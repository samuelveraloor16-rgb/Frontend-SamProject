/** Utilidades de formato compartidas (fechas ISO → es-ES). */

const MESES = [
  'ene', 'feb', 'mar', 'abr', 'may', 'jun',
  'jul', 'ago', 'sep', 'oct', 'nov', 'dic',
] as const;

/** "20 nov" o "20 nov 2027" si no es el año actual. */
export function formatFechaLimite(iso: string): string {
  const fecha = new Date(iso);
  if (Number.isNaN(fecha.getTime())) return '';
  const ahora = new Date();
  const dia = fecha.getUTCDate();
  const mes = MESES[fecha.getUTCMonth()];
  const anio = fecha.getUTCFullYear();
  return anio === ahora.getFullYear() ? `${dia} ${mes}` : `${dia} ${mes} ${anio}`;
}

/** "17 nov 2026" completo, para detalles. */
export function formatFechaCorta(iso: string): string {
  const fecha = new Date(iso);
  if (Number.isNaN(fecha.getTime())) return '';
  return `${fecha.getUTCDate()} ${MESES[fecha.getUTCMonth()]} ${fecha.getUTCFullYear()}`;
}
