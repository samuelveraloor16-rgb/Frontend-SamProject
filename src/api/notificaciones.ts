/** Avisos propios mínimos RF-19 (CONTRATO_API.md v1.3 §8.4). */
import { request } from './client';
import { queryString } from './espacios';
import type { Notificacion, Paginated, PaginacionParams } from './types';

export function listarNotificaciones(
  filtros: PaginacionParams & { leida?: boolean } = {},
): Promise<Paginated<Notificacion>> {
  return request(`/notificaciones${queryString({
    page: filtros.page, pageSize: filtros.pageSize, leida: filtros.leida,
  })}`);
}

export function marcarNotificacionLeida(id: string): Promise<Notificacion> {
  return request(`/notificaciones/${encodeURIComponent(id)}/leida`, { method: 'PATCH' });
}
