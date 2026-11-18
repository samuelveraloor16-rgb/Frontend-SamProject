/** Endpoints de autenticación (CONTRATO_API.md §1). */
import { request } from './client';
import type { AuthResponse, Usuario } from './types';

export type RegistroInput = { nombre: string; email: string; contrasena: string };
export type LoginInput = { email: string; contrasena: string };

export function registrar(input: RegistroInput): Promise<AuthResponse> {
  return request<AuthResponse>('/auth/registro', { method: 'POST', body: input, auth: false });
}

export function iniciarSesion(input: LoginInput): Promise<AuthResponse> {
  return request<AuthResponse>('/auth/login', { method: 'POST', body: input, auth: false });
}

export function cerrarSesionRemota(): Promise<{ mensaje: string }> {
  return request<{ mensaje: string }>('/auth/logout', { method: 'POST' });
}

export function obtenerPerfil(): Promise<Usuario> {
  return request<Usuario>('/perfil');
}
