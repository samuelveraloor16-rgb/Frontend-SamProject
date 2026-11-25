const test = require('node:test');
const assert = require('node:assert/strict');
const ts = require('typescript');
const fs = require('node:fs');
const vm = require('node:vm');

function load() {
  const js = ts.transpileModule(fs.readFileSync('src/lib/menciones.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const exports = {};
  vm.runInNewContext(js, { exports, require: name => { throw new Error(name); } });
  return exports;
}
const m = load();
const plain = value => JSON.parse(JSON.stringify(value));

test('menciones: API pública sin resolución por nombre ni lógica de membresías', () => {
  assert.deepEqual(Object.keys(m).sort(), [
    'CLAVE_IDEMPOTENCIA_RE', 'LIMITE_DESTINATARIOS_DISTINTOS', 'LIMITE_PUNTOS_CODIGO',
    'LONGITUD_MAXIMA_ID', 'MENSAJE_MENCION_INVALIDA', 'analizarTexto', 'contarPuntosCodigo',
    'directorioANombres', 'insertarMencion', 'previsualizarMenciones', 'validarTextoComentario',
  ]);
});

test('sintaxis: @[id] válido, orden de primera aparición y repetidos una sola vez', () => {
  const a = m.analizarTexto('Hola @[usr_2], revisa @[usr_10] esto. @[usr_2] otra vez @[usr_3]');
  assert.equal(a.error, null);
  assert.deepEqual(plain(a.ids), ['usr_2', 'usr_10', 'usr_3']);
  assert.deepEqual(plain(a.menciones), [
    { id: 'usr_2', inicio: 5, fin: 13 },
    { id: 'usr_10', inicio: 22, fin: 31 },
    { id: 'usr_2', inicio: 38, fin: 46 },
    { id: 'usr_3', inicio: 56, fin: 64 },
  ]);
  assert.equal(m.validarTextoComentario('Hola @[usr_2]'), null);
});

test('sintaxis: @@[ es apertura literal, no inicia mención y no destruye menciones válidas', () => {
  const a = m.analizarTexto('literal @@[usr_1] y mención @[usr_2] tras @@[');
  assert.equal(a.error, null);
  assert.deepEqual(plain(a.ids), ['usr_2']);
  assert.equal(m.previsualizarMenciones('literal @@[usr_1]', new Map()), 'literal @[usr_1]');
  assert.equal(m.previsualizarMenciones('@@[usr_1] @[usr_2]', new Map([['usr_2', 'Luis']])), '@[usr_1] @Luis');
  assert.equal(m.analizarTexto('x @@[ y').error, null);
});

test('sintaxis: marcador sin cerrar o id inválido es «Mención inválida»', () => {
  const invalidos = [
    'hola @[', 'hola @[usr_2', 'hola @[]', 'hola @[usr 2]', 'hola @[usr.2]',
    'hola @[ñ]', 'hola @[usr_2!]', 'hola @[a@[b]',
    '@[', '@[ ]', 'texto @[con]@[también mal]',
  ];
  for (const texto of invalidos) {
    const a = m.analizarTexto(texto);
    assert.equal(a.error, 'mencion-invalida', texto);
    assert.deepEqual(plain(a.ids), [], texto);
    assert.equal(m.validarTextoComentario(texto), 'Mención inválida', texto);
  }
  // @nombre ordinario es texto, no mención.
  assert.equal(m.analizarTexto('hola @Luis, @maria@example.com').error, null);
  assert.deepEqual(plain(m.analizarTexto('@Luis').ids), []);
  // Un escape `@@[` sin cerrar es texto literal válido, no un marcador inválido.
  assert.equal(m.analizarTexto('hola @@[sin cerrar').error, null);
  assert.deepEqual(plain(m.analizarTexto('hola @@[sin cerrar').ids), []);
});

test('sintaxis: id con 128 caracteres válido y 129 inválido; @ suelto es texto', () => {
  const id128 = 'a'.repeat(128);
  const id129 = 'a'.repeat(129);
  assert.equal(m.analizarTexto(`@[${id128}]`).error, null);
  assert.deepEqual(plain(m.analizarTexto(`@[${id128}]`).ids), [id128]);
  assert.equal(m.analizarTexto(`@[${id129}]`).error, 'mencion-invalida');
  assert.equal(m.analizarTexto('@').error, null);
  assert.equal(m.analizarTexto('a@ @[usr_1]').error, null);
});

test('longitud: 4000 puntos de código Unicode, no unidades UTF-16', () => {
  const justo = '😀'.repeat(4000);
  assert.equal(justo.length, 8000); // el límite UTF-16 NO es el contrato
  const a = m.analizarTexto(justo);
  assert.equal(a.puntosCodigo, 4000);
  assert.equal(a.error, null);
  assert.equal(m.analizarTexto('😀'.repeat(4001)).error, 'demasiado-largo');
  assert.equal(m.analizarTexto('a'.repeat(4000)).error, null);
  assert.equal(m.analizarTexto('a'.repeat(4001)).error, 'demasiado-largo');
  const mixto = 'a'.repeat(2000) + '😀'.repeat(2000);
  assert.equal(mixto.length, 6000);
  assert.equal(m.analizarTexto(mixto).error, null);
  assert.equal(m.contarPuntosCodigo('😀👍'), 2);
  assert.equal('😀👍'.length, 4);
  assert.equal(m.contarPuntosCodigo('👍🏽'), 2); // emoji + modificador de tono
});

test('trim: vacío tras espacios rechazado; la longitud se mide sin trim', () => {
  for (const vacio of ['', ' ', '   ', '\n\t ', '  \r\n ']) {
    assert.equal(m.analizarTexto(vacio).error, 'vacio', JSON.stringify(vacio));
  }
  assert.equal(m.validarTextoComentario('  hola  '), null);
  assert.equal(m.validarTextoComentario('   '), 'Escribe un comentario para publicar.');
  assert.equal(m.analizarTexto(`hola${' '.repeat(4000)}`).error, 'demasiado-largo');
});

test('límite: máximo 20 IDs distintos; repetidos y automención cuentan una vez', () => {
  const ids = n => Array.from({ length: n }, (_, i) => `usr_${i + 1}`);
  const texto = n => ids(n).map(id => `@[${id}] `).join('');
  assert.equal(m.analizarTexto(texto(20)).error, null);
  assert.equal(m.analizarTexto(texto(21)).error, 'demasiados-destinatarios');
  assert.equal(m.validarTextoComentario(texto(21)), 'Un comentario puede mencionar como máximo 20 personas.');
  // 21 menciones pero solo 20 distintos: se permite.
  const conRepetida = `${texto(20)}@[usr_1]`;
  assert.equal(m.analizarTexto(conRepetida).error, null);
  assert.equal(m.analizarTexto(conRepetida).ids.length, 20);
  // Automención: es un destinatario normal, se incluye y se deduplica; las
  // relaciones y los avisos (incl. sin autoaviso) los resuelve el backend.
  const automencion = '@[usr_1] hola @[usr_2] y otra vez @[usr_1]';
  assert.deepEqual(plain(m.analizarTexto(automencion).ids), ['usr_1', 'usr_2']);
});

test('previsualización: mapa id→nombre confirmado, homónimos jamás se mezclan', () => {
  const mapa = m.directorioANombres([
    { id: 'usr_a', nombre: 'Luis' }, { id: 'usr_b', nombre: 'Luis' }, { id: 'usr_c', nombre: 'Ana' },
  ]);
  const texto = '@[usr_a] y @[usr_b] con @[usr_c]';
  assert.deepEqual(plain(m.analizarTexto(texto).ids), ['usr_a', 'usr_b', 'usr_c']);
  assert.equal(m.previsualizarMenciones(texto, mapa), '@Luis y @Luis con @Ana');
  // Id sin nombre confirmado: se conserva el marcador; nunca se inventa un nombre.
  assert.equal(m.previsualizarMenciones('@[usr_z]', mapa), '@[usr_z]');
  assert.equal(m.previsualizarMenciones('@[usr_a] y @[usr_z]', mapa), '@Luis y @[usr_z]');
  // Texto libre con apariencia de mención: se muestra literal, sin resolver identidad.
  assert.equal(m.previsualizarMenciones('hola @Luis, revisa @[usr_a]', mapa), 'hola @Luis, revisa @Luis');
  // Nombre con caracteres de mención no rompe la vista previa.
  const raro = m.directorioANombres([{ id: 'usr_1', nombre: 'Ana @ [López]' }]);
  assert.equal(m.previsualizarMenciones('@[usr_1]', raro), '@Ana @ [López]');
});

test('inserción: canónica, preserva resto del texto y cursor UTF-16', () => {
  assert.deepEqual(plain(m.insertarMencion('Hola ', { inicio: 5, fin: 5 }, 'usr_2')),
    { texto: 'Hola @[usr_2]', cursor: 13 });
  // Selección reemplazada por completo.
  const aBorrar = 'borra esto';
  assert.deepEqual(plain(m.insertarMencion(aBorrar, { inicio: 0, fin: aBorrar.length }, 'usr_2')),
    { texto: '@[usr_2]', cursor: 8 });
  // Desplazamientos en unidades UTF-16 (emoji = 2), como el cursor del editor.
  assert.deepEqual(plain(m.insertarMencion('😀 ', { inicio: 3, fin: 3 }, 'usr_1')),
    { texto: '😀 @[usr_1]', cursor: 11 });
  assert.equal(m.insertarMencion('😀 ', { inicio: 3, fin: 3 }, 'usr_1').texto.length, 11);
  // El '@' disparador se consume: sin ello resultaría '@@[' (literal, sin mención).
  assert.deepEqual(plain(m.insertarMencion('Hola @', { inicio: 6, fin: 6 }, 'usr_2')),
    { texto: 'Hola @[usr_2]', cursor: 13 });
  assert.equal(m.analizarTexto(m.insertarMencion('Hola @', { inicio: 6, fin: 6 }, 'usr_2').texto).error, null);
  // Selección que solapa una mención existente: se reemplaza la mención completa.
  assert.deepEqual(plain(m.insertarMencion('hola @[usr_1]!', { inicio: 8, fin: 12 }, 'usr_2')),
    { texto: 'hola @[usr_2]!', cursor: 13 });
  assert.deepEqual(plain(m.analizarTexto('hola @[usr_2]!').ids), ['usr_2']);
  // Selección fuera de rango: recorte determinista.
  assert.deepEqual(plain(m.insertarMencion('abc', { inicio: -5, fin: 99 }, 'u1')),
    { texto: '@[u1]', cursor: 5 });
  assert.deepEqual(plain(m.insertarMencion('abc', { inicio: 3, fin: 1 }, 'u1')),
    { texto: 'abc@[u1]', cursor: 8 });
});

test('inserción: respeta escapes y menciones previas (no re-escapa)', () => {
  assert.equal(m.insertarMencion('ver @@[usr_1]', { inicio: 13, fin: 13 }, 'usr_2').texto,
    'ver @@[usr_1]@[usr_2]');
  const r1 = m.insertarMencion('ver @@[usr_1]', { inicio: 13, fin: 13 }, 'usr_2');
  assert.deepEqual(plain(m.analizarTexto(r1.texto).ids), ['usr_2']);
  assert.equal(r1.cursor, r1.texto.length);
  // '@@' previo no se consume (no se destruye el escape aunque la inserción
  // resultante no inicie mención en esa posición: texto preservado tal cual).
  assert.equal(m.insertarMencion('hola @@', { inicio: 7, fin: 7 }, 'usr_1').texto, 'hola @@@[usr_1]');
  const previa = 'mención válida @[usr_1] ok';
  const r2 = m.insertarMencion(previa, { inicio: previa.length, fin: previa.length }, 'usr_2');
  assert.equal(r2.texto, `${previa}@[usr_2]`);
  assert.equal(r2.cursor, r2.texto.length);
  assert.deepEqual(plain(m.analizarTexto(r2.texto).ids), ['usr_1', 'usr_2']);
});

test('inserción: id con formato inválido lanza error de programación', () => {
  for (const id of ['', 'a'.repeat(129), 'usr 2', 'usr]1', 'ñ', '@[x']) {
    assert.throws(() => m.insertarMencion('x', { inicio: 1, fin: 1 }, id), /Identificador de mención inválido/);
  }
});
