/**
 * Utilidades RF-19 de texto de comentarios y menciones canónicas.
 * Fuente única: CONTRATO_API.md v1.3 §8.2 (formato de texto) — este módulo no
 * calcula membresías, no resuelve identidades por nombre ni toca el contrato.
 *
 * Reglas representadas:
 * - Texto plano; no vacío tras quitar espacios exteriores y 1–4000 caracteres
 *   Unicode medidos en PUNTOS DE CÓDIGO (no en unidades UTF-16).
 * - Mención: `@[usuarioId]` con id ASCII [A-Za-z0-9_-]{1,128}.
 * - `@@[` es apertura literal de `@[` y NO inicia mención; `@nombre` es texto.
 * - Un `@[` no escapado sin cierre o con id inválido: «Mención inválida».
 * - Máximo 20 destinatarios distintos por comentario, incluida la automención;
 *   repetidos cuentan una sola vez en orden de primera aparición.
 *
 * Módulo puro y sin dependencias. La previsualización usa únicamente un mapa
 * id→nombre CONFIRMADO por el directorio (§8.2): nunca infiere desde texto
 * libre ni usa coincidencias de nombre como identidad.
 */

export const LIMITE_PUNTOS_CODIGO = 4000;
export const LIMITE_DESTINATARIOS_DISTINTOS = 20;
export const LONGITUD_MAXIMA_ID = 128;
export const MENSAJE_MENCION_INVALIDA = 'Mención inválida';

/** Clave de idempotencia admitida por §8.5 (1–128 ASCII [A-Za-z0-9_-]). */
export const CLAVE_IDEMPOTENCIA_RE = /^[A-Za-z0-9_-]{1,128}$/;

const ID_MENCION_RE = /^[A-Za-z0-9_-]{1,128}$/;

export type ErrorTextoComentario =
  | 'vacio'
  | 'mencion-invalida'
  | 'demasiado-largo'
  | 'demasiados-destinatarios';

/** Mención detectada con desplazamientos en unidades UTF-16 (posición del editor). */
export type MencionDetectada = { id: string; inicio: number; fin: number };

export type AnalisisTexto = {
  /** Longitud del texto transmitido (sin trim) en puntos de código Unicode. */
  puntosCodigo: number;
  error: ErrorTextoComentario | null;
  /** IDs distintos en orden de primera aparición; vacío si hay error sintáctico. */
  ids: string[];
  menciones: MencionDetectada[];
};

export type SeleccionEditor = { inicio: number; fin: number };
export type InsercionMencion = { texto: string; cursor: number };

type Segmento =
  | { tipo: 'texto'; valor: string }
  | { tipo: 'mencion'; id: string; inicio: number; fin: number };

/**
 * Escanea el texto una sola vez. `valor` de los segmentos de texto ya trae
 * `@@[` desescapado a `@[` (su significado según §8.2). Ante un marcador
 * inválido se conserva el resto SIN convertir y se marca `errorSintactico`.
 */
function segmentar(texto: string): { segmentos: Segmento[]; errorSintactico: boolean } {
  const segmentos: Segmento[] = [];
  let literal = '';
  const cerrarLiteral = () => {
    if (literal) { segmentos.push({ tipo: 'texto', valor: literal }); literal = ''; }
  };
  let i = 0;
  while (i < texto.length) {
    if (texto.charCodeAt(i) !== 64 /* @ */) { literal += texto[i]; i += 1; continue; }
    if (texto[i + 1] === '@' && texto[i + 2] === '[') { literal += '@['; i += 3; continue; }
    if (texto[i + 1] === '[') {
      const cierre = texto.indexOf(']', i + 2);
      const id = cierre === -1 ? '' : texto.slice(i + 2, cierre);
      if (cierre === -1 || !ID_MENCION_RE.test(id)) {
        literal += texto.slice(i);
        cerrarLiteral();
        return { segmentos, errorSintactico: true };
      }
      cerrarLiteral();
      segmentos.push({ tipo: 'mencion', id, inicio: i, fin: cierre + 1 });
      i = cierre + 1;
      continue;
    }
    literal += '@';
    i += 1;
  }
  cerrarLiteral();
  return { segmentos, errorSintactico: false };
}

/** Puntos de código Unicode (un emoji astral = 1; en UTF-16 serían 2). */
export function contarPuntosCodigo(texto: string): number {
  return [...texto].length;
}

const MENSAJES_ERROR: Record<ErrorTextoComentario, string> = {
  vacio: 'Escribe un comentario para publicar.',
  'mencion-invalida': MENSAJE_MENCION_INVALIDA,
  'demasiado-largo': `El comentario no puede superar ${LIMITE_PUNTOS_CODIGO} caracteres.`,
  'demasiados-destinatarios': `Un comentario puede mencionar como máximo ${LIMITE_DESTINATARIOS_DISTINTOS} personas.`,
};

/**
 * Analiza el texto que se transmitirá TAL CUAL (sin normalizar ni trim).
 * Precedencia del primer error: vacío → mención inválida → largo → destinatarios.
 * Con error sintáctico, `ids` y `menciones` quedan vacíos: no son fiables.
 */
export function analizarTexto(texto: string): AnalisisTexto {
  const puntosCodigo = contarPuntosCodigo(texto);
  const { segmentos, errorSintactico } = segmentar(texto);
  const ids: string[] = [];
  const menciones: MencionDetectada[] = [];
  if (!errorSintactico) {
    const vistos = new Set<string>();
    for (const segmento of segmentos) {
      if (segmento.tipo !== 'mencion') continue;
      menciones.push({ id: segmento.id, inicio: segmento.inicio, fin: segmento.fin });
      if (!vistos.has(segmento.id)) { vistos.add(segmento.id); ids.push(segmento.id); }
    }
  }
  let error: ErrorTextoComentario | null = null;
  if (texto.trim().length === 0) error = 'vacio';
  else if (errorSintactico) error = 'mencion-invalida';
  else if (puntosCodigo > LIMITE_PUNTOS_CODIGO) error = 'demasiado-largo';
  else if (ids.length > LIMITE_DESTINATARIOS_DISTINTOS) error = 'demasiados-destinatarios';
  return { puntosCodigo, error, ids, menciones };
}

/** Primer mensaje de error de cliente, o null si el texto es publicable. */
export function validarTextoComentario(texto: string): string | null {
  const { error } = analizarTexto(texto);
  return error ? MENSAJES_ERROR[error] : null;
}

/**
 * Vista previa legible: cada mención válida se muestra como `@Nombre` usando
 * SOLO el mapa id→nombre confirmado; id sin nombre conocido se conserva como
 * `@[id]` (nunca se inventa ni se resuelve por nombre libre).
 */
export function previsualizarMenciones(
  texto: string,
  nombres: ReadonlyMap<string, string>,
): string {
  const { segmentos } = segmentar(texto);
  let salida = '';
  for (const segmento of segmentos) {
    if (segmento.tipo === 'texto') { salida += segmento.valor; continue; }
    const nombre = nombres.get(segmento.id);
    salida += typeof nombre === 'string' && nombre.trim().length > 0 ? `@${nombre}` : `@[${segmento.id}]`;
  }
  return salida;
}

/** Mapa id→nombre a partir del directorio confirmado (solo id y nombre, §8.2). */
export function directorioANombres(
  personas: readonly { id: string; nombre: string }[],
): ReadonlyMap<string, string> {
  const mapa = new Map<string, string>();
  for (const persona of personas) {
    if (persona && typeof persona.id === 'string' && typeof persona.nombre === 'string') {
      mapa.set(persona.id, persona.nombre);
    }
  }
  return mapa;
}

/**
 * Inserta `@[id]` en la selección preservando el resto del texto y devolviendo
 * el nuevo cursor (desplazamientos UTF-16, como el cursor del editor).
 * Determinista:
 * - Si hay menciones que solapan la selección, se expande para reemplazarlas
 *   completas (evita texto inválido al editar dentro de una mención).
 * - Un `@` inmediatamente anterior al inicio (disparador) se consume para que
 *   la inserción produzca una mención real (`@`+`@[id]` sería `@@[` literal);
 *   no se consume si forma parte de un escape `@@` (no se destruye texto).
 * - No reescribe nada más: los `@@[` existentes se conservan y las menciones
 *   válidas previas no se re-escapan.
 * Lanza Error si `id` no cumple el formato del contrato (error de programación).
 */
export function insertarMencion(
  texto: string,
  seleccion: SeleccionEditor,
  id: string,
): InsercionMencion {
  if (!ID_MENCION_RE.test(id)) throw new Error('Identificador de mención inválido.');
  const total = texto.length;
  let inicio = Math.min(Math.max(Math.trunc(seleccion.inicio) || 0, 0), total);
  let fin = Math.min(Math.max(Math.trunc(seleccion.fin) || 0, inicio), total);
  const { segmentos } = segmentar(texto);
  for (const segmento of segmentos) {
    if (segmento.tipo !== 'mencion') continue;
    if (segmento.inicio < fin && segmento.fin > inicio) {
      inicio = Math.min(inicio, segmento.inicio);
      fin = Math.max(fin, segmento.fin);
    }
  }
  if (inicio > 0 && texto[inicio - 1] === '@' && (inicio < 2 || texto[inicio - 2] !== '@')) {
    inicio -= 1;
  }
  const marcador = `@[${id}]`;
  return { texto: texto.slice(0, inicio) + marcador + texto.slice(fin), cursor: inicio + marcador.length };
}
