const test = require('node:test');
const assert = require('node:assert/strict');
const ts = require('typescript');
const fs = require('node:fs');
const vm = require('node:vm');

function load(path, deps = {}, globals = {}) {
  const js = ts.transpileModule(fs.readFileSync(path, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const exports = {};
  vm.runInNewContext(js, { exports, require: name => {
    if (!(name in deps)) throw new Error(name);
    return deps[name];
  }, ...globals });
  return exports;
}

const comentario = {
  id: 'com_1', tareaId: 'tar_1', texto: 'Hola @[usr_2]',
  autor: { id: 'usr_1', nombre: 'Ana' }, menciones: [{ id: 'usr_2', nombre: 'Luis' }],
  creadoEn: '2026-11-19T12:00:00.000Z', actualizadoEn: '2026-11-19T12:00:00.000Z',
};
const plain = value => JSON.parse(JSON.stringify(value));

function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

/** Carga cliente real (fetch inyectable) + coordinador con crear configurable. */
function setup({ keys } = {}) {
  const llamadas = [];
  const cola = []; // funciones que atienden cada envío, en orden
  const client = load('src/api/client.ts', {
    './config': { API_BASE_URL: 'https://example.invalid/api/v1' },
    './tokenStorage': { getToken: () => 'test-token', getTokenVersion: () => 1 },
  });
  const { ComentarioWriteCoordinator, generarClaveIdempotencia } = load(
    'src/lib/ComentarioWriteCoordinator.ts',
    { '../api/client': client, './menciones': load('src/lib/menciones.ts') },
  );
  let claves = 0;
  const crear = (tareaId, texto, clave) => {
    llamadas.push([tareaId, texto, clave]);
    const atender = cola.shift();
    if (!atender) throw new Error('sin comportamiento definido');
    return atender();
  };
  const coordinador = new ComentarioWriteCoordinator({
    generarClave: keys ? undefined : () => { claves += 1; return `clave_${claves}`; },
    crear,
  });
  return {
    client, coordinador, generarClaveIdempotencia, llamadas, cola,
    claves: () => claves,
    responder: valor => cola.push(() => Promise.resolve(valor)),
    fallar: error => cola.push(() => Promise.reject(error)),
  };
}

test('doble toque y envío concurrente: un solo envío, una sola clave, texto exacto', async () => {
  const s = setup();
  const d = deferred();
  s.cola.push(() => d.promise);
  const p1 = s.coordinador.publicar('tar_1', ' hola con espacios ');
  const p2 = s.coordinador.publicar('tar_1', ' hola con espacios ');
  const p3 = s.coordinador.reintentar(); // aún no hay intención incierta: se ignora
  assert.equal(s.llamadas.length, 1);
  assert.equal(s.coordinador.getSnapshot().fase, 'publicando');
  assert.equal(s.claves(), 1);
  d.resolve({ comentario, idempotencyReplayed: false });
  await p1; await p2; await p3;
  assert.equal(s.llamadas.length, 1);
  assert.equal(s.claves(), 1);
  assert.deepEqual(s.llamadas[0], ['tar_1', ' hola con espacios ', 'clave_1']);
  const snap = s.coordinador.getSnapshot();
  assert.equal(snap.fase, 'confirmado');
  assert.equal(snap.intencion, null); // confirmación definitiva → intención liberada
  assert.equal(snap.replayed, false);
  assert.equal(snap.mensaje, 'Comentario publicado.');
  assert.deepEqual(plain(snap.comentario), comentario);
});

test('respuesta tardía tras desmonte: sin suscriptores no falla y el estado queda coherente', async () => {
  const s = setup();
  const d = deferred();
  s.cola.push(() => d.promise);
  let notificaciones = 0;
  const cancelar = s.coordinador.subscribe(() => { notificaciones += 1; });
  const pendiente = s.coordinador.publicar('tar_1', 'hola');
  assert.equal(notificaciones, 1); // transición a publicando
  cancelar(); // desmonte de la UI
  d.resolve({ comentario, idempotencyReplayed: false });
  await pendiente;
  assert.equal(notificaciones, 1); // la respuesta tardía no invoca listeners fuera
  assert.equal(s.coordinador.getSnapshot().fase, 'confirmado');
  assert.equal(s.coordinador.getSnapshot().comentario.id, 'com_1');
});

test('timeout, 503 y red: «incierto» con MISMA clave, sin regenerar ni reintento automático', async () => {
  const errores = [
    { nombre: '503', crear: client => new client.ApiRequestError(503, 'Service Unavailable', ['Servicio no disponible.']) },
    { nombre: 'red', crear: client => new client.ApiRequestError(0, 'NetworkError', ['No pudimos conectar.']) },
    { nombre: '408', crear: client => new client.ApiRequestError(408, 'Request Timeout', ['Tiempo agotado.']) },
    { nombre: 'abort', crear: () => Object.assign(new Error('La solicitud fue abortada.'), { name: 'AbortError' }) },
    { nombre: 'perdida', crear: () => new TypeError('respuesta perdida') },
  ];
  for (const caso of errores) {
    const s = setup();
    s.fallar(caso.crear(s.client));
    await s.coordinador.publicar('tar_1', 'texto exacto ');
    const snap = s.coordinador.getSnapshot();
    assert.equal(snap.fase, 'incierto', caso.nombre);
    assert.deepEqual(plain(snap.intencion), { tareaId: 'tar_1', texto: 'texto exacto ', clave: 'clave_1' });
    assert.equal(s.claves(), 1); // clave NO regenerada
    assert.equal(s.llamadas.length, 1); // sin reintento automático
    assert.equal(s.coordinador.getSnapshot().comentario, null); // sin publicación optimista
    assert.equal(Object.isFrozen(snap.intencion), true); // intención inmutable
    // Nueva publicación distinta queda bloqueada mientras haya duda.
    await s.coordinador.publicar('tar_1', 'otro texto');
    assert.equal(s.llamadas.length, 1);
    assert.equal(s.claves(), 1);
    // Reintento EXPLÍCITO con idéntica intención.
    s.responder({ comentario, idempotencyReplayed: true });
    await s.coordinador.reintentar();
    assert.equal(s.llamadas.length, 2);
    assert.deepEqual(s.llamadas[1], s.llamadas[0]); // misma clave, tarea y texto
    assert.equal(s.claves(), 1); // la clave jamás se regenera
    const confirmado = s.coordinador.getSnapshot();
    assert.equal(confirmado.fase, 'confirmado');
    assert.equal(confirmado.replayed, true); // replay = confirmación de la misma intención
    assert.equal(confirmado.intencion, null);
  }
});

test('reintentar solo actúa desde «incierto» y conserva la intención byte a byte', async () => {
  const s = setup();
  assert.equal(await s.coordinador.reintentar(), undefined);
  assert.equal(s.llamadas.length, 0);
  s.fallar(new s.client.ApiRequestError(503, 'Service Unavailable', ['xx']));
  await s.coordinador.publicar('tar_1', '  con espacios  ');
  const intencion = s.coordinador.getSnapshot().intencion;
  s.responder({ comentario, idempotencyReplayed: false });
  await s.coordinador.reintentar();
  assert.equal(s.coordinador.getSnapshot().intencion, null);
  assert.deepEqual(s.llamadas[1], ['tar_1', '  con espacios  ', intencion.clave]);
});

test('400, 404 y 409: error definitivo, intención liberada y sin reintento automático', async () => {
  const casos = [
    { status: 400, mensaje: 'Uno o más destinatarios no son válidos' },
    { status: 404, mensaje: 'Recurso no encontrado.' },
    { status: 409, mensaje: 'Conflicto.' },
  ];
  for (const caso of casos) {
    const s = setup();
    s.fallar(new s.client.ApiRequestError(caso.status, 'ContractError', [caso.mensaje]));
    await s.coordinador.publicar('tar_1', 'hola');
    const snap = s.coordinador.getSnapshot();
    assert.equal(snap.fase, 'error');
    assert.equal(snap.intencion, null); // liberada (validaciones no consumen clave, §8.5)
    assert.equal(s.llamadas.length, 1); // sin reintento automático
    if (caso.status === 409) {
      assert.ok(snap.error.includes('Clave reutilizada con otra petición'));
      assert.ok(snap.error.includes('revisa el borrador'));
    } else {
      assert.equal(snap.error, caso.mensaje);
    }
    // reintentar() no revive una intención ya liberada.
    await s.coordinador.reintentar();
    assert.equal(s.llamadas.length, 1);
    // Una nueva publicación es una intención nueva con clave nueva.
    s.responder({ comentario, idempotencyReplayed: false });
    await s.coordinador.publicar('tar_1', 'hola');
    assert.equal(s.claves(), 2);
    assert.deepEqual(s.llamadas[1], ['tar_1', 'hola', 'clave_2']);
    assert.equal(s.coordinador.getSnapshot().fase, 'confirmado');
  }
});

test('respuesta sin confirmar ni fallar queda «incierto»; cabecera ausente no se presume', async () => {
  const s = setup();
  s.responder({}); // cuerpo sin comentario: no confirma nada
  await s.coordinador.publicar('tar_1', 'hola');
  assert.equal(s.coordinador.getSnapshot().fase, 'incierto');
  assert.equal(s.coordinador.getSnapshot().replayed, null);
  s.responder({ comentario, idempotencyReplayed: undefined });
  await s.coordinador.reintentar();
  const snap = s.coordinador.getSnapshot();
  assert.equal(snap.fase, 'confirmado');
  assert.equal(snap.replayed, null); // Idempotency-Replayed ausente → no se presume
});

test('reiniciar: limpia confirmación y error, nunca una intención incierta', async () => {
  const s = setup();
  s.responder({ comentario, idempotencyReplayed: false });
  await s.coordinador.publicar('tar_1', 'hola');
  s.coordinador.reiniciar();
  assert.equal(s.coordinador.getSnapshot().fase, 'inactivo');
  assert.deepEqual(plain(s.coordinador.getSnapshot()), {
    fase: 'inactivo', intencion: null, mensaje: null, error: null, replayed: null, comentario: null,
  });
  s.fallar(new s.client.ApiRequestError(400, 'Bad Request', ['Validación']));
  await s.coordinador.publicar('tar_1', 'hola');
  s.coordinador.reiniciar();
  assert.equal(s.coordinador.getSnapshot().fase, 'inactivo');
  // Incierto: reiniciar() no descarta la intención (clave conservada).
  s.fallar(new s.client.ApiRequestError(503, 'Service Unavailable', ['xx']));
  await s.coordinador.publicar('tar_1', 'hola');
  s.coordinador.reiniciar();
  assert.equal(s.coordinador.getSnapshot().fase, 'incierto');
  assert.deepEqual(plain(s.coordinador.getSnapshot().intencion), {
    tareaId: 'tar_1', texto: 'hola', clave: 'clave_3',
  });
});

test('clave: generador por defecto válido y único; generador defectuoso no envía', async () => {
  const base = setup();
  const k1 = base.generarClaveIdempotencia();
  const k2 = base.generarClaveIdempotencia();
  assert.match(k1, /^[A-Za-z0-9_-]{1,128}$/);
  assert.match(k2, /^[A-Za-z0-9_-]{1,128}$/);
  assert.notEqual(k1, k2);
  // Sin generarClave inyectado se usa el generador por defecto.
  const s = setup({ keys: true });
  s.responder({ comentario, idempotencyReplayed: false });
  await s.coordinador.publicar('tar_1', 'hola');
  assert.match(s.llamadas[0][2], /^[A-Za-z0-9_-]{1,128}$/);
  // Clave fuera de contrato: fallo síncrono sin gastar la petición.
  const modulo = load('src/lib/ComentarioWriteCoordinator.ts',
    { '../api/client': setup().client, './menciones': load('src/lib/menciones.ts') });
  let generado = 0;
  const c = new modulo.ComentarioWriteCoordinator({
    generarClave: () => { generado += 1; return 'clave con espacios'; },
    crear: () => { throw new Error('no debe enviarse'); },
  });
  await c.publicar('tar_1', 'hola');
  assert.equal(generado, 1);
  assert.equal(c.getSnapshot().fase, 'error');
  assert.equal(c.getSnapshot().error, 'Clave de idempotencia inválida.');
  assert.equal(c.getSnapshot().intencion, null);
});

test('integración con el cliente real: misma cabecera en reintento y replay interpretado', async () => {
  const peticiones = [];
  const respuestas = [
    () => { throw new TypeError('fetch failed'); }, // red caída → ApiRequestError(0)
    () => ({ status: 201, ok: true, headers: new Headers({ 'Idempotency-Replayed': 'true' }),
      text: async () => JSON.stringify(comentario) }),
    () => ({ status: 503, ok: false, headers: new Headers(), text: async () =>
      JSON.stringify({ statusCode: 503, error: 'Service Unavailable', message: 'No disponible.' }) }),
    () => ({ status: 201, ok: true, headers: new Headers({ 'Idempotency-Replayed': 'false' }),
      text: async () => JSON.stringify(comentario) }),
  ];
  const client = load('src/api/client.ts', {
    './config': { API_BASE_URL: 'https://example.invalid/api/v1' },
    './tokenStorage': { getToken: () => 'test-token', getTokenVersion: () => 1 },
  }, { fetch: async (url, options) => { peticiones.push({ url, ...options }); return respuestas.shift()(); } });
  const espacios = load('src/api/espacios.ts', { './client': client });
  const comentarios = load('src/api/comentarios.ts', { './client': client, './espacios': espacios });
  const modulo = load('src/lib/ComentarioWriteCoordinator.ts',
    { '../api/client': client, './menciones': load('src/lib/menciones.ts') });
  let claves = 0;
  const coord = new modulo.ComentarioWriteCoordinator({
    generarClave: () => { claves += 1; return `intent_${claves}`; },
    crear: (tareaId, texto, clave) => comentarios.crearComentario(tareaId, { texto }, clave),
  });

  await coord.publicar('tar/1', ' Hola @[usr_2] ');
  assert.equal(coord.getSnapshot().fase, 'incierto'); // fallo de red sin confirmación
  assert.equal(peticiones.length, 1);
  await coord.reintentar();
  let snap = coord.getSnapshot();
  assert.equal(snap.fase, 'confirmado');
  assert.equal(snap.replayed, true); // Idempotency-Replayed: true = MISMA intención
  assert.equal(claves, 1);
  assert.equal(peticiones.length, 2);
  // Misma clave, misma tarea y mismo texto (sin normalizar) en el reintento.
  assert.equal(peticiones[0].headers['Idempotency-Key'], 'intent_1');
  assert.equal(peticiones[1].headers['Idempotency-Key'], 'intent_1');
  assert.deepEqual(JSON.parse(peticiones[1].body), JSON.parse(peticiones[0].body));
  assert.equal(peticiones[1].url, 'https://example.invalid/api/v1/tareas/tar%2F1/comentarios');

  // Segunda intención: 503 → incierto; reintento → creación nueva (replayed false).
  coord.reiniciar();
  await coord.publicar('tar/1', 'otra vez');
  assert.equal(coord.getSnapshot().fase, 'incierto');
  await coord.reintentar();
  snap = coord.getSnapshot();
  assert.equal(snap.fase, 'confirmado');
  assert.equal(snap.replayed, false); // primera creación de la intención
  assert.equal(claves, 2);
  assert.equal(peticiones[2].headers['Idempotency-Key'], 'intent_2');
  assert.equal(peticiones[3].headers['Idempotency-Key'], 'intent_2');
  assert.equal(peticiones.length, 4);
});
