const test = require('node:test');
const assert = require('node:assert/strict');
const ts = require('typescript');
const fs = require('node:fs');
const vm = require('node:vm');
function load(path, deps = {}, globals = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(`src/${path}.ts`, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, { exports, require: name => { assert.ok(name in deps, name); return deps[name]; }, Error, AbortController, setTimeout, clearTimeout, ...globals });
  return exports;
}
const plain = v => JSON.parse(JSON.stringify(v));
const client = load('api/client', { './config': { API_BASE_URL: 'https://example.invalid' }, './tokenStorage': { getToken: () => 'new', getTokenVersion: () => 2 } });
const api = load('api/preferenciasNotificaciones', { './client': client });
const { PreferenciasNotificacionesController: Controller, cambiosPendientes, validarMatriz } = load('lib/PreferenciasNotificacionesController', { '../api/client': client, '../api/preferenciasNotificaciones': api });
const matriz = () => ({ preferencias: api.TIPOS_PREFERENCIA.map((tipo, i) => ({ tipo, inApp: i % 2 === 0, correo: i === 1, push: i !== 2 })) });
function deferred() { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
function setup() {
  let generation = 1, mounted = true, gets = 0, patches = [], unauthorized = 0;
  let get = async () => matriz(), patch = async () => matriz();
  const sello = { usuarioId: 'u', generation: 1, tokenVersion: 1 };
  const c = new Controller({ sello, jwt: 'captured', vigente: s => mounted && s.generation === generation,
    consultar: jwt => { assert.equal(jwt, 'captured'); gets++; return get(); },
    guardar: (p, jwt) => { assert.equal(jwt, 'captured'); patches.push(plain(p)); return patch(); },
    unauthorized: s => { assert.equal(s, sello); unauthorized++; },
  });
  return { c, get: fn => get = fn, patch: fn => patch = fn, gets: () => gets, patches: () => patches, unauthorized: () => unauthorized,
    nuevaSesion: () => generation++, logout: () => mounted = false };
}
test('API: GET real sin body y PATCH mínimo con Bearer inmutable, sin campos de usuario', async () => {
  const calls = [];
  const a = load('api/preferenciasNotificaciones', { './client': { request: async (path, { signal, ...options }) => { assert.ok(signal); calls.push({ path, ...options }); return matriz(); } } });
  assert.deepEqual(plain(await a.obtenerPreferenciasNotificaciones('jwt')), plain(matriz()));
  await a.actualizarPreferenciasNotificaciones([{ tipo: 'COMENTARIO', correo: true, usuarioId: 'no', desconocido: false }], 'jwt');
  assert.deepEqual(plain(calls), [
    { path: '/perfil/preferencias-notificaciones', bearer: 'jwt' },
    { path: '/perfil/preferencias-notificaciones', method: 'PATCH', bearer: 'jwt', body: { preferencias: [{ tipo: 'COMENTARIO', correo: true }] } },
  ]);
});
test('API: errores 400/401/429/500/red sin retry ni cierre global de sesión nueva', async () => {
  for (const status of [0, 400, 401, 429, 500]) {
    for (const write of [false, true]) {
      let calls = 0, logout = 0;
      const cl = load('api/client', { './config': { API_BASE_URL: 'https://example.invalid' }, './tokenStorage': { getToken: () => 'new', getTokenVersion: () => 2 } }, {
        fetch: async () => { calls++; if (!status) throw new Error('offline'); return { status, ok: false, text: async () => JSON.stringify({ message: 'error' }) }; },
      });
      cl.setUnauthorizedHandler(() => logout++);
      const a = load('api/preferenciasNotificaciones', { './client': cl });
      await assert.rejects(write ? a.actualizarPreferenciasNotificaciones([{ tipo: 'COMENTARIO', correo: true }], 'old') : a.obtenerPreferenciasNotificaciones('old'), e => e.statusCode === status);
      assert.equal(calls, 1); assert.equal(logout, 0);
    }
  }
});
test('plazo cubre fetch/cuerpo colgados; respuesta/401 tardíos no confirman ni cierran nueva sesión', async () => {
  for (const cuerpo of [false, true]) {
    let tick, cleared = 0, unauthorized = 0, calls = 0;
    const d = deferred();
    const cl = load('api/client', { './config': { API_BASE_URL: 'https://example.invalid' }, './tokenStorage': { getToken: () => 'new', getTokenVersion: () => 2 } }, {
      fetch: async () => { calls++; return cuerpo ? { status: 200, ok: true, text: () => d.promise } : d.promise; },
    });
    cl.setUnauthorizedHandler(() => unauthorized++);
    const a = load('api/preferenciasNotificaciones', { './client': cl }, { setTimeout: fn => { tick = fn; return 1; }, clearTimeout: () => cleared++ });
    const p = a.actualizarPreferenciasNotificaciones([{ tipo: 'COMENTARIO', correo: true }], 'old');
    await Promise.resolve(); await Promise.resolve(); tick();
    await assert.rejects(p, e => e.statusCode === 0);
    d.resolve(cuerpo ? JSON.stringify(matriz()) : { status: 401, ok: false });
    await Promise.resolve(); await Promise.resolve(); assert.equal(calls, 1); assert.equal(cleared, 1); assert.equal(unauthorized, 0);
  }
});
test('sin defaults; adopta matriz real, menciones bloqueadas, sin cambios y edición revertida no PATCH', async () => {
  const s = setup(); assert.equal(s.c.getSnapshot().borrador, null);
  await s.c.cargar(); assert.deepEqual(plain(s.c.getSnapshot().borrador), plain(matriz().preferencias));
  s.c.editar('MENCION', 'inApp', false); assert.equal(s.c.getSnapshot().borrador[4].inApp, true);
  await s.c.guardar(); assert.equal(s.patches().length, 0);
  s.c.editar('COMENTARIO', 'correo', true); s.c.editar('COMENTARIO', 'correo', false);
  assert.equal(cambiosPendientes(s.c.getSnapshot().original, s.c.getSnapshot().borrador).length, 0);
  await s.c.guardar(); assert.equal(s.patches().length, 0);
});
test('PATCH solo canales modificados; bloquea edición, doble click, GET solapado; adopta respuesta completa', async () => {
  const s = setup(); await s.c.cargar(); const d = deferred(); s.patch(() => d.promise);
  s.c.editar('COMENTARIO', 'correo', true); s.c.editar('TAREA_ASIGNADA', 'push', false);
  const p = s.c.guardar(); await s.c.guardar(); await s.c.cargar(); s.c.editar('COMENTARIO', 'push', false);
  assert.deepEqual(s.patches(), [[{ tipo: 'TAREA_ASIGNADA', push: false }, { tipo: 'COMENTARIO', correo: true }]]);
  assert.equal(s.gets(), 1); assert.equal(s.c.getSnapshot().borrador[3].push, true);
  const response = matriz(); response.preferencias[3].correo = true; response.preferencias[0].push = false;
  d.resolve(response); await p; assert.deepEqual(plain(s.c.getSnapshot().borrador), plain(response.preferencias));
});
test('GET pendiente bloquea otros GET/PATCH y edición', async () => {
  const s = setup(), d = deferred(); s.get(() => d.promise); const p = s.c.cargar();
  await s.c.cargar(); await s.c.guardar(); s.c.editar('COMENTARIO', 'push', false);
  assert.equal(s.gets(), 1); assert.equal(s.patches().length, 0); assert.equal(s.c.getSnapshot().borrador, null);
  d.resolve(matriz()); await p;
});
test('error carga, matriz incompleta/inválida nunca cargada; reintento explícito', async () => {
  for (const value of [null, { preferencias: [] }, { preferencias: matriz().preferencias.slice(1) }, { preferencias: matriz().preferencias.map(f => ({ ...f, inApp: false })) }]) {
    const s = setup(); s.get(async () => value); await s.c.cargar(); assert.equal(s.c.getSnapshot().fase, 'error-carga'); assert.equal(s.c.getSnapshot().borrador, null);
    s.get(async () => matriz()); await s.c.cargar(); assert.equal(s.c.getSnapshot().fase, 'listo');
  }
  assert.throws(() => validarMatriz({ preferencias: Array(5).fill(matriz().preferencias[0]) }));
  const s = setup(); s.get(async () => { throw new client.ApiRequestError(0, 'Network', ['sin red']); }); await s.c.cargar();
  assert.equal(s.c.getSnapshot().error, 'sin red'); assert.equal(s.gets(), 1);
});
test('400 permite corregir sin perder borrador ni confirmar guardado', async () => {
  const s = setup(); await s.c.cargar(); s.c.editar('COMENTARIO', 'correo', true);
  s.patch(async () => { throw new client.ApiRequestError(400, 'BadRequest', ['Preferencias inválidas']); });
  await s.c.guardar(); assert.equal(s.c.getSnapshot().fase, 'listo'); assert.equal(s.c.getSnapshot().error, 'Preferencias inválidas');
  assert.equal(s.c.getSnapshot().borrador[3].correo, true); assert.equal(s.c.getSnapshot().original[3].correo, false);
});
test('incierto sin retry, consulta fallida/reintento, revisión explícita y diff no pisa canales concurrentes', async () => {
  for (const error of [new client.ApiRequestError(0, 'Network', ['red']), new client.ApiRequestError(500, 'Server', ['fallo']), new Error('parse')]) {
    const s = setup(); await s.c.cargar(); s.c.editar('COMENTARIO', 'correo', true);
    s.patch(async () => { throw error; }); await s.c.guardar(); await s.c.guardar();
    assert.equal(s.patches().length, 1); assert.equal(s.c.getSnapshot().fase, 'incierto');
    s.c.editar('COMENTARIO', 'correo', false); assert.equal(s.c.getSnapshot().borrador[3].correo, true);
    s.get(async () => { throw new Error('offline'); }); await s.c.cargar(); assert.equal(s.c.getSnapshot().fase, 'incierto');
    const actual = matriz(); actual.preferencias[0].correo = true;
    s.get(async () => actual); await s.c.cargar(); assert.equal(s.c.getSnapshot().fase, 'revisar');
    assert.equal(s.c.getSnapshot().borrador[0].correo, true);
    await s.c.guardar(); assert.equal(s.patches().length, 1);
    s.c.aceptarRevision(); s.patch(async () => actual); await s.c.guardar();
    assert.deepEqual(s.patches()[1], [{ tipo: 'COMENTARIO', correo: true }]);
  }
});
test('respuesta PATCH inválida es incierta y consulta confirmada puede eliminar dirty', async () => {
  const s = setup(); await s.c.cargar(); s.c.editar('COMENTARIO', 'correo', true); s.patch(async () => ({})); await s.c.guardar();
  assert.equal(s.c.getSnapshot().fase, 'incierto'); const actual = matriz(); actual.preferencias[3].correo = true;
  s.get(async () => actual); await s.c.cargar(); s.c.aceptarRevision(); await s.c.guardar(); assert.equal(s.patches().length, 1);
});
test('GET/PATCH tardíos, errores y 401 no cruzan sesión nueva misma cuenta, logout ni desmontaje', async () => {
  for (const write of [false, true]) for (const invalidar of ['nuevaSesion', 'logout', 'dispose']) for (const failure of [false, true]) {
    const s = setup(), d = deferred();
    if (write) { await s.c.cargar(); s.c.editar('COMENTARIO', 'correo', true); s.patch(() => d.promise); }
    else s.get(() => d.promise);
    const p = write ? s.c.guardar() : s.c.cargar();
    if (invalidar === 'dispose') s.c.dispose(); else s[invalidar]();
    if (failure) d.reject(new client.ApiRequestError(401, 'Unauthorized', ['expired'])); else d.resolve(matriz());
    await p; assert.equal(s.c.getSnapshot().borrador, null); assert.equal(s.unauthorized(), 0);
  }
});
test('401 actual se comunica con sello; desmontaje/reactivación invalida lecturas anteriores', async () => {
  const s = setup(); s.get(async () => { throw new client.ApiRequestError(401, 'Unauthorized', ['expired']); }); await s.c.cargar(); assert.equal(s.unauthorized(), 1);
  const t = setup(), old = deferred(); t.get(() => old.promise); const pending = t.c.cargar(); t.c.dispose(); t.c.activar();
  const actual = matriz(); actual.preferencias[0].push = false; t.get(async () => actual); await t.c.cargar(); old.resolve(matriz()); await pending;
  assert.equal(t.c.getSnapshot().borrador[0].push, false);
});
test('UI Perfil conserva RF20, matriz accesible y correo explícitamente no operativo', () => {
  const perfil = fs.readFileSync('src/screens/PerfilScreen.tsx', 'utf8'), ui = fs.readFileSync('src/components/PreferenciasNotificaciones.tsx', 'utf8');
  assert.ok(perfil.includes('<PushControls />') && perfil.includes('<PreferenciasNotificaciones />'));
  assert.ok(ui.includes('accessibilityRole="switch"') && ui.includes('accessibilityState={{ checked: fila[canal], disabled }}'));
  assert.ok(ui.includes('Tus preferencias se guardan, pero el envío de correos todavía no está operativo'));
  assert.ok(ui.includes('sello.generation') && ui.includes('return controller.dispose'));
});
