import { ApiRequestError, mensajeDeError } from '../api/client';
import { validarMetricas, type MetricasProyecto } from '../api/metricas';
import type { Proyecto } from '../api/types';
import type { SelloSesion } from '../auth/SessionController';

type Snapshot = {
  fase: 'inicial' | 'cargando' | 'listo' | 'error' | 'sin-acceso';
  metricas: MetricasProyecto | null; proyecto: { nombre: string; archivado: boolean } | null; error: string | null;
};
type Dependencies = {
  proyectoId: string; sello: SelloSesion; jwt: string;
  vigente: (sello: SelloSesion) => boolean;
  metricas: (id: string, jwt: string) => Promise<MetricasProyecto>;
  proyecto: (id: string, jwt: string) => Promise<Proyecto>;
  unauthorized: (sello: SelloSesion) => void;
};
const vacio = (): Snapshot => ({ fase: 'inicial', metricas: null, proyecto: null, error: null });

/** Instancia local por proyecto+sello, sin snapshots compartidos ni reintentos automáticos. */
export class PanelProyectoController {
  private snapshot = vacio();
  private readonly empty = vacio();
  private activo = true;
  private revision = 0;
  private listeners = new Set<() => void>();
  constructor(private readonly d: Dependencies) {}
  private vigente = () => this.activo && this.d.vigente(this.d.sello);
  getSnapshot = () => this.vigente() ? this.snapshot : this.empty;
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  private update(snapshot: Snapshot) { this.snapshot = snapshot; this.listeners.forEach(fn => fn()); }
  activar = () => { this.activo = true; };
  suspender = () => { this.activo = false; this.revision++; this.update(vacio()); };
  dispose = () => { this.suspender(); this.listeners.clear(); };
  cargar = async () => {
    if (!this.vigente() || this.snapshot.fase === 'cargando') return;
    const revision = ++this.revision;
    this.update({ ...vacio(), fase: 'cargando' });
    try {
      const [raw, proyecto] = await Promise.all([
        this.d.metricas(this.d.proyectoId, this.d.jwt), this.d.proyecto(this.d.proyectoId, this.d.jwt),
      ]);
      if (!this.vigente() || revision !== this.revision) return;
      const metricas = validarMetricas(raw, this.d.proyectoId);
      if (!proyecto || proyecto.id !== this.d.proyectoId || typeof proyecto.nombre !== 'string' || typeof proyecto.archivado !== 'boolean') throw new Error('Proyecto inválido');
      this.update({ fase: 'listo', metricas, proyecto: { nombre: proyecto.nombre, archivado: proyecto.archivado }, error: null });
    } catch (error) {
      if (!this.vigente() || revision !== this.revision) return;
      const status = error instanceof ApiRequestError ? error.statusCode : undefined;
      if (status === 401) this.d.unauthorized(this.d.sello);
      this.update({ ...vacio(), fase: status === 404 || status === 403 ? 'sin-acceso' : 'error',
        error: status === 404 || status === 403 ? 'Proyecto no disponible. Puede que ya no tengas acceso.' : mensajeDeError(error, 'No pudimos cargar el panel. Reintenta la consulta.') });
    }
  };
}
