import { listarNotificaciones, marcarNotificacionLeida } from '../api/notificaciones';
import { ApiRequestError } from '../api/client';
import type { Notificacion, Proyecto } from '../api/types';
import { obtenerTarea } from '../api/tareas';
import { obtenerProyecto } from '../api/proyectos';

type Estado = {
  avisos: Notificacion[]; cargando: boolean; pagina: number; hayMas: boolean;
  error: string | null; marcando: string[];
  erroresMarca: Record<string, string>; mensaje: string | null;
  abriendo: string | null;
};
const inicial = (): Estado => ({ avisos: [], cargando: false, pagina: 0, hayMas: false,
  error: null, marcando: [], erroresMarca: {}, mensaje: null, abriendo: null });

// El contrato no prescribe UUID/CUID ni longitud para IDs de tarea/proyecto.
const tieneId = (id: unknown): id is string => typeof id === 'string' && id.trim().length > 0;

/** Estado efímero por montaje y sello de sesión; nunca reutiliza caché como autorización. */
export class NotificacionesController {
  private state = inicial();
  private listeners = new Set<() => void>();
  private revision = 0;
  constructor(private vigente: () => boolean) {}
  getSnapshot = () => this.state;
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  private update(value: Partial<Estado>) {
    this.state = { ...this.state, ...value }; this.listeners.forEach(fn => fn());
  }
  limpiar = () => { this.revision++; this.state = inicial(); this.listeners.forEach(fn => fn()); };
  async cargar(mas = false) {
    if (!this.vigente() || this.state.abriendo || this.state.cargando || this.state.marcando.length || (mas && !this.state.hayMas)) return;
    const revision = ++this.revision;
    const page = mas ? this.state.pagina + 1 : 1;
    this.update({ cargando: true, error: null, mensaje: null,
      ...(!mas ? { avisos: [], erroresMarca: {} } : {}) });
    try {
      const result = await listarNotificaciones({ page, pageSize: 20 });
      if (!this.vigente() || revision !== this.revision) return;
      const avisos = mas ? [...this.state.avisos, ...result.datos] : result.datos;
      this.update({ avisos: avisos.filter((n, i) => avisos.findIndex(a => a.id === n.id) === i),
        pagina: result.meta.pagina, hayMas: result.meta.pagina < result.meta.totalPaginas });
    } catch {
      if (!this.vigente() || revision !== this.revision) return;
      // Una consulta fallida no autoriza conservar páginas anteriores.
      this.update({ avisos: [], hayMas: false, pagina: 0,
        error: 'No se pudieron cargar las notificaciones. No se pudo verificar el acceso.' });
    } finally {
      if (this.vigente() && revision === this.revision) this.update({ cargando: false });
    }
  }
  async abrir(id: string, navegar: (tareaId: string, proyecto: Proyecto) => void) {
    if (!this.vigente() || this.state.abriendo || this.state.cargando || this.state.marcando.length) return;
    const aviso = this.state.avisos.find(n => n.id === id);
    if (!aviso) return;
    const tareaId = aviso.datos?.tareaId;
    if (aviso.tipo !== 'MENCION' || !tieneId(tareaId)) {
      this.update({ mensaje: 'Este aviso no permite abrir una tarea. Actualiza las notificaciones.' });
      return;
    }
    const revision = this.revision;
    const actual = () => this.vigente() && revision === this.revision;
    let navegado = false;
    this.update({ abriendo: id, mensaje: null });
    try {
      // Consultas frescas, sin caché ni IDs de ubicación antiguos como autorización.
      const tarea = await obtenerTarea(tareaId);
      if (!actual()) return;
      if (tarea.id !== tareaId || !tieneId(tarea.proyectoId)) throw new Error('Recurso inválido');
      const proyecto = await obtenerProyecto(tarea.proyectoId);
      if (!actual()) return;
      if (proyecto.id !== tarea.proyectoId || !tieneId(proyecto.espacioId) || typeof proyecto.archivado !== 'boolean') throw new Error('Recurso inválido');
      // El detalle existente aplica solo lectura para proyectos archivados.
      navegar(tarea.id, proyecto);
      navegado = true;
    } catch {
      if (!actual()) return;
      this.update({ avisos: this.state.avisos.filter(n => n.id !== id),
        mensaje: 'No se pudo abrir la tarea ni verificar el acceso. Actualiza las notificaciones para reintentar.' });
    } finally {
      if (actual() && !navegado) this.update({ abriendo: null });
    }
  }
  async marcar(id: string) {
    const aviso = this.state.avisos.find(n => n.id === id);
    if (!this.vigente() || this.state.abriendo || !aviso || aviso.leida || this.state.cargando || this.state.marcando.includes(id)) return;
    const revision = this.revision;
    this.update({ marcando: [...this.state.marcando, id], erroresMarca: { ...this.state.erroresMarca, [id]: '' }, mensaje: null });
    try {
      const result = await marcarNotificacionLeida(id);
      if (!this.vigente() || revision !== this.revision) return;
      this.update({ avisos: this.state.avisos.map(n => n.id === id ? result : n), mensaje: 'Aviso marcado como leído' });
    } catch (error) {
      if (!this.vigente() || revision !== this.revision) return;
      if (error instanceof ApiRequestError && [401, 403, 404].includes(error.statusCode)) {
        this.limpiar();
        this.update({ error: 'No se pudo verificar el acceso a las notificaciones' });
      } else {
        this.update({ erroresMarca: { ...this.state.erroresMarca, [id]: 'No se pudo marcar como leído' } });
      }
    } finally {
      if (this.vigente() && revision === this.revision) this.update({ marcando: this.state.marcando.filter(n => n !== id) });
    }
  }
}
