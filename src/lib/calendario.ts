/**
 * Utilidades de calendario para la pantalla RF-18.
 * Todas las fechas son claves `YYYY-MM-DD` en UTC (el backend interpreta la
 * ventana en días UTC), por lo que aquí NO se usa la hora local del dispositivo.
 */

const MESES_LARGO = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
] as const;

const DIAS_SEMANA_LARGO = [
  'domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado',
] as const;

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** Clave `YYYY-MM-DD` (UTC) de un objeto Date o de hoy. */
export function claveUTC(fecha: Date): string {
  return `${fecha.getUTCFullYear()}-${pad2(fecha.getUTCMonth() + 1)}-${pad2(fecha.getUTCDate())}`;
}

export function hoyClaveUTC(): string {
  return claveUTC(new Date());
}

/** Parsea una clave `YYYY-MM-DD` a Date UTC a medianoche (siempre válida: viene del backend/estado). */
export function parseClaveUTC(clave: string): Date {
  const [y = 1970, m = 1, d = 1] = clave.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function moverDias(clave: string, dias: number): string {
  const fecha = parseClaveUTC(clave);
  fecha.setUTCDate(fecha.getUTCDate() + dias);
  return claveUTC(fecha);
}

/** Primer día del mes de la clave (`YYYY-MM-01`). */
export function inicioMesUTC(clave: string): string {
  return `${clave.slice(0, 7)}-01`;
}

/** Último día del mes de la clave. */
export function finMesUTC(clave: string): string {
  const [y = 1970, m = 1] = clave.split('-').map(Number);
  return claveUTC(new Date(Date.UTC(y, m, 0)));
}

/** Lunes de la semana (ISO, lunes primero) que contiene la clave. */
export function inicioSemanaUTC(clave: string): string {
  const dia = parseClaveUTC(clave).getUTCDay(); // 0 = domingo
  const offsetLunes = (dia + 6) % 7;
  return moverDias(clave, -offsetLunes);
}

/** Domingo de la semana que contiene la clave. */
export function finSemanaUTC(clave: string): string {
  return moverDias(inicioSemanaUTC(clave), 6);
}

/** "jueves, 20 de noviembre de 2026" (UTC). */
export function formatDiaCompleto(clave: string): string {
  const fecha = parseClaveUTC(clave);
  const dia = fecha.getUTCDate();
  const mes = MESES_LARGO[fecha.getUTCMonth()];
  const anio = fecha.getUTCFullYear();
  const semana = DIAS_SEMANA_LARGO[fecha.getUTCDay()];
  return `${semana}, ${dia} de ${mes} de ${anio}`;
}

/** "20 de noviembre" (UTC). */
export function formatDiaMes(clave: string): string {
  const fecha = parseClaveUTC(clave);
  return `${fecha.getUTCDate()} de ${MESES_LARGO[fecha.getUTCMonth()]}`;
}

/** Nombre del día de la semana con inicial mayúscula ("Jueves"). */
export function diaSemanaCapitalizado(clave: string): string {
  const semana = DIAS_SEMANA_LARGO[parseClaveUTC(clave).getUTCDay()] ?? '';
  return `${semana.charAt(0).toUpperCase()}${semana.slice(1)}`;
}

/** "noviembre 2026" con inicial mayúscula (para el resumen de la ventana). */
export function formatMesAnio(clave: string): string {
  const fecha = parseClaveUTC(clave);
  const mes = MESES_LARGO[fecha.getUTCMonth()] ?? '';
  return `${mes.charAt(0).toUpperCase()}${mes.slice(1)} ${fecha.getUTCFullYear()}`;
}

/**
 * Iniciales (máx. 2) del nombre de una persona para el avatar:
 * primera letra del primer nombre y primera letra del primer apellido.
 */
export function iniciales(nombre: string): string {
  const partes = nombre.trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return '?';
  const primera = partes[0]?.charAt(0) ?? '';
  const ultima = partes.length > 1 ? (partes[partes.length - 1]?.charAt(0) ?? '') : '';
  return (primera + ultima).toUpperCase();
}
