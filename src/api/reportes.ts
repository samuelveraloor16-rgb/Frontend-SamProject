import { fetch as expoFetch } from 'expo/fetch';
import { API_BASE_URL } from './config';

export type FormatoReporte = 'pdf' | 'csv';
export class ReporteError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}
const MAX = 1024 * 1024;
export const reporteNombre = (f: FormatoReporte) => `resumen-proyecto.${f}`;
export const reporteMime = (f: FormatoReporte) => f === 'pdf' ? 'application/pdf' : 'text/csv';
const invalido = () => new ReporteError(502, 'El servidor devolvió un reporte inválido o incompleto.');

/** Transporte binario independiente de JSON. Nunca usa credenciales globales ni sigue redirects. */
export async function descargarReporte(id: string, formato: FormatoReporte, jwt: string, signal: AbortSignal): Promise<Uint8Array> {
  if (formato !== 'pdf' && formato !== 'csv') throw invalido();
  const abort = new AbortController();
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let rejectStop: (error: Error) => void = () => {};
  const stopped = new Promise<never>((_, reject) => { rejectStop = reject; });
  const stop = (error: Error) => { rejectStop(error); abort.abort(); if (reader) void reader.cancel().catch(() => {}); };
  const cancel = () => stop(new ReporteError(-1, 'Descarga cancelada.'));
  signal.addEventListener('abort', cancel, { once: true });
  timer = setTimeout(() => stop(new ReporteError(0, 'La descarga tardó demasiado. Reintenta.')), 15000);
  const run = async () => {
    if (signal.aborted) throw new ReporteError(-1, 'Descarga cancelada.');
    const url = `${API_BASE_URL}/proyectos/${encodeURIComponent(id)}/reportes/resumen.${formato}`;
    const res = await expoFetch(url, { method: 'GET', headers: { Accept: reporteMime(formato), Authorization: `Bearer ${jwt}` }, signal: abort.signal, redirect: 'error', credentials: 'omit' });
    if (abort.signal.aborted) throw new ReporteError(-1, 'Descarga cancelada.');
    if (res.redirected || res.url !== url) throw invalido();
    if (res.status !== 200) {
      const messages: Record<number, string> = {
        401: 'Tu sesión expiró.', 403: 'Proyecto no disponible. Puede que ya no tengas acceso.',
        404: 'Proyecto no disponible. Puede que ya no tengas acceso.',
        422: formato === 'pdf' ? 'No se pudo generar el PDF: el contenido puede exceder los límites o contener caracteres no representables. Puedes solicitar CSV por separado.' : 'El contenido del reporte excede los límites admitidos.',
        429: 'Demasiados intentos. Espera un minuto y reintenta.',
      };
      // No leer cuerpos JSON de error ni exponer mensajes arbitrarios del servidor.
      throw new ReporteError(res.status, messages[res.status] ?? 'No se pudo obtener el reporte. Reintenta más tarde.');
    }
    const h = res.headers;
    const mime = h.get('content-type')?.toLowerCase().replace(/\s+/g, '');
    if (mime !== (formato === 'pdf' ? 'application/pdf' : 'text/csv;charset=utf-8') ||
      h.get('content-disposition') !== `attachment; filename="${reporteNombre(formato)}"` ||
      h.get('x-content-type-options')?.toLowerCase() !== 'nosniff' ||
      h.get('cache-control')?.toLowerCase().replace(/\s+/g, '') !== 'private,no-store') throw invalido();
    const length = h.get('content-length');
    if (length !== null && (!/^\d+$/.test(length) || Number(length) === 0 || Number(length) > MAX)) throw invalido();
    if (!res.body) throw invalido();
    reader = res.body.getReader();
    // Fixed capacity: Content-Length is not trusted. No growing list of chunks.
    const buffer = new Uint8Array(MAX);
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (abort.signal.aborted) throw new ReporteError(-1, 'Descarga cancelada.');
      if (done) break;
      if (!value || size + value.byteLength > MAX) throw invalido();
      buffer.set(value, size); size += value.byteLength;
    }
    if (!size || (length !== null && size !== Number(length))) throw invalido();
    const bytes = buffer.slice(0, size);
    if (formato === 'pdf') {
      const start = String.fromCharCode(...bytes.subarray(0, 8));
      const end = String.fromCharCode(...bytes.subarray(Math.max(0, size - 32)));
      if (!/^%PDF-1\.[0-9]/.test(start) || !/%%EOF\s*$/.test(end)) throw invalido();
    } else {
      if (bytes[0] !== 239 || bytes[1] !== 187 || bytes[2] !== 191 || size < 6 || bytes[size - 2] !== 13 || bytes[size - 1] !== 10) throw invalido();
      let text: string;
      try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(3)); } catch { throw invalido(); }
      const header = 'proyectoId,proyectoNombre,calculadoEn,progreso,total,hechas,pendientes,enCurso,trabajoPendiente,vencidas,ritmoDisponible,ritmoMotivo,ritmoPromedioSemanal\r\n';
      if (!text.startsWith(header) || text.length <= header.length) throw invalido();
      // Validate framing only (quoted fields may contain CRLF); never interpret values.
      let quoted = false, columns = 1, records = 0, atStart = true, afterQuote = false;
      for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (quoted) { if (c === '"') { if (text[i + 1] === '"') i++; else { quoted = false; afterQuote = true; } } continue; }
        if (c === '"') { if (!atStart) throw invalido(); quoted = true; atStart = false; continue; }
        if (c === ',') { columns++; atStart = true; afterQuote = false; continue; }
        if (c === '\r' && text[i + 1] === '\n') { if (columns !== 13) throw invalido(); records++; i++; columns = 1; atStart = true; afterQuote = false; continue; }
        if (afterQuote || c === '\n' || c === '\r') throw invalido();
        atStart = false;
      }
      if (quoted || records !== 2 || !atStart) throw invalido();
    }
    return bytes;
  };
  try { return await Promise.race([run(), stopped]); }
  catch (error) { if (error instanceof ReporteError) throw error; throw new ReporteError(0, 'No se pudo completar la descarga. Revisa tu conexión.'); }
  finally { clearTimeout(timer); signal.removeEventListener('abort', cancel); abort.abort(); if (reader) void reader.cancel().catch(() => {}); }
}
