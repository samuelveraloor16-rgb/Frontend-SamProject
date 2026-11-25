const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
function load(file, deps) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { exports, require: n => { assert.ok(n in deps, n); return deps[n]; }, Date, Set });
  return exports;
}
class ApiRequestError extends Error { constructor(statusCode) { super('API'); this.statusCode = statusCode; } }
const notice = (id, leida = false) => ({ id, tipo: 'MENCION', titulo: 'Te mencionaron', cuerpo: null,
  leida, datos: { tareaId: 'privado', comentarioId: 'privado' }, creadoEn: '2026-11-19T12:00:00.000Z' });
const page = (n, datos = [notice('a')], totalPaginas = 2) => ({ datos, meta: { pagina: n, totalPaginas } });
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
function setup(api = {}, vigente = () => true) {
  const { NotificacionesController } = load('src/lib/NotificacionesController.ts', {
    '../api/notificaciones': { listarNotificaciones: async () => page(1), marcarNotificacionLeida: async id => notice(id, true), ...api },
    '../api/client': { ApiRequestError },
    '../api/tareas': { obtenerTarea: async id => ({ id, proyectoId: 'pro_actual' }), ...api.tareas },
    '../api/proyectos': { obtenerProyecto: async id => ({ id, espacioId: 'esp_actual', archivado: false }), ...api.proyectos },
  });
  return new NotificacionesController(vigente);
}
test('lista propia: orden servidor, páginas 20, final y actualizar desde 1 sin datos viejos', async () => {
  const calls = [];
  const c = setup({ listarNotificaciones: async args => { calls.push(args); return page(args.page, args.page === 1 ? [notice('z'), notice('a', true)] : [notice('b')]); } });
  await c.cargar(); await c.cargar(true); await c.cargar(true);
  assert.equal(JSON.stringify(c.getSnapshot().avisos.map(n => n.id)), '["z","a","b"]');
  assert.equal(c.getSnapshot().hayMas, false);
  assert.equal(JSON.stringify(calls), '[{"page":1,"pageSize":20},{"page":2,"pageSize":20}]');
  const refresh = c.cargar(); assert.equal(c.getSnapshot().avisos.length, 0); await refresh;
  assert.equal(calls.at(-1).page, 1);
});
test('carga inicial/vacío independientes y doble carga bloqueada', async () => {
  const d = deferred(); let calls = 0;
  const c = setup({ listarNotificaciones: () => { calls++; return d.promise; } });
  const p = c.cargar(); await c.cargar();
  assert.equal(c.getSnapshot().cargando, true); assert.equal(calls, 1);
  d.resolve(page(1, [], 0)); await p;
  assert.equal(c.getSnapshot().cargando, false); assert.equal(c.getSnapshot().error, null);
  assert.equal(c.getSnapshot().avisos.length, 0); assert.equal(c.getSnapshot().hayMas, false);
});
test('marcado confirmado, doble toque bloqueado y ya leído no envía', async () => {
  const d = deferred(); let calls = 0;
  const c = setup({ marcarNotificacionLeida: () => { calls++; return d.promise; } });
  await c.cargar(); const p = c.marcar('a'); await c.marcar('a'); await c.cargar(true);
  assert.equal(calls, 1); assert.equal(c.getSnapshot().avisos[0].leida, false);
  assert.equal(c.getSnapshot().mensaje, null);
  d.resolve(notice('a', true)); await p;
  assert.equal(c.getSnapshot().avisos[0].leida, true); assert.equal(c.getSnapshot().mensaje, 'Aviso marcado como leído');
  await c.marcar('a'); assert.equal(calls, 1);
});
test('HTTP/red al marcar conserva estado confirmado, permite reintento manual sin auto retry', async () => {
  for (const error of [new ApiRequestError(429), new ApiRequestError(503), new Error('red')]) {
    let calls = 0;
    const c = setup({ marcarNotificacionLeida: async id => { if (++calls === 1) throw error; return notice(id, true); } });
    await c.cargar(); await c.marcar('a');
    assert.equal(calls, 1); assert.equal(c.getSnapshot().avisos[0].leida, false);
    assert.equal(c.getSnapshot().erroresMarca.a, 'No se pudo marcar como leído');
    assert.equal(c.getSnapshot().marcando.length, 0);
    await c.marcar('a'); assert.equal(c.getSnapshot().avisos[0].leida, true);
  }
});
test('403/404/401 al marcar retira toda lista y descarta otros marcados tardíos', async () => {
  for (const status of [401, 403, 404]) {
    const d = deferred();
    const c = setup({ listarNotificaciones: async () => page(1, [notice('a'), notice('b')]),
      marcarNotificacionLeida: async id => { if (id === 'a') throw new ApiRequestError(status); return d.promise; } });
    await c.cargar(); const b = c.marcar('b'); await c.marcar('a');
    d.resolve(notice('b', true)); await b;
    assert.equal(c.getSnapshot().avisos.length, 0); assert.equal(c.getSnapshot().marcando.length, 0);
    assert.match(c.getSnapshot().error, /verificar el acceso/); assert.equal(c.getSnapshot().mensaje, null);
  }
});
test('fallo de listado inicial o página oculta copia sin autorizar; reintento reinicia página 1', async () => {
  for (const error of [new ApiRequestError(403), new ApiRequestError(404), new ApiRequestError(503), new Error('red')]) {
    for (const mas of [false, true]) {
      let fail = false; const calls = [];
      const c = setup({ listarNotificaciones: async args => { calls.push(args.page); if (fail) throw error; return page(1); } });
      if (mas) await c.cargar(); fail = true; await c.cargar(mas);
      assert.equal(c.getSnapshot().avisos.length, 0); assert.ok(c.getSnapshot().error);
      assert.equal(c.getSnapshot().cargando, false);
      fail = false; await c.cargar(); assert.equal(calls.at(-1), 1);
      assert.equal(c.getSnapshot().error, null);
    }
  }
});
test('sesión cambiada: listado y marcado tardíos no publican datos ni mensajes', async () => {
  for (const marca of [false, true]) {
    for (const reject of [false, true]) {
      const d = deferred(); let actual = true;
      const c = setup(marca ? { marcarNotificacionLeida: () => d.promise } : { listarNotificaciones: () => d.promise }, () => actual);
      if (marca) await c.cargar();
      const p = marca ? c.marcar('a') : c.cargar();
      actual = false; c.limpiar();
      if (reject) d.reject(new ApiRequestError(404)); else d.resolve(marca ? notice('a', true) : page(1));
      await p;
      assert.equal(c.getSnapshot().avisos.length, 0); assert.equal(c.getSnapshot().mensaje, null); assert.equal(c.getSnapshot().error, null);
      await c.cargar(); await c.marcar('a'); assert.equal(c.getSnapshot().avisos.length, 0);
    }
  }
});
test('blur/desmontaje invalida respuesta pendiente incluso misma sesión', async () => {
  const d = deferred(); const c = setup({ listarNotificaciones: () => d.promise });
  const p = c.cargar(); c.limpiar(); d.resolve(page(1)); await p;
  assert.equal(c.getSnapshot().avisos.length, 0);
});

function render(state = {}) {
  const jsx = (type, props, key) => ({ type, props: props || {}, key }); const effects = []; const actions = []; const cache = [];
  const snapshot = { avisos: [notice('a'), notice('b', true)], pagina: 1, cargando: false, error: null, hayMas: false,
    marcando: [], erroresMarca: {}, mensaje: null, ...state };
  const controller = { subscribe() {}, getSnapshot: () => snapshot, cargar: mas => actions.push(mas ? 'next' : 'load'),
    marcar: id => actions.push(id), abrir: (id, navegar) => { actions.push('open'); navegar(id, { id: 'p', archivado: true }); }, limpiar: () => actions.push('clear') };
  let session = { usuarioId: 'u', tokenVersion: 1, generation: 2 };
  const { NotificacionesScreen } = load('src/screens/NotificacionesScreen.tsx', {
    react: { useState: () => [controller], useSyncExternalStore: (_, get) => get(), useCallback: fn => fn },
    'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-native': Object.fromEntries(['ActivityIndicator', 'Pressable', 'ScrollView', 'Text', 'View'].map(n => [n, n])),
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
    '@react-navigation/native': { useFocusEffect: fn => effects.push(fn) },
    '@tanstack/react-query': { useQueryClient: () => ({ removeQueries: q => cache.push(q), setQueryData: (key, value) => cache.push({ key, value }) }) },
    '../auth/AuthContext': { useAuth: () => ({ capturarSesion: () => session, esSesionActual: () => true }) },
    '../lib/NotificacionesController': { NotificacionesController: function() { return controller; } },
    '../theme/colors': { colors: { primary: '#245B4A', secondary: '#DCE9DF', text: '#34413A', background: '#F7F8F5' } },
  });
  const props = { navigation: { goBack: () => actions.push('back'), navigate: (route, params) => actions.push([route, params]) } };
  const root = NotificacionesScreen(props); const nodes = [];
  function walk(n) {
    if (Array.isArray(n)) return n.forEach(walk);
    if (n == null || typeof n === 'boolean') return;
    if (typeof n.type === 'function') return walk(n.type(n.props));
    nodes.push(n); if (typeof n === 'object') walk(n.props.children);
  }
  walk(root);
  return { nodes, text: nodes.filter(n => typeof n === 'string').join('\n'), actions, effects, cache,
    otherKey: () => { session = { ...session, generation: 3 }; return NotificacionesScreen(props).key; }, key: root.key,
    noSession: () => { session = null; return NotificacionesScreen(props); } };
}
test('UI: título/fecha/lectura y acciones independientes accesibles sin IDs privados', () => {
  const ui = render(); assert.match(ui.text, /Te mencionaron/); assert.match(ui.text, /No leído/); assert.match(ui.text, /Leído/);
  assert.doesNotMatch(ui.text, /privado|Ver tarea/);
  const buttons = ui.nodes.filter(n => n.type === 'Pressable');
  assert.ok(buttons.every(n => n.props.accessibilityRole === 'button' && n.props.style.minHeight >= 44));
  assert.equal(buttons.filter(n => n.props.accessibilityLabel.startsWith('Marcar como leído:')).length, 1);
  buttons.find(n => n.props.accessibilityLabel.startsWith('Marcar como leído:')).props.onPress(); assert.deepEqual(ui.actions, ['a']);
  assert.notEqual(ui.key, ui.otherKey()); assert.equal(ui.noSession(), null);
  const cleanup = ui.effects[0](); cleanup(); assert.deepEqual(ui.actions, ['a', 'load', 'clear']);
});
test('UI: vacío, error, carga, paginación, marcado ocupado y confirmación independientes', () => {
  assert.doesNotMatch(render({ avisos: [], pagina: 0 }).text, /Aún no tienes/);
  assert.match(render({ avisos: [] }).text, /Aún no tienes notificaciones/);
  assert.doesNotMatch(render({ avisos: [], cargando: true }).text, /Aún no tienes/);
  assert.match(render({ avisos: [], cargando: true }).text, /Cargando notificaciones/);
  const failed = render({ avisos: [], error: 'No se pudieron cargar las notificaciones' });
  assert.doesNotMatch(failed.text, /Aún no tienes/);
  failed.nodes.find(n => n.props?.accessibilityLabel === 'Reintentar cargar notificaciones').props.onPress(); assert.deepEqual(failed.actions, ['load']);
  const more = render({ hayMas: true }); more.nodes.find(n => n.props?.accessibilityLabel === 'Cargar más notificaciones').props.onPress(); assert.deepEqual(more.actions, ['next']);
  const busy = render({ marcando: ['a'] }); const button = busy.nodes.find(n => n.props?.accessibilityLabel?.startsWith('Marcar como leído:'));
  assert.equal(button.props.disabled, true); assert.equal(button.props.accessibilityState.busy, true); button.props.onPress(); assert.deepEqual(busy.actions, []);
  assert.match(render({ mensaje: 'Aviso marcado como leído' }).text, /Aviso marcado como leído/);
  assert.match(render({ erroresMarca: { a: 'No se pudo marcar como leído' } }).text, /Reintentar marcar como leído/);
});
test('entrada autenticada y navegación a ruta real con solo tareaId', () => {
  const nav = fs.readFileSync('src/navigation/AppNavigator.tsx', 'utf8');
  assert.ok(nav.indexOf('<Stack.Screen name="Notificaciones"') > nav.indexOf('{autenticado ?'));
  assert.match(fs.readFileSync('src/screens/HomeScreen.tsx', 'utf8'), /navigate\('Notificaciones'\)/);
  const ui = render();
  ui.nodes.find(n => n.props?.accessibilityLabel?.startsWith('Abrir tarea:')).props.onPress();
  assert.equal(JSON.stringify(ui.actions), JSON.stringify(['open', ['TareaDetalle', { tareaId: 'a' }]]));
  assert.equal(JSON.stringify(ui.cache), JSON.stringify([{ queryKey: ['tarea', 'a'], exact: true },
    { key: ['proyecto', 'p'], value: { id: 'p', archivado: true } }]));
});

test('abrir revalida GET tarea/proyecto actuales, archivado permitido, sin PATCH y doble toque', async () => {
  for (const archivado of [false, true]) {
    const calls = []; const d = deferred(); let patches = 0; const opened = [];
    const c = setup({ tareas: { obtenerTarea: id => { calls.push(id); return d.promise; } },
      proyectos: { obtenerProyecto: async id => { calls.push(id); return { id, espacioId: 'e', archivado }; } },
      marcarNotificacionLeida: () => { patches++; } });
    await c.cargar(); const p = c.abrir('a', id => opened.push(id)); await c.abrir('a', () => assert.fail());
    d.resolve({ id: 'privado', proyectoId: 'movido' }); await p;
    assert.deepEqual(calls, ['privado', 'movido']); assert.deepEqual(opened, ['privado']);
    await c.abrir('a', () => assert.fail()); assert.equal(patches, 0); assert.equal(c.getSnapshot().avisos[0].leida, false);
  }
});
test('aviso antiguo sin tareaId o valor no string/vacío no resuelve ni navega', async () => {
  for (const tareaId of [undefined, null, 7, {}, '', '  ']) {
    const n = notice('a'); n.datos = { tareaId };
    const c = setup({ listarNotificaciones: async () => page(1, [n]), tareas: { obtenerTarea: () => assert.fail() } });
    await c.cargar(); await c.abrir('a', () => assert.fail()); assert.match(c.getSnapshot().mensaje, /no permite/);
  }
});
test('IDs opacos se codifican como segmento sin inventar validación UUID/CUID', async () => {
  const n = notice('a'); n.datos.tareaId = 't/?:#'; const calls = [];
  const c = setup({ listarNotificaciones: async () => page(1, [n]),
    tareas: { obtenerTarea: async id => { calls.push(id); return { id: 't/?:#', proyectoId: 'p/1' }; } },
    proyectos: { obtenerProyecto: async id => { calls.push(id); return { id: 'p/1', espacioId: 'e', archivado: false }; } } });
  await c.cargar(); await c.abrir('a', id => assert.equal(id, 't/?:#'));
  assert.deepEqual(calls, ['t/?:#', 'p/1']);
  const paths = [];
  const deps = { './client': { request: path => { paths.push(path); } }, './espacios': { queryString() {} } };
  load('src/api/tareas.ts', deps).obtenerTarea('t/?:#');
  load('src/api/proyectos.ts', deps).obtenerProyecto('p/1');
  assert.deepEqual(paths, ['/tareas/t%2F%3F%3A%23', '/proyectos/p%2F1']);
});
test('acceso perdido/tarea eliminada/fallo de red en cualquiera de las consultas: no abre y retira copia', async () => {
  for (const etapa of ['tareas', 'proyectos']) for (const status of [401, 403, 404, 503]) {
    const c = setup({ [etapa]: etapa === 'tareas' ? { obtenerTarea: async () => { throw new ApiRequestError(status); } }
      : { obtenerProyecto: async () => { throw new ApiRequestError(status); } } });
    await c.cargar(); await c.abrir('a', () => assert.fail());
    assert.equal(c.getSnapshot().avisos.length, 0); assert.match(c.getSnapshot().mensaje, /verificar el acceso/);
  }
});
test('sesión cambiada o blur durante cada GET descarta respuesta tardía y navegación', async () => {
  for (const etapa of ['tareas', 'proyectos']) for (const cambioSesion of [false, true]) {
    let vigente = true; const d = deferred(); const started = deferred();
    const c = setup({ [etapa]: etapa === 'tareas' ? { obtenerTarea: () => { started.resolve(); return d.promise; } }
      : { obtenerProyecto: () => { started.resolve(); return d.promise; } } }, () => vigente);
    await c.cargar(); const p = c.abrir('a', () => assert.fail()); await started.promise;
    if (cambioSesion) vigente = false;
    c.limpiar(); d.resolve(etapa === 'tareas' ? { id: 'privado', proyectoId: 'p' } : { id: 'pro_actual', espacioId: 'e', archivado: false }); await p;
    assert.equal(c.getSnapshot().avisos.length, 0); assert.equal(c.getSnapshot().mensaje, null);
  }
});
test('respuestas con IDs ausentes o identidad distinta no navegan', async () => {
  for (const tarea of [{}, { id: 'otro', proyectoId: 'p' }, { id: 'privado', proyectoId: null }]) {
    const c = setup({ tareas: { obtenerTarea: async () => tarea } }); await c.cargar(); await c.abrir('a', () => assert.fail());
    assert.match(c.getSnapshot().mensaje, /No se pudo abrir/);
  }
});
