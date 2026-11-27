/** RF22, contrato v1.8 §11. Sin caché ni cálculo de métricas en el cliente. */
import { ApiRequestError, request } from './client';
import type { Proyecto } from './types';

export type MetricasProyecto = {
  proyectoId: string; calculadoEn: string;
  total: number; hechas: number; pendientes: number; enCurso: number;
  trabajoPendiente: number; vencidas: number; progreso: number;
};

/** Plazo incluye cabeceras y cuerpo. Bearer capturado, sin invalidación global. */
async function leer<T>(path: string, bearer: string): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new ApiRequestError(0, 'Timeout', ['La consulta tardó demasiado. Reintenta para obtener un nuevo corte.']));
      controller.abort();
    }, 15000);
  });
  try { return await Promise.race([request<T>(path, { bearer, signal: controller.signal }), timeout]); }
  finally { if (timer !== undefined) clearTimeout(timer); }
}
export function obtenerMetricasProyecto(proyectoId: string, bearer: string) {
  return leer<MetricasProyecto>(`/proyectos/${encodeURIComponent(proyectoId)}/metricas`, bearer);
}
/** Solo nombre/archivo desde el recurso real; nunca usa sus métricas RF11. */
export function obtenerProyectoParaPanel(proyectoId: string, bearer: string) {
  return leer<Proyecto>(`/proyectos/${encodeURIComponent(proyectoId)}`, bearer);
}

/** Valida estructura y rangos, no reconstruye relaciones ni fórmulas de negocio. */
export function validarMetricas(data: MetricasProyecto, proyectoId: string): MetricasProyecto {
  if (!data || data.proyectoId !== proyectoId || typeof data.calculadoEn !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T.*Z$/.test(data.calculadoEn) || !Number.isFinite(Date.parse(data.calculadoEn))) throw new Error('Corte inválido');
  for (const campo of ['total', 'hechas', 'pendientes', 'enCurso', 'trabajoPendiente', 'vencidas'] as const) {
    if (!Number.isSafeInteger(data[campo]) || data[campo] < 0 || (campo !== 'total' && data[campo] > data.total)) throw new Error('Conteo inválido');
  }
  if (typeof data.progreso !== 'number' || !Number.isFinite(data.progreso) || data.progreso < 0 || data.progreso > 100) throw new Error('Progreso inválido');
  return { ...data };
}
