const test = require('node:test');
const assert = require('node:assert/strict');
const ts = require('typescript');
const fs = require('node:fs');
const vm = require('node:vm');
function load(path, deps = {}, globals = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText,
    { exports, require: n => { if (!(n in deps)) throw Error(n); return deps[n]; }, ...globals });
  return exports;
}
const payload = load('src/push/payload.ts');
const { PushController } = load('src/push/PushController.ts', { './payload': payload });
const data = { tipo: 'MENCION', tareaId: 'task_opaque', proyectoId: 'project_opaque', espacioId: 'space_opaque', comentarioId: 'comment_opaque' };
const session = (generation = 1, usuarioId = 'u1') => ({ generation, tokenVersion: generation, usuarioId, jwt: `jwt-${generation}` });
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return { promise, resolve, reject }; };
const tick = () => new Promise(resolve => setImmediate(resolve));
function setup(overrides = {}) {
  const calls = [], stored = [], nav = [];
  const d = {
    api: {
      registrar: async (jwt, token) => { calls.push(['register', jwt, token]); return { id: token === 'expo2' ? 'd2' : 'd1' }; },
      revocar: async (jwt, id) => { calls.push(['delete', jwt, id]); },
      codigo: async () => ({ codigo: 'ABCDEFG2', expiraEn: 'later' }),
      transferir: async () => { calls.push(['transfer']); return { id: 'd1' }; },
    },
    token: async () => ({ token: 'expo1', plataforma: 'ANDROID' }),
    load: async () => [], save: async b => { stored.push(JSON.parse(JSON.stringify(b))); },
    status: e => e?.status,
    tarea: async (jwt, id) => { calls.push(['task', jwt, id]); return { id, proyectoId: data.proyectoId }; },
    proyecto: async (jwt, id) => ({ id, espacioId: data.espacioId }),
    ...overrides,
  };
  const c = new PushController(d); c.setNavigator(id => nav.push(id));
  return { c, d, calls, stored, nav };
}
test('payload mínimo estricto: rechaza rutas, campos privados, tipos y comentario incompatibles', () => {
  assert.ok(payload.parsePushPayload(data));
  for (const v of [null, [], { ...data, url: 'https://evil' }, { ...data, titulo: 'privado' }, { ...data, tipo: 'OTRO' }, { ...data, tareaId: '../x' }, { ...data, espacioId: 'https://x' }, { ...data, comentarioId: null }, { ...data, tipo: 'TAREA_VENCIDA' }]) assert.equal(payload.parsePushPayload(v), null);
  assert.ok(payload.parsePushPayload({ ...data, tipo: 'TAREA_ASIGNADA', comentarioId: null }));
});
test('permiso denegado/config faltante no registra ni impide la sesión', async () => {
  for (const motivo of ['sin permiso', 'falta projectId', 'Expo Go']) {
    const { c, calls } = setup({ token: async () => ({ motivo }) }); c.setSession(session()); await tick();
    assert.equal(c.getSnapshot(), motivo); assert.equal(calls.length, 0);
  }
});
test('errores de token y API controlados, 409 jamás transfiere', async () => {
  const x = setup({ token: async () => { throw Error('no red'); } }); x.c.setSession(session()); await tick(); assert.match(x.c.getSnapshot(), /reintentar/);
  const y = setup(); y.d.api.registrar = async () => { throw { status: 409 }; }; y.c.setSession(session()); await tick();
  assert.match(y.c.getSnapshot(), /código/); assert.equal(y.calls.some(c => c[0] === 'transfer'), false);
});
test('login y restauración re-registran; rotación alta nueva antes de revocar anterior', async () => {
  const { c, d, calls } = setup(); c.setSession(session()); await tick();
  d.token = async () => ({ token: 'expo2', plataforma: 'ANDROID' }); await c.refresh(false);
  assert.deepEqual(calls.map(c => c[0]), ['register', 'register', 'delete']); assert.equal(calls[2][2], 'd1');
  c.setSession(null); c.setSession(session(2)); await tick(); assert.equal(calls.at(-1)[1], 'jwt-2');
});
test('logout espera registro en vuelo y DELETE con JWT viejo; nunca borra vínculo nuevo por respuesta tardía', async () => {
  const x = setup(), gate = deferred(); x.d.api.registrar = async jwt => { x.calls.push(['register', jwt]); return gate.promise; };
  x.c.setSession(session()); await tick(); const logout = x.c.beforeLogout();
  x.c.setSession(session(2, 'u2'));
  gate.resolve({ id: 'd1' }); await logout; await tick();
  assert.equal(x.calls.find(c => c[0] === 'delete')[1], 'jwt-1');
  const deletion = x.calls.findIndex(c => c[0] === 'delete');
  assert.ok(deletion < x.calls.findIndex(c => c[0] === 'register' && c[1] === 'jwt-2'));
});
test('logout offline conserva intención sin JWT/token, no bloquea; reintenta solo bajo dueño', async () => {
  const x = setup(); x.c.setSession(session()); await tick();
  x.d.api.revocar = async () => { throw { status: 0 }; }; await x.c.beforeLogout();
  assert.equal(x.stored.at(-1)[0].pendiente, true); assert.doesNotMatch(JSON.stringify(x.stored), /jwt|expo1/);
  x.c.setSession(session(2, 'u2')); await tick();
  assert.equal(x.stored.at(-1).some(b => b.usuarioId === 'u1' && b.pendiente), true);
  x.c.setSession(null); x.d.api.revocar = async (jwt, id) => { x.calls.push(['retry', jwt, id]); throw { status: 404 }; };
  x.c.setSession(session(3)); await tick(); assert.ok(x.calls.some(c => c[0] === 'retry' && c[1] === 'jwt-3'));
});
test('sin sesión no navega; tap frío espera sesión revalidada y navigator', async () => {
  const x = setup(); x.c.setNavigator(null); x.c.tap(data, 'cold', true); await tick(); assert.equal(x.nav.length, 0);
  x.c.setSession(session()); await tick(); assert.equal(x.nav.length, 0);
  x.c.setNavigator(id => x.nav.push(id)); await tick(); assert.deepEqual(x.nav, [data.tareaId]);
  x.c.tap(data, 'cold', true); await tick(); assert.equal(x.nav.length, 1);
});
test('tap caliente consulta API con JWT capturado; no utiliza títulos o URLs del push', async () => {
  const x = setup(); x.c.setSession(session()); await tick(); x.c.tap(data, 'warm'); await tick();
  assert.deepEqual(x.nav, [data.tareaId]); assert.ok(x.calls.some(c => c[0] === 'task' && c[1] === 'jwt-1'));
  x.c.tap({ ...data, url: 'evil' }, 'invalid'); await tick(); assert.equal(x.nav.length, 1);
});
test('acceso revocado, tarea movida o espacio no coincidente nunca navegan', async () => {
  for (const overrides of [
    { tarea: async () => { throw { status: 404 }; } },
    { tarea: async () => ({ id: data.tareaId, proyectoId: 'moved' }) },
    { proyecto: async () => ({ id: data.proyectoId, espacioId: 'other' }) },
  ]) { const x = setup(overrides); x.c.setSession(session()); await tick(); x.c.tap(data, 'denied'); await tick(); assert.equal(x.nav.length, 0); }
});
test('respuesta tardía de acceso no muestra ni navega en otra sesión/logout', async () => {
  const gate = deferred(), x = setup({ tarea: () => gate.promise }); x.c.setSession(session()); await tick();
  x.c.tap(data, 'late'); const received = x.c.receive(data); x.c.setSession(null); x.c.setSession(session(2, 'u2'));
  gate.resolve({ id: data.tareaId, proyectoId: data.proyectoId }); await received; await tick(); assert.equal(x.nav.length, 0); assert.doesNotMatch(x.c.getSnapshot(), /actualización/);
});
test('transferencia requiere código válido + consentimiento y código dueño explícito', async () => {
  const x = setup(); x.c.setSession(session()); await tick();
  await assert.rejects(x.c.transfer('ABCDEFG2', false)); await assert.rejects(x.c.transfer('bad', true)); await assert.rejects(x.c.ownerCode('d1', false));
  assert.equal((await x.c.ownerCode('d1', true)).codigo, 'ABCDEFG2'); await x.c.transfer('ABCDEFG2', true);
  assert.equal(x.calls.filter(c => c[0] === 'transfer').length, 1);
});
test('revocación persistida antes de I/O, error no elimina intención; 404 definitivo', async () => {
  const x = setup(); x.c.setSession(session()); await tick(); x.d.api.revocar = async () => { assert.equal(x.stored.at(-1)[0].pendiente, true); throw { status: 404 }; };
  await x.c.revoke('d1'); assert.equal(x.stored.at(-1).length, 0);
  const before = x.calls.length; await x.c.refresh(false); assert.equal(x.calls.length, before);
});
test('cinco endpoints: rutas/body exactos y Bearer explícito sin revelar token en GET', async () => {
  const calls = [];
  const { dispositivosApi: api } = load('src/api/dispositivos.ts', { './client': { request: async (p, o) => { calls.push([p, o]); return {}; } } }, { AbortController, setTimeout, clearTimeout });
  await api.registrar('jwt', 'expo-token', 'IOS'); await api.listar('jwt', 2); await api.revocar('jwt', 'opaque/id'); await api.codigo('jwt', 'opaque/id'); await api.transferir('jwt', 'ABCDEFG2', 'expo-token');
  assert.deepEqual(calls.map(x => x[0]), ['/dispositivos', '/dispositivos?page=2&pageSize=20', '/dispositivos/opaque%2Fid', '/dispositivos/opaque%2Fid/codigo-transferencia', '/dispositivos/transferencia']);
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0][1].body)), { token: 'expo-token', plataforma: 'IOS' });
  assert.equal(calls[1][1].body, undefined); assert.equal(calls[2][1].body, undefined); assert.equal(calls[3][1].body, undefined);
  assert.ok(calls.every(c => c[1].bearer === 'jwt'));
});
function expoHarness({ os = 'android', go = false, project = '12345678-1234-1234-1234-123456789abc', permission = { granted: true, canAskAgain: true } } = {}) {
  const calls = [], handlers = {};
  const notification = {
    IosAuthorizationStatus: { AUTHORIZED: 2, PROVISIONAL: 3, EPHEMERAL: 4 }, AndroidImportance: { DEFAULT: 3 }, DEFAULT_ACTION_IDENTIFIER: 'default',
    setNotificationChannelAsync: async () => calls.push('channel'),
    getPermissionsAsync: async () => { calls.push('permissions'); return permission; },
    requestPermissionsAsync: async () => { calls.push('ask'); return permission; },
    getExpoPushTokenAsync: async () => { calls.push('expo-token'); return { data: 'ExpoPushToken[abc_123]' }; },
    setNotificationHandler: h => { handlers.handler = h; },
    addNotificationReceivedListener: f => { handlers.received = f; return { remove() {} }; },
    addNotificationResponseReceivedListener: f => { handlers.response = f; return { remove() {} }; },
    addPushTokenListener: f => { handlers.rotated = f; return { remove() {} }; },
    getLastNotificationResponse: () => null, clearLastNotificationResponse: () => calls.push('clear'),
  };
  const api = load('src/push/expoPush.ts', {
    'expo-constants': { __esModule: true, default: { executionEnvironment: 'storeClient', expoVersion: go ? '58.0.0' : null, expoConfig: { extra: { eas: { projectId: project } } } } },
    'expo-device': { isDevice: true }, 'expo-notifications': notification, 'expo-secure-store': {}, 'react-native': { Platform: { OS: os } }, '../api/dispositivos': {}, '../api/client': {}, './PushController': {}, './payload': payload,
  }, { setTimeout, clearTimeout });
  return { api, calls, handlers, notification };
}
test('adaptador Expo: canal antes de permiso/token, rechazo sin token y no repreguntar automáticamente', async () => {
  const x = expoHarness(); assert.equal((await x.api.expoToken(false)).token, 'ExpoPushToken[abc_123]'); assert.deepEqual(x.calls, ['channel', 'permissions', 'expo-token']);
  const y = expoHarness({ permission: { granted: false, canAskAgain: true } }); await y.api.expoToken(false); assert.equal(y.calls.includes('ask'), false); await y.api.expoToken(true); assert.equal(y.calls.includes('ask'), true); assert.equal(y.calls.includes('expo-token'), false);
  const z = expoHarness({ permission: { granted: false, canAskAgain: false } }); await z.api.expoToken(true); assert.equal(z.calls.includes('ask'), false);
});
test('adaptador: Expo Go/projectId ausente controlados; iOS provisional permitido', async () => {
  for (const opts of [{ go: true }, { project: '' }]) { const x = expoHarness(opts); assert.ok((await x.api.expoToken(true)).motivo); assert.equal(x.calls.includes('expo-token'), false); }
  const x = expoHarness({ os: 'ios', permission: { granted: false, canAskAgain: false, ios: { status: 3 } } }); assert.ok((await x.api.expoToken(false)).token);
});
test('listener nativo nunca registra token nativo: solicita renovar Expo; recepción y tap no usan título/body', async () => {
  const x = expoHarness(), calls = [];
  x.api.listenPush({ refresh: ask => { calls.push(['refresh', ask]); }, receive: d => calls.push(['receive', d]), tap: d => calls.push(['tap', d]) });
  x.handlers.rotated({ type: 'fcm', data: 'NATIVE-SECRET' }); x.handlers.received({ request: { content: { data, title: 'untrusted' } } });
  x.handlers.response({ actionIdentifier: 'default', notification: { request: { identifier: 'n1', content: { data, body: 'untrusted' } } } });
  assert.deepEqual(calls.map(x => x[0]), ['refresh', 'receive', 'tap']); assert.equal(calls[0][1], false); assert.doesNotMatch(JSON.stringify(calls), /NATIVE|untrusted/);
  const behavior = await x.handlers.handler.handleNotification(); assert.equal(behavior.shouldShowBanner, false); assert.equal(behavior.shouldShowList, false);
});
test('integración con SessionController: DELETE termina antes de POST logout, caché y navegación invalidadas inmediatamente', async () => {
  const { SessionController } = load('src/auth/SessionController.ts');
  const x = setup(); let jwt = 'jwt-1', version = 1, cacheClears = 0; const gate = deferred();
  const controller = new SessionController({
    getToken: () => jwt, getTokenVersion: () => version, loadToken: async () => jwt,
    clearToken: async () => { jwt = null; version++; }, saveToken: async t => { jwt=t; version++; },
    perfil: async () => ({ id: 'u1' }), clearCache: () => { cacheClears++; }, status: e => e?.status, storageCritical: () => false,
    login: async () => ({ accessToken: 'new', usuario: { id: 'u2' } }), registro: async () => ({}),
    logout: async () => { const captured = jwt; await x.c.beforeLogout(); x.calls.push(['logout', captured]); },
  });
  controller.subscribe(() => { const s = controller.capturarSesion(); x.c.setSession(s && jwt ? { ...s, jwt } : null); });
  await controller.bootstrap(); await tick(); x.d.api.revocar = async (jwt, id) => { x.calls.push(['delete', jwt, id]); await gate.promise; };
  const logout = controller.cerrarSesion(); await tick(); assert.equal(controller.getSnapshot().usuario, null); assert.ok(cacheClears >= 2); assert.equal(x.calls.some(c => c[0] === 'logout'), false);
  x.c.tap(data, 'after-logout'); await tick(); assert.equal(x.nav.length, 0);
  gate.resolve(); await logout; assert.deepEqual(x.calls.filter(c => ['delete', 'logout'].includes(c[0])).map(c => c[0]), ['delete', 'logout']);
});
test('cliente real: Bearer capturado no cambia ni 401 tardío invalida sesión global', async () => {
  const gate = deferred(); let unauthorized = 0;
  const client = load('src/api/client.ts', { './config': { API_BASE_URL: 'https://example.invalid' }, './tokenStorage': { getToken: () => 'NEW', getTokenVersion: () => 5 } }, {
    fetch: async (_, options) => { assert.equal(options.headers.Authorization, 'Bearer OLD'); return gate.promise; },
  });
  client.setUnauthorizedHandler(() => unauthorized++);
  const operation = client.request('/dispositivos', { bearer: 'OLD' });
  gate.resolve({ status: 401 }); await assert.rejects(operation); assert.equal(unauthorized, 0);
});
test('logout con varios vínculos marca todos antes de DELETE y no abandona posteriores tras un fallo', async () => {
  const x = setup({ load: async () => [{ usuarioId: 'u1', id: 'first', pendiente: false }, { usuarioId: 'u1', id: 'second', pendiente: false }] });
  // No registrar: conservar ambos vínculos previos para comprobar cierre parcial.
  x.d.token = async () => ({ motivo: 'sin permiso' }); x.c.setSession(session()); await tick();
  x.d.api.revocar = async (_, id) => {
    assert.ok(x.stored.at(-1).filter(b => b.usuarioId === 'u1').every(b => b.pendiente));
    x.calls.push(['delete', id]); if (id === 'first') throw { status: 0 };
  };
  await x.c.beforeLogout(); assert.deepEqual(x.calls.map(c => c[1]), ['first', 'second']);
  assert.deepEqual(x.stored.at(-1), [{ usuarioId: 'u1', id: 'first', pendiente: true }]);
});
