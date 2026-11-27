export const REPORTES_CUOTA = { cantidad: 24, bytes: 8 * 1024 * 1024, archivo: 1024 * 1024, retencion: 7 * 86400000 } as const;
export type ResiduoReporte = { key: string; bytes: number; ofrecido: boolean; fecha: number | null };
export interface DiscoReportes {
  inventario(): ResiduoReporte[];
  escribir(key: string, nombre: string, bytes: Uint8Array): Promise<string>;
  marcar(key: string, fecha: number): void;
  borrar(key: string): void;
}
type Operacion = { key: string; sesion: object; bytes: number; writing: boolean; ofrecido: boolean; pending: boolean };
/** Credential-free storage boundary. Reservations happen synchronously before any write. */
export class ReportesTemporales {
  private sesion: { namespace: string } | null = null;
  private operaciones = new Map<string, Operacion>();
  constructor(private disco: DiscoReportes, private random: () => string, private now = Date.now) {}
  rotar() { this.sesion = null; this.limpiar(); }
  capturar() { return this.sesion ??= { namespace: this.random() }; }
  private actual(s: object) { if (s !== this.sesion) throw new Error('Sesión de reporte inválida'); }
  limpiar() {
    try {
      for (const r of this.disco.inventario()) {
        const op = this.operaciones.get(r.key);
        if (op?.writing || op?.pending) continue;
        if ((!r.ofrecido && (!op || op.sesion !== this.sesion)) || (r.ofrecido && r.fecha !== null && this.now() - r.fecha >= REPORTES_CUOTA.retencion)) {
          try { this.disco.borrar(r.key); this.operaciones.delete(r.key); } catch { /* Failed deletion never means reclaimed quota. */ }
        }
      }
    } catch { /* Subsequent reservation fails closed on inventory errors. */ }
  }
  async escribir(s: ReturnType<ReportesTemporales['capturar']>, nombre: string, bytes: Uint8Array) {
    this.actual(s); this.limpiar();
    const inventory = this.disco.inventario();
    let count = inventory.length, size = inventory.reduce((n, r) => {
      if (!Number.isSafeInteger(r.bytes) || r.bytes < 0) throw new Error('Inventario ilegible');
      return n + r.bytes;
    }, 0);
    for (const op of this.operaciones.values()) if (op.writing) {
      const onDisk = inventory.find(r => r.key === op.key);
      if (!onDisk) count++;
      size += Math.max(0, op.bytes - (onDisk?.bytes ?? 0));
    }
    if (bytes.length > REPORTES_CUOTA.archivo || count >= REPORTES_CUOTA.cantidad || size + bytes.length > REPORTES_CUOTA.bytes) throw new Error('CUOTA_REPORTES');
    const key = `${s.namespace}/op-${this.now()}-${this.random()}`;
    const op: Operacion = { key, sesion: s, bytes: bytes.length, writing: true, ofrecido: false, pending: false };
    this.operaciones.set(key, op);
    const limpiar = () => {
      if (op.writing || op.ofrecido) return;
      try { this.disco.borrar(key); } finally { this.operaciones.delete(key); }
    };
    try {
      const uri = await this.disco.escribir(key, nombre, bytes);
      op.writing = false; this.actual(s);
      return { uri, limpiar,
        marcarOfrecido: () => { this.actual(s); if (op.ofrecido) throw new Error('Reporte ya ofrecido'); },
        invocar: <T,>(fn: () => T) => {
          this.actual(s); if (op.ofrecido || this.operaciones.get(key) !== op) throw new Error('Reporte no reutilizable');
          this.disco.marcar(key, this.now());
          op.ofrecido = true; op.pending = true; return fn();
        },
        liberar: () => {
          op.pending = false;
          if (!op.ofrecido) { try { limpiar(); } catch { /* Retry on lifecycle. */ } }
          this.operaciones.delete(key); this.limpiar();
        },
      };
    } catch (error) {
      op.writing = false; try { limpiar(); } catch { /* Remains charged by disk inventory. */ } throw error;
    }
  }
}
