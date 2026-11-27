const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
function load(file, deps={}, globals={}) {
  const exports={};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(`src/${file}`,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,jsx:ts.JsxEmit.ReactJSX}}).outputText,
    {exports, require:n=>{assert.ok(n in deps,n);return deps[n];},Error,AbortController,Uint8Array,TextDecoder,URL,setTimeout,clearTimeout,...globals});
  return exports;
}
const url='https://example.invalid/api/v1/proyectos/p/reportes/resumen.pdf';
const pdf=new TextEncoder().encode('%PDF-1.7\nopaque server bytes\n%%EOF\n');
const header='proyectoId,proyectoNombre,calculadoEn,progreso,total,hechas,pendientes,enCurso,trabajoPendiente,vencidas,ritmoDisponible,ritmoMotivo,ritmoPromedioSemanal\r\n';
const csv=new TextEncoder().encode('\ufeff'+header+'"p","Nombre\r\ncon ""comillas""","corte",9,8,7,6,5,4,3,"NO_DISPONIBLE","motivo",\r\n');
function response(bytes=pdf,f='pdf',patch={}) {
  const headers=new Headers({'content-type':f==='pdf'?'application/pdf':'text/csv; charset=utf-8','content-disposition':`attachment; filename="resumen-proyecto.${f}"`,'cache-control':'private, no-store','x-content-type-options':'nosniff'});
  return {status:200,redirected:false,url:url.replace('.pdf',`.${f}`),headers,body:new ReadableStream({start(c){c.enqueue(bytes);c.close();}}),...patch};
}
function api(fetch,globals={}) {return load('api/reportes.ts',{'expo/fetch':{fetch},'./config':{API_BASE_URL:'https://example.invalid/api/v1'}},globals);}
const base=api(()=>{});
const {ReporteController:Controller}=load('lib/ReporteController.ts',{'../api/reportes':base});
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};}
const tick=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
test('binario: GET fijo bearer capturado, redirect error, sin token URL/body; bytes PDF/CSV intactos',async()=>{
  for(const [f,b] of [['pdf',pdf],['csv',csv]]) {
    let opts,called;
    const a=api(async(u,o)=>{called=u;opts=o;return response(b,f);});
    const got=await a.descargarReporte('p',f,'private-token',new AbortController().signal);
    assert.deepEqual(got,b); assert.equal(opts.headers.Authorization,'Bearer private-token');
    assert.equal(opts.redirect,'error');assert.equal(opts.credentials,'omit');assert.equal(opts.body,undefined);assert.equal(opts.method,'GET');
    assert.equal(called,url.replace('.pdf',`.${f}`));assert.ok(!called.includes('private-token'));
  }
  let called;
  const a=api(async(u)=>{called=u;throw Error('offline');});
  await assert.rejects(a.descargarReporte('p /?#','pdf','old',new AbortController().signal));
  assert.ok(called.includes('/p%20%2F%3F%23/'));
});
test('límite REAL streaming: 1MiB aceptado; exceso sin length o length mentiroso cancelado',async()=>{
  const full=new Uint8Array(1024*1024).fill(32);full.set(new TextEncoder().encode('%PDF-1.7\n'));full.set(new TextEncoder().encode('%%EOF\n'),full.length-6);
  assert.equal((await api(async()=>response(full)).descargarReporte('p','pdf','x',new AbortController().signal)).length,full.length);
  for(const length of [null,'1','1048576']) {
    let canceled=0,n=0;
    const res=response(); if(length)res.headers.set('content-length',length);
    res.body=new ReadableStream({pull(c){n++;c.enqueue(new Uint8Array(400000));},cancel(){canceled++;}});
    await assert.rejects(api(async()=>res).descargarReporte('p','pdf','x',new AbortController().signal),e=>e.status===502);
    assert.ok(canceled);assert.ok(n<7);
  }
});
test('headers, empty/truncated, invalid signature/UTF8/framing/JSON and redirects fail closed',async()=>{
  const bad=[];
  for(const [name,value] of [['content-type','application/json'],['content-disposition','attachment; filename="../../x.pdf"'],['content-disposition','attachment; filename="resumen-proyecto.pdf"; filename*=evil'],['cache-control','public'],['x-content-type-options',''],['content-length','9999'],['content-length','1'],['content-length','NaN'],['content-length','1048577']]) {
    const res=response();res.headers.set(name,value);bad.push(res);
  }
  bad.push(response(new Uint8Array()),response(pdf.slice(0,-8)),response(new TextEncoder().encode('{"error":1}')),response(pdf,'pdf',{redirected:true}),response(pdf,'pdf',{url:'https://evil.invalid/file'}),response(pdf,'pdf',{status:302}));
  for(const res of bad)await assert.rejects(api(async()=>res).descargarReporte('p','pdf','x',new AbortController().signal));
  for(const bytes of [csv.slice(3),csv.slice(0,-2),new TextEncoder().encode('\ufeff{}\r\n'),new TextEncoder().encode('\ufeff'+header+'"incomplete\r\n'),Uint8Array.from([...csv.slice(0,-2),255,13,10])])
    await assert.rejects(api(async()=>response(bytes,'csv')).descargarReporte('p','csv','x',new AbortController().signal));
});
test('401/403/404/422/429/5xx errors no JSON body reading; PDF Unicode explained, no fallback',async()=>{
  for(const status of [401,403,404,422,429,500]) {
    let calls=0;
    const a=api(async()=>{calls++;return response(pdf,'pdf',{status,body:{getReader(){throw Error('must not read JSON');}}});});
    await assert.rejects(a.descargarReporte('p','pdf','x',new AbortController().signal),e=>e.status===status&&(status!==422||/caracteres no representables/.test(e.message)));
    assert.equal(calls,1);
  }
});
test('plazo cubre headers y cuerpo ignorando abort; cancelación aborta y descarta resultado tardío',async()=>{
  for(const body of [false,true]) for(const cancel of [false,true]) {
    const d=deferred();let timeout,aborted=false,canceled=0;
    const res=response();res.body={getReader:()=>({read:()=>d.promise,cancel:async()=>{canceled++;}})};
    const a=api(async(u,o)=>{o.signal.addEventListener('abort',()=>aborted=true);return body?res:d.promise;},{setTimeout:fn=>{timeout=fn;return 1;},clearTimeout:()=>{}});
    const ac=new AbortController(),p=a.descargarReporte('p','pdf','x',ac.signal);await tick();
    if(cancel)ac.abort();else timeout();
    await assert.rejects(p,e=>e.status===(cancel?-1:0));assert.ok(aborted);if(body)assert.ok(canceled);
    d.resolve(body?{done:true}:res);await tick();
  }
});
function setup(overrides={}) {
  let generation=1,logged=true,downloads=0,writes=0,shares=0,cleaned=0,unauthorized=0,denied=0;
  const sello={usuarioId:'u',generation:1,tokenVersion:1};
  const d={id:'p',jwt:'old',sello,vigente:s=>logged&&s.generation===generation,
    descargar:async(id,f,jwt)=>{downloads++;assert.equal(id,'p');assert.equal(jwt,'old');return pdf;},
    disponible:async()=>true,escribir:async(f,b)=>{writes++;assert.deepEqual(b,pdf);return {uri:'private/op/resumen-proyecto.pdf',limpiar:()=>cleaned++};},
    compartir:async()=>{shares++;},unauthorized:()=>unauthorized++,sinAcceso:()=>denied++,...overrides};
  const c=new Controller(d);
  return {c,d,next:()=>generation++,logout:()=>logged=false,counts:()=>({downloads,writes,shares,cleaned,unauthorized,denied})};
}
test('controlador: duplicados, Promise<void> nunca éxito guardado, share failure sin falso éxito',async()=>{
  const d=deferred(),s=setup({disponible:()=>d.promise});const p=s.c.iniciar('pdf');await s.c.iniciar('csv');assert.equal(s.c.getSnapshot().fase,'descargando');d.resolve(true);await p;
  assert.equal(s.counts().downloads,1);assert.equal(s.counts().shares,1);assert.equal(s.counts().cleaned,0);
  assert.match(s.c.getSnapshot().mensaje,/No podemos confirmar/);assert.doesNotMatch(s.c.getSnapshot().mensaje,/^Compartido|^Guardado/);
  const t=setup({compartir:async()=>{throw Error('native');}});await t.c.iniciar('pdf');assert.match(t.c.getSnapshot().mensaje,/No se pudo/);assert.equal(t.counts().cleaned,0);
});
test('controlador: disponibilidad, escritura fallida, 401 vigente y errores no reviven ni filtran',async()=>{
  const missing=setup({disponible:async()=>false});await missing.c.iniciar('pdf');assert.equal(missing.counts().downloads,0);assert.match(missing.c.getSnapshot().mensaje,/no está disponible/);
  const failed=setup({escribir:async()=>{throw Error('I/O');}});await failed.c.iniciar('pdf');assert.equal(failed.counts().shares,0);assert.match(failed.c.getSnapshot().mensaje,/No se pudo/);
  for(const status of [401,403,404,422,429,500]) {
    const s=setup({descargar:async()=>{throw new base.ReporteError(status,'mensaje seguro');}});await s.c.iniciar('pdf');assert.equal(s.counts().shares,0);assert.equal(s.counts().writes,0);
    assert.equal(s.counts().unauthorized,status===401?1:0);assert.equal(s.counts().denied,[403,404].includes(status)?1:0);
    if([403,404].includes(status))assert.equal(s.c.getSnapshot().mensaje,null);
  }
});
test('misma cuenta nueva sesión/token, logout, unmount/proyecto: descarga tardía no escribe ni comparte, tampoco 401',async()=>{
  for(const action of ['next','logout','suspend'])for(const status of [200,401]) {
    const d=deferred();let signal;
    const s=setup({descargar:(id,f,j,si)=>{signal=si;return d.promise;}});const p=s.c.iniciar('pdf');await tick();
    if(action==='suspend')s.c.suspender();else{s[action]();s.c.suspender();}
    assert.ok(signal.aborted);
    if(status===200)d.resolve(pdf);else d.reject(new base.ReporteError(401,'old'));
    await p;assert.equal(s.counts().writes,0);assert.equal(s.counts().shares,0);assert.equal(s.counts().unauthorized,0);assert.equal(s.c.getSnapshot().mensaje,null);
  }
});
test('carrera escribiendo limpia tras await sin abrir hoja; cambio durante share no publica estado ni borra receptor',async()=>{
  const d=deferred();let cleaned=0;const s=setup({escribir:()=>d.promise});const p=s.c.iniciar('pdf');await tick();assert.equal(s.c.getSnapshot().fase,'preparando');s.c.suspender();d.resolve({uri:'own',limpiar:()=>cleaned++});await p;assert.equal(cleaned,1);assert.equal(s.counts().shares,0);
  const share=deferred(),t=setup({compartir:()=>share.promise});const q=t.c.iniciar('pdf');await tick();t.next();t.c.suspender();share.resolve();await q;assert.equal(t.c.getSnapshot().mensaje,null);assert.equal(t.counts().cleaned,0);
});
test('rotación token sin cambiar cuenta/generación y proyecto B no reciben resultado ni 401 de A',async()=>{
  for(const stage of ['descargar','escribir']) {
    const d=deferred();let tokenVersion=1,cleaned=0;
    const a=setup({vigente:s=>s.tokenVersion===tokenVersion,[stage]:()=>d.promise});
    const p=a.c.iniciar('pdf');await tick();tokenVersion=2;
    if(stage==='descargar')d.resolve(pdf);else d.resolve({uri:'a',limpiar:()=>cleaned++});
    await p;assert.equal(a.counts().shares,0);assert.equal(a.c.getSnapshot().mensaje,null);assert.equal(cleaned,stage==='escribir'?1:0);
    const b=setup();b.d.id='b';b.d.descargar=async(id)=>{assert.equal(id,'b');return pdf;};await b.c.iniciar('pdf');assert.equal(b.counts().shares,1);
  }
});
test('cancelar descarga no comparte y no permite doble petición pendiente',async()=>{
  const d=deferred();let signal;const s=setup({descargar:(i,f,j,si)=>{signal=si;return d.promise;}});const p=s.c.iniciar('pdf');await tick();s.c.cancelar();assert.ok(signal.aborted);await s.c.iniciar('csv');d.resolve(pdf);await p;assert.equal(s.counts().writes,0);assert.equal(s.counts().shares,0);assert.match(s.c.getSnapshot().mensaje,/cancelada/);
});
function nativeSetup() {
  const entries=new Map([['cache',{dir:true}],['cache/other.txt',{bytes:pdf}]]);let failure=false,shareCalls=[];
  class Directory {
    constructor(...parts){this.uri=parts.map(p=>p.uri??p).join('/');this.name=this.uri.split('/').at(-1);}
    get exists(){return entries.has(this.uri);}
    get parentDirectory(){return new Directory(this.uri.slice(0,this.uri.lastIndexOf('/')));}
    create(o={}){if(this.exists&&!o.idempotent)throw Error('collision');entries.set(this.uri,{dir:true});}
    list(){return [...entries.keys()].filter(k=>k.startsWith(this.uri+'/')&&!k.slice(this.uri.length+1).includes('/')).map(k=>entries.get(k).dir?new Directory(k):new File(k));}
    delete(){for(const k of entries.keys())if(k===this.uri||k.startsWith(this.uri+'/'))entries.delete(k);}
  }
  class File {
    constructor(...parts){this.uri=parts.map(p=>p.uri??p).join('/');this.name=this.uri.split('/').at(-1);}
    get exists(){return entries.has(this.uri);}
    get size(){return entries.get(this.uri)?.bytes?.length??0;}
    info(){return {exists:this.exists,size:this.size};}
    get lastModified(){return entries.get(this.uri)?.date??Date.now();}
    create(){if(this.exists)throw Error('collision');entries.set(this.uri,{bytes:new Uint8Array()});}
    async write(bytes){entries.set(this.uri,{bytes});if(failure)throw Error('disk');}
    delete(){entries.delete(this.uri);}
  }
  let id=0;
  const module=load('lib/expoReportes.ts',{'expo':{uuid:{v4:()=>`00000000-0000-4000-8000-${String(++id).padStart(12,'0')}`}},'./ReportesTemporales':load('lib/ReportesTemporales.ts'),'expo-file-system':{Directory,File,Paths:{cache:new Directory('cache')}},'expo-sharing':{isAvailableAsync:async()=>true,shareAsync:async(...args)=>{shareCalls.push(args);}},'react-native':{Platform:{OS:'ios'}},'../api/reportes':base});
  return {module,entries,fail:()=>failure=true,shareCalls,Directory,File};
}
test('adaptador Expo simulado: bytes intactos privados/aislados nombre fijo, write fail limpia propios, anchor y MIME',async()=>{
  const s=nativeSetup(),a=await s.module.escribirReporte('pdf',pdf),b=await s.module.escribirReporte('pdf',pdf);
  assert.notEqual(a.uri,b.uri);assert.ok(a.uri.endsWith('/resumen-proyecto.pdf'));assert.deepEqual(s.entries.get(a.uri).bytes,pdf);
  a.marcarOfrecido();const anchor={x:10,y:20,width:44,height:44};await s.module.compartirReporte(a,'pdf',anchor);
  assert.equal(s.shareCalls[0][0],a.uri);assert.equal(s.shareCalls[0][1].mimeType,'application/pdf');assert.equal(s.shareCalls[0][1].anchor,anchor);
  a.liberar();b.limpiar();s.module.limpiarResiduosReportes();assert.ok(s.entries.has(a.uri));assert.ok(!s.entries.has(b.uri));assert.ok(s.entries.has('cache/other.txt'));
  s.fail();await assert.rejects(s.module.escribirReporte('csv',csv));assert.equal([...s.entries.keys()].filter(k=>k.endsWith('.csv')).length,0);
});
test('residuos: parciales propios inmediatos, entregados siete días, activos no se borran, ajenos intactos',async()=>{
  const s=nativeSetup(),root='cache/samproject-rf23-v1';new s.Directory(root).create();
  const old=Date.now()-8*24*3600000,recent=Date.now();
  for(const [name,offered] of [[`op-${recent}-partial`,false],[`op-${old}-shared`,true],[`op-${recent}-shared`,true]]) {
    const d=new s.Directory(root,name);d.create();new s.File(d,'resumen-proyecto.pdf').create();if(offered)new s.File(d,'ofrecido').create();
  }
  const active=await s.module.escribirReporte('pdf',pdf);
  s.module.limpiarResiduosReportes();assert.ok(s.entries.has(active.uri));assert.ok(!s.entries.has(`${root}/op-${recent}-partial`));assert.ok(!s.entries.has(`${root}/op-${old}-shared`));assert.ok(s.entries.has(`${root}/op-${recent}-shared`));assert.ok(s.entries.has('cache/other.txt'));
  active.liberar();s.module.limpiarResiduosReportes();assert.ok(!s.entries.has(active.uri));
});
test('registro sesión cancela de inmediato y se desuscribe sin tocar otros controladores',()=>{
  const registry=load('lib/reportesSesion.ts');let n=0;const off=registry.registrarReporte(()=>n++);registry.sincronizarReportes();assert.equal(n,1);off();registry.sincronizarReportes();assert.equal(n,1);
  const auth=fs.readFileSync('src/auth/AuthContext.tsx','utf8');assert.match(auth,/const sync = \(\) => \{\s+sincronizarReportes\(\)/);assert.match(auth,/controller.subscribe\(sync\)/);
});
function jsx(type,props){return {type,props:props??{}};}
function nodes(t){return !t||typeof t!=='object'?[]:Array.isArray(t)?t.flatMap(nodes):[t,...nodes(t.props.children)];}
test('UI hosts/hooks: acciones, busy/disabled, cancel sólo descarga, duplicados, anchor medido y blur',async()=>{
  let index=0,states=[],focus,controller,measures=0;
  const s=setup(),d=deferred();s.d.descargar=()=>d.promise;
  class Captured extends Controller {constructor(opts){super({...opts,...s.d});controller=this;}}
  const registry={registrarReporte:()=>()=>{}};
  const ui=load('components/ReportesProyecto.tsx',{
    react:{useState:fn=>{const i=index++;if(!(i in states))states[i]=typeof fn==='function'?fn():fn;return [states[i],()=>{}];},useRef:()=>({current:{measureInWindow:fn=>{measures++;fn(3,4,44,44);}}}),useCallback:f=>f,useSyncExternalStore:(sub,get)=>get()},
    'react/jsx-runtime':{jsx,jsxs:jsx},'react-native':{View:'View',Text:'Text',StyleSheet:{create:x=>x}},'@react-navigation/native':{useFocusEffect:fn=>{focus=fn;}},
    '../auth/AuthContext':{useAuth:()=>({esSesionActual:()=>true,salirLocalSiSesionActual:()=>{}})},'../api/reportes':base,'../lib/ReporteController':{ReporteController:Captured},
    '../lib/expoReportes':{compartirDisponible:()=>true,compartirReporte:()=>{},escribirReporte:()=>{},limpiarResiduosReportes:()=>{}},'../lib/reportesSesion':registry,'./PrimaryButton':{PrimaryButton:'Button'},'../theme/colors':{colors:{primary:'#245B4A',text:'#34413A'}},
  });
  const render=()=>{index=0;return ui.ReportesProyecto({id:'p',jwt:'old',sello:s.d.sello,sinAcceso:()=>{}});};
  let tree=render(),buttons=nodes(tree).filter(n=>n.type==='Button');assert.deepEqual(buttons.map(n=>n.props.titulo),['Compartir PDF','Compartir CSV']);const cleanup=focus();
  buttons[0].props.onPress();buttons[1].props.onPress();await tick();assert.equal(measures,1);assert.equal(controller.getSnapshot().fase,'descargando');
  tree=render();buttons=nodes(tree).filter(n=>n.type==='Button');assert.ok(buttons[0].props.deshabilitado&&buttons[0].props.cargando);assert.ok(buttons[1].props.deshabilitado);assert.equal(buttons[2].props.titulo,'Cancelar descarga');
  buttons[2].props.onPress();d.resolve(pdf);await tick();tree=render();assert.equal(nodes(tree).filter(n=>n.type==='Button').length,2);cleanup();assert.equal(controller.getSnapshot().mensaje,null);
  const primary=fs.readFileSync('src/components/PrimaryButton.tsx','utf8');assert.match(primary,/accessibilityRole="button"/);assert.match(primary,/accessibilityState=\{\{ disabled: inactivo, busy: cargando \}\}/);assert.match(primary,/minHeight: 52/);
});
