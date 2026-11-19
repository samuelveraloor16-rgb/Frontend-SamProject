/** Endpoints de tareas (CONTRATO_API.md §4) y tarea rápida (§4, RF-13). */
import { request } from './client';
import { queryString } from './espacios';
import type { EstadoTarea, Paginated, PrioridadTarea, Tarea, TareaDetalle, TareaFiltros } from './types';

export function listarTareasProyecto(
  proyectoId: string,
  filtros: TareaFiltros = {},
): Promise<Paginated<Tarea, { proyectoId?: string }>> {
  return request<Paginated<Tarea>>(`/proyectos/${proyectoId}/tareas${queryString(filtros)}`);
}

/** GET /tareas/:id — detalle con `subtareasDetalle` embebido (contrato §4). */
export function obtenerTarea(tareaId: string): Promise<TareaDetalle> {
  return request<TareaDetalle>(`/tareas/${tareaId}`);
}

export type ActualizarTareaInput = {
  titulo?: string;
  /** null borra la descripción (contrato v1.1 §4). */
  descripcion?: string | null;
  prioridad?: PrioridadTarea;
  /** null borra la fecha límite. */
  fechaLimite?: string | null;
  /** null desasigna el responsable. */
  responsableId?: string | null;
  /** Reemplaza el conjunto completo de etiquetas. */
  etiquetas?: string[];
};

/** PATCH /tareas/:id — no permite cambiar estado (usar cambiarEstadoTarea) ni proyecto. */
export function actualizarTarea(tareaId: string, input: ActualizarTareaInput): Promise<Tarea> {
  return request<Tarea>(`/tareas/${tareaId}`, { method: 'PATCH', body: input });
}

/** DELETE /tareas/:id — borra la tarea y sus subtareas (cascada). */
export function eliminarTarea(tareaId: string): Promise<void> {
  return request<void>(`/tareas/${tareaId}`, { method: 'DELETE' });
}

export type CrearSubtareaInput = {
  titulo: string;
  prioridad?: PrioridadTarea;
  fechaLimite?: string;
  responsableId?: string | null;
};

/** POST /tareas/:id/subtareas — un solo nivel de anidación (contrato §4). */
export function crearSubtarea(tareaId: string, input: CrearSubtareaInput): Promise<Tarea> {
  return request<Tarea>(`/tareas/${tareaId}/subtareas`, { method: 'POST', body: input });
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
