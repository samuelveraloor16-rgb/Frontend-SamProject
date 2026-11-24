/**
 * Cliente HTTP tipado sobre la API de SamProject (CONTRATO_API.md v1.1).
 *
 * - Base URL: `${API_BASE_URL}` (ver ./config.ts); rutas bajo /api/v1.
 * - Auth: `Authorization: Bearer <accessToken>` automático salvo `auth: false`.
 * - Errores: lanza `ApiRequestError` con statusCode/mensajes siempre.
 * - Listas paginadas: envelope `{ datos, meta }` (ver ./types.ts).
 *
 * La app NO calcula métricas: los números vienen del backend.
 */
import { API_BASE_URL } from './config';
import { getToken, getTokenVersion } from './tokenStorage';
import type { ApiErrorBody } from './types';

/** Error normalizado de la API. `statusCode: 0` = sin conexión con el servidor. */
export class ApiRequestError extends Error {
  readonly statusCode: number;
  readonly error: string;
  /** Mensajes aplanados del backend (string[] en validación, string en negocio). */
  readonly mensajes: string[];

  constructor(statusCode: number, error: string, mensajes: string[]) {
    super(mensajes.join(' '));
    this.name = 'ApiRequestError';
    this.statusCode = statusCode;
    this.error = error;
    this.mensajes = mensajes;
  }

  get esErrorDeRed(): boolean {
    return this.statusCode === 0;
  }
}

/** Una escritura sin confirmación no debe repetirse automáticamente. */
export function esEscrituraIncierta(error: unknown): boolean {
  return !(error instanceof ApiRequestError) || error.statusCode === 0 || error.statusCode === 408 || error.statusCode >= 500;
}

/** Se invoca cuando el backend responde 401 (token inválido/expirado/versión). */
let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(handler: (() => void) | null): void {
  onUnauthorized = handler;
}

type RequestOptions = {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  /** false para endpoints públicos (registro, login, recuperar, restablecer). */
  auth?: boolean;
  signal?: AbortSignal;
};

function normalizarMensajes(body: ApiErrorBody | undefined, fallback: string): string[] {
  if (!body) return [fallback];
  const msg = body.message;
  if (Array.isArray(msg)) return msg.length > 0 ? msg : [fallback];
  if (typeof msg === 'string' && msg.trim().length > 0) return [msg];
  return [fallback];
}

async function parseErrorBody(res: Response): Promise<ApiErrorBody | undefined> {
  try {
    const text = await res.text();
    if (!text) return undefined;
    return JSON.parse(text) as ApiErrorBody;
  } catch {
    return undefined;
  }
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, auth = true, signal } = options;

  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const token = auth ? getToken() : null;
  const tokenVersion = getTokenVersion();
  if (auth) {
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw error;
    throw new ApiRequestError(
      0,
      'NetworkError',
      ['No pudimos conectar con el servidor. Revisa tu conexión e inténtalo de nuevo.'],
    );
  }

  // 401 autenticado es suficiente al recibir cabeceras: el cuerpo puede no
  // llegar nunca. No confiar en una respuesta ya cancelada ni de otra sesión.
  if (res.status === 401) {
    if (signal?.aborted) {
      const error = new Error('Solicitud cancelada.');
      error.name = 'AbortError';
      throw error;
    }
    if (auth && token && tokenVersion === getTokenVersion()) onUnauthorized?.();
    throw new ApiRequestError(401, 'Unauthorized', ['No autorizado.']);
  }

  if (res.status === 204) return undefined as T;

  if (!res.ok) {
    const errorBody = await parseErrorBody(res);
    throw new ApiRequestError(
      res.status,
      errorBody?.error ?? 'Error',
      normalizarMensajes(errorBody, `Error ${res.status} al contactar el servidor.`),
    );
  }

  let text: string;
  try { text = await res.text(); } catch {
    throw new ApiRequestError(0, 'NetworkError', ['No se pudo completar la respuesta. Revisa tu conexión.']);
  }
  if (!text) return undefined as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new ApiRequestError(502, 'InvalidJson', ['El servidor devolvió una respuesta inesperada.']);
  }
}

/** Mensaje amigable único para mostrar en la UI ante un error de API. */
export function mensajeDeError(error: unknown, respaldo = 'Algo salió mal. Inténtalo de nuevo.'): string {
  if (error instanceof ApiRequestError) {
    if (error.statusCode === 429) {
      return 'Demasiados intentos. Espera un minuto e inténtalo de nuevo.';
    }
    if (error.statusCode >= 500) return 'El servidor no está disponible. Inténtalo de nuevo.';
    return error.mensajes.join('\n');
  }
  return respaldo;
}
