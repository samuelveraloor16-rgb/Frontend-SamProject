const tipos = ['TAREA_ASIGNADA', 'TAREA_POR_VENCER', 'TAREA_VENCIDA', 'MENCION', 'COMENTARIO'] as const;
export type PushPayload = { tipo: typeof tipos[number]; tareaId: string; proyectoId: string; espacioId: string; comentarioId: string | null };
// Opacos: no imponer UUID/CUID, pero tampoco aceptar URLs, escapes ni rutas.
export const opaqueId = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{1,256}$/.test(v);
export function parsePushPayload(value: unknown): PushPayload | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const p = value as Record<string, unknown>;
  if (Object.keys(p).sort().join(',') !== 'comentarioId,espacioId,proyectoId,tareaId,tipo') return null;
  if (!tipos.includes(p.tipo as PushPayload['tipo']) || !opaqueId(p.tareaId) || !opaqueId(p.proyectoId) || !opaqueId(p.espacioId)) return null;
  const comentario = p.tipo === 'MENCION' || p.tipo === 'COMENTARIO';
  if (comentario ? !opaqueId(p.comentarioId) : p.comentarioId !== null) return null;
  return p as PushPayload;
}
