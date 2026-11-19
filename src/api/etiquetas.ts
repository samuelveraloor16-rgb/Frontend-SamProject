/** Etiquetas del espacio (CONTRATO_API.md §4, RF-12). */
import { request } from './client';
import type { Etiqueta, Paginated } from './types';

export function listarEtiquetasEspacio(espacioId: string): Promise<Paginated<Etiqueta>> {
  return request<Paginated<Etiqueta>>(`/espacios/${espacioId}/etiquetas?pageSize=100`);
}
