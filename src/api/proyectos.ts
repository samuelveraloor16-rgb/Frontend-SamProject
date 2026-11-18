/** Endpoints de proyectos (CONTRATO_API.md §3). El progreso lo calcula el backend (RF-11). */
import { request } from './client';
import { queryString } from './espacios';
import type { Paginated, ProgresoProyecto, Proyecto } from './types';

export function listarProyectos(
  espacioId: string,
  params: { page?: number; pageSize?: number; q?: string; archivados?: boolean } = {},
): Promise<Paginated<Proyecto>> {
  const qs = queryString(params);
  return request<Paginated<Proyecto>>(`/espacios/${espacioId}/proyectos${qs}`);
}

export type CrearProyectoInput = {
  nombre: string;
  descripcion?: string;
  fechaInicio?: string;
  fechaFin?: string;
};

export function crearProyecto(
  espacioId: string,
  input: CrearProyectoInput,
): Promise<Proyecto> {
  return request<Proyecto>(`/espacios/${espacioId}/proyectos`, {
    method: 'POST',
    body: input,
  });
}

export function obtenerProyecto(proyectoId: string): Promise<Proyecto> {
  return request<Proyecto>(`/proyectos/${proyectoId}`);
}

/** RF-11: total, hechas, pendientes, enCurso, vencidas y progreso (1 decimal). */
export function obtenerProgreso(proyectoId: string): Promise<ProgresoProyecto> {
  return request<ProgresoProyecto>(`/proyectos/${proyectoId}/progreso`);
}
