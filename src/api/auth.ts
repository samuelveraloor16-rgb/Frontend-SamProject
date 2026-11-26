/** Endpoints de autenticación (CONTRATO_API.md §1). */
import { ApiRequestError, request } from './client';
import type { AuthResponse, Usuario } from './types';

export type RegistroInput = { nombre: string; email: string; contrasena: string };
export type LoginInput = { email: string; contrasena: string };

export function registrar(input: RegistroInput): Promise<AuthResponse> {
  return request<AuthResponse>('/auth/registro', { method: 'POST', body: input, auth: false });
}

export function iniciarSesion(input: LoginInput): Promise<AuthResponse> {
  return request<AuthResponse>('/auth/login', { method: 'POST', body: input, auth: false });
}

export async function cerrarSesionRemota(bearer?: string): Promise<{ mensaje: string }> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { controller.abort(); reject(new Error('Tiempo de espera agotado')); }, 15000);
  });
  try {
    return await Promise.race([request<{ mensaje: string }>('/auth/logout', { method: 'POST', signal: controller.signal, bearer }), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** El plazo abarca fetch y lectura del cuerpo; abort no prueba cancelación remota. */
async function requestConPlazo<T>(path: string, options: { method?: 'POST' | 'PATCH'; body?: unknown; auth?: boolean } = {}): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new ApiRequestError(0, 'Timeout', ['No se pudo confirmar el resultado dentro del plazo.']));
      try { controller.abort(); } catch { /* El plazo no implica cancelación remota. */ }
    }, 15000);
  });
  try { return await Promise.race([request<T>(path, { ...options, signal: controller.signal }), timeout]); }
  finally { if (timer !== undefined) clearTimeout(timer); }
}

export function obtenerPerfil(): Promise<Usuario> {
  return requestConPlazo<Usuario>('/perfil');
}

export function solicitarRecuperacion(email: string): Promise<{ mensaje: string }> {
  return request('/auth/recuperar', { method: 'POST', body: { email }, auth: false });
}
export function restablecerContrasena(token: string, contrasenaNueva: string): Promise<{ mensaje: string }> {
  return requestConPlazo('/auth/restablecer', { method: 'POST', body: { token, contrasenaNueva }, auth: false });
}
export function actualizarPerfil(input: { nombre?: string; fotoUrl?: string | null }): Promise<Usuario> {
  return requestConPlazo('/perfil', { method: 'PATCH', body: input });
}
export function cambiarContrasena(contrasenaActual: string, contrasenaNueva: string): Promise<{ mensaje: string }> {
  return requestConPlazo('/perfil/contrasena', { method: 'PATCH', body: { contrasenaActual, contrasenaNueva } });
}
