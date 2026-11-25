const test = require('node:test');
const assert = require('node:assert/strict');
const ts = require('typescript');
const fs = require('node:fs');
const vm = require('node:vm');

function load(file, deps = {}, globals = {}) {
  const js = ts.transpileModule(fs.readFileSync(`src/api/${file}.ts`, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const exports = {};
  vm.runInNewContext(js, { exports, require: name => {
    assert.ok(name in deps, name); return deps[name];
  }, URLSearchParams, Error, ...globals });
  return exports;
}
const meta = { pagina: 2, tamanoPagina: 7, total: 8, totalPaginas: 2 };
const comentario = {
  id: 'com_1', tareaId: 'tar_1', texto: ' Hola @[usr_2] ',
  autor: { id: 'usr_1', nombre: 'Ana' }, menciones: [{ id: 'usr_2', nombre: 'Luis' }],
  creadoEn: '2026-11-19T12:00:00.000Z', actualizadoEn: '2026-11-19T12:00:00.000Z',
};
const aviso = {
  id: 'not_1', tipo: 'MENCION', titulo: 'Te mencionaron', cuerpo: null, leida: false,
  datos: { espacioId: 'esp_1', proyectoId: 'pro_1', tareaId: 'tar_1', comentarioId: 'com_1' },
  creadoEn: comentario.creadoEn,
};
function setup({ data = {}, status = 200, replay, failure, bodyFailure } = {}) {
  const calls = []; let unauthorized = 0;
  const client = load('client', {
    './config': { API_BASE_URL: 'https://example.invalid/api/v1' },
    './tokenStorage': { getToken: () => 'test-token', getTokenVersion: () => 1 },
  }, { fetch: async (url, options) => {
    calls.push({ url, ...options });
    if (failure) throw failure;
    return { status, ok: status >= 200 && status < 300,
      headers: new Headers(replay === undefined ? {} : { 'Idempotency-Replayed': replay }),
      text: async () => { if (bodyFailure) throw bodyFailure; return JSON.stringify(data); } };
  } });
  client.setUnauthorizedHandler(() => unauthorized++);
  const espacios = load('espacios', { './client': client });
  const deps = { './client': client, './espacios': espacios };
  return { ...load('comentarios', deps), ...load('notificaciones', deps), client, calls,
    unauthorized: () => unauthorized };
}
const plain = value => JSON.parse(JSON.stringify(value));
function checkCall(api, path, method = 'GET') {
  assert.equal(api.calls.length, 1);
  const call = api.calls[0];
  assert.equal(call.url, `https://example.invalid/api/v1${path}`);
  assert.equal(call.method, method);
  assert.equal(call.headers.Authorization, 'Bearer test-token');
  assert.equal(call.headers.Accept, 'application/json');
  return call;
}

test('directorio: paginación, búsqueda codificada y shape mínimo intacto', async () => {
  const data = { datos: [{ id: 'usr_2', nombre: 'Luis' }], meta };
  const api = setup({ data });
  assert.deepEqual(plain(await api.listarMiembrosMencionables('tar/a ?#', {
    page: 2, pageSize: 7, q: '  Ana & José  ',
  })), data);
  const call = checkCall(api, '/tareas/tar%2Fa%20%3F%23/miembros-mencionables?page=2&pageSize=7&q=Ana+%26+Jos%C3%A9');
  assert.equal(call.body, undefined);
});
test('directorio: q ausente, vacío o espacios se omite; sin defaults inventados', async () => {
  for (const filtros of [undefined, {}, { q: '' }, { q: '   ' }]) {
    const api = setup(); await api.listarMiembrosMencionables('tar', filtros);
    checkCall(api, '/tareas/tar/miembros-mencionables');
  }
});
test('comentarios GET: ruta codificada, queries y envelope exacto', async () => {
  for (const filtros of [undefined, { page: 2, pageSize: 7 }]) {
    const data = { datos: [comentario], meta }; const api = setup({ data });
    assert.deepEqual(plain(await api.listarComentarios('tar/1', filtros)), data);
    const call = checkCall(api, `/tareas/tar%2F1/comentarios${filtros ? '?page=2&pageSize=7' : ''}`);
    assert.equal(call.body, undefined);
  }
});
test('comentarios POST: solo texto exacto, clave obligatoria aportada y replay explícito', async () => {
  for (const replay of ['true', 'false', undefined, 'unexpected']) {
    const api = setup({ data: comentario, status: 201, replay });
    const result = await api.crearComentario('tar/1', { texto: comentario.texto, autorId: 'NO_ENVIAR' }, 'intent_123');
    assert.deepEqual(plain(result.comentario), comentario);
    assert.equal(result.idempotencyReplayed, replay === 'true' ? true : replay === 'false' ? false : undefined);
    const call = checkCall(api, '/tareas/tar%2F1/comentarios', 'POST');
    assert.equal(call.headers['Idempotency-Key'], 'intent_123');
    assert.equal(call.headers['Content-Type'], 'application/json');
    assert.deepEqual(JSON.parse(call.body), { texto: comentario.texto });
  }
});
test('avisos GET: preserva false, true, omisión y paginación sin usuarioId', async () => {
  for (const leida of [false, true, undefined]) {
    const data = { datos: [aviso], meta }; const api = setup({ data });
    assert.deepEqual(plain(await api.listarNotificaciones({ page: 2, pageSize: 7, leida, usuarioId: 'NO_ENVIAR' })), data);
    checkCall(api, `/notificaciones?page=2&pageSize=7${leida === undefined ? '' : `&leida=${leida}`}`);
  }
  const api = setup(); await api.listarNotificaciones(); checkCall(api, '/notificaciones');
});
test('avisos PATCH: codifica ID, sin body ni Content-Type y devuelve aviso leído', async () => {
  const data = { ...aviso, leida: true }; const api = setup({ data });
  assert.deepEqual(plain(await api.marcarNotificacionLeida('not/ ?#')), data);
  const call = checkCall(api, '/notificaciones/not%2F%20%3F%23/leida', 'PATCH');
  assert.equal(call.body, undefined); assert.equal(call.headers['Content-Type'], undefined);
});
const operations = [
  api => api.listarMiembrosMencionables('tar'), api => api.listarComentarios('tar'),
  api => api.crearComentario('tar', { texto: 'hola' }, 'intent_123'),
  api => api.listarNotificaciones(), api => api.marcarNotificacionLeida('not'),
];
test('cinco operaciones: errores HTTP y red conservados sin retry', async () => {
  for (const operation of operations) {
    for (const status of [400, 401, 404, 409, 429, 503]) {
      const api = setup({ status, data: { statusCode: status, error: 'ContractError', message: ['Mensaje original'] } });
      await assert.rejects(operation(api), error => {
        assert.ok(error instanceof api.client.ApiRequestError); assert.equal(error.statusCode, status);
        assert.equal(error.error, status === 401 ? 'Unauthorized' : 'ContractError');
        assert.equal(error.mensajes.join(), status === 401 ? 'No autorizado.' : 'Mensaje original'); return true;
      });
      assert.equal(api.calls.length, 1); assert.equal(api.unauthorized(), status === 401 ? 1 : 0);
    }
    const api = setup({ failure: new Error('offline') });
    await assert.rejects(operation(api), error => error instanceof api.client.ApiRequestError && error.statusCode === 0);
    assert.equal(api.calls.length, 1);
  }
});
test('cliente: consumidores existentes siguen recibiendo body bare y auth:false no agrega Bearer', async () => {
  const api = setup({ data: comentario });
  assert.deepEqual(plain(await api.client.request('/publico', { auth: false })), comentario);
  assert.equal(api.calls[0].headers.Authorization, undefined);
});
test('cinco operaciones: pérdida del cuerpo exitoso no confirma resultado ni reintenta', async () => {
  for (const operation of operations) {
    const api = setup({ bodyFailure: new Error('respuesta interrumpida') });
    await assert.rejects(operation(api), error => error instanceof api.client.ApiRequestError && error.statusCode === 0);
    assert.equal(api.calls.length, 1);
  }
});
