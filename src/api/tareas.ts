/** Endpoints de tareas (CONTRATO_API.md §4) y tarea rápida (§4, RF-13). */
import { request } from './client';
import { queryString } from './espacios';
import type { EstadoTarea, Paginated, Tarea, TareaFiltros } from './types';

export function listarTareasProyecto(
  proyectoId: string,
  filtros: TareaFiltros = {},
): Promise<Paginated<Tarea, { proyectoId?: string }>> {
  return request<Paginated<Tarea>>(`/proyectos/${proyectoId}/tareas${queryString(filtros)}`);
}

export type CrearTareaInput = {
  titulo: string;
  descripcion?: string;
  prioridad?: 'BAJA' | 'MEDIA' | 'ALTA' | 'URGENTE';
  fechaLimite?: string;
  responsableId?: string;
};

export function crearTarea(proyectoId: string, input: CrearTareaInput): Promise<Tarea> {
  return request<Tarea>(`/proyectos/${proyectoId}/tareas`, { method: 'POST', body: input });
}

/** Tarea rápida → Bandeja de entrada (RF-13). Sin espacioId: Bandeja del espacio personal. */
export function crearTareaRapida(titulo: string, espacioId?: string): Promise<Tarea> {
  return request<Tarea>('/tareas/rapida', {
    method: 'POST',
    body: espacioId ? { titulo, espacioId } : { titulo },
  });
}

/** RF-14: transiciones libres entre PENDIENTE / EN_CURSO / HECHA. */
export function cambiarEstadoTarea(tareaId: string, estado: EstadoTarea): Promise<Tarea> {
  return request<Tarea>(`/tareas/${tareaId}/estado`, { method: 'PATCH', body: { estado } });
}
