const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const rq = require('@tanstack/react-query');

function load(file, deps) {
  const exports = {};
  const js = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020,
      jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(js, { exports, require: name => {
    assert.ok(name in deps, name); return deps[name];
  }, Date });
  return exports;
}
class ApiRequestError extends Error {
  constructor(statusCode) { super('API'); this.statusCode = statusCode; }
}
function options(api) {
  return load('src/lib/comentariosLectura.ts', {
    '@tanstack/react-query': rq,
    '../api/comentarios': { listarComentarios: api }, '../api/client': { ApiRequestError },
  });
}
const comment = (id, texto = ' Hola @[usr_2]\n@@[literal] <b>texto</b> ') => ({
  id, texto, autor: { id: 'usr_1', nombre: 'Nombre largo del servidor' },
  creadoEn: '2026-11-19T12:00:00.000Z',
});
const page = (n, ids, totalPaginas = 2) => ({ datos: ids.map(id => comment(id)),
  meta: { pagina: n, tamanoPagina: 20, total: 21, totalPaginas } });

test('query real: páginas de 20, orden servidor, final y aislamiento por tarea', async () => {
  const calls = [];
  const lib = options(async (id, params) => {
    calls.push([id, params.page, params.pageSize]);
    return page(params.page, params.page === 1 ? ['z', 'a'] : ['b']);
  });
  const client = new rq.QueryClient();
  const observer = new rq.InfiniteQueryObserver(client, lib.comentariosLecturaOptions('t1'));
  await observer.refetch();
  await observer.fetchNextPage();
  assert.deepEqual(observer.getCurrentResult().data.pages.flatMap(p => p.datos.map(c => c.id)), ['z', 'a', 'b']);
  assert.equal(observer.getCurrentResult().hasNextPage, false);
  await client.fetchInfiniteQuery(lib.comentariosLecturaOptions('t2'));
  assert.deepEqual(calls, [['t1', 1, 20], ['t1', 2, 20], ['t2', 1, 20]]);
  client.clear();
});

test('query real: sin reintentos de 401/403/404 y clasificación cerrada', async () => {
  for (const status of [401, 403, 404]) {
    let calls = 0;
    const lib = options(async () => { calls++; throw new ApiRequestError(status); });
    const client = new rq.QueryClient();
    let denied = 0;
    await assert.rejects(client.fetchInfiniteQuery(lib.comentariosLecturaOptions('t', () => denied++)));
    assert.equal(denied, 1);
    assert.equal(calls, 1);
    assert.equal(lib.accesoComentariosDenegado(new ApiRequestError(status)), true);
    assert.equal(lib.accesoComentariosDenegado(new ApiRequestError(503)), false);
    assert.equal(lib.comentariosLecturaOptions('t').gcTime, 0);
    assert.equal(lib.comentariosLecturaOptions('t').refetchOnMount, 'always');
    client.clear();
  }
});

function render(state = {}, props = {}) {
  const effects = []; const removed = []; const actions = [];
  const lib = options(async () => {});
  const query = { isPending: false, isFetching: false, isFetchingNextPage: false,
    isError: false, hasNextPage: false, data: { pages: [page(1, ['a'])] },
    refetch: () => actions.push('refetch'), fetchNextPage: () => actions.push('next'), ...state };
  const jsx = (type, props, key) => ({ type, props: props || {}, key });
  const { ComentariosSection } = load('src/components/ComentariosSection.tsx', {
    react: { useState: () => [false, v => actions.push(['denied', v])],
      useEffect: fn => effects.push(fn) },
    'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' },
    'react-native': Object.fromEntries(['ActivityIndicator', 'Pressable', 'Text', 'View'].map(n => [n, n])),
    '@tanstack/react-query': { useInfiniteQuery: () => query,
      useQueryClient: () => ({ removeQueries: x => removed.push(x) }) },
    '../lib/comentariosLectura': lib, '../theme/colors': { colors: { primary: '#245B4A' } },
    './ComentarioPublicacion': { ComentarioPublicacion: 'ComentarioPublicacion' },
    '../auth/AuthContext': { useAuth: () => ({ capturarSesion: () => ({ usuarioId: 'u', tokenVersion: 1, generation: 2 }), esSesionActual: () => true }) },
    '../lib/miembrosMencionables': { miembrosMencionablesKey: (id, sesion) => ['miembros-mencionables', id, sesion] },
  });
  const section = ComentariosSection({ tareaId: 't', soloLectura: false, ...props });
  const tree = section.type(section.props);
  const nodes = [];
  function walk(n) {
    if (Array.isArray(n)) return n.forEach(walk);
    if (n == null || typeof n === 'boolean') return;
    nodes.push(n); if (typeof n === 'object') walk(n.props.children);
  }
  walk(tree);
  return { nodes, text: nodes.filter(n => typeof n === 'string').join('\n'), effects, removed, actions };
}

test('UI: autor, fecha/hora y texto íntegro sin resolver marcadores ni truncar', () => {
  const ui = render();
  assert.ok(ui.text.includes(comment('a').texto));
  assert.ok(ui.text.includes('Nombre largo del servidor'));
  assert.ok(ui.text.includes(new Date(comment('a').creadoEn).toLocaleString('es')));
  assert.equal(ui.nodes.some(n => n?.props?.numberOfLines), false);
  assert.equal(ui.nodes.some(n => n?.type === 'TextInput'), false);
});
test('UI: carga y revalidación no exponen páginas cacheadas', () => {
  for (const state of [{ isPending: true }, { isFetching: true }]) {
    const ui = render(state);
    assert.ok(ui.text.includes('Cargando comentarios…'));
    assert.ok(!ui.text.includes(comment('a').texto));
  }
});
test('UI: vacío independiente sin invitar a publicar', () => {
  const ui = render({ data: { pages: [page(1, [], 0)] } });
  assert.ok(ui.text.includes('Aún no hay comentarios'));
  assert.ok(!ui.text.includes('Escribe'));
});
test('UI: error inicial reintenta consulta, error de página reintenta esa página', () => {
  for (const next of [false, true]) {
    const ui = render({ isError: true, isFetchNextPageError: next,
      data: next ? { pages: [page(1, ['a'])] } : undefined });
    assert.ok(ui.text.includes('No se pudieron cargar los comentarios'));
    assert.ok(!ui.text.includes('Aún no hay comentarios'));
    ui.nodes.find(n => n?.type === 'Pressable').props.onPress();
    assert.deepEqual(ui.actions, [next ? 'next' : 'refetch']);
  }
});
test('UI: pérdida acceso en cualquier página oculta y retira caché exacta', () => {
  for (const status of [401, 403, 404]) {
    const ui = render({ isError: true, error: new ApiRequestError(status), isFetchNextPageError: true });
    assert.ok(ui.text.includes('Esta tarea ya no está disponible o no tienes acceso'));
    assert.ok(!ui.text.includes(comment('a').texto));
    assert.equal(ui.nodes.some(n => n?.type === 'Pressable'), false);
    ui.effects.forEach(fn => fn());
    assert.equal(JSON.stringify(ui.removed), JSON.stringify([{ queryKey: ['comentarios', 't', 'u:1:2'], exact: true }, { queryKey: ['miembros-mencionables', 't', 'u:1:2'] }]));
    assert.equal(ui.nodes.some(n => n?.type === 'ComentarioBorrador'), false);
    assert.deepEqual(ui.actions, []);
  }
});
test('UI: cargar más conserva historial y bloquea duplicados durante carga', () => {
  const ui = render({ hasNextPage: true });
  assert.ok(ui.text.includes('Cargar más comentarios'));
  ui.nodes.find(n => n?.type === 'Pressable').props.onPress();
  assert.deepEqual(ui.actions, ['next']);
  const loading = render({ hasNextPage: true, isFetching: true, isFetchingNextPage: true });
  assert.ok(loading.text.includes(comment('a').texto));
  const button = loading.nodes.find(n => n?.type === 'Pressable');
  assert.equal(button.props.disabled, true);
  button.props.onPress();
  assert.deepEqual(loading.actions, []);
});
test('UI: proyecto archivado mantiene lectura y copy aprobado sin acciones de escritura', () => {
  const ui = render({}, { soloLectura: true });
  assert.ok(ui.text.includes('Proyecto archivado: comentarios de solo lectura'));
  assert.ok(ui.text.includes(comment('a').texto));
  assert.equal(ui.nodes.some(n => n?.type === 'Pressable'), false);
  assert.equal(ui.nodes.some(n => n?.type === 'ComentarioBorrador'), false);
});
test('integración: sección posterior a subtareas y anterior a eliminar, también para subtareas', () => {
  const source = fs.readFileSync('src/screens/TareaDetalleScreen.tsx', 'utf8');
  const section = source.indexOf('<ComentariosSection');
  assert.ok(section > source.indexOf('{/* Subtareas'));
  assert.ok(section < source.indexOf('{/* Eliminar tarea */}'));
  assert.match(source.slice(section - 30, section), /\) : null\}/);
});
