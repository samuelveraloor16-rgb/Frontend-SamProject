const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
function load(file, deps = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { exports, require: name => { assert.ok(name in deps, name); return deps[name]; } });
  return exports;
}
const menciones = load('src/lib/menciones.ts');
class ApiRequestError extends Error { constructor(statusCode) { super('rechazado'); this.statusCode = statusCode; } }
const client = { ApiRequestError, esEscrituraIncierta: e => !e.statusCode || e.statusCode === 408 || e.statusCode >= 500,
  mensajeDeError: e => e.message };
const coordinador = load('src/lib/ComentarioWriteCoordinator.ts', { '../api/client': client, './menciones': menciones });
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const respuesta = replay => ({ comentario: { id: 'c', tareaId: 't', texto: ' Hola @[u] ' }, idempotencyReplayed: replay });
function harness(cacheExterno) {
  const hooks = [], effects = [], calls = [], invalidaciones = [], cola = [];
  let index = 0, vigente = true, denied = 0, props = { tareaId: 't', sesion: 'sesion-A', soloLectura: false };
  const react = {
    useState(initial) { const i = index++; if (!(i in hooks)) hooks[i] = typeof initial === 'function' ? initial() : initial;
      return [hooks[i], next => { hooks[i] = typeof next === 'function' ? next(hooks[i]) : next; }]; },
    useRef(initial) { const i = index++; return hooks[i] ??= { current: initial }; },
    useEffect(fn, deps) { const i = index++; const old = hooks[i];
      if (!old || deps.some((d, n) => d !== old.deps[n])) effects.push(() => { old?.cleanup?.(); hooks[i] = { deps, cleanup: fn() }; }); },
    useSyncExternalStore(_subscribe, snapshot) { return snapshot(); },
  };
  react.useLayoutEffect = react.useEffect;
  const jsx = (type, props, key) => ({ type, props: props || {}, key });
  const cache = { invalidateQueries: value => { invalidaciones.push(value); return cacheExterno?.invalidateQueries(value) ?? Promise.resolve(); } };
  const mod = load('src/components/ComentarioPublicacion.tsx', {
    react, 'react/jsx-runtime': { jsx, jsxs: jsx }, 'react-native': { Pressable: 'Pressable', Text: 'Text', View: 'View' },
    '@tanstack/react-query': { useQueryClient: () => cache },
    '../api/comentarios': { crearComentario: (...args) => { calls.push(args); return cola.shift().promise; } },
    '../lib/comentariosLectura': { accesoComentariosDenegado: e => [401, 403, 404].includes(e.statusCode), comentariosKey: (id, s) => ['comentarios', id, s] },
    '../lib/ComentarioWriteCoordinator': coordinador, '../lib/menciones': menciones,
    './ComentarioBorrador': { ComentarioBorrador: 'Borrador' },
  });
  function render(flush = true) {
    index = 0;
    const tree = mod.ComentarioPublicacion({ ...props, vigente: () => vigente, perderAcceso: () => denied++ });
    const nodes = [];
    const walk = n => { if (Array.isArray(n)) return n.forEach(walk); if (n == null || typeof n === 'boolean') return;
      nodes.push(n); if (typeof n === 'object') walk(n.props.children); };
    walk(tree); if (flush) effects.splice(0).forEach(fn => fn());
    return { draft: nodes.find(n => n?.type === 'Borrador'), retry: nodes.find(n => n?.type === 'Pressable'),
      text: nodes.filter(n => typeof n === 'string').join('\n') };
  }
  return { render, calls, invalidaciones, cola, setProps: p => { props = { ...props, ...p }; },
    revoke: () => { vigente = false; }, denied: () => denied,
    unmount: () => hooks.forEach(h => h?.cleanup?.()) };
}
const settle = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };

test('UI: éxito/replay true/false, doble toque síncrono, bloqueo antes de render y refresco único confirmado', async () => {
  for (const replay of [true, false]) {
    const h = harness(), d = deferred(); h.cola.push(d);
    const ui = h.render(); const control = ui.draft.props.publicacion;
    control.publicar(' Hola @[u] '); control.publicar('otro');
    assert.equal(control.puedeEditar(), false);
    assert.equal(h.calls.length, 1); assert.equal(h.calls[0][1].texto, ' Hola @[u] ');
    assert.equal(h.render().draft.props.publicacion.bloqueado, true);
    assert.equal(h.invalidaciones.length, 0);
    d.resolve(respuesta(replay)); await settle();
    assert.equal(control.puedeEditar(), false); // todavía no se limpió el borrador confirmado
    const confirmed = h.render(); assert.ok(confirmed.text.includes('Comentario publicado.'));
    assert.equal(control.puedeEditar(), false); // callbacks del editor anterior quedan obsoletos
    control.publicar('otra edición antigua'); assert.equal(h.calls.length, 1);
    const clean = h.render(); assert.notEqual(clean.draft.key, ui.draft.key);
    assert.equal(clean.draft.props.publicacion.bloqueado, false);
    assert.equal(h.invalidaciones.length, 1);
    assert.equal(JSON.stringify(h.invalidaciones[0]), JSON.stringify({ queryKey: ['comentarios', 't', 'sesion-A'], exact: true }));
    h.render(); assert.equal(h.invalidaciones.length, 1);
  }
});
test('UI: red/503/408 inciertos, solo retry manual conserva tarea/texto/clave, sin descarte ni optimismo', async () => {
  for (const status of [0, 503, 408]) {
    const h = harness(), d = deferred(); h.cola.push(d);
    const ui = h.render(); ui.draft.props.publicacion.publicar(' Hola @[u] ');
    d.reject(new ApiRequestError(status)); await settle();
    const uncertain = h.render(); assert.equal(uncertain.draft.key, ui.draft.key);
    assert.equal(uncertain.draft.props.publicacion.bloqueado, true);
    assert.match(uncertain.text, /solo en memoria/); assert.match(uncertain.text, /duplicar/);
    assert.match(uncertain.text, /24 horas/); assert.doesNotMatch(uncertain.text, /Descartar/);
    uncertain.draft.props.publicacion.publicar('mutar intención');
    assert.equal(h.calls.length, 1); assert.equal(h.invalidaciones.length, 0);
    const retry = deferred(); h.cola.push(retry); uncertain.retry.props.onPress(); uncertain.retry.props.onPress();
    assert.equal(h.calls.length, 2); assert.deepEqual(h.calls[0], h.calls[1]);
    retry.resolve(respuesta(true)); await settle(); h.render();
    assert.equal(h.invalidaciones.length, 1);
  }
});
test('UI: 400/403/404/409 definitivos conservan borrador, no refrescan y acceso denegado se limpia', async () => {
  for (const status of [400, 403, 404, 409]) {
    const h = harness(), d = deferred(); h.cola.push(d);
    const ui = h.render(); ui.draft.props.publicacion.publicar('texto');
    d.reject(new ApiRequestError(status)); await settle();
    const failed = h.render(); assert.equal(failed.draft.key, ui.draft.key);
    assert.equal(failed.draft.props.publicacion.bloqueado, false);
    assert.equal(failed.retry, undefined); assert.equal(h.invalidaciones.length, 0);
    assert.equal(h.denied(), [403, 404].includes(status) ? 1 : 0);
    if (status === 409) assert.match(failed.text, /Clave reutilizada/);
  }
});
test('UI: respuesta tardía tras desmontaje o cambio sesión no limpia borrador ni invalida ni revoca nuevo usuario', async () => {
  for (const revoke of [false, true]) for (const failure of [false, true]) {
    const h = harness(), d = deferred(); h.cola.push(d);
    h.render().draft.props.publicacion.publicar('privado');
    if (revoke) h.revoke(); else h.unmount();
    if (failure) d.reject(new ApiRequestError(404)); else d.resolve(respuesta(false));
    await settle(); h.render(); assert.equal(h.invalidaciones.length, 0); assert.equal(h.denied(), 0);
  }
});
test('UI: archivado y límites bloquean nuevas intenciones, replay incierto sigue disponible', async () => {
  const h = harness(); const previo = h.render(); h.setProps({ soloLectura: true });
  assert.equal(h.render().draft, undefined);
  previo.draft.props.publicacion.publicar('texto'); assert.equal(h.calls.length, 0);
  h.setProps({ soloLectura: false });
  for (const text of ['', '   ', 'a'.repeat(4001), '@[roto', Array.from({ length: 21 }, (_, i) => `@[u${i}]`).join('')]) {
    h.render().draft.props.publicacion.publicar(text);
  }
  assert.equal(h.calls.length, 0);
  const d = deferred(); h.cola.push(d); h.render().draft.props.publicacion.publicar('texto');
  d.reject(new ApiRequestError(503)); await settle(); h.setProps({ soloLectura: true });
  const retry = deferred(); h.cola.push(retry); h.render().retry.props.onPress();
  assert.deepEqual(h.calls[0], h.calls[1]); retry.resolve(respuesta(true)); await settle();
});
test('consultas reales: respuestas privadas tardías no comparten clave entre sesiones', async () => {
  const rq = require('@tanstack/react-query'); const d = deferred();
  const lib = load('src/lib/comentariosLectura.ts', { '@tanstack/react-query': rq,
    '../api/comentarios': { listarComentarios: () => d.promise }, '../api/client': { ApiRequestError } });
  const directory = load('src/lib/miembrosMencionables.ts', { '@tanstack/react-query': rq,
    '../api/comentarios': {}, './comentariosLectura': lib });
  const a = lib.comentariosLecturaOptions('t', undefined, 'A');
  const b = lib.comentariosLecturaOptions('t', undefined, 'B');
  assert.notDeepEqual(a.queryKey, b.queryKey);
  assert.notDeepEqual(directory.miembrosMencionablesOptions('t', '', () => {}, 'A').queryKey,
    directory.miembrosMencionablesOptions('t', '', () => {}, 'B').queryKey);
  const cache = new rq.QueryClient(); const old = cache.fetchInfiniteQuery(a);
  d.resolve({ datos: [{ id: 'privado-A' }], meta: { pagina: 1, totalPaginas: 1 } }); await old;
  assert.equal(cache.getQueryData(b.queryKey), undefined); cache.clear();
});
test('historial real: replay confirmado refresca solo servidor y no duplica comentario existente', async () => {
  const rq = require('@tanstack/react-query'); const cache = new rq.QueryClient(); let lecturas = 0;
  const lib = load('src/lib/comentariosLectura.ts', { '@tanstack/react-query': rq,
    '../api/comentarios': { listarComentarios: async () => { lecturas++; return {
      datos: [{ id: 'c', texto: 'respuesta autorizada actual' }], meta: { pagina: 1, totalPaginas: 1 } }; } },
    '../api/client': { ApiRequestError } });
  const observer = new rq.InfiniteQueryObserver(cache, lib.comentariosLecturaOptions('t', undefined, 'sesion-A'));
  const unsubscribe = observer.subscribe(() => {}); await observer.refetch();
  const h = harness(cache), d = deferred(); h.cola.push(d);
  h.render().draft.props.publicacion.publicar(' Hola @[u] ');
  assert.equal(lecturas, 1); assert.equal(observer.getCurrentResult().data.pages[0].datos.length, 1);
  d.resolve(respuesta(true)); await settle();
  assert.equal(lecturas, 2);
  const comentarios = observer.getCurrentResult().data.pages.flatMap(p => p.datos);
  assert.deepEqual(comentarios, [{ id: 'c', texto: 'respuesta autorizada actual' }]);
  assert.equal(h.invalidaciones.length, 1); unsubscribe(); cache.clear();
});
