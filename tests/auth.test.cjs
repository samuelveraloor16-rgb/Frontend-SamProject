const test = require('node:test');
const assert = require('node:assert/strict');
const ts = require('typescript');
const fs = require('node:fs');
const vm = require('node:vm');
function load(path, deps = {}, globals = {}) {
  const source = fs.readFileSync(path, 'utf8');
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const exports = {};
  vm.runInNewContext(js, { exports, require: (name) => { if (!(name in deps)) throw Error(name); return deps[name]; }, ...globals });
  return exports;
}
function setup(fetch) {
  let token = 'old', version = 1, unauthorized = 0;
  const storage = { getToken: () => token, getTokenVersion: () => version };
  const client = load('src/api/client.ts', { './config': { API_BASE_URL: 'https://example.invalid/api/v1' }, './tokenStorage': storage }, { fetch, Error, JSON });
  client.setUnauthorizedHandler(() => { unauthorized++; });
  return { client, change: () => { token = 'new'; version++; }, count: () => unauthorized };
}
const response = (status) => ({ status, ok: status >= 200 && status < 300, text: async () => JSON.stringify({ message: 'error' }) });
test('401 público no cierra sesión; 401 autenticado sí', async () => {
  const x = setup(async () => response(401));
  await assert.rejects(x.client.request('/auth/login', { method: 'POST', auth: false })); assert.equal(x.count(), 0);
  await assert.rejects(x.client.request('/perfil')); assert.equal(x.count(), 1);
});
test('401 tardío no cierra sesión nueva', async () => {
  let resolve; const x = setup(() => new Promise(r => { resolve = r; }));
  const promise = x.client.request('/perfil'); x.change(); resolve(response(401)); await assert.rejects(promise); assert.equal(x.count(), 0);
});
test('red y servidor conservan clasificación y no cierran sesión', async () => {
  const red = setup(async () => { throw Error('offline'); });
  await assert.rejects(red.client.request('/perfil'), e => e.statusCode === 0); assert.equal(red.count(), 0);
  const servidor = setup(async () => response(503));
  await assert.rejects(servidor.client.request('/perfil'), e => e.statusCode === 503); assert.equal(servidor.count(), 0);
});
test('logout usa Bearer sin cuerpo', async () => {
  let captured; const x = setup(async (url, options) => { captured = {url, options}; return response(200); });
  await x.client.request('/auth/logout', { method: 'POST' });
  assert.equal(captured.options.headers.Authorization, 'Bearer old'); assert.equal(captured.options.body, undefined);
});
test('enlaces reset aceptan solo token de 64 hex y separan otros enlaces', () => {
  const { parseResetLink } = load('src/lib/resetLink.ts'); const token = 'ab'.repeat(32);
  assert.equal(parseResetLink(`samproject://reset?token=${token}`).token, token);
  assert.equal(parseResetLink('samproject://reset?token=xyz').token, null);
  assert.equal(parseResetLink('samproject://reset').token, null);
  assert.equal(parseResetLink('samproject://invitar?token=abc'), null);
});
function deferred() { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return { promise, resolve, reject }; }
function sessionHarness(secure, overrides = {}) {
  const store = load('src/api/tokenStorage.ts', { 'expo-secure-store': secure }, { Error, Promise });
  const { SessionController } = load('src/auth/SessionController.ts', {}, { Promise, Set });
  const user = { id: 'id', nombre: 'Ana', email: 'a@example.com', fotoUrl: null, creadoEn: '2026' };
  let clears = 0;
  const deps = { clearToken: store.clearToken, saveToken: store.saveToken, loadToken: store.loadToken, getToken: store.getToken, getTokenVersion: store.getTokenVersion, storageCritical: e => !!e?.critical,
    perfil: async () => user, logout: async () => ({}), login: async () => ({ usuario: user, accessToken: 'memory-only' }),
    registro: async () => ({ usuario: user, accessToken: 'memory-only' }), clearCache: () => clears++, status: e => e?.statusCode, ...overrides };
  return { c: new SessionController(deps), store, user, clears: () => clears };
}
function fakeStorage(value = null) {
  const map = new Map(); if (value !== null) map.set('samproject.accessToken', value);
  const db = { map, failDelete: false, failWrite: false, failRead: false, failTokenWrite: false, failMarkerDelete: false, reads: 0, writes: 0, deletes: 0,
    get value() { return map.get('samproject.accessToken') ?? null; }, set value(v) { if (v === null) map.delete('samproject.accessToken'); else map.set('samproject.accessToken', v); } };
  const secure = { getItemAsync: async key => { db.reads++; if (db.failRead) throw Error('read'); return map.get(key) ?? null; },
    setItemAsync: async (key,v) => { db.writes++; if (db.failWrite || (db.failTokenWrite && key === 'samproject.accessToken')) throw Error('write'); map.set(key,v); },
    deleteItemAsync: async key => { db.deletes++; if (db.failDelete || (db.failMarkerDelete && key === 'samproject.pendingCleanup')) throw Error('delete'); map.delete(key); } };
  return {db, secure};
}
test('reinicio restaura JWT solo después de validar perfil', async () => {
  const {db,secure}=fakeStorage('legacy'); const verify=deferred();
  const {c,store,user}=sessionHarness(secure,{perfil:()=>verify.promise}); const boot=c.bootstrap();
  await new Promise(r=>setImmediate(r)); assert.equal(c.getSnapshot().estado,'cargando'); assert.equal(c.getSnapshot().usuario,null);
  assert.equal(store.getToken(),'legacy'); verify.resolve(user); await boot;
  assert.equal(c.getSnapshot().estado,'autenticado'); assert.equal(c.getSnapshot().usuario.id,user.id); assert.equal(db.value,'legacy');
});
test('lectura fallida bloquea sin borrar JWT y reintento lo revalida', async () => {
  const {db,secure}=fakeStorage('legacy'); db.failRead=true; const {c,store}=sessionHarness(secure);
  await c.bootstrap(); assert.equal(c.getSnapshot().estado,'error-borrado'); assert.equal(c.getSnapshot().usuario,null); assert.equal(store.getToken(),null); assert.equal(db.value,'legacy');
  db.failRead=false; await c.retryCleanup(); assert.equal(c.getSnapshot().estado,'autenticado'); assert.equal(db.value,'legacy');
});
test('logout incierto y fallo de borrado mantienen marcador hasta reintento', async () => {
  const {db,secure}=fakeStorage(); const {c,store}=sessionHarness(secure,{logout: async () => { throw {statusCode: 0}; }});
  await c.bootstrap(); await c.iniciarSesion('a','x'); db.failDelete=true;
  await c.cerrarSesion(); assert.equal(c.getSnapshot().estado,'error-borrado'); assert.equal(c.getSnapshot().usuario,null); assert.equal(store.getToken(),null);
  assert.equal(db.value,'memory-only'); assert.equal(db.map.get('samproject.pendingCleanup'),'1');
  db.failDelete=false; await c.retryCleanup(); assert.equal(c.getSnapshot().estado,'no-autenticado'); assert.match(c.getSnapshot().aviso,/servidor/); assert.equal(db.value,null);
});
test('reinicio con marcador no restaura JWT hasta limpiar', async () => {
  const {db,secure}=fakeStorage(); const first=sessionHarness(secure); await first.c.bootstrap(); await first.c.iniciarSesion('a','x');
  db.failDelete=true; await first.c.salirLocal(); assert.equal(first.c.getSnapshot().estado,'error-borrado');
  const restart=sessionHarness(secure); await restart.c.bootstrap(); assert.equal(restart.c.getSnapshot().estado,'error-borrado'); assert.equal(restart.c.getSnapshot().usuario,null);
  db.failDelete=false; await restart.c.retryCleanup(); assert.equal(restart.c.getSnapshot().estado,'no-autenticado'); assert.equal(db.value,null);
});
test('401 y cambio de contraseña bloquean cuando borrar falla', async () => {
  for (const mode of ['401','password']) {
    const {db,secure}=fakeStorage(); const {c,store}=sessionHarness(secure); await c.bootstrap(); await c.iniciarSesion('a','x');
    db.failDelete=true;
    if (mode === '401') { c.unauthorized(); await new Promise(r => setImmediate(r)); } else await c.salirLocal('Contraseña actualizada. Inicia sesión nuevamente.');
    assert.equal(c.getSnapshot().estado,'error-borrado'); assert.equal(c.getSnapshot().usuario,null); assert.equal(store.getToken(),null);
    db.failDelete=false; await c.retryCleanup(); assert.equal(c.getSnapshot().estado,'no-autenticado');
    assert.match(c.getSnapshot().aviso,mode === '401' ? /sesión ya no es válida/ : /Contraseña actualizada/);
  }
});
test('fallo de red en revalidación conserva JWT en memoria sin mostrar usuario', async () => {
  const {secure}=fakeStorage(null); const {c,store}=sessionHarness(secure,{perfil: async () => {throw {statusCode:0};}});
  await c.bootstrap(); await c.iniciarSesion('a','x'); await c.revalidar();
  assert.equal(c.getSnapshot().estado,'error-validacion'); assert.equal(c.getSnapshot().usuario,null); assert.equal(store.getToken(),'memory-only');
});
test('login tardío no revive sesión después de salir', async () => {
  const {secure}=fakeStorage(null); const pending=deferred(); const {c,store,user}=sessionHarness(secure,{login: () => pending.promise});
  await c.bootstrap(); const login=c.iniciarSesion('a','x'); await c.salirLocal(); pending.resolve({usuario:user,accessToken:'late'}); await login;
  assert.equal(c.getSnapshot().estado,'no-autenticado'); assert.equal(store.getToken(),null);
});
test('logout pendiente impide nueva sesión y no permite datos mientras espera al servidor', async () => {
  const {secure}=fakeStorage(null); const pending=deferred(); const {c}=sessionHarness(secure,{logout: () => pending.promise});
  await c.bootstrap(); await c.iniciarSesion('a','x'); const logout=c.cerrarSesion(); await new Promise(r => setImmediate(r));
  assert.equal(c.getSnapshot().estado,'borrando'); assert.equal(c.getSnapshot().usuario,null); await assert.rejects(c.iniciarSesion('a','x'), {name:'AutenticacionEnCursoError'}); assert.equal(c.getSnapshot().estado,'borrando');
  pending.resolve({}); await logout; assert.equal(c.getSnapshot().estado,'no-autenticado');
});
test('enlace caliente prevalece sobre frío tardío; duplicados y callbacks antiguos no cierran enlace nuevo', () => {
  const {ResetLinkCoordinator}=load('src/lib/resetLink.ts'); const c=new ResetLinkCoordinator();
  const a='samproject://reset?token='+'a'.repeat(64), b='samproject://reset?token='+'b'.repeat(64);
  const first=c.receive(a); assert.equal(c.receive(a).id,first.id);
  const second=c.receive(b); assert.notEqual(second.id,first.id); assert.equal(c.receive(a,true).id,second.id);
  assert.equal(c.discard(first.id).id,second.id); assert.equal(c.close(first.id).id,second.id);
  assert.equal(c.discard(second.id).token,null); assert.equal(c.close(second.id),null);
});
test('enlace inicial se procesa aunque se recibió otro evento ajeno', () => {
  const {ResetLinkCoordinator}=load('src/lib/resetLink.ts'); const c=new ResetLinkCoordinator();
  assert.equal(c.receive('samproject://invitar?token=x'),null);
  assert.equal(c.receive('samproject://reset?token='+'c'.repeat(64),true).token,'c'.repeat(64));
});
test('cliente HTTP y controlador reales: 401 autenticado bloquea al fallar SecureStore', async () => {
  const {db,secure}=fakeStorage(null); const store=load('src/api/tokenStorage.ts',{'expo-secure-store':secure},{Error,Promise});
  const client=load('src/api/client.ts',{'./config':{API_BASE_URL:'https://example.invalid'},'./tokenStorage':store},{fetch:async()=>response(401),Error,JSON});
  const {SessionController}=load('src/auth/SessionController.ts',{}, {Promise,Set});
  const user={id:'1',nombre:'Ana',email:'a@example.com',fotoUrl:null,creadoEn:'2026'};
  const c=new SessionController({clearToken:store.clearToken,saveToken:store.saveToken,loadToken:store.loadToken,getToken:store.getToken,getTokenVersion:store.getTokenVersion,storageCritical:e=>!!e?.critical,
    perfil:()=>client.request('/perfil'),logout:()=>client.request('/auth/logout',{method:'POST'}),
    login:async()=>({usuario:user,accessToken:'t'}),registro:async()=>({usuario:user,accessToken:'t'}),clearCache:()=>{},status:e=>e?.statusCode});
  client.setUnauthorizedHandler(c.unauthorized);
  await c.bootstrap(); await c.iniciarSesion('a','x'); db.failDelete=true;
  await assert.rejects(client.request('/perfil')); await new Promise(r=>setImmediate(r));
  assert.equal(c.getSnapshot().estado,'error-borrado'); assert.equal(c.getSnapshot().usuario,null); assert.equal(store.getToken(),null);
});
test('limpieza en curso impide restaurar datos al completar revalidación antigua', async () => {
  const {db,secure}=fakeStorage(null); const wait=deferred(); const {c,store}=sessionHarness(secure,{perfil:()=>wait.promise});
  await c.bootstrap(); await c.iniciarSesion('a','x'); const validation=c.revalidar(); db.failDelete=true; await c.salirLocal();
  wait.resolve({id:'1',nombre:'Viejo'}); await validation;
  assert.equal(c.getSnapshot().estado,'error-borrado'); assert.equal(c.getSnapshot().usuario,null); assert.equal(store.getToken(),null);
});
test('dos enlaces durante sesión activa no alteran sesión ni permiten que resultado antiguo descarte el nuevo', async () => {
  const {secure}=fakeStorage(null); const {c}=sessionHarness(secure); await c.bootstrap(); await c.iniciarSesion('a','x');
  const {ResetLinkCoordinator}=load('src/lib/resetLink.ts'); const links=new ResetLinkCoordinator();
  const a=links.receive('samproject://reset?token='+'d'.repeat(64)); const b=links.receive('samproject://reset?token='+'e'.repeat(64));
  assert.equal(links.discard(a.id).id,b.id); assert.equal(c.getSnapshot().estado,'autenticado'); assert.equal(c.getSnapshot().usuario.nombre,'Ana');
});
test('logout sin respuesta alcanza límite y no confirma resultado', async () => {
  let aborted=false; let cleared=false;
  class FakeAbort { constructor() { this.signal = {}; } abort() { aborted=true; } }
  const api=load('src/api/auth.ts',{'./client':{request:()=>new Promise(()=>{})}}, {
    AbortController: FakeAbort, Promise, Error,
    setTimeout: callback => { Promise.resolve().then(callback); return 1; }, clearTimeout: () => { cleared=true; },
  });
  await assert.rejects(api.cerrarSesionRemota(), /Tiempo de espera/); assert.equal(aborted,true); assert.equal(cleared,true);
});
test('perfil A tardío no sustituye usuario B ni aun con mismo id de cuenta', async () => {
  const {secure}=fakeStorage(null); let loginCount=0;
  const a={id:'same',nombre:'A',email:'a@example.com'}, b={id:'same',nombre:'B',email:'b@example.com'};
  const {c}=sessionHarness(secure,{login:async()=>({usuario:++loginCount === 1 ? a : b, accessToken:'same-token'})});
  await c.bootstrap(); await c.iniciarSesion('a','x'); const selloA=c.capturarSesion(); const late=deferred();
  const update=late.promise.then(profile=>c.actualizarUsuario(profile,selloA));
  await c.salirLocal(); await c.iniciarSesion('b','x'); late.resolve({...a,nombre:'A antigua'}); await update;
  assert.equal(c.getSnapshot().usuario.nombre,'B'); assert.equal(c.esSesionActual(selloA),false);
  const selloB=c.capturarSesion(); c.actualizarUsuario({...b,nombre:'B actual'},selloB); assert.equal(c.getSnapshot().usuario.nombre,'B actual');
  c.actualizarUsuario({id:'other',nombre:'Ajeno'},selloB); assert.equal(c.getSnapshot().usuario.nombre,'B actual');
});
test('resultado tardío de cambio de contraseña A no cierra sesión B', async () => {
  const {secure}=fakeStorage(null); let i=0;
  const {c,store}=sessionHarness(secure,{login:async()=>({usuario:{id:++i===1?'A':'B',nombre:'Nombre'},accessToken:'token-'+i})});
  await c.bootstrap(); await c.iniciarSesion('a','x'); const selloA=c.capturarSesion(); const pending=deferred();
  const password=pending.promise.then(()=>c.salirLocalSiSesionActual(selloA,'Contraseña actualizada'));
  await c.salirLocal(); await c.iniciarSesion('b','x'); pending.resolve(); await password;
  assert.equal(c.getSnapshot().estado,'autenticado'); assert.equal(c.getSnapshot().usuario.id,'B'); assert.equal(store.getToken(),'token-2');
});
test('registro pendiente impide login solapado, revalidación no descarta creación', async () => {
  const {secure}=fakeStorage(null); const pending=deferred(); let loginCalls=0, registerCalls=0;
  const user={id:'reg',nombre:'Nuevo'}; const {c}=sessionHarness(secure,{registro:()=>{registerCalls++; return pending.promise},perfil:async()=>user,login:async()=>{loginCalls++; return {usuario:user,accessToken:'login'};}});
  await c.bootstrap(); const registro=c.registrarse('Nombre','a@example.com','clave');
  await assert.rejects(c.iniciarSesion('a','x'),{name:'AutenticacionEnCursoError'}); await c.revalidar();
  pending.resolve({usuario:user,accessToken:'registro'}); await registro;
  assert.equal(registerCalls,1); assert.equal(loginCalls,0); assert.equal(c.getSnapshot().estado,'autenticado'); assert.equal(c.getSnapshot().usuario.id,'reg');
});
test('registro exitoso pero supersedido se comunica explícitamente', async () => {
  const {secure}=fakeStorage(null); const pending=deferred(); const {c}=sessionHarness(secure,{registro:()=>pending.promise});
  await c.bootstrap(); const registro=c.registrarse('Nombre','a@example.com','clave'); await c.salirLocal();
  pending.resolve({usuario:{id:'reg',nombre:'Nuevo'},accessToken:'registro'});
  await assert.rejects(registro,{name:'RegistroSinSesionError'}); assert.equal(c.getSnapshot().estado,'no-autenticado'); assert.match(c.getSnapshot().aviso,/cuenta se creó/);
});
test('reset 400 distingue enlace inválido, validación y mensajes desconocidos sin reflejar contenido', () => {
  const {clasificarErrorReset400}=load('src/lib/resetErrors.ts');
  assert.match(clasificarErrorReset400(['El enlace es inválido o ha caducado']).general,/enlace/);
  const validacion=clasificarErrorReset400(['La contraseña debe incluir al menos una letra']); assert.match(validacion.campo,/letra/); assert.equal(validacion.general,undefined);
  assert.doesNotMatch(clasificarErrorReset400(['token secreto: 123']).general,/123/);
  const {validarContrasena}=load('src/lib/validation.ts'); assert.match(validarContrasena('üüüüüüü1'),/letra/); assert.equal(validarContrasena('ñ1234567'),null);
});
test('login pendiente bloquea registro antes de emitir solicitud y explica espera', async () => {
  const {secure}=fakeStorage(null); const pending=deferred(); let registros=0;
  const {c}=sessionHarness(secure,{login:()=>pending.promise, registro:async()=>{registros++; return {};}});
  await c.bootstrap(); const login=c.iniciarSesion('a','x');
  await assert.rejects(c.registrarse('Nombre','a@example.com','clave'),e=>e.name==='AutenticacionEnCursoError' && /espera/i.test(e.message));
  assert.equal(registros,0); pending.resolve({usuario:{id:'A',nombre:'Ana'},accessToken:'token'}); await login; assert.equal(c.getSnapshot().usuario.id,'A');
});
test('cierre remoto incierto advierte que puede afectar una sesión posterior', async () => {
  const {secure}=fakeStorage(null); const {c}=sessionHarness(secure,{logout:async()=>{throw {statusCode:0};}});
  await c.bootstrap(); await c.iniciarSesion('a','x'); await c.cerrarSesion();
  assert.match(c.getSnapshot().aviso,/podría procesarse después/i); assert.match(c.getSnapshot().aviso,/sesión iniciada de nuevo/i);
});
test('registro supersedido durante borrado conserva aviso al terminar el borrado', async () => {
  const {secure}=fakeStorage(null); const pending=deferred(); const deletion=deferred();
  const {c}=sessionHarness(secure,{registro:()=>pending.promise,clearToken:()=>deletion.promise});
  await c.bootstrap(); const registro=c.registrarse('Nombre','a@example.com','clave'); const salida=c.salirLocal();
  pending.resolve({usuario:{id:'R',nombre:'R'},accessToken:'t'}); await assert.rejects(registro,{name:'RegistroSinSesionError'});
  deletion.resolve(); await salida; assert.match(c.getSnapshot().aviso,/cuenta se creó/);
});
test('fallo simultáneo de escritura del marcador y borrado muestra aviso crítico y límite al reiniciar', async () => {
  const {db,secure}=fakeStorage(null); const {c}=sessionHarness(secure,{logout:async()=>{throw {statusCode:0};}});
  await c.bootstrap(); await c.iniciarSesion('a','x'); db.failWrite=true; db.failDelete=true;
  await c.cerrarSesion(); assert.equal(c.getSnapshot().estado,'error-borrado'); assert.equal(c.getSnapshot().usuario,null);
  assert.match(c.getSnapshot().errorValidacion,/Aviso crítico/); assert.match(c.getSnapshot().errorValidacion,/podría volver a aparecer/);
  assert.equal(db.value,'memory-only'); assert.equal(db.map.has('samproject.pendingCleanup'),false);
  // Si se reinicia tras una falla total y no se pudo grabar marcador, no puede detectarse la intención anterior.
  db.failWrite=false; db.failDelete=false; const restart=sessionHarness(secure); await restart.c.bootstrap();
  assert.equal(restart.c.getSnapshot().estado,'autenticado');
});
test('fallo de guardar JWT revierte credencial y bloqueo permite reintentar limpieza', async () => {
  const {db,secure}=fakeStorage(null); const {c,store}=sessionHarness(secure); await c.bootstrap(); db.failTokenWrite=true;
  await c.iniciarSesion('a','x'); assert.equal(c.getSnapshot().estado,'error-borrado'); assert.equal(c.getSnapshot().usuario,null);
  assert.equal(store.getToken(),null); assert.equal(db.value,null); assert.equal(db.map.has('samproject.pendingCleanup'),false);
  db.failTokenWrite=false; await c.retryCleanup(); assert.equal(c.getSnapshot().estado,'no-autenticado');
});
test('guardar JWT y fallar confirmar marcador no permite sesión y conserva marcador si rollback falla', async () => {
  const {db,secure}=fakeStorage(null); const {c,store}=sessionHarness(secure); await c.bootstrap(); db.failMarkerDelete=true;
  await c.iniciarSesion('a','x'); assert.equal(c.getSnapshot().estado,'error-borrado'); assert.equal(c.getSnapshot().usuario,null);
  assert.equal(store.getToken(),null); assert.equal(db.value,null); assert.equal(db.map.get('samproject.pendingCleanup'),'1');
  db.failMarkerDelete=false; const restart=sessionHarness(secure); await restart.c.bootstrap(); assert.equal(restart.c.getSnapshot().estado,'no-autenticado');
});
test('401 en arranque invalida y borra JWT; si borrar falla no muestra datos', async () => {
  const {db,secure}=fakeStorage('legacy'); db.failDelete=true;
  const {c,store}=sessionHarness(secure,{perfil:async()=>{throw {statusCode:401};}});
  await c.bootstrap(); assert.equal(c.getSnapshot().estado,'error-borrado'); assert.equal(c.getSnapshot().usuario,null); assert.equal(store.getToken(),null);
  assert.equal(db.map.get('samproject.pendingCleanup'),'1'); db.failDelete=false; await c.retryCleanup(); assert.equal(c.getSnapshot().estado,'no-autenticado'); assert.equal(db.value,null);
});
test('arranque sin red o con 503 conserva token seguro sin exponer usuario y permite reintentar', async () => {
  for (const statusCode of [0,503]) {
    const {db,secure}=fakeStorage('persisted'); let fail=true; const user={id:'A',nombre:'Ana'};
    const {c}=sessionHarness(secure,{perfil:async()=>{if(fail) throw {statusCode}; return user;}});
    await c.bootstrap(); assert.equal(c.getSnapshot().estado,'error-validacion'); assert.equal(c.getSnapshot().usuario,null); assert.equal(db.value,'persisted');
    fail=false; await c.revalidar(); assert.equal(c.getSnapshot().estado,'autenticado'); assert.equal(c.getSnapshot().usuario.id,'A');
  }
});
test('link caliente durante restauración no invalida generación ni accede a sesión sin validar', async () => {
  const {secure}=fakeStorage('persisted'); const verify=deferred(); const {c,user}=sessionHarness(secure,{perfil:()=>verify.promise});
  const boot=c.bootstrap(); await new Promise(r=>setImmediate(r));
  const {ResetLinkCoordinator}=load('src/lib/resetLink.ts'); const links=new ResetLinkCoordinator();
  const link=links.receive('samproject://reset?token='+'d'.repeat(64)); assert.ok(link); assert.equal(c.getSnapshot().usuario,null);
  verify.resolve(user); await boot; assert.equal(c.getSnapshot().estado,'autenticado'); assert.equal(links.close(link.id),null);
});
test('cierre durante lectura inicial invalida restauración y después elimina credencial', async () => {
  const {db,secure}=fakeStorage('persisted'); const wait=deferred(); let profileCalls=0;
  const {c}=sessionHarness(secure,{loadToken:()=>wait.promise,perfil:async()=>{profileCalls++; return {id:'A',nombre:'A'};}});
  const boot=c.bootstrap(); const close=c.salirLocal('Sesión cerrada'); wait.resolve('persisted');
  await boot; await close; assert.equal(c.getSnapshot().estado,'no-autenticado'); assert.equal(c.getSnapshot().usuario,null); assert.equal(profileCalls,0); assert.equal(db.value,null);
});
test('escritura pendiente seguida de cierre no revive JWT', async () => {
  const {db,secure}=fakeStorage(null); const gate=deferred(); const original=secure.setItemAsync;
  secure.setItemAsync=async (key,value)=>{ if(key==='samproject.accessToken') await gate.promise; return original(key,value); };
  const store=load('src/api/tokenStorage.ts',{'expo-secure-store':secure},{Error,Promise});
  const write=store.saveToken('new'); await new Promise(r=>setImmediate(r)); const close=store.clearToken(); gate.resolve();
  await write; await close; assert.equal(store.getToken(),null); assert.equal(db.value,null); assert.equal(db.map.has('samproject.pendingCleanup'),false);
});
test('fallo al escribir marcador aun borra token cuando el borrado sí funciona', async () => {
  const {db,secure}=fakeStorage(null); const {c}=sessionHarness(secure); await c.bootstrap(); await c.iniciarSesion('a','x');
  db.failWrite=true; await c.salirLocal(); assert.equal(c.getSnapshot().estado,'no-autenticado'); assert.equal(db.value,null);
});
test('registro creado con fallo de persistencia comunica creación al reintentar', async () => {
  const {db,secure}=fakeStorage(null); const {c}=sessionHarness(secure); await c.bootstrap(); db.failTokenWrite=true;
  await c.registrarse('Ana','a@example.com','clave'); assert.equal(c.getSnapshot().estado,'error-borrado'); assert.match(c.getSnapshot().errorValidacion,/cuenta se creó/);
  db.failTokenWrite=false; await c.retryCleanup(); assert.equal(c.getSnapshot().estado,'no-autenticado'); assert.match(c.getSnapshot().aviso,/cuenta se creó/);
});
test('reset exitoso durante login previo exige GET posterior y elimina JWT revocado sin exponer perfil', async () => {
  const {db,secure}=fakeStorage(null); const login=deferred(); const profile=deferred(); const estados=[];
  const {c,store}=sessionHarness(secure,{login:()=>login.promise,perfil:()=>profile.promise});
  c.subscribe(()=>estados.push(c.getSnapshot().estado)); await c.bootstrap(); const access=c.iniciarSesion('a','x');
  await c.revalidarTrasReset(false); login.resolve({usuario:{id:'A',nombre:'Ana'},accessToken:'revocado'});
  await new Promise(r=>setImmediate(r)); assert.equal(c.getSnapshot().estado,'cargando'); assert.equal(c.getSnapshot().usuario,null); assert.equal(db.value,'revocado');
  profile.reject({statusCode:401}); await access; assert.equal(c.getSnapshot().estado,'no-autenticado'); assert.equal(store.getToken(),null); assert.equal(db.value,null); assert.equal(estados.includes('autenticado'),false);
});
test('reset exitoso durante login con GET sin red conserva JWT oculto y permite reintentar', async () => {
  const {db,secure}=fakeStorage(null); const login=deferred(); let offline=true; const user={id:'A',nombre:'Ana'};
  const {c}=sessionHarness(secure,{login:()=>login.promise,perfil:async()=>{if(offline) throw {statusCode:0}; return user;}});
  await c.bootstrap(); const access=c.iniciarSesion('a','x'); await c.revalidarTrasReset(false);
  login.resolve({usuario:user,accessToken:'persistido'}); await access; assert.equal(c.getSnapshot().estado,'error-validacion'); assert.equal(c.getSnapshot().usuario,null); assert.equal(db.value,'persistido');
  offline=false; await c.revalidar(); assert.equal(c.getSnapshot().estado,'autenticado');
});
test('reset exitoso durante login con fallo de borrado tras 401 queda bloqueado', async () => {
  const {db,secure}=fakeStorage(null); const login=deferred();
  const {c}=sessionHarness(secure,{login:()=>login.promise,perfil:async()=>{db.failDelete=true; throw {statusCode:401};}});
  await c.bootstrap(); const access=c.iniciarSesion('a','x'); await c.revalidarTrasReset(false); login.resolve({usuario:{id:'A',nombre:'Ana'},accessToken:'revocado'}); await access;
  assert.equal(c.getSnapshot().estado,'error-borrado'); assert.equal(c.getSnapshot().usuario,null); assert.equal(db.map.get('samproject.pendingCleanup'),'1');
  db.failDelete=false; await c.retryCleanup(); assert.equal(db.value,null); assert.equal(c.getSnapshot().estado,'no-autenticado');
});
test('resultado incierto de reset durante login descarta JWT antes de guardarlo', async () => {
  const {db,secure}=fakeStorage(null); const login=deferred(); const {c,store}=sessionHarness(secure,{login:()=>login.promise});
  await c.bootstrap(); const access=c.iniciarSesion('a','x'); await c.revalidarTrasReset(true); login.resolve({usuario:{id:'A',nombre:'Ana'},accessToken:'incierto'}); await access;
  assert.equal(c.getSnapshot().estado,'no-autenticado'); assert.match(c.getSnapshot().aviso,/No se pudo confirmar/); assert.equal(store.getToken(),null); assert.equal(db.value,null);
});
test('reset incierto durante persistencia de login elimina JWT sin publicar sesión', async () => {
  const {db,secure}=fakeStorage(null); const gate=deferred(); const set=secure.setItemAsync;
  secure.setItemAsync=async (key,value)=>{if(key==='samproject.accessToken') await gate.promise; return set(key,value);};
  const {c,store}=sessionHarness(secure); await c.bootstrap(); const access=c.iniciarSesion('a','x'); await new Promise(r=>setImmediate(r));
  await c.revalidarTrasReset(true); gate.resolve(); await access; assert.equal(c.getSnapshot().estado,'no-autenticado'); assert.equal(db.value,null); assert.equal(store.getToken(),null);
});
test('cuenta creada durante reset conserva aviso si revalidación falla por red', async () => {
  const {secure}=fakeStorage(null); const registration=deferred(); const user={id:'R',nombre:'R'};
  const {c}=sessionHarness(secure,{registro:()=>registration.promise,perfil:async()=>{throw {statusCode:503};}});
  await c.bootstrap(); const create=c.registrarse('R','r@example.com','x'); await c.revalidarTrasReset(false); registration.resolve({usuario:user,accessToken:'t'}); await create;
  assert.equal(c.getSnapshot().estado,'error-validacion'); assert.equal(c.getSnapshot().usuario,null); assert.match(c.getSnapshot().aviso,/cuenta se creó/);
});
test('cambio de contraseña A exitoso cierra la misma credencial mientras se revalida', async () => {
  const {db,secure}=fakeStorage(null); const profile=deferred(); const {c,store}=sessionHarness(secure,{perfil:()=>profile.promise});
  await c.bootstrap(); await c.iniciarSesion('a','x'); const sello=c.capturarSesion(); const validating=c.revalidar();
  assert.equal(c.esSesionActual(sello),false); assert.equal(c.esCredencialActual(sello),true);
  await c.salirLocalSiSesionActual(sello,'Contraseña actualizada. Inicia sesión nuevamente.'); profile.resolve({id:'id',nombre:'Ana'}); await validating;
  assert.equal(c.getSnapshot().estado,'no-autenticado'); assert.equal(store.getToken(),null); assert.equal(db.value,null); assert.match(c.getSnapshot().aviso,/Contraseña actualizada/);
});
test('cambio A durante revalidación fallida elimina misma credencial aunque borrar falle', async () => {
  const {db,secure}=fakeStorage(null); const profile=deferred(); const {c}=sessionHarness(secure,{perfil:()=>profile.promise});
  await c.bootstrap(); await c.iniciarSesion('a','x'); const sello=c.capturarSesion(); const validating=c.revalidar(); profile.reject({statusCode:503}); await validating;
  assert.equal(c.getSnapshot().estado,'error-validacion'); db.failDelete=true; await c.salirLocalSiSesionActual(sello,'Resultado incierto');
  assert.equal(c.getSnapshot().estado,'error-borrado'); assert.equal(c.getSnapshot().usuario,null); assert.equal(db.map.get('samproject.pendingCleanup'),'1');
  db.failDelete=false; await c.retryCleanup(); assert.equal(db.value,null);
});
test('resultado 200 tardío de contraseña A no cierra B aunque B esté revalidándose', async () => {
  const {secure}=fakeStorage(null); const profile=deferred(); let count=0;
  const {c,store}=sessionHarness(secure,{login:async()=>({usuario:{id:++count===1?'A':'B',nombre:'Nombre'},accessToken:'token-'+count}),perfil:()=>profile.promise});
  await c.bootstrap(); await c.iniciarSesion('a','x'); const old=c.capturarSesion(); await c.salirLocal(); await c.iniciarSesion('b','x'); const validating=c.revalidar();
  await c.salirLocalSiSesionActual(old,'Contraseña actualizada'); profile.resolve({id:'B',nombre:'B'}); await validating;
  assert.equal(c.getSnapshot().estado,'autenticado'); assert.equal(c.getSnapshot().usuario.id,'B'); assert.equal(store.getToken(),'token-2');
});
test('cambio A exitoso posterior a GET 200 limpia la misma credencial pese a nueva generación', async () => {
  const {db,secure}=fakeStorage(null); const {c}=sessionHarness(secure); await c.bootstrap(); await c.iniciarSesion('a','x');
  const sello=c.capturarSesion(); await c.revalidar(); assert.equal(c.esSesionActual(sello),false); assert.equal(c.esCredencialActual(sello),true);
  await c.salirLocalSiSesionActual(sello,'Contraseña actualizada'); assert.equal(c.getSnapshot().estado,'no-autenticado'); assert.equal(db.value,null);
});
test('reset incierto durante registro creado no oculta creación ni persiste JWT', async () => {
  const {db,secure}=fakeStorage(null); const registration=deferred(); const {c}=sessionHarness(secure,{registro:()=>registration.promise});
  await c.bootstrap(); const create=c.registrarse('R','r@example.com','x'); await c.revalidarTrasReset(true);
  registration.resolve({usuario:{id:'R',nombre:'R'},accessToken:'token-r'}); await create;
  assert.equal(c.getSnapshot().estado,'no-autenticado'); assert.match(c.getSnapshot().aviso,/cuenta se creó/); assert.equal(db.value,null);
});
test('revalidación tras reset previo a login no autentica si persistencia falla', async () => {
  const {db,secure}=fakeStorage(null); const login=deferred(); let perfiles=0; const {c}=sessionHarness(secure,{login:()=>login.promise,perfil:async()=>{perfiles++; return {id:'A',nombre:'Ana'};}});
  await c.bootstrap(); const access=c.iniciarSesion('a','x'); await c.revalidarTrasReset(false); db.failTokenWrite=true;
  login.resolve({usuario:{id:'A',nombre:'Ana'},accessToken:'t'}); await access;
  assert.equal(c.getSnapshot().estado,'error-borrado'); assert.equal(c.getSnapshot().usuario,null); assert.equal(db.value,null); assert.equal(perfiles,0);
});
test('reset exitoso durante persistencia obliga GET posterior antes de exponer JWT', async () => {
  const {db,secure}=fakeStorage(null); const gate=deferred(); const profile=deferred(); const set=secure.setItemAsync;
  secure.setItemAsync=async (key,value)=>{if(key==='samproject.accessToken') await gate.promise; return set(key,value);};
  const {c}=sessionHarness(secure,{perfil:()=>profile.promise}); await c.bootstrap(); const access=c.iniciarSesion('a','x');
  await new Promise(r=>setImmediate(r)); await c.revalidarTrasReset(false); gate.resolve(); await new Promise(r=>setImmediate(r));
  assert.equal(c.getSnapshot().estado,'cargando'); assert.equal(c.getSnapshot().usuario,null); profile.reject({statusCode:401}); await access;
  assert.equal(c.getSnapshot().estado,'no-autenticado'); assert.equal(db.value,null);
});
test('reset exitoso de otra cuenta no cierra B cuando perfil B sigue válido', async () => {
  const {secure}=fakeStorage(null); const login=deferred(); const b={id:'B',nombre:'Beatriz'};
  const {c,store}=sessionHarness(secure,{login:()=>login.promise,perfil:async()=>b}); await c.bootstrap(); const access=c.iniciarSesion('b','x');
  await c.revalidarTrasReset(false); login.resolve({usuario:b,accessToken:'token-b'}); await access;
  assert.equal(c.getSnapshot().estado,'autenticado'); assert.equal(c.getSnapshot().usuario.id,'B'); assert.equal(store.getToken(),'token-b');
});
test('login respondido durante reset en vuelo no se expone ni se guarda antes del resultado', async () => {
  const {db,secure}=fakeStorage(null); const login=deferred(); const profile=deferred(); const {c}=sessionHarness(secure,{login:()=>login.promise,perfil:()=>profile.promise});
  await c.bootstrap(); const access=c.iniciarSesion('a','x'); const reset=c.iniciarReset(); login.resolve({usuario:{id:'A',nombre:'Ana'},accessToken:'revocado'});
  await new Promise(r=>setImmediate(r)); assert.equal(c.getSnapshot().estado,'no-autenticado'); assert.equal(db.value,null);
  await c.finalizarReset(reset,'exito'); await new Promise(r=>setImmediate(r)); assert.equal(c.getSnapshot().estado,'cargando'); assert.equal(c.getSnapshot().usuario,null);
  profile.reject({statusCode:401}); await access; assert.equal(c.getSnapshot().estado,'no-autenticado'); assert.equal(db.value,null);
});
test('reset incierto en vuelo descarta registro completado e informa cuenta creada', async () => {
  const {db,secure}=fakeStorage(null); const registro=deferred(); const {c}=sessionHarness(secure,{registro:()=>registro.promise});
  await c.bootstrap(); const create=c.registrarse('R','r@example.com','x'); const reset=c.iniciarReset(); registro.resolve({usuario:{id:'R',nombre:'R'},accessToken:'t'});
  await new Promise(r=>setImmediate(r)); assert.equal(db.value,null); await c.finalizarReset(reset,'incierto'); await create;
  assert.equal(c.getSnapshot().estado,'no-autenticado'); assert.match(c.getSnapshot().aviso,/cuenta se creó/); assert.equal(db.value,null);
});
test('dos resets en vuelo bloquean autenticación hasta resolver ambos', async () => {
  const {db,secure}=fakeStorage(null); const user={id:'A',nombre:'Ana'}; const {c}=sessionHarness(secure,{perfil:async()=>user});
  await c.bootstrap(); const a=c.iniciarReset(), b=c.iniciarReset(); const login=c.iniciarSesion('a','x');
  await new Promise(r=>setImmediate(r)); await c.finalizarReset(a,'exito'); await new Promise(r=>setImmediate(r)); assert.equal(db.value,null); assert.equal(c.getSnapshot().usuario,null);
  await c.finalizarReset(b,'rechazado'); await login; assert.equal(c.getSnapshot().estado,'autenticado');
});
test('reset incierto mientras guardar JWT y falla borrar bloquea sin exponer datos', async () => {
  const {db,secure}=fakeStorage(null); const gate=deferred(); const set=secure.setItemAsync;
  secure.setItemAsync=async(key,value)=>{if(key==='samproject.accessToken') await gate.promise; return set(key,value);};
  const {c}=sessionHarness(secure); await c.bootstrap(); const login=c.iniciarSesion('a','x'); await new Promise(r=>setImmediate(r));
  const reset=c.iniciarReset(); gate.resolve(); await new Promise(r=>setImmediate(r)); assert.equal(c.getSnapshot().usuario,null);
  db.failDelete=true; await c.finalizarReset(reset,'incierto'); await login; assert.equal(c.getSnapshot().estado,'error-borrado'); assert.equal(c.getSnapshot().usuario,null);
  db.failDelete=false; await c.retryCleanup(); assert.equal(db.value,null);
});
test('registro creado con reset confirmado y revalidación 401 informa creación', async () => {
  const {db,secure}=fakeStorage(null); const reg=deferred(); const {c}=sessionHarness(secure,{registro:()=>reg.promise,perfil:async()=>{throw {statusCode:401};}});
  await c.bootstrap(); const create=c.registrarse('R','r@example.com','x'); const reset=c.iniciarReset(); reg.resolve({usuario:{id:'R',nombre:'R'},accessToken:'t'});
  await c.finalizarReset(reset,'exito'); await create; assert.equal(c.getSnapshot().estado,'no-autenticado'); assert.match(c.getSnapshot().aviso,/cuenta se creó/); assert.equal(db.value,null);
});
function resetTimeoutHarness(fetchImpl) {
  const jobs=new Map(); let next=0; let aborted=0;
  class FakeAbortController { constructor() { this.signal={}; } abort(){aborted++;} }
  const setTimeoutFake=(cb,ms)=>{assert.equal(ms,15000); const id=++next; jobs.set(id,cb); return id;};
  const clearTimeoutFake=id=>jobs.delete(id);
  const storage={getToken:()=>null,getTokenVersion:()=>0};
  const client=load('src/api/client.ts',{'./config':{API_BASE_URL:'https://example.invalid'},'./tokenStorage':storage},{fetch:fetchImpl,Error,JSON});
  const api=load('src/api/auth.ts',{'./client':client},{AbortController:FakeAbortController,Promise,Error,setTimeout:setTimeoutFake,clearTimeout:clearTimeoutFake});
  const reset=load('src/auth/resetOperation.ts',{'../api/client':client},{Promise});
  return {client,api,reset,jobs,expire:()=>{const first=jobs.entries().next().value; assert.ok(first,'temporizador activo'); jobs.delete(first[0]); first[1]();},aborted:()=>aborted};
}
test('fetch reset colgado vence y libera login con resultado incierto; 200 tardío no produce otro efecto', async () => {
  const net=deferred(); const h=resetTimeoutHarness(()=>net.promise); const {db,secure}=fakeStorage(null); const login=deferred();
  let loginCalls=0; const userB={id:'B',nombre:'Beatriz'};
  const {c,store}=sessionHarness(secure,{login:()=>++loginCalls===1 ? login.promise : Promise.resolve({usuario:userB,accessToken:'token-b'})}); await c.bootstrap(); const access=c.iniciarSesion('a','x');
  const outcomes=[]; let finishes=0;
  const flow=h.reset.ejecutarReset('a'.repeat(64),'nueva123',{iniciar:c.iniciarReset,enviar:h.api.restablecerContrasena,finalizar:async(id,result)=>{finishes++; await c.finalizarReset(id,result);},estaActiva:()=>true,entregar:r=>outcomes.push(r.tipo)});
  login.resolve({usuario:{id:'A',nombre:'Ana'},accessToken:'token'}); await new Promise(r=>setImmediate(r)); assert.equal(db.value,null);
  h.expire(); const result=await flow; await access; assert.equal(result.tipo,'incierto'); assert.equal(finishes,1); assert.equal(h.aborted(),1); assert.equal(c.getSnapshot().estado,'no-autenticado'); assert.equal(store.getToken(),null); assert.equal(db.value,null);
  await c.iniciarSesion('b','x'); assert.equal(c.getSnapshot().estado,'autenticado'); assert.equal(store.getToken(),'token-b');
  net.resolve(response(200)); await new Promise(r=>setImmediate(r)); assert.equal(finishes,1); assert.deepEqual(outcomes,['incierto']); assert.equal(c.getSnapshot().estado,'autenticado'); assert.equal(c.getSnapshot().usuario.id,'B'); assert.equal(store.getToken(),'token-b');
});
test('cuerpo reset colgado vence aun con cabeceras 200; cuerpo tardío no confirma éxito', async () => {
  const body=deferred(); const h=resetTimeoutHarness(async()=>({status:200,ok:true,text:()=>body.promise}));
  let finishes=0; const outcomes=[]; const flow=h.reset.ejecutarReset('b'.repeat(64),'nueva123',{iniciar:()=>7,enviar:h.api.restablecerContrasena,finalizar:async(_,tipo)=>{finishes++; outcomes.push(tipo);},estaActiva:()=>true,entregar:r=>outcomes.push(r.tipo)});
  await new Promise(r=>setImmediate(r)); h.expire(); const result=await flow; assert.equal(result.tipo,'incierto'); assert.equal(finishes,1); assert.equal(h.aborted(),1);
  body.resolve('{"mensaje":"ok"}'); await new Promise(r=>setImmediate(r)); assert.equal(finishes,1); assert.deepEqual(outcomes,['incierto','incierto']); assert.equal(h.jobs.size,0);
});
test('pantalla de reset sustituida no recibe callbacks tardíos y no impide autenticación', async () => {
  const network=deferred(); const h=resetTimeoutHarness(()=>network.promise); const {db,secure}=fakeStorage(null); const login=deferred(); const {c}=sessionHarness(secure,{login:()=>login.promise});
  const {ResetLinkCoordinator}=load('src/lib/resetLink.ts'); const links=new ResetLinkCoordinator(); const first=links.receive('samproject://reset?token='+'c'.repeat(64));
  let mounted=true; let callbacks=0; await c.bootstrap(); const access=c.iniciarSesion('a','x');
  const flow=h.reset.ejecutarReset(first.token,'nueva123',{iniciar:c.iniciarReset,enviar:h.api.restablecerContrasena,finalizar:c.finalizarReset,estaActiva:()=>mounted && links.isCurrent(first.id),entregar:()=>{callbacks++; links.discard(first.id);}});
  login.resolve({usuario:{id:'A',nombre:'Ana'},accessToken:'jwt'}); const second=links.receive('samproject://reset?token='+'d'.repeat(64));
  h.expire(); await flow; await access; assert.equal(c.getSnapshot().estado,'no-autenticado'); assert.equal(db.value,null); assert.equal(callbacks,0); assert.equal(links.close(first.id).id,second.id);
  mounted=false; network.resolve(response(200)); await new Promise(r=>setImmediate(r)); assert.equal(callbacks,0); assert.equal(links.discard(first.id).id,second.id);
});
test('perfil sin cuerpo completo vence y conserva JWT sin mostrar datos', async () => {
  const body=deferred(); const h=resetTimeoutHarness(async()=>({status:200,ok:true,text:()=>body.promise}));
  const result=h.api.obtenerPerfil(); await new Promise(r=>setImmediate(r)); h.expire();
  await assert.rejects(result,e=>e.statusCode===0 && e.error==='Timeout'); body.resolve('{}'); await new Promise(r=>setImmediate(r)); assert.equal(h.aborted(),1);
});
test('cuerpo de error 400 colgado vence como incierto sin asumir rechazo', async () => {
  const body=deferred(); const h=resetTimeoutHarness(async()=>({status:400,ok:false,text:()=>body.promise}));
  const received=[]; const flow=h.reset.ejecutarReset('e'.repeat(64),'nueva123',{iniciar:()=>1,enviar:h.api.restablecerContrasena,finalizar:async(_,tipo)=>received.push(tipo)});
  await new Promise(r=>setImmediate(r)); h.expire(); const result=await flow; assert.equal(result.tipo,'incierto');
  body.resolve('{"message":"El enlace es inválido o ha caducado"}'); await new Promise(r=>setImmediate(r)); assert.deepEqual(received,['incierto']);
});
test('reset completado dentro del plazo confirma una sola vez y cancela temporizador', async () => {
  const h=resetTimeoutHarness(async()=>response(200)); const received=[];
  const result=await h.reset.ejecutarReset('f'.repeat(64),'nueva123',{iniciar:()=>1,enviar:h.api.restablecerContrasena,finalizar:async(_,tipo)=>received.push(tipo),estaActiva:()=>true,entregar:r=>received.push(r.tipo)});
  assert.equal(result.tipo,'exito'); assert.deepEqual(received,['exito','exito']); assert.equal(h.jobs.size,0); assert.equal(h.aborted(),0);
});
test('401 de cabeceras cierra inmediatamente sin leer cuerpo colgado', async () => {
  const body=deferred(); const controller=new AbortController(); let closed=0, reads=0;
  const client=load('src/api/client.ts',{'./config':{API_BASE_URL:'https://example.invalid'},'./tokenStorage':{getToken:()=> 'jwt',getTokenVersion:()=>1}}, {fetch:async()=>({status:401,ok:false,text:()=>{reads++; return body.promise;}}),Error,JSON});
  client.setUnauthorizedHandler(()=>closed++); const pending=client.request('/perfil',{signal:controller.signal});
  await assert.rejects(pending,e=>e.statusCode===401 && !e.message.includes('secreto')); assert.equal(closed,1); assert.equal(reads,0);
  controller.abort(); body.resolve('{"message":"secreto"}'); await new Promise(r=>setImmediate(r)); assert.equal(closed,1);
});
test('timeout antes de cabeceras ignora 401 tardío aunque fetch ignore abort', async () => {
  const responseLater=deferred(); const controller=new AbortController(); let unauthorized=0; let bodyReads=0;
  const client=load('src/api/client.ts',{'./config':{API_BASE_URL:'https://example.invalid'},'./tokenStorage':{getToken:()=> 'jwt',getTokenVersion:()=>1}}, {fetch:()=>responseLater.promise,Error,JSON});
  client.setUnauthorizedHandler(()=>unauthorized++); const pending=client.request('/perfil',{signal:controller.signal});
  controller.abort(); responseLater.resolve({status:401,ok:false,text:()=>{bodyReads++; return new Promise(()=>{});}});
  await assert.rejects(pending,e=>e.name==='AbortError'); assert.equal(unauthorized,0); assert.equal(bodyReads,0);
});
test('401 en cabeceras de JWT anterior no invalida nueva sesión ni lee cuerpo', async () => {
  const responseLater=deferred(); let version=1, token='old', unauthorized=0, bodyReads=0;
  const client=load('src/api/client.ts',{'./config':{API_BASE_URL:'https://example.invalid'},'./tokenStorage':{getToken:()=>token,getTokenVersion:()=>version}}, {fetch:()=>responseLater.promise,Error,JSON});
  client.setUnauthorizedHandler(()=>unauthorized++); const pending=client.request('/perfil'); token='new'; version++;
  responseLater.resolve({status:401,ok:false,text:()=>{bodyReads++; return new Promise(()=>{});}});
  await assert.rejects(pending,e=>e.statusCode===401); assert.equal(unauthorized,0); assert.equal(bodyReads,0); assert.equal(token,'new');
});
test('401 público de login con cuerpo colgado no invalida sesión ni refleja cuerpo', async () => {
  let unauthorized=0, bodyReads=0, headers;
  const client=load('src/api/client.ts',{'./config':{API_BASE_URL:'https://example.invalid'},'./tokenStorage':{getToken:()=> 'jwt',getTokenVersion:()=>1}}, {fetch:async(_,options)=>{headers=options.headers; return {status:401,ok:false,text:()=>{bodyReads++; return new Promise(()=>{});}};},Error,JSON});
  client.setUnauthorizedHandler(()=>unauthorized++);
  await assert.rejects(client.request('/auth/login',{method:'POST',auth:false,body:{email:'a@example.com',contrasena:'x'}}),e=>e.statusCode===401 && e.message==='No autorizado.');
  assert.equal(unauthorized,0); assert.equal(bodyReads,0); assert.equal(headers.Authorization,undefined);
});
test('401 de cabeceras con body colgado limpia JWT persistido de sesión real', async () => {
  const {db,secure}=fakeStorage('persisted'); const store=load('src/api/tokenStorage.ts',{'expo-secure-store':secure},{Error,Promise}); let bodyReads=0;
  const client=load('src/api/client.ts',{'./config':{API_BASE_URL:'https://example.invalid'},'./tokenStorage':store},{fetch:async()=>({status:401,ok:false,text:()=>{bodyReads++; return new Promise(()=>{});}}),Error,JSON});
  const {SessionController}=load('src/auth/SessionController.ts',{}, {Promise,Set,Map});
  const c=new SessionController({clearToken:store.clearToken,saveToken:store.saveToken,loadToken:store.loadToken,getToken:store.getToken,getTokenVersion:store.getTokenVersion,storageCritical:e=>!!e?.critical,
    perfil:()=>client.request('/perfil'),logout:()=>client.request('/auth/logout',{method:'POST'}),login:async()=>{throw Error('unused')},registro:async()=>{throw Error('unused')},clearCache:()=>{},status:e=>e?.statusCode});
  client.setUnauthorizedHandler(c.unauthorized); await c.bootstrap(); await new Promise(r=>setImmediate(r));
  assert.equal(c.getSnapshot().estado,'no-autenticado'); assert.equal(c.getSnapshot().usuario,null); assert.equal(store.getToken(),null); assert.equal(db.value,null); assert.equal(bodyReads,0);
});
test('timeout real del cliente antes de headers: 401 tardío no afecta sesión nueva', async () => {
  const responseLater=deferred(); let version=1, token='old', unauthorized=0, bodyReads=0, timer;
  const client=load('src/api/client.ts',{'./config':{API_BASE_URL:'https://example.invalid'},'./tokenStorage':{getToken:()=>token,getTokenVersion:()=>version}}, {fetch:()=>responseLater.promise,Error,JSON});
  client.setUnauthorizedHandler(()=>unauthorized++);
  const api=load('src/api/auth.ts',{'./client':client},{AbortController,Promise,Error,setTimeout:cb=>{timer=cb; return 1;},clearTimeout:()=>{}});
  const pending=api.obtenerPerfil(); timer(); await assert.rejects(pending,e=>e.statusCode===0 && e.error==='Timeout');
  token='new'; version++; responseLater.resolve({status:401,ok:false,text:()=>{bodyReads++; return new Promise(()=>{});}});
  await new Promise(r=>setImmediate(r)); assert.equal(unauthorized,0); assert.equal(bodyReads,0); assert.equal(token,'new');
});
function perfilHarness(api, client, controller) {
  let slots=[], index=0, effect, effectRan=false;
  const react={useState:initial=>{const slot=index++; if (!(slot in slots)) slots[slot]=initial; return [slots[slot], value=>{slots[slot]=typeof value==='function'?value(slots[slot]):value;}];}, useEffect:fn=>{if (!effectRan) effect=fn;},useSyncExternalStore:(_,get)=>get()};
  const components={FormField:'FormField',PrimaryButton:'PrimaryButton',ErrorBanner:'ErrorBanner'};
  const val=load('src/lib/validation.ts');
  const {ProfileWriteCoordinator}=load('src/auth/ProfileWriteCoordinator.ts',{'../api/client':client},{Promise,Set});
  const perfilEscrituras=new ProfileWriteCoordinator({credencial:controller.credencialActual,sello:controller.capturarSesion,credencialVigente:controller.esCredencialActual,
    actualizarUsuario:(usuario,sello)=>{const actual=controller.capturarSesion(); if(actual && actual.usuarioId===sello.usuarioId && actual.tokenVersion===sello.tokenVersion) controller.actualizarUsuario(usuario,actual);},
    guardar:api.actualizarPerfil,consultar:api.obtenerPerfil,cambiar:api.cambiarContrasena,salir:controller.salirLocalSiSesionActual});
  controller.subscribe(perfilEscrituras.sincronizar); perfilEscrituras.sincronizar();
  const deps={react,'react/jsx-runtime':{jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})},
    'react-native':{ActivityIndicator:'ActivityIndicator',Pressable:'Pressable',ScrollView:'ScrollView',Text:'Text'},
    '../auth/AuthContext':{useAuth:()=>({perfilEscrituras,capturarSesion:controller.capturarSesion,esSesionActual:controller.esSesionActual,esCredencialActual:controller.esCredencialActual,actualizarUsuario:controller.actualizarUsuario,salirLocalSiSesionActual:controller.salirLocalSiSesionActual})},
    '../api/auth':api,'../api/client':client,'../components/FormField':{FormField:components.FormField},'../components/PrimaryButton':{PrimaryButton:components.PrimaryButton},'../components/ErrorBanner':{ErrorBanner:components.ErrorBanner},'../lib/validation':val};
  const src=fs.readFileSync('src/screens/PerfilScreen.tsx','utf8'); const js=ts.transpileModule(src,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  const exports={}; vm.runInNewContext(js,{exports,require:name=>{if(!(name in deps))throw Error(name);return deps[name];},Promise,URL,Error});
  return {components,perfilEscrituras,unmount:()=>{slots=[];index=0;effect=undefined;effectRan=false;},render:(name='PerfilScreen')=>{index=0; const result=exports[name]({navigation:{goBack(){},navigate(){}}}); if(effect&&!effectRan){effectRan=true;effect();} return result;}};
}
function findNode(root,predicate) {
  if (Array.isArray(root)) {for (const n of root){const result=findNode(n,predicate);if(result)return result;}return undefined;}
  if (!root || typeof root!=='object')return undefined;
  if (predicate(root)) return root; return findNode(root.props?.children,predicate);
}
function patchTimeoutHarness(fetch, store) {
  let timer, aborted=0, calls=0;
  class FakeAbort {constructor(){this.signal={aborted:false};} abort(){this.signal.aborted=true;aborted++;}}
  const client=load('src/api/client.ts',{'./config':{API_BASE_URL:'https://example.invalid/api/v1'},'./tokenStorage':store},{fetch:async(...args)=>{calls++; return fetch(...args);},Error,JSON});
  const api=load('src/api/auth.ts',{'./client':client},{AbortController:FakeAbort,Promise,Error,setTimeout:(cb,ms)=>{assert.equal(ms,15000);timer=cb;return 1;},clearTimeout:()=>{}});
  return {client,api,expire:()=>{assert.ok(timer);timer();},aborted:()=>aborted,calls:()=>calls};
}
test('PATCH perfil 408 conserva borrador y bloquea guardar hasta consulta explícita', async () => {
  const {db,secure}=fakeStorage(null); const {c,store,user}=sessionHarness(secure); await c.bootstrap(); await c.iniciarSesion('a','x');
  let headers,body; const h=patchTimeoutHarness(async(url,opt)=>{headers=opt.headers; body=JSON.parse(opt.body); assert.match(url,/\/perfil$/); assert.equal(opt.method,'PATCH'); return {status:408,ok:false,text:async()=>'{"message":"Request Timeout"}'};},store);
  let reads=0; const api={...h.api,obtenerPerfil:async()=>{reads++;return user;}}; const ui=perfilHarness(api,h.client,c); ui.render(); await new Promise(r=>setImmediate(r));
  let tree=ui.render(); const field=findNode(tree,n=>n.type==='FormField'&&n.props.label==='Nombre'); field.props.onChangeText('Nuevo nombre');
  tree=ui.render(); const save=findNode(tree,n=>n.type==='PrimaryButton'&&n.props.titulo==='Guardar cambios'); await save.props.onPress(); tree=ui.render();
  assert.equal(findNode(tree,n=>n.type==='PrimaryButton'&&n.props.titulo==='Guardar cambios').props.deshabilitado,true);
  assert.match(findNode(tree,n=>n.type==='ErrorBanner'&&n.props.mensaje).props.mensaje,/No pudimos confirmar/); assert.equal(findNode(tree,n=>n.type==='FormField'&&n.props.label==='Nombre').props.value,'Nuevo nombre');
  assert.deepEqual(body,{nombre:'Nuevo nombre'}); assert.equal(headers.Authorization,'Bearer memory-only'); assert.equal(h.calls(),1); assert.equal(reads,1); assert.equal(db.value,'memory-only');
  const retry=findNode(tree,n=>n.type==='PrimaryButton'&&n.props.titulo==='Consultar perfil'); assert.ok(retry); retry.props.onPress(); await new Promise(r=>setImmediate(r));
  tree=ui.render(); assert.equal(reads,2); assert.equal(findNode(tree,n=>n.type==='PrimaryButton'&&n.props.titulo==='Guardar cambios').props.deshabilitado,true); assert.equal(findNode(tree,n=>n.type==='FormField'&&n.props.label==='Nombre').props.value,'Nuevo nombre');
  findNode(tree,n=>n.type==='Pressable'&&n.props.children?.props?.children==='He revisado; quiero continuar').props.onPress(); tree=ui.render();
  assert.equal(findNode(tree,n=>n.type==='PrimaryButton'&&n.props.titulo==='Guardar cambios').props.deshabilitado,false);
});
test('PATCH contraseña 408 limpia SecureStore y exige reingreso sin declarar éxito', async () => {
  const {db,secure}=fakeStorage(null); const {c,store}=sessionHarness(secure); await c.bootstrap(); await c.iniciarSesion('a','x');
  let path,body; const h=patchTimeoutHarness(async(url,opt)=>{path=url;body=JSON.parse(opt.body); return {status:408,ok:false,text:async()=>'{"message":"Request Timeout"}'};},store);
  const ui=perfilHarness(h.api,h.client,c); let tree=ui.render('CambiarContrasenaScreen');
  for(const [label,value] of [['Contraseña actual','actual123'],['Nueva contraseña','nueva123'],['Confirmar nueva contraseña','nueva123']]) {findNode(tree,n=>n.type==='FormField'&&n.props.label===label).props.onChangeText(value); tree=ui.render('CambiarContrasenaScreen');}
  await findNode(tree,n=>n.type==='PrimaryButton'&&n.props.titulo==='Cambiar contraseña').props.onPress();
  assert.match(path,/\/perfil\/contrasena$/); assert.deepEqual(body,{contrasenaActual:'actual123',contrasenaNueva:'nueva123'}); assert.equal(c.getSnapshot().estado,'no-autenticado'); assert.match(c.getSnapshot().aviso,/No pudimos confirmar/); assert.doesNotMatch(c.getSnapshot().aviso,/actual123|nueva123/); assert.equal(db.value,null); assert.equal(store.getToken(),null); assert.equal(h.calls(),1);
});
test('timeout de fetch PATCH perfil es incierto; 200 tardío no anuncia guardado ni reintenta', async () => {
  const {db,secure}=fakeStorage(null); const {c,store,user}=sessionHarness(secure); await c.bootstrap(); await c.iniciarSesion('a','x'); const network=deferred();
  const h=patchTimeoutHarness(()=>network.promise,store); const ui=perfilHarness({...h.api,obtenerPerfil:async()=>user},h.client,c); ui.render(); await new Promise(r=>setImmediate(r)); let tree=ui.render();
  findNode(tree,n=>n.type==='FormField'&&n.props.label==='Nombre').props.onChangeText('Nombre editado'); tree=ui.render();
  const pending=findNode(tree,n=>n.type==='PrimaryButton'&&n.props.titulo==='Guardar cambios').props.onPress(); await new Promise(r=>setImmediate(r)); h.expire(); await pending;
  tree=ui.render(); assert.match(findNode(tree,n=>n.type==='ErrorBanner'&&n.props.mensaje).props.mensaje,/servidor podría procesarlos más tarde/); assert.equal(findNode(tree,n=>n.type==='PrimaryButton'&&n.props.titulo==='Guardar cambios').props.deshabilitado,true);
  network.resolve({status:200,ok:true,text:async()=>JSON.stringify({...user,nombre:'Nombre editado'})}); await new Promise(r=>setImmediate(r)); tree=ui.render();
  assert.equal(c.getSnapshot().usuario.nombre,user.nombre); assert.equal(findNode(tree,n=>n.type==='FormField'&&n.props.label==='Nombre').props.value,'Nombre editado'); assert.equal(db.value,'memory-only'); assert.equal(h.calls(),1); assert.equal(h.aborted(),1);
});
test('cuerpo PATCH perfil colgado y respuesta tardía A no modifica sesión B', async () => {
  const {db,secure}=fakeStorage(null); let count=0; const a={id:'A',nombre:'Ana',email:'a@example.com',fotoUrl:null}, b={id:'B',nombre:'Beatriz',email:'b@example.com',fotoUrl:null};
  const {c,store}=sessionHarness(secure,{login:async()=>({usuario:++count===1?a:b,accessToken:'token-'+count})}); await c.bootstrap(); await c.iniciarSesion('a','x'); const body=deferred();
  const h=patchTimeoutHarness(async()=>({status:200,ok:true,text:()=>body.promise}),store); const ui=perfilHarness({...h.api,obtenerPerfil:async()=>a},h.client,c); ui.render(); await new Promise(r=>setImmediate(r)); let tree=ui.render();
  findNode(tree,n=>n.type==='FormField'&&n.props.label==='Nombre').props.onChangeText('Cambio de A'); tree=ui.render(); const pending=findNode(tree,n=>n.type==='PrimaryButton'&&n.props.titulo==='Guardar cambios').props.onPress(); await new Promise(r=>setImmediate(r));
  await c.salirLocal(); await c.iniciarSesion('b','x'); h.expire(); await pending; body.resolve(JSON.stringify({...a,nombre:'Cambio de A'})); await new Promise(r=>setImmediate(r));
  assert.equal(c.getSnapshot().estado,'autenticado'); assert.equal(c.getSnapshot().usuario.id,'B'); assert.equal(c.getSnapshot().usuario.nombre,'Beatriz'); assert.equal(db.value,'token-2'); assert.equal(h.calls(),1);
});
test('timeout de fetch PATCH contraseña cierra sesión local y respuesta tardía no confirma éxito', async () => {
  const {db,secure}=fakeStorage(null); const {c,store}=sessionHarness(secure); await c.bootstrap(); await c.iniciarSesion('a','x'); const network=deferred();
  const h=patchTimeoutHarness(()=>network.promise,store); const ui=perfilHarness(h.api,h.client,c); let tree=ui.render('CambiarContrasenaScreen');
  for(const [label,value] of [['Contraseña actual','actual123'],['Nueva contraseña','nueva123'],['Confirmar nueva contraseña','nueva123']]) {findNode(tree,n=>n.type==='FormField'&&n.props.label===label).props.onChangeText(value); tree=ui.render('CambiarContrasenaScreen');}
  const pending=findNode(tree,n=>n.type==='PrimaryButton'&&n.props.titulo==='Cambiar contraseña').props.onPress(); await new Promise(r=>setImmediate(r)); h.expire(); await pending;
  assert.equal(c.getSnapshot().estado,'no-autenticado'); assert.match(c.getSnapshot().aviso,/podría procesarla más tarde/); assert.equal(db.value,null); assert.equal(store.getToken(),null); assert.equal(h.calls(),1);
  network.resolve({status:200,ok:true,text:async()=>'{"mensaje":"ok"}'}); await new Promise(r=>setImmediate(r)); assert.equal(c.getSnapshot().estado,'no-autenticado'); assert.match(c.getSnapshot().aviso,/No pudimos confirmar/);
});
test('cuerpo PATCH contraseña colgado de A no cierra sesión B tras timeout y 200 tardío', async () => {
  const {db,secure}=fakeStorage(null); let count=0; const a={id:'A',nombre:'Ana'},b={id:'B',nombre:'Beatriz'}; const {c,store}=sessionHarness(secure,{login:async()=>({usuario:++count===1?a:b,accessToken:'token-'+count})});
  await c.bootstrap(); await c.iniciarSesion('a','x'); const body=deferred(); const h=patchTimeoutHarness(async()=>({status:200,ok:true,text:()=>body.promise}),store); const ui=perfilHarness(h.api,h.client,c); let tree=ui.render('CambiarContrasenaScreen');
  for(const [label,value] of [['Contraseña actual','actual123'],['Nueva contraseña','nueva123'],['Confirmar nueva contraseña','nueva123']]) {findNode(tree,n=>n.type==='FormField'&&n.props.label===label).props.onChangeText(value); tree=ui.render('CambiarContrasenaScreen');}
  const pending=findNode(tree,n=>n.type==='PrimaryButton'&&n.props.titulo==='Cambiar contraseña').props.onPress(); await new Promise(r=>setImmediate(r)); await c.salirLocal(); await c.iniciarSesion('b','x'); h.expire(); await pending;
  body.resolve('{"mensaje":"ok"}'); await new Promise(r=>setImmediate(r)); assert.equal(c.getSnapshot().estado,'autenticado'); assert.equal(c.getSnapshot().usuario.id,'B'); assert.equal(db.value,'token-2'); assert.equal(h.calls(),1);
});
test('clasificación de escritura incierta distingue red, 408 y 5xx de 400 o 401', () => {
  const client=setup(async()=>response(200)).client; const err=status=>new client.ApiRequestError(status,'Error',['detalle']);
  for(const code of [0,408,500,503]) assert.equal(client.esEscrituraIncierta(err(code)),true);
  for(const code of [400,401,403,429]) assert.equal(client.esEscrituraIncierta(err(code)),false);
  assert.equal(client.esEscrituraIncierta(Error('respuesta desconocida')),true);
});
test('red y 503 en PATCH de perfil o contraseña se tratan como inciertos sin reintento', async () => {
  for (const kind of ['perfil','password']) for (const mode of ['red','503']) {
    const {db,secure}=fakeStorage(null); const {c,store,user}=sessionHarness(secure); await c.bootstrap(); await c.iniciarSesion('a','x');
    const h=patchTimeoutHarness(async()=>{if(mode==='red') throw Error('offline'); return {status:503,ok:false,text:async()=>'{"message":"unavailable"}'};},store);
    const ui=perfilHarness({...h.api,obtenerPerfil:async()=>user},h.client,c); let tree=ui.render(kind==='perfil'?'PerfilScreen':'CambiarContrasenaScreen');
    if(kind==='perfil') {await new Promise(r=>setImmediate(r)); tree=ui.render(); findNode(tree,n=>n.type==='FormField'&&n.props.label==='Nombre').props.onChangeText('Nombre editado'); tree=ui.render(); await findNode(tree,n=>n.type==='PrimaryButton'&&n.props.titulo==='Guardar cambios').props.onPress(); tree=ui.render(); assert.equal(findNode(tree,n=>n.type==='PrimaryButton'&&n.props.titulo==='Guardar cambios').props.deshabilitado,true); assert.match(findNode(tree,n=>n.type==='ErrorBanner'&&n.props.mensaje).props.mensaje,/No pudimos confirmar/); assert.equal(db.value,'memory-only'); }
    else {for(const [label,value] of [['Contraseña actual','actual123'],['Nueva contraseña','nueva123'],['Confirmar nueva contraseña','nueva123']]) {findNode(tree,n=>n.type==='FormField'&&n.props.label===label).props.onChangeText(value); tree=ui.render('CambiarContrasenaScreen');} await findNode(tree,n=>n.type==='PrimaryButton'&&n.props.titulo==='Cambiar contraseña').props.onPress(); assert.equal(c.getSnapshot().estado,'no-autenticado'); assert.match(c.getSnapshot().aviso,/No pudimos confirmar/); assert.equal(db.value,null);}
    assert.equal(h.calls(),1);
  }
});
test('desmontar y reabrir perfil mientras guarda conserva borrador y bloquea duplicado', async () => {
  const {secure}=fakeStorage(null); const {c,store,user}=sessionHarness(secure); await c.bootstrap(); await c.iniciarSesion('a','x'); const responsePending=deferred();
  const h=patchTimeoutHarness(()=>responsePending.promise,store); let reads=0; const ui=perfilHarness({...h.api,obtenerPerfil:async()=>{reads++; return user;}},h.client,c);
  ui.render(); await new Promise(r=>setImmediate(r)); let tree=ui.render(); findNode(tree,n=>n.type==='FormField'&&n.props.label==='Nombre').props.onChangeText('Borrador persistente'); tree=ui.render();
  const pending=findNode(tree,n=>n.type==='PrimaryButton'&&n.props.titulo==='Guardar cambios').props.onPress(); await new Promise(r=>setImmediate(r)); ui.unmount(); ui.render(); await new Promise(r=>setImmediate(r)); tree=ui.render();
  const save=findNode(tree,n=>n.type==='PrimaryButton'&&n.props.titulo==='Guardar cambios'); assert.equal(save.props.cargando,true); assert.equal(findNode(tree,n=>n.type==='FormField'&&n.props.label==='Nombre').props.value,'Borrador persistente');
  await save.props.onPress(); assert.equal(h.calls(),1); assert.equal(reads,2);
  responsePending.resolve({status:200,ok:true,text:async()=>JSON.stringify({...user,nombre:'Borrador persistente'})}); await pending; tree=ui.render(); assert.equal(c.getSnapshot().usuario.nombre,'Borrador persistente'); assert.equal(save.props.cargando,true); assert.equal(findNode(tree,n=>n.type==='PrimaryButton'&&n.props.titulo==='Guardar cambios').props.cargando,false);
});
test('reabrir tras 408 no reconcilia automáticamente y exige revisión consciente', async () => {
  const {secure}=fakeStorage(null); const {c,store,user}=sessionHarness(secure); await c.bootstrap(); await c.iniciarSesion('a','x'); let reads=0;
  const h=patchTimeoutHarness(async()=>({status:408,ok:false,text:async()=>'{"message":"timeout"}'}),store); const ui=perfilHarness({...h.api,obtenerPerfil:async()=>{reads++; return user;}},h.client,c);
  ui.render(); await new Promise(r=>setImmediate(r)); let tree=ui.render(); findNode(tree,n=>n.type==='FormField'&&n.props.label==='Nombre').props.onChangeText('Borrador'); tree=ui.render(); await findNode(tree,n=>n.type==='PrimaryButton'&&n.props.titulo==='Guardar cambios').props.onPress();
  ui.unmount(); ui.render(); await new Promise(r=>setImmediate(r)); tree=ui.render(); assert.equal(reads,2); assert.equal(findNode(tree,n=>n.type==='PrimaryButton'&&n.props.titulo==='Guardar cambios').props.deshabilitado,true); assert.equal(findNode(tree,n=>n.type==='FormField'&&n.props.label==='Nombre').props.value,'Borrador');
  await findNode(tree,n=>n.type==='PrimaryButton'&&n.props.titulo==='Guardar cambios').props.onPress(); assert.equal(h.calls(),1);
  findNode(tree,n=>n.type==='PrimaryButton'&&n.props.titulo==='Consultar perfil').props.onPress(); await new Promise(r=>setImmediate(r)); tree=ui.render(); assert.equal(reads,3); assert.equal(findNode(tree,n=>n.type==='PrimaryButton'&&n.props.titulo==='Guardar cambios').props.deshabilitado,true);
  assert.match(ui.perfilEscrituras.getSnapshot().mensaje,/aún podría procesarse más tarde/); findNode(tree,n=>n.type==='Pressable'&&n.props.children?.props?.children==='He revisado; quiero continuar').props.onPress(); tree=ui.render(); assert.equal(findNode(tree,n=>n.type==='PrimaryButton'&&n.props.titulo==='Guardar cambios').props.deshabilitado,false);
});
test('timeout y deep link de reset conservan incertidumbre y borrador al reabrir', async () => {
  const {secure}=fakeStorage(null); const {c,store,user}=sessionHarness(secure); await c.bootstrap(); await c.iniciarSesion('a','x'); const network=deferred();
  const h=patchTimeoutHarness(()=>network.promise,store); const ui=perfilHarness({...h.api,obtenerPerfil:async()=>user},h.client,c); ui.render(); await new Promise(r=>setImmediate(r)); let tree=ui.render();
  findNode(tree,n=>n.type==='FormField'&&n.props.label==='Nombre').props.onChangeText('Borrador pendiente'); tree=ui.render(); const pending=findNode(tree,n=>n.type==='PrimaryButton'&&n.props.titulo==='Guardar cambios').props.onPress(); await new Promise(r=>setImmediate(r));
  const {ResetLinkCoordinator}=load('src/lib/resetLink.ts'); const links=new ResetLinkCoordinator(); const link=links.receive('samproject://reset?token='+'a'.repeat(64)); ui.unmount();
  h.expire(); await pending; const reset=c.iniciarReset(); await c.finalizarReset(reset,'exito'); assert.equal(links.close(link.id),null);
  ui.render(); await new Promise(r=>setImmediate(r)); tree=ui.render(); assert.equal(ui.perfilEscrituras.getSnapshot().fase,'incierto'); assert.equal(findNode(tree,n=>n.type==='FormField'&&n.props.label==='Nombre').props.value,'Borrador pendiente'); assert.equal(findNode(tree,n=>n.type==='PrimaryButton'&&n.props.titulo==='Guardar cambios').props.deshabilitado,true);
  network.resolve({status:200,ok:true,text:async()=>JSON.stringify({...user,nombre:'Borrador pendiente'})}); await new Promise(r=>setImmediate(r)); assert.equal(ui.perfilEscrituras.getSnapshot().fase,'incierto'); assert.equal(h.calls(),1);
});
test('logout y cambio de identidad borran borrador y no aplican 200 tardío de A en B', async () => {
  const {db,secure}=fakeStorage(null); let count=0; const a={id:'A',nombre:'Ana',email:'a@example.com',fotoUrl:null}, b={id:'B',nombre:'Beatriz',email:'b@example.com',fotoUrl:null};
  const {c,store}=sessionHarness(secure,{login:async()=>({usuario:++count===1?a:b,accessToken:'token-'+count})}); await c.bootstrap(); await c.iniciarSesion('a','x'); const network=deferred();
  const h=patchTimeoutHarness(()=>network.promise,store); const ui=perfilHarness({...h.api,obtenerPerfil:async()=>c.getSnapshot().usuario},h.client,c); ui.render(); await new Promise(r=>setImmediate(r)); let tree=ui.render(); findNode(tree,n=>n.type==='FormField'&&n.props.label==='Nombre').props.onChangeText('Borrador privado A'); tree=ui.render();
  const pending=findNode(tree,n=>n.type==='PrimaryButton'&&n.props.titulo==='Guardar cambios').props.onPress(); await new Promise(r=>setImmediate(r)); ui.unmount(); await c.salirLocal(); assert.equal(ui.perfilEscrituras.getSnapshot().nombre,''); await c.iniciarSesion('b','x');
  ui.render(); await new Promise(r=>setImmediate(r)); tree=ui.render(); assert.equal(findNode(tree,n=>n.type==='FormField'&&n.props.label==='Nombre').props.value,'Beatriz'); assert.equal(ui.perfilEscrituras.getSnapshot().fase,'listo');
  network.resolve({status:200,ok:true,text:async()=>JSON.stringify({...a,nombre:'Borrador privado A'})}); await pending; assert.equal(c.getSnapshot().usuario.id,'B'); assert.equal(ui.perfilEscrituras.getSnapshot().nombre,'Beatriz'); assert.equal(db.value,'token-2');
});
test('cambio de contraseña en curso sobrevive desmontaje sin guardar contraseñas ni duplicar', async () => {
  const {db,secure}=fakeStorage(null); const {c,store}=sessionHarness(secure); await c.bootstrap(); await c.iniciarSesion('a','x'); const network=deferred(); const h=patchTimeoutHarness(()=>network.promise,store); const ui=perfilHarness(h.api,h.client,c); let tree=ui.render('CambiarContrasenaScreen');
  for(const [label,value] of [['Contraseña actual','actual123'],['Nueva contraseña','nueva123'],['Confirmar nueva contraseña','nueva123']]) {findNode(tree,n=>n.type==='FormField'&&n.props.label===label).props.onChangeText(value); tree=ui.render('CambiarContrasenaScreen');}
  const pending=findNode(tree,n=>n.type==='PrimaryButton'&&n.props.titulo==='Cambiar contraseña').props.onPress(); await new Promise(r=>setImmediate(r)); assert.equal(ui.perfilEscrituras.getSnapshot().contrasenaPendiente,true); assert.doesNotMatch(JSON.stringify(ui.perfilEscrituras.getSnapshot()),/actual123|nueva123/); assert.equal(db.value,'memory-only');
  ui.unmount(); tree=ui.render('CambiarContrasenaScreen'); assert.equal(findNode(tree,n=>n.type==='FormField'&&n.props.label==='Contraseña actual').props.value,''); assert.equal(findNode(tree,n=>n.type==='PrimaryButton'&&n.props.titulo==='Cambiar contraseña').props.cargando,true);
  await findNode(tree,n=>n.type==='PrimaryButton'&&n.props.titulo==='Cambiar contraseña').props.onPress(); assert.equal(h.calls(),1); h.expire(); await pending; assert.equal(c.getSnapshot().estado,'no-autenticado'); assert.equal(db.value,null); assert.equal(ui.perfilEscrituras.getSnapshot().contrasenaPendiente,false);
  network.resolve({status:200,ok:true,text:async()=>'{"mensaje":"ok"}'}); await new Promise(r=>setImmediate(r)); assert.match(c.getSnapshot().aviso,/No pudimos confirmar/);
});
test('reset profundo durante guardado conserva bloqueo y procesa 408 aunque perfil esté desmontado', async () => {
  const {secure}=fakeStorage(null); const {c,store,user}=sessionHarness(secure); await c.bootstrap(); await c.iniciarSesion('a','x'); const network=deferred();
  const h=patchTimeoutHarness(()=>network.promise,store); const ui=perfilHarness({...h.api,obtenerPerfil:async()=>user},h.client,c); ui.render(); await new Promise(r=>setImmediate(r)); let tree=ui.render();
  findNode(tree,n=>n.type==='FormField'&&n.props.label==='Nombre').props.onChangeText('Nombre en vuelo'); tree=ui.render(); const pending=findNode(tree,n=>n.type==='PrimaryButton'&&n.props.titulo==='Guardar cambios').props.onPress();
  await new Promise(r=>setImmediate(r)); ui.unmount(); const {ResetLinkCoordinator}=load('src/lib/resetLink.ts'); const links=new ResetLinkCoordinator(); const link=links.receive('samproject://reset?token='+'c'.repeat(64)); const id=c.iniciarReset(); await c.finalizarReset(id,'exito'); assert.equal(links.close(link.id),null);
  assert.equal(ui.perfilEscrituras.getSnapshot().fase,'guardando'); network.resolve({status:408,ok:false,text:async()=>'{"message":"timeout"}'}); await pending;
  ui.render(); await new Promise(r=>setImmediate(r)); tree=ui.render(); assert.equal(ui.perfilEscrituras.getSnapshot().fase,'incierto'); assert.equal(findNode(tree,n=>n.type==='PrimaryButton'&&n.props.titulo==='Guardar cambios').props.deshabilitado,true); assert.equal(findNode(tree,n=>n.type==='FormField'&&n.props.label==='Nombre').props.value,'Nombre en vuelo'); assert.equal(h.calls(),1);
});
test('contraseña 408 tras desmontar sigue política local sin almacenar secretos', async () => {
  const {db,secure}=fakeStorage(null); const {c,store}=sessionHarness(secure); await c.bootstrap(); await c.iniciarSesion('a','x'); const network=deferred();
  const h=patchTimeoutHarness(()=>network.promise,store); const ui=perfilHarness(h.api,h.client,c); let tree=ui.render('CambiarContrasenaScreen');
  for(const [label,value] of [['Contraseña actual','actual123'],['Nueva contraseña','nueva123'],['Confirmar nueva contraseña','nueva123']]) {findNode(tree,n=>n.type==='FormField'&&n.props.label===label).props.onChangeText(value); tree=ui.render('CambiarContrasenaScreen');}
  const pending=findNode(tree,n=>n.type==='PrimaryButton'&&n.props.titulo==='Cambiar contraseña').props.onPress(); await new Promise(r=>setImmediate(r)); ui.unmount();
  assert.doesNotMatch(JSON.stringify([...db.map]),/actual123|nueva123/); assert.doesNotMatch(JSON.stringify(ui.perfilEscrituras.getSnapshot()),/actual123|nueva123/);
  network.resolve({status:408,ok:false,text:async()=>'{"message":"timeout"}'}); await pending; assert.equal(c.getSnapshot().estado,'no-autenticado'); assert.equal(db.value,null); assert.match(c.getSnapshot().aviso,/No pudimos confirmar/); assert.doesNotMatch(JSON.stringify(ui.perfilEscrituras.getSnapshot()),/actual123|nueva123/); assert.equal(h.calls(),1);
});
test('snapshot no revela borrador A si credencial cambia antes de sincronizar suscriptor', async () => {
  const client=setup(async()=>response(200)).client; const {ProfileWriteCoordinator}=load('src/auth/ProfileWriteCoordinator.ts',{'../api/client':client},{Promise,Set}); let identity={usuarioId:'A',tokenVersion:1};
  const writes=new ProfileWriteCoordinator({credencial:()=>identity,sello:()=>null,credencialVigente:()=>false,actualizarUsuario:()=>{},guardar:async()=>{},consultar:async()=>{},cambiar:async()=>{},salir:async()=>{}});
  writes.sincronizar(); writes.adoptar({id:'A',nombre:'Ana',fotoUrl:null}); writes.editarNombre('Borrador A'); assert.equal(writes.getSnapshot().nombre,'Borrador A');
  identity={usuarioId:'B',tokenVersion:2}; assert.equal(writes.getSnapshot().nombre,''); writes.sincronizar(); assert.equal(writes.getSnapshot().fase,'sin-perfil');
});
test('nueva credencial de la misma cuenta descarta borrador de sesión anterior', async () => {
  const {secure}=fakeStorage(null); const {c,store,user}=sessionHarness(secure); await c.bootstrap(); await c.iniciarSesion('a','x'); const h=patchTimeoutHarness(async()=>response(200),store);
  const ui=perfilHarness({...h.api,obtenerPerfil:async()=>user},h.client,c); ui.render(); await new Promise(r=>setImmediate(r)); let tree=ui.render();
  findNode(tree,n=>n.type==='FormField'&&n.props.label==='Nombre').props.onChangeText('Borrador de sesión previa'); await c.salirLocal(); assert.equal(ui.perfilEscrituras.getSnapshot().nombre,''); await c.iniciarSesion('a','x');
  ui.unmount(); ui.render(); await new Promise(r=>setImmediate(r)); tree=ui.render(); assert.equal(findNode(tree,n=>n.type==='FormField'&&n.props.label==='Nombre').props.value,user.nombre);
});
