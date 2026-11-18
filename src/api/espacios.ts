/** Endpoints de espacios y Bandeja de entrada (CONTRATO_API.md §2 y §5). */
import { request } from './client';
import type { BandejaResponse, Espacio, Paginated } from './types';

export function listarEspacios(): Promise<Paginated<Espacio>> {
  return request<Paginated<Espacio>>('/espacios');
}

/**
 * Bandeja de entrada del espacio. Se pide pageSize=1: solo necesitamos
 * `meta.total` y `meta.proyectoId`; el conteo lo calcula el backend.
 */
export function obtenerBandejaTotal(espacioId: string): Promise<BandejaResponse> {
  return request<BandejaResponse>(`/espacios/${espacioId}/bandeja?pageSize=1`);
}
