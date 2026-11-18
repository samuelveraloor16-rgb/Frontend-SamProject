/** Endpoints de espacios, miembros e invitaciones (CONTRATO_API.md §2) y Bandeja (§5). */
import { request } from './client';
import type {
  AceptarInvitacionResponse,
  BandejaResponse,
  Espacio,
  InvitacionCreada,
  Paginated,
  RolEspacio,
  TareaFiltros,
  Tarea,
} from './types';

export function listarEspacios(): Promise<Paginated<Espacio>> {
  return request<Paginated<Espacio>>('/espacios');
}

/** Crea un espacio de equipo; el creador queda ADMINISTRADOR. También crea su Bandeja. */
export function crearEspacio(nombre: string): Promise<Espacio> {
  return request<Espacio>('/espacios', { method: 'POST', body: { nombre } });
}

export function obtenerEspacio(id: string): Promise<Espacio> {
  return request<Espacio>(`/espacios/${id}`);
}

/** Bandeja de entrada del espacio. Se pide pageSize=1: solo meta.total y meta.proyectoId. */
export function obtenerBandejaTotal(espacioId: string): Promise<BandejaResponse> {
  return request<BandejaResponse>(`/espacios/${espacioId}/bandeja?pageSize=1`);
}

/** Bandeja de entrada con filtros (mismos que el listado de tareas, §5). */
export function listarBandeja(
  espacioId: string,
  filtros: TareaFiltros = {},
): Promise<Paginated<Tarea, { proyectoId?: string }>> {
  return request<Paginated<Tarea, { proyectoId: string }>>(
    `/espacios/${espacioId}/bandeja${queryString(filtros)}`,
  );
}

/** Invitar por correo (solo ADMINISTRADOR). El token llega al invitado por correo. */
export function invitarMiembro(
  espacioId: string,
  input: { email: string; rol: RolEspacio },
): Promise<InvitacionCreada> {
  return request<InvitacionCreada>(`/espacios/${espacioId}/invitaciones`, {
    method: 'POST',
    body: input,
  });
}

/** Aceptar una invitación con el token del enlace (samproject://invitar?token=...). */
export function aceptarInvitacion(token: string): Promise<AceptarInvitacionResponse> {
  return request<AceptarInvitacionResponse>(`/invitaciones/${encodeURIComponent(token)}/aceptar`, {
    method: 'POST',
  });
}

export function queryString(filtros: Record<string, string | number | boolean | undefined>): string {
  const params = new URLSearchParams();
  for (const [clave, valor] of Object.entries(filtros)) {
    if (valor === undefined || valor === '') continue;
    params.set(clave, String(valor));
  }
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}
