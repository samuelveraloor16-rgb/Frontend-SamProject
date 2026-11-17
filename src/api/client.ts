/**
 * Cliente HTTP placeholder (Fase 1 — scaffold).
 *
 * AÚN NO CONSUME NINGÚN ENDPOINT. Este módulo deja lista la estructura
 * para cuando lleguen las pantallas de datos (auth → espacios → proyectos →
 * tareas → lista → Kanban), consumiendo el contrato de
 * docs/orquestacion/CONTRATO_API.md.
 *
 * Convenciones del contrato que este cliente respetará:
 *  - Base URL: `${API_BASE_URL}` (ver ./config.ts), rutas bajo /api/v1.
 *  - Auth: `Authorization: Bearer <accessToken>` en todo excepto
 *    registro/login/recuperar/restablecer.
 *  - Errores: `{ statusCode, message: string | string[], error: string }`.
 *  - Listas paginadas con envelope `{ datos: [...], meta: { pagina, tamanoPagina, total, totalPaginas } }`.
 *  - Fechas ISO 8601 UTC (con `Z`).
 *
 * Fuera de alcance a propósito: sin lógica de negocio, sin cálculo de
 * métricas en cliente, sin manejo de tokens todavía. Eso llega con las
 * pantallas de autenticación, no antes.
 */

import { API_BASE_URL } from './config';

export type ApiError = {
  statusCode: number;
  message: string | string[];
  error: string;
};

/** Envelope de lista paginada del contrato (sección 0, Paginación). */
export type Paginated<T> = {
  datos: T[];
  meta: {
    pagina: number;
    tamanoPagina: number;
    total: number;
    totalPaginas: number;
  };
};

async function request<T>(_path: string, _init?: RequestInit): Promise<T> {
  // Intencionadamente sin implementar en el scaffold.
  // Las pantallas de datos llegarán en pasos posteriores de la Fase 1.
  throw new Error(
    `Cliente API no implementado todavía (scaffold de Fase 1). Base URL configurada: ${API_BASE_URL}`,
  );
}

export const apiClient = {
  baseUrl: API_BASE_URL,
  request,
} as const;
