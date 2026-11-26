/** RF-20, contrato v1.4 §9. Ningún resultado contiene tokens. */
import { request } from './client';
import type { Paginated } from './types';
export type Dispositivo = { id: string; plataforma: 'ANDROID' | 'IOS'; creadoEn: string; actualizadoEn: string; ultimoEnvioEn: string | null };
// Plazo para cabeceras Y cuerpo. Un timeout no prueba que el servidor no escribió.
async function call<T>(jwt: string, path: string, method: 'GET' | 'POST' | 'DELETE', body?: unknown): Promise<T> {
  const abort = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => { abort.abort(); reject(new Error('No se pudo confirmar la operación.')); }, 10000); });
  try { return await Promise.race([request<T>(path, { method, body, bearer: jwt, signal: abort.signal }), timeout]); }
  finally { clearTimeout(timer); }
}
export const dispositivosApi = {
  registrar: (jwt: string, token: string, plataforma: Dispositivo['plataforma']) => call<Dispositivo>(jwt, '/dispositivos', 'POST', { token, plataforma }),
  listar: (jwt: string, page = 1) => call<Paginated<Dispositivo>>(jwt, `/dispositivos?page=${page}&pageSize=20`, 'GET'),
  revocar: (jwt: string, id: string) => call<void>(jwt, `/dispositivos/${encodeURIComponent(id)}`, 'DELETE'),
  codigo: (jwt: string, id: string) => call<{ codigo: string; expiraEn: string }>(jwt, `/dispositivos/${encodeURIComponent(id)}/codigo-transferencia`, 'POST'),
  transferir: (jwt: string, codigo: string, token: string) => call<Dispositivo>(jwt, '/dispositivos/transferencia', 'POST', { codigo, token }),
};
