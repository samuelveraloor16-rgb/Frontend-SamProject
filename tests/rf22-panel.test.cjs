const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
function load(path, deps = {}, globals = {}) {
  const exports = {}, file = `src/${path}.${path.includes('Screen') ? 'tsx' : 'ts'}`;
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText, { exports, require: n => { assert.ok(n in deps, n); return deps[n]; },
    Error, AbortController, setTimeout, clearTimeout, ...globals });
  return exports;
}
const plain = x => JSON.parse(JSON.stringify(x));
const cl = load('api/client', { './config': { API_BASE_URL: 'https://example.invalid/api/v1' }, './tokenStorage': { getToken: () => 'new', getTokenVersion: () => 2 } });
const api = load('api/metricas', { './client': cl });
const { PanelProyectoController: Controller } = load('lib/PanelProyectoController', { '../api/client': cl, '../api/metricas': api });
// Deliberadamente independientes: si el cliente recompone sumas/progreso falla la prueba.
const metricas = (id = 'p') => ({ proyectoId: id, calculadoEn: '2026-11-26T12:00:00.000Z', total: 81, hechas: 12, pendientes: 21, enCurso: 8, trabajoPendiente: 67, vencidas: 4, progreso: 73.4 });
const proyecto = (id = 'p', archivado = false) => ({ id, nombre: 'Proyecto real', archivado, progreso: 99, total: 999 });
function deferred() { let resolve, reject; const promise = new Promise((a,b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
function setup(id = 'p') {
  let generation = 1, logged = true, unauthorized = 0, gets = 0;
  let metrics = async () => metricas(id), project = async () => proyecto(id);
  const sello = { usuarioId: 'u', generation: 1, tokenVersion: 1 };
  const c = new Controller({ proyectoId: id, sello, jwt: 'old', vigente: s => logged && s.generation === generation,
    metricas: (i,j) => { assert.equal(i,id); assert.equal(j,'old'); gets++; return metrics(); },
    proyecto: (i,j) => { assert.equal(i,id); assert.equal(j,'old'); return project(); },
    unauthorized: s => { assert.equal(s,sello); unauthorized++; },
  });
  return { c, metrics: fn => metrics = fn, project: fn => project = fn, unauthorized: () => unauthorized, gets: () => gets,
    nuevaSesion: () => generation++, logout: () => logged = false };
}
test('API dedicada: encode segmento, base /api/v1 una vez, GET sin query/body y Bearer capturado', async () => {
  const calls = [];
  const client = load('api/client', { './config': { API_BASE_URL: 'https://example.invalid/api/v1' }, './tokenStorage': { getToken: () => 'new', getTokenVersion: () => 2 } }, {
    fetch: async (url, options) => { calls.push({url, ...options, signal: !!options.signal}); return {status: 200, ok: true, text: async () => JSON.stringify(metricas())}; },
  });
  const a = load('api/metricas', {'./client': client});
  await a.obtenerMetricasProyecto('p /?#', 'old'); await a.obtenerProyectoParaPanel('p /?#', 'old');
  assert.deepEqual(calls.map(c => c.url), ['https://example.invalid/api/v1/proyectos/p%20%2F%3F%23/metricas', 'https://example.invalid/api/v1/proyectos/p%20%2F%3F%23']);
  for (const c of calls) { assert.equal(c.method,'GET'); assert.equal(c.body, undefined); assert.equal(c.headers.Authorization,'Bearer old'); assert.equal(c.signal,true); }
});
test('API sin retry: 400/401/404/429/500/red; 401 explícito nunca cierra la sesión global nueva', async () => {
  for (const status of [0,400,401,404,429,500]) {
    let calls = 0, exits = 0;
    const client = load('api/client', { './config': {API_BASE_URL:''}, './tokenStorage':{getToken:()=> 'new',getTokenVersion:()=>2} }, {
      fetch: async () => { calls++; if (!status) throw new Error('offline'); return {status,ok:false,text:async()=>'{"message":"error"}'}; },
    });
    client.setUnauthorizedHandler(()=>exits++);
    const a = load('api/metricas',{'./client':client});
    await assert.rejects(a.obtenerMetricasProyecto('p','old'), e=>e.statusCode===status);
    assert.equal(calls,1); assert.equal(exits,0);
  }
});
test('plazo incluye fetch/cuerpo colgado; éxito y 401 tardíos descartados sin invalidación global', async () => {
  for (const body of [false,true]) for (const status of [200,401]) {
    let tick, cleared = 0, exits = 0;
    const d=deferred();
    const response = {status,ok:status===200,text:()=>body?d.promise:Promise.resolve(JSON.stringify(metricas()))};
    const client=load('api/client',{'./config':{API_BASE_URL:''},'./tokenStorage':{getToken:()=> 'new',getTokenVersion:()=>2}}, {
      fetch:()=>body?Promise.resolve(response):d.promise,
    });
    client.setUnauthorizedHandler(()=>exits++);
    const a=load('api/metricas',{'./client':client},{setTimeout:fn=>{tick=fn;return 1;},clearTimeout:()=>cleared++});
    const p=a.obtenerMetricasProyecto('p','old');
    await Promise.resolve(); await Promise.resolve();
    // 401 se rechaza al recibir cabeceras, no espera cuerpo.
    if (body && status===401) { await assert.rejects(p,e=>e.statusCode===401); }
    else { tick(); await assert.rejects(p,e=>e.statusCode===0); }
    d.resolve(body?JSON.stringify(metricas()):response);
    await Promise.resolve(); await Promise.resolve(); assert.equal(exits,0); assert.equal(cleared,1);
  }
});
test('validación de shape/rangos sin reconstruir relaciones backend', () => {
  assert.deepEqual(plain(api.validarMetricas(metricas(),'p')),metricas());
  for(const patch of [{proyectoId:'other'},{calculadoEn:'bad'},{calculadoEn:5},{total:-1},{hechas:1.5},{pendientes:82},{enCurso:NaN},{trabajoPendiente:Infinity},{vencidas:-1},{progreso:101},{progreso:'50'}]) {
    assert.throws(()=>api.validarMetricas({...metricas(),...patch},'p'));
  }
  assert.throws(()=>api.validarMetricas(null,'p'));
});
test('carga sin defaults, métricas literales independientes de RF11 metadata y archivo real solo lectura', async () => {
  const s=setup(); assert.equal(s.c.getSnapshot().metricas,null);
  s.project(async()=>proyecto('p',true)); const d=deferred(); s.metrics(()=>d.promise);
  const p=s.c.cargar(); assert.equal(s.c.getSnapshot().fase,'cargando'); assert.equal(s.c.getSnapshot().metricas,null);
  await s.c.cargar(); assert.equal(s.gets(),1);
  d.resolve(metricas()); await p;
  assert.deepEqual(plain(s.c.getSnapshot().metricas),metricas()); assert.equal(s.c.getSnapshot().proyecto.archivado,true);
});
test('vacío real total cero se conserva; no se presenta vacío durante error/carga', async () => {
  const s=setup(); const zero={...metricas(),total:0,hechas:0,pendientes:0,enCurso:0,trabajoPendiente:0,vencidas:0,progreso:0};
  s.metrics(async()=>zero); await s.c.cargar(); assert.deepEqual(plain(s.c.getSnapshot().metricas),zero);
  s.metrics(async()=>{throw new Error('offline');}); await s.c.cargar(); assert.equal(s.c.getSnapshot().metricas,null);
});
test('actualizar purga corte anterior desde el inicio, error/red/429 no lo restaura; reintento manual', async () => {
  for(const status of [0,429,500,404,403]) for(const source of ['metrics','project']) {
    const s=setup(); await s.c.cargar(); const d=deferred(); s[source](()=>d.promise);
    const p=s.c.cargar(); assert.equal(s.c.getSnapshot().metricas,null); assert.equal(s.c.getSnapshot().proyecto,null);
    d.reject(new cl.ApiRequestError(status,'Error',['sin red'])); await p;
    assert.equal(s.c.getSnapshot().fase,[403,404].includes(status)?'sin-acceso':'error');
    assert.equal(s.c.getSnapshot().metricas,null); assert.equal(s.gets(),2);
    if(status===429) assert.match(s.c.getSnapshot().error,/Demasiados/);
    s.metrics(async()=>metricas()); s.project(async()=>proyecto()); await s.c.cargar(); assert.equal(s.c.getSnapshot().fase,'listo');
  }
});
test('404 no distingue existencia ni acceso y shape inválido falla cerrado', async () => {
  const s=setup(); s.metrics(async()=>{throw new cl.ApiRequestError(404,'NotFound',['nombre privado']);}); await s.c.cargar();
  assert.equal(s.c.getSnapshot().error,'Proyecto no disponible. Puede que ya no tengas acceso.');
  for(const source of ['metrics','project']) {
    const t=setup(); t[source](async()=>({})); await t.c.cargar(); assert.equal(t.c.getSnapshot().fase,'error'); assert.equal(t.c.getSnapshot().metricas,null);
  }
});
test('sesión nueva misma cuenta/logout/desmontaje/foco descartan éxitos y 401 tardíos en ambas consultas', async () => {
  for(const exit of ['nuevaSesion','logout','dispose','suspender']) for(const source of ['metrics','project']) for(const fail of [false,true]) {
    const s=setup(), d=deferred(); s[source](()=>d.promise); const p=s.c.cargar();
    if(['dispose','suspender'].includes(exit)) s.c[exit](); else s[exit]();
    if(fail) d.reject(new cl.ApiRequestError(401,'Unauthorized',['expired'])); else d.resolve(source==='metrics'?metricas():proyecto());
    await p; assert.equal(s.c.getSnapshot().metricas,null); assert.equal(s.unauthorized(),0);
  }
});
test('401 actual usa sello; blur/reactivación, proyecto A→B y desmontaje no mezclan datos', async () => {
  const s=setup(); s.metrics(async()=>{throw new cl.ApiRequestError(401,'Unauthorized',['expired']);}); await s.c.cargar(); assert.equal(s.unauthorized(),1);
  const a=setup('a'), b=setup('b'), d=deferred(); a.metrics(()=>d.promise); const p=a.c.cargar(); a.c.suspender();
  await b.c.cargar(); d.resolve(metricas('a')); await p; assert.equal(b.c.getSnapshot().metricas.proyectoId,'b'); assert.equal(a.c.getSnapshot().metricas,null);
  const t=setup(), old=deferred(); t.metrics(()=>old.promise); const previous=t.c.cargar(); t.c.suspender(); t.c.activar();
  t.metrics(async()=>({...metricas(),progreso:18})); await t.c.cargar(); old.resolve(metricas()); await previous;
  assert.equal(t.c.getSnapshot().metricas.progreso,18); t.c.dispose(); assert.equal(t.c.getSnapshot().metricas,null);
});

const jsx=(type,props)=>({type,props:props||{}});
function render(node) {
  if(node==null||typeof node==='boolean')return null;
  if(Array.isArray(node))return node.map(render);
  if(typeof node!=='object')return node;
  if(typeof node.type==='function')return render(node.type(node.props));
  return {...node,props:{...node.props,children:render(node.props.children)}};
}
function nodes(tree) { return tree==null?[]:Array.isArray(tree)?tree.flatMap(nodes):typeof tree==='object'?[tree,...nodes(tree.props.children)]:[]; }
function text(tree) { return tree==null?'':Array.isArray(tree)?tree.map(text).join(''):typeof tree==='object'?text(tree.props.children):String(tree); }
function uiModule(extra={}) {
  return load('screens/PanelProyectoScreen',{
    react:{},'react/jsx-runtime':{jsx,jsxs:jsx,Fragment:'Fragment'},
    'react-native':{View:'View',Text:'Text',ScrollView:'ScrollView',ActivityIndicator:'ActivityIndicator',StyleSheet:{create:x=>x}},
    '@react-navigation/native':{},'../auth/AuthContext':{},'../api/tokenStorage':{},'../api/metricas':api,
    '../lib/PanelProyectoController':{PanelProyectoController:Controller},'../components/ScreenHeader':{},'../components/PrimaryButton':{},
    '../theme/colors':{colors:{primary:'#245B4A',secondary:'#DCE9DF',tertiary:'#D5C78E',background:'#F7F8F5',text:'#34413A'}},...extra,
  });
}
test('UI hosts simulados: cifras backend sin recálculo, barras solo geometría y progreso accesible', () => {
  const {MetricasPanel}=uiModule(); const tree=render(MetricasPanel({metricas:metricas()})), t=text(tree), all=nodes(tree);
  for(const expected of ['73.4%','12 completadas','Total contable: 81','Pendientes (sin iniciar): 21','En curso: 8','Completadas: 12','Trabajo pendiente: 67','Vencidas: 4','Corte del servidor:','Ritmo semanal no disponible','no un estado adicional']) assert.ok(t.includes(expected),expected);
  const progress=all.find(n=>n.props.accessibilityRole==='progressbar'); assert.equal(progress.props.accessibilityValue.now,73.4);
  assert.ok(all.some(n=>n.props.accessibilityLabel==='Pendientes (sin iniciar): 21'));
  assert.ok(all.some(n=>Array.isArray(n.props.style)&&n.props.style.some(s=>s.width===`${21/81*100}%`)));
  assert.ok(!t.includes('aún no tiene tareas'));
  const zero=render(MetricasPanel({metricas:{...metricas(),total:0,hechas:0,pendientes:0,enCurso:0,trabajoPendiente:0,vencidas:0,progreso:0}}));
  assert.ok(text(zero).includes('aún no tiene tareas contables')); assert.ok(!JSON.stringify(zero).includes('NaN'));
});
test('navegación registrada/conectada y ciclo foco/AppState/sesión declarado; no cache RF11 ni mutaciones', () => {
  const nav=fs.readFileSync('src/navigation/AppNavigator.tsx','utf8'), types=fs.readFileSync('src/navigation/types.ts','utf8'), project=fs.readFileSync('src/screens/ProyectoScreen.tsx','utf8'), ui=fs.readFileSync('src/screens/PanelProyectoScreen.tsx','utf8');
  assert.ok(nav.includes('<Stack.Screen name="PanelProyecto" component={PanelProyectoScreen} />'));
  assert.ok(types.includes('PanelProyecto: { proyectoId: string }'));
  assert.ok(project.includes("navigation.navigate('PanelProyecto', { proyectoId })"));
  assert.ok(ui.includes('sello.generation')&&ui.includes('sello.tokenVersion')&&ui.includes('key={`${proyectoId}:'));
  assert.ok(ui.includes('useFocusEffect(useCallback')&&ui.includes('controller.suspender()')&&ui.includes("AppState.addEventListener('change'"));
  assert.ok(ui.includes('ScrollView')&&ui.includes('No se muestran cifras anteriores')&&ui.includes('Proyecto archivado · solo lectura'));
  assert.ok(!ui.includes('useQuery')&&!ui.includes('obtenerProgreso')&&!ui.includes('listarTareas'));
  assert.match(project,/minHeight: 48/);
});
test('UI harness de hooks: carga/foco/actualizar/error/archivo/404, suspensión y limpieza de AppState', async () => {
  let controller, focus, appChange, removed=0, calls=0, navigated, captured;
  let get=async()=>metricas(), metadata=async()=>proyecto('p',true);
  const sello={usuarioId:'u',generation:7,tokenVersion:4};
  const auth={capturarSesion:()=>sello,esSesionActual:s=>s===sello,salirLocalSiSesionActual:()=>{}};
  const {PanelProyectoScreen}=uiModule({
    react:{useCallback:fn=>fn,useState:fn=>[controller??(controller=fn())],useSyncExternalStore:(_,snapshot)=>snapshot()},
    'react-native':{View:'View',Text:'Text',ScrollView:'ScrollView',ActivityIndicator:'ActivityIndicator',StyleSheet:{create:x=>x},
      AppState:{currentState:'active',addEventListener:(event,fn)=>{assert.equal(event,'change');appChange=fn;return{remove:()=>removed++};}}},
    '@react-navigation/native':{useRoute:()=>({params:{proyectoId:'p'}}),useNavigation:()=>({navigate:route=>navigated=route}),useFocusEffect:fn=>focus=fn},
    '../auth/AuthContext':{useAuth:()=>auth},'../api/tokenStorage':{getToken:()=> 'captured'},
    '../api/metricas':{obtenerMetricasProyecto:async(id,jwt)=>{assert.equal(id,'p');captured=jwt;calls++;return get();},obtenerProyectoParaPanel:()=>metadata()},
    '../components/ScreenHeader':{ScreenHeader:'Header'},'../components/PrimaryButton':{PrimaryButton:'Button'},
  });
  const screen=()=>render(PanelProyectoScreen());
  const flush=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
  assert.ok(!text(screen()).includes('Total contable'));
  const cleanup=focus(); assert.equal(captured,'captured'); assert.ok(text(screen()).includes('Consultando un nuevo corte'));
  await flush(); let tree=screen(); assert.ok(text(tree).includes('Proyecto real'));
  assert.ok(text(tree).includes('Proyecto archivado · solo lectura')); assert.ok(text(tree).includes('73.4%'));
  const d=deferred(); get=()=>d.promise;
  nodes(tree).find(n=>n.type==='Button'&&n.props.titulo==='Actualizar panel').props.onPress();
  assert.ok(!text(screen()).includes('73.4%')); assert.ok(nodes(screen()).some(n=>n.type==='Button'&&n.props.cargando));
  d.reject(new cl.ApiRequestError(429,'Limit',['privado'])); await flush();
  tree=screen(); assert.ok(text(tree).includes('Demasiados intentos')); assert.ok(!text(tree).includes('Total contable'));
  get=async()=>metricas(); nodes(tree).find(n=>n.type==='Button'&&n.props.titulo==='Reintentar panel').props.onPress(); await flush();
  assert.ok(text(screen()).includes('73.4%'));
  appChange('background'); assert.ok(!text(screen()).includes('73.4%'));
  metadata=async()=>{throw new cl.ApiRequestError(404,'NotFound',['dato privado']);};
  appChange('active'); await flush(); tree=screen();
  assert.ok(text(tree).includes('Proyecto no disponible')); assert.ok(!text(tree).includes('Proyecto real'));
  nodes(tree).find(n=>n.type==='Button'&&n.props.titulo==='Volver al inicio').props.onPress(); assert.equal(navigated,'Principal');
  const before=calls; cleanup(); assert.equal(removed,1); await controller.cargar(); assert.equal(calls,before);
});
