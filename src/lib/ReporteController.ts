import { ReporteError, type FormatoReporte } from '../api/reportes';
import type { SelloSesion } from '../auth/SessionController';

export type ArchivoReporte = { uri: string; limpiar: () => void; liberar?: () => void; marcarOfrecido?: () => void; invocar?: <T>(fn: () => T) => T };
type Snapshot = { fase: 'inicial' | 'descargando' | 'preparando' | 'hoja'; mensaje: string | null };
type Dependencies = {
  id: string; jwt: string; sello: SelloSesion; vigente: (s: SelloSesion) => boolean;
  descargar: (id: string, f: FormatoReporte, jwt: string, signal: AbortSignal) => Promise<Uint8Array>;
  escribir: (f: FormatoReporte, bytes: Uint8Array) => Promise<ArchivoReporte>;
  disponible: () => Promise<boolean>; compartir: (archivo: ArchivoReporte, f: FormatoReporte) => Promise<void>;
  unauthorized: () => void; sinAcceso: () => void;
};
const empty: Snapshot = { fase: 'inicial', mensaje: null };
/** One controller per project/session. No report bytes in observable state. */
export class ReporteController {
  private snapshot: Snapshot = empty;
  private listeners = new Set<() => void>();
  private activo = true;
  private revision = 0;
  private abort?: AbortController;
  private working = false;
  constructor(private d: Dependencies) {}
  private vigente = () => this.activo && this.d.vigente(this.d.sello);
  getSnapshot = () => this.vigente() ? this.snapshot : empty;
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  private update(s: Snapshot) { this.snapshot = s; this.listeners.forEach(fn => fn()); }
  activar = () => { this.activo = true; };
  suspender = () => { this.activo = false; this.revision++; this.abort?.abort(); this.update(empty); };
  cancelar = () => { if (this.snapshot.fase !== 'descargando') return; this.revision++; this.abort?.abort(); this.update({ ...empty, mensaje: 'Descarga cancelada.' }); };
  iniciar = async (f: FormatoReporte) => {
    if (!this.vigente() || this.working) return;
    this.working = true;
    const revision = ++this.revision;
    const current = () => this.vigente() && revision === this.revision;
    const abort = this.abort = new AbortController();
    let archivo: ArchivoReporte | undefined, offered = false;
    this.update({ fase: 'descargando', mensaje: 'Descargando reporte…' });
    try {
      if (!await this.d.disponible()) throw new ReporteError(0, 'Compartir archivos no está disponible en este dispositivo.');
      if (!current()) return;
      const bytes = await this.d.descargar(this.d.id, f, this.d.jwt, abort.signal);
      if (!current()) return;
      this.update({ fase: 'preparando', mensaje: 'Preparando archivo privado…' });
      archivo = await this.d.escribir(f, bytes);
      if (!current()) return;
      this.update({ fase: 'hoja', mensaje: 'Se ofrece el reporte a la hoja del sistema.' });
      if (!current()) return;
      // Once handed off, the receiver may read after this Promise resolves.
      archivo.marcarOfrecido?.();
      if (!current()) return;
      offered = true;
      await this.d.compartir(archivo, f);
      if (current()) this.update({ ...empty, mensaje: 'Hoja de compartir cerrada. No podemos confirmar si se guardó o envió el archivo.' });
    } catch (e) {
      if (!current()) return;
      if (e instanceof ReporteError && e.status === 401) this.d.unauthorized();
      if (e instanceof ReporteError && (e.status === 403 || e.status === 404)) { this.d.sinAcceso(); this.suspender(); return; }
      this.update({ ...empty, mensaje: e instanceof ReporteError ? e.message : 'No se pudo preparar o abrir el reporte. Reintenta.' });
    } finally {
      if (archivo && !offered) { try { archivo.limpiar(); } catch { /* Own residue retried on reentry. */ } }
      archivo?.liberar?.();
      if (this.abort === abort) this.abort = undefined;
      this.working = false;
    }
  };
}
