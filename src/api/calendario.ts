/**
 * Calendario del espacio — RF-18 (CONTRATO_API.md §7, v1.2).
 * Tareas no-subtareas de proyectos no archivados del espacio (Bandeja incluida)
 * con fechaLimite dentro de la ventana [desde, hasta] (inclusive, días UTC).
 * Miembro del espacio; si no lo es, el backend responde 404.
 */
import { request } from './client';
import type { CalendarioResponse } from './types';

export type VentanaCalendario = {
  /** YYYY-MM-DD; omitido = sin límite inferior (el backend aplica su default). */
  desde?: string;
  /** YYYY-MM-DD; omitido = sin límite superior. Debe ser >= desde. */
  hasta?: string;
  page?: number;
  pageSize?: number;
};

/** Página única del calendario (paginación estándar, pageSize máximo 100). */
export function obtenerCalendario(
  espacioId: string,
  { desde, hasta, page = 1, pageSize = 100 }: VentanaCalendario = {},
): Promise<CalendarioResponse> {
  const params = new URLSearchParams();
  if (desde) params.set('desde', desde);
  if (hasta) params.set('hasta', hasta);
  params.set('page', String(page));
  params.set('pageSize', String(pageSize));
  return request<CalendarioResponse>(`/espacios/${espacioId}/calendario?${params}`);
}

/**
 * Todas las tareas de la ventana (el backend pagina; aquí se concatenan las páginas).
 * `meta` se devuelve tal cual la entregó la primera página.
 */
export async function obtenerCalendarioCompleto(
  espacioId: string,
  ventana: Omit<VentanaCalendario, 'page' | 'pageSize'>,
): Promise<CalendarioResponse> {
  const primera = await obtenerCalendario(espacioId, { ...ventana, page: 1, pageSize: 100 });
  const totalPaginas = primera.meta.totalPaginas;
  if (totalPaginas <= 1) return primera;
  const resto = await Promise.all(
    Array.from({ length: totalPaginas - 1 }, (_, i) =>
      obtenerCalendario(espacioId, { ...ventana, page: i + 2, pageSize: 100 }),
    ),
  );
  return {
    datos: [...primera.datos, ...resto.flatMap((r) => r.datos)],
    meta: primera.meta,
  };
}
