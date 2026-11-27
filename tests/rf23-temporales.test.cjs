const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const exportsModule = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/lib/ReportesTemporales.ts','utf8'),{fileName:'manager.ts',compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,{exports:exportsModule,Error});
const {ReportesTemporales,REPORTES_CUOTA:Q}=exportsModule;
function deferred(){let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};}
function setup(){
  let n=0,now=1000000000,readError=false,deleteError=false,writeError=false,markError=false,gate;
  const disk=new Map(),deleted=[];
  const io={inventario(){if(readError)throw Error('read');return [...disk.values()].map(r=>({...r}));},
    async escribir(key,name,bytes){disk.set(key,{key,bytes:0,ofrecido:false,fecha:null});if(gate)await gate.promise;disk.get(key).bytes=bytes.length;if(writeError)throw Error('write');return `cache/${key}/${name}`;},
    marcar(key,date){if(markError)throw Error('mark');Object.assign(disk.get(key),{ofrecido:true,fecha:date});},
    borrar(key){if(deleteError)throw Error('delete');disk.delete(key);deleted.push(key);}};
  const m=new ReportesTemporales(io,()=>`opaque-${++n}`,()=>now);
  return {m,disk,io,deleted,get now(){return now;},advance:t=>now+=t,readFail:()=>readError=true,deleteFail:()=>deleteError=true,writeFail:()=>writeError=true,markFail:()=>markError=true,pause:()=>gate=deferred()};
}
const bytes=(n=10)=>new Uint8Array(n);
const write=(s,n)=>s.m.escribir(s.m.capturar(),'resumen-proyecto.pdf',bytes(n));
test('A/B opacos, sello por objeto, invalidación tras escritura tardía y reinicio sin sesiones restauradas',async()=>{
  const s=setup(),a=s.m.capturar(),gate=s.pause(),p=write(s);s.m.rotar();const b=s.m.capturar();assert.notEqual(a.namespace,b.namespace);gate.resolve();await assert.rejects(p,/Sesión/);assert.equal(s.disk.size,0);
  await assert.rejects(s.m.escribir(a,'x',bytes()),/Sesión/);
  const restarted=new ReportesTemporales(s.io,()=> 'new-process');assert.notEqual(restarted.capturar().namespace,b.namespace);
});
test('recibido logout elimina; marca antes de invocar NO cuenta ofrecido; invalidación antes share no entrega',async()=>{
  const s=setup(),a=await write(s);a.marcarOfrecido();assert.equal([...s.disk.values()][0].ofrecido,false);s.m.rotar();assert.equal(s.disk.size,0);assert.throws(()=>a.invocar(()=>assert.fail()),/Sesión/);a.liberar();
});
test('invocación void o throw conserva cuarentena no reutilizable ni revocable externamente',async()=>{
  for(const fail of [false,true]){
    const s=setup(),a=await write(s);a.marcarOfrecido();let called=0;
    try{a.invocar(()=>{called++;if(fail)throw Error('native');});}catch{}
    assert.equal(called,1);assert.throws(()=>a.invocar(()=>assert.fail()),/reutilizable/);a.limpiar();a.liberar();s.m.rotar();assert.equal(s.disk.size,1);
    const b=await write(s);assert.notEqual(a.uri,b.uri);assert.doesNotMatch(a.uri,/token|usuario|proyectoId/);
  }
});
test('cuota global cantidad incluye sesiones anteriores y legado; nunca borrar ofrecidos recientes para forzar hueco',async()=>{
  const s=setup();for(let i=0;i<Q.cantidad;i++)s.disk.set(`legacy/${i}`,{key:`legacy/${i}`,bytes:1,ofrecido:true,fecha:s.now});
  await assert.rejects(write(s),/CUOTA/);s.m.rotar();await assert.rejects(write(s),/CUOTA/);assert.equal(s.deleted.length,0);
});
test('cuota bytes y archivo exactos, error antes de escribir',async()=>{
  const s=setup();s.disk.set('old',{key:'old',bytes:Q.bytes-Q.archivo,ofrecido:true,fecha:s.now});
  const a=await write(s,Q.archivo);a.invocar(()=>{});a.liberar();await assert.rejects(write(s,1),/CUOTA/);assert.equal(s.disk.size,2);
  await assert.rejects(write(setup(),Q.archivo+1),/CUOTA/);
});
test('reservas concurrentes incluyen bytes no escritos sin doble cargo ni carreras de cantidad',async()=>{
  const s=setup(),gate=s.pause(),pending=[];for(let i=0;i<8;i++)pending.push(write(s,Q.archivo));
  await assert.rejects(write(s,1),/CUOTA/);gate.resolve();const all=await Promise.all(pending);assert.equal(s.disk.size,8);for(const a of all)a.limpiar();
});
test('lectura falla cerrado; tamaños desconocidos/negativos no infraestiman',async()=>{
  const s=setup();s.readFail();await assert.rejects(write(s),/read/);
  for(const size of [NaN,-1,null]){const x=setup();x.disk.set('unknown',{key:'unknown',bytes:size,ofrecido:true,fecha:x.now});await assert.rejects(write(x),/ilegible/);}
});
test('fallo write limpia al acabar; delete fallida mantiene cargo global',async()=>{
  const s=setup();s.writeFail();await assert.rejects(write(s),/write/);assert.equal(s.disk.size,0);
  const x=setup();x.writeFail();x.deleteFail();for(let i=0;i<8;i++)await assert.rejects(write(x,Q.archivo),/write/);await assert.rejects(write(x,1),/CUOTA/);assert.equal(x.disk.size,8);
});
test('fallo de marca no invoca y recibido no queda retenido',async()=>{
  const s=setup(),a=await write(s);s.markFail();assert.throws(()=>a.invocar(()=>assert.fail()),/mark/);a.limpiar();a.liberar();assert.equal(s.disk.size,0);
});
test('share pendiente protegido en lifecycle incluso expirado; liberar vuelve elegible sin timer',async()=>{
  const s=setup(),a=await write(s),gate=deferred();const p=a.invocar(()=>gate.promise);s.advance(Q.retencion+1);s.m.rotar();s.m.limpiar();assert.equal(s.disk.size,1);gate.resolve();await p;a.liberar();assert.equal(s.disk.size,0);
});
test('ofrecidos expiran sólo con oportunidad cleanup; reloj atrás y fecha ausente retienen y cuota limita',async()=>{
  const s=setup(),a=await write(s);a.invocar(()=>{});a.liberar();s.advance(-1000);s.m.limpiar();assert.equal(s.disk.size,1);s.advance(Q.retencion+1001);assert.equal(s.disk.size,1);s.m.limpiar();assert.equal(s.disk.size,0);
  s.disk.set('unknown-date',{key:'unknown-date',bytes:Q.bytes,ofrecido:true,fecha:null});s.advance(Q.retencion*5);s.m.limpiar();await assert.rejects(write(s),/CUOTA/);
});
test('lifecycle AuthContext arranque, active y rotación declarado sin servicio app cerrada',()=>{
  const auth=fs.readFileSync('src/auth/AuthContext.tsx','utf8');assert.match(auth,/temporalesReportes\.rotar\(\)/);assert.match(auth,/state === 'active'.*limpiarResiduosReportes\(\)/);
});
