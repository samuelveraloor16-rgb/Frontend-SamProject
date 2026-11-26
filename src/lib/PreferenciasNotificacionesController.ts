import { ApiRequestError, esEscrituraIncierta, mensajeDeError } from '../api/client';
import { CANALES_PREFERENCIA, TIPOS_PREFERENCIA, type CambioPreferencia, type CanalPreferencia, type PreferenciaNotificacion, type PreferenciasNotificaciones, type TipoPreferencia } from '../api/preferenciasNotificaciones';
import type { SelloSesion } from '../auth/SessionController';

type Fase = 'inicial' | 'cargando' | 'error-carga' | 'listo' | 'guardando' | 'incierto' | 'consultando' | 'revisar';
type Snapshot = { fase: Fase; original: PreferenciaNotificacion[] | null; borrador: PreferenciaNotificacion[] | null; error: string | null; mensaje: string | null };
type Dependencies = {
  sello: SelloSesion; jwt: string;
  vigente: (sello: SelloSesion) => boolean;
  consultar: (jwt: string) => Promise<PreferenciasNotificaciones>;
  guardar: (cambios: CambioPreferencia[], jwt: string) => Promise<PreferenciasNotificaciones>;
  unauthorized: (sello: SelloSesion) => void;
};
const vacio = (): Snapshot => ({ fase: 'inicial', original: null, borrador: null, error: null, mensaje: null });
const INCIERTO = 'No pudimos confirmar si se guardaron las preferencias. La solicitud podría procesarse más tarde. Consulta el estado antes de decidir si vuelves a guardar.';

/** No inventa defaults ni acepta matrices incompletas como preferencias cargadas. */
export function validarMatriz(data: PreferenciasNotificaciones): PreferenciaNotificacion[] {
  if (!data || !Array.isArray(data.preferencias) || data.preferencias.length !== TIPOS_PREFERENCIA.length) throw new Error('Matriz incompleta');
  return TIPOS_PREFERENCIA.map(tipo => {
    const filas = data.preferencias.filter(f => f?.tipo === tipo);
    if (filas.length !== 1 || CANALES_PREFERENCIA.some(c => typeof filas[0][c] !== 'boolean') || (tipo === 'MENCION' && !filas[0].inApp)) throw new Error('Matriz inválida');
    const { inApp, correo, push } = filas[0];
    return { tipo, inApp, correo, push };
  });
}
export function cambiosPendientes(original: PreferenciaNotificacion[] | null, borrador: PreferenciaNotificacion[] | null): CambioPreferencia[] {
  if (!original || !borrador) return [];
  return borrador.flatMap(fila => {
    const anterior = original.find(f => f.tipo === fila.tipo);
    if (!anterior) return [];
    const cambio: CambioPreferencia = { tipo: fila.tipo };
    for (const canal of CANALES_PREFERENCIA) if (fila[canal] !== anterior[canal] && !(fila.tipo === 'MENCION' && canal === 'inApp')) cambio[canal] = fila[canal];
    return Object.keys(cambio).length > 1 ? [cambio] : [];
  });
}

/** Una instancia por montaje/sello. Sin caché persistente, retry ni escrituras solapadas. */
export class PreferenciasNotificacionesController {
  private snapshot = vacio();
  private readonly empty = vacio();
  private activo = true;
  private revision = 0;
  private listeners = new Set<() => void>();
  constructor(private readonly d: Dependencies) {}
  private vigente = () => this.activo && this.d.vigente(this.d.sello);
  getSnapshot = () => this.vigente() ? this.snapshot : this.empty;
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  activar = () => { this.activo = true; };
  private update(patch: Partial<Snapshot>) { this.snapshot = { ...this.snapshot, ...patch }; this.listeners.forEach(fn => fn()); }
  dispose = () => { this.activo = false; this.revision++; this.snapshot = vacio(); this.listeners.clear(); };
  editar = (tipo: TipoPreferencia, canal: CanalPreferencia, valor: boolean) => {
    if (!this.vigente() || this.snapshot.fase !== 'listo' || (tipo === 'MENCION' && canal === 'inApp')) return;
    this.update({ borrador: this.snapshot.borrador?.map(f => f.tipo === tipo ? { ...f, [canal]: valor } : f) ?? null, mensaje: null, error: null });
  };
  aceptarRevision = () => {
    if (this.vigente() && this.snapshot.fase === 'revisar') this.update({ fase: 'listo', mensaje: 'Puedes continuar. La solicitud anterior aún podría procesarse.', error: null });
  };
  private error(error: unknown) {
    if (error instanceof ApiRequestError && error.statusCode === 401 && this.vigente()) this.d.unauthorized(this.d.sello);
    return mensajeDeError(error, 'El servidor devolvió preferencias inesperadas. Reintenta la consulta.');
  }
  cargar = async () => {
    if (!this.vigente() || !['inicial', 'error-carga', 'incierto'].includes(this.snapshot.fase)) return;
    const confirmacion = this.snapshot.fase === 'incierto';
    const revision = ++this.revision;
    this.update({ fase: confirmacion ? 'consultando' : 'cargando', error: null, mensaje: null });
    try {
      const data = await this.d.consultar(this.d.jwt);
      if (!this.vigente() || revision !== this.revision) return;
      const matriz = validarMatriz(data);
      const pendientes = confirmacion ? cambiosPendientes(this.snapshot.original, this.snapshot.borrador) : [];
      const borrador = matriz.map(f => ({ ...f, ...pendientes.find(p => p.tipo === f.tipo) }));
      this.update({ original: matriz, borrador, fase: confirmacion ? 'revisar' : 'listo', mensaje: confirmacion ? 'Estado consultado. Conservamos tus cambios pendientes. Revisa los valores antes de continuar; la solicitud anterior aún podría procesarse más tarde.' : null });
    } catch (error) {
      if (this.vigente() && revision === this.revision) this.update({ fase: confirmacion ? 'incierto' : 'error-carga', error: this.error(error) });
    }
  };
  guardar = async () => {
    if (!this.vigente() || this.snapshot.fase !== 'listo') return;
    const cambios = cambiosPendientes(this.snapshot.original, this.snapshot.borrador);
    if (!cambios.length) { this.update({ mensaje: 'No hay cambios para guardar.' }); return; }
    const revision = ++this.revision;
    this.update({ fase: 'guardando', error: null, mensaje: null });
    try {
      const data = await this.d.guardar(cambios, this.d.jwt);
      if (!this.vigente() || revision !== this.revision) return;
      const matriz = validarMatriz(data);
      this.update({ fase: 'listo', original: matriz, borrador: matriz.map(f => ({ ...f })), mensaje: 'Preferencias guardadas.' });
    } catch (error) {
      if (!this.vigente() || revision !== this.revision) return;
      const mensaje = this.error(error);
      this.update({ fase: esEscrituraIncierta(error) ? 'incierto' : 'listo', error: esEscrituraIncierta(error) ? INCIERTO : mensaje });
    }
  };
}
