/** Adaptadores RF-19, CONTRATO_API.md v1.3 §8. Sin reintentos ni lógica de menciones. */
import { request } from './client';
import { queryString } from './espacios';
import type { Comentario, MiembroMencionable, Paginated, PaginacionParams } from './types';

export function listarMiembrosMencionables(
  tareaId: string,
  filtros: PaginacionParams & { q?: string } = {},
): Promise<Paginated<MiembroMencionable>> {
  return request(`/tareas/${encodeURIComponent(tareaId)}/miembros-mencionables${queryString({
    page: filtros.page, pageSize: filtros.pageSize, q: filtros.q?.trim() || undefined,
  })}`);
}

export function listarComentarios(
  tareaId: string,
  filtros: PaginacionParams = {},
): Promise<Paginated<Comentario>> {
  return request(`/tareas/${encodeURIComponent(tareaId)}/comentarios${queryString({
    page: filtros.page, pageSize: filtros.pageSize,
  })}`);
}

export type CrearComentarioInput = { texto: string };
export type CrearComentarioResponse = {
  comentario: Comentario;
  /** undefined si el servidor no expuso la cabecera; no se presume primera creación. */
  idempotencyReplayed: boolean | undefined;
};

/** La clave la aporta el llamador; texto y clave se envían sin normalizar. */
export async function crearComentario(
  tareaId: string,
  input: CrearComentarioInput,
  idempotencyKey: string,
): Promise<CrearComentarioResponse> {
  let idempotencyReplayed: boolean | undefined;
  const comentario = await request<Comentario>(`/tareas/${encodeURIComponent(tareaId)}/comentarios`, {
    method: 'POST',
    body: { texto: input.texto },
    headers: { 'Idempotency-Key': idempotencyKey },
    onResponseHeaders: headers => {
      const value = headers.get('Idempotency-Replayed');
      idempotencyReplayed = value === 'true' ? true : value === 'false' ? false : undefined;
    },
  });
  return { comentario, idempotencyReplayed };
}
