import { ApiRequestError, request } from './client';

export const TIPOS_PREFERENCIA = ['TAREA_ASIGNADA', 'TAREA_POR_VENCER', 'TAREA_VENCIDA', 'COMENTARIO', 'MENCION'] as const;
export const CANALES_PREFERENCIA = ['inApp', 'correo', 'push'] as const;
export type TipoPreferencia = typeof TIPOS_PREFERENCIA[number];
export type CanalPreferencia = typeof CANALES_PREFERENCIA[number];
export type PreferenciaNotificacion = { tipo: TipoPreferencia; inApp: boolean; correo: boolean; push: boolean };
export type CambioPreferencia = { tipo: TipoPreferencia } & Partial<Record<CanalPreferencia, boolean>>;
export type PreferenciasNotificaciones = { preferencias: PreferenciaNotificacion[] };

/** Como Perfil: plazo sobre cabeceras y cuerpo, sin presumir cancelación remota. */
async function consultarConPlazo(bearer: string, body?: { preferencias: CambioPreferencia[] }) {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new ApiRequestError(0, 'Timeout', ['No se pudo confirmar el resultado dentro del plazo.']));
      controller.abort();
    }, 15000);
  });
  try {
    return await Promise.race([request<PreferenciasNotificaciones>('/perfil/preferencias-notificaciones', {
      bearer, signal: controller.signal, ...(body ? { method: 'PATCH' as const, body } : {}),
    }), timeout]);
  } finally { if (timer !== undefined) clearTimeout(timer); }
}
/** Bearer capturado: un 401 se resuelve únicamente en el ámbito de esa sesión. */
export function obtenerPreferenciasNotificaciones(bearer: string) {
  return consultarConPlazo(bearer);
}
export function actualizarPreferenciasNotificaciones(preferencias: CambioPreferencia[], bearer: string) {
  // Lista permitida: nunca propagar campos de usuario ni otros datos del llamador.
  const cambios = preferencias.map(fila => {
    const cambio: CambioPreferencia = { tipo: fila.tipo };
    for (const canal of CANALES_PREFERENCIA) if (typeof fila[canal] === 'boolean') cambio[canal] = fila[canal];
    return cambio;
  });
  return consultarConPlazo(bearer, { preferencias: cambios });
}
