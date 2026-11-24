import { ApiRequestError, esEscrituraIncierta, mensajeDeError } from '../api/client';
import type { Usuario } from '../api/types';
import type { SelloSesion } from './SessionController';

type Credencial = { usuarioId: string; tokenVersion: number };
type FasePerfil = 'sin-perfil' | 'listo' | 'guardando' | 'incierto' | 'consultando' | 'revisar';
type Snapshot = {
  fase: FasePerfil; nombre: string; foto: string; originalNombre: string; originalFoto: string;
  mensaje: string | null; error: string | null; contrasenaPendiente: boolean; errorContrasena: string | null;
};
type Dependencies = {
  credencial: () => Credencial | null;
  sello: () => SelloSesion | null;
  credencialVigente: (sello: SelloSesion) => boolean;
  actualizarUsuario: (usuario: Usuario, sello: SelloSesion) => void;
  guardar: (input: { nombre?: string; fotoUrl?: string | null }) => Promise<Usuario>;
  consultar: () => Promise<Usuario>;
  cambiar: (actual: string, nueva: string) => Promise<unknown>;
  salir: (sello: SelloSesion, mensaje: string) => Promise<void>;
};

const vacio = (): Snapshot => ({ fase: 'sin-perfil', nombre: '', foto: '', originalNombre: '', originalFoto: '', mensaje: null, error: null, contrasenaPendiente: false, errorContrasena: null });

/** Solo memoria y por credencial: nunca conserva contraseñas en el estado. */
export class ProfileWriteCoordinator {
  private scope: Credencial | null = null;
  private revision = 0;
  private snapshot = vacio();
  private readonly snapshotVacio = vacio();
  private listeners = new Set<() => void>();
  constructor(private readonly d: Dependencies) {}
  getSnapshot = () => {
    const actual = this.d.credencial();
    return this.scope?.usuarioId === actual?.usuarioId && this.scope?.tokenVersion === actual?.tokenVersion
      ? this.snapshot : this.snapshotVacio;
  };
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private update(patch: Partial<Snapshot>) { this.snapshot = { ...this.snapshot, ...patch }; this.listeners.forEach(fn => fn()); }
  sincronizar = () => {
    const next = this.d.credencial();
    if (this.scope?.usuarioId === next?.usuarioId && this.scope?.tokenVersion === next?.tokenVersion) return;
    this.scope = next; this.revision++; this.snapshot = vacio(); this.listeners.forEach(fn => fn());
  };
  private vigente(revision: number, sello: SelloSesion) { return revision === this.revision && this.d.credencialVigente(sello); }
  adoptar = (perfil: Usuario) => {
    this.sincronizar();
    if (!this.scope || perfil.id !== this.scope.usuarioId || this.snapshot.fase !== 'sin-perfil') return;
    this.update({ fase: 'listo', nombre: perfil.nombre, foto: perfil.fotoUrl ?? '', originalNombre: perfil.nombre, originalFoto: perfil.fotoUrl ?? '' });
  };
  editarNombre = (nombre: string) => { this.sincronizar(); if (this.scope) this.update({ nombre, mensaje: null }); };
  editarFoto = (foto: string) => { this.sincronizar(); if (this.scope) this.update({ foto, mensaje: null }); };
  quitarFoto = () => { this.sincronizar(); if (this.scope) this.update({ foto: '', mensaje: 'La foto se quitará al guardar.' }); };
  aceptarRevision = () => { if (this.snapshot.fase === 'revisar') this.update({ fase: 'listo', error: null, mensaje: 'Puedes volver a guardar. La solicitud anterior aún podría procesarse.' }); };
  limpiarErrorContrasena = () => { if (this.snapshot.errorContrasena) this.update({ errorContrasena: null }); };

  guardar = async () => {
    this.sincronizar();
    const sello = this.d.sello(); if (!sello || this.snapshot.fase !== 'listo') return;
    const nombre = this.snapshot.nombre.trim(), foto = this.snapshot.foto.trim();
    const input: { nombre?: string; fotoUrl?: string | null } = {};
    if (nombre !== this.snapshot.originalNombre) input.nombre = nombre;
    if (foto !== this.snapshot.originalFoto) input.fotoUrl = foto || null;
    if (!Object.keys(input).length) { this.update({ mensaje: 'No hay cambios para guardar.' }); return; }
    const revision = this.revision;
    this.update({ fase: 'guardando', error: null, mensaje: null });
    try {
      const perfil = await this.d.guardar(input);
      if (!this.vigente(revision, sello)) return;
      if (!perfil || perfil.id !== sello.usuarioId || typeof perfil.nombre !== 'string') { this.update({ fase: 'incierto', error: 'No pudimos confirmar si se guardaron los cambios. Consulta el perfil antes de decidir si vuelves a guardar.' }); return; }
      this.d.actualizarUsuario(perfil, sello);
      this.update({ fase: 'listo', nombre: perfil.nombre, foto: perfil.fotoUrl ?? '', originalNombre: perfil.nombre, originalFoto: perfil.fotoUrl ?? '', mensaje: 'Cambios guardados.' });
    } catch (error) {
      if (!this.vigente(revision, sello)) return;
      if (esEscrituraIncierta(error)) this.update({ fase: 'incierto', error: 'No pudimos confirmar si se guardaron los cambios. El servidor podría procesarlos más tarde. Consulta el perfil antes de decidir si vuelves a guardar.' });
      else this.update({ fase: 'listo', error: mensajeDeError(error) });
    }
  };
  consultar = async () => {
    this.sincronizar();
    const sello = this.d.sello(); if (!sello || this.snapshot.fase !== 'incierto') return;
    const revision = this.revision;
    this.update({ fase: 'consultando', error: null });
    try {
      const perfil = await this.d.consultar();
      if (!this.vigente(revision, sello)) return;
      if (!perfil || perfil.id !== sello.usuarioId || typeof perfil.nombre !== 'string') { this.update({ fase: 'incierto', error: 'No se pudo comprobar el perfil. Reintenta la consulta.' }); return; }
      this.d.actualizarUsuario(perfil, sello);
      this.update({ fase: 'revisar', originalNombre: perfil.nombre, originalFoto: perfil.fotoUrl ?? '', mensaje: 'Perfil consultado. La solicitud anterior aún podría procesarse más tarde. Revisa el borrador antes de decidir si vuelves a guardar.' });
    } catch (error) {
      if (this.vigente(revision, sello)) this.update({ fase: 'incierto', error: mensajeDeError(error, 'No se pudo consultar el perfil. Reintenta la consulta.') });
    }
  };
  cambiarContrasena = async (actual: string, nueva: string) => {
    this.sincronizar();
    const sello = this.d.sello(); if (!sello || this.snapshot.contrasenaPendiente) return;
    const revision = this.revision;
    this.update({ contrasenaPendiente: true, errorContrasena: null });
    try {
      await this.d.cambiar(actual, nueva);
      if (this.vigente(revision, sello)) await this.d.salir(sello, 'Contraseña actualizada. Inicia sesión nuevamente.');
    } catch (error) {
      if (!this.vigente(revision, sello)) return;
      if (esEscrituraIncierta(error)) await this.d.salir(sello, 'No pudimos confirmar si se actualizó la contraseña; el servidor podría procesarla más tarde. Inicia sesión de nuevo para comprobarlo.');
      else this.update({ errorContrasena: error instanceof ApiRequestError && error.statusCode === 400 && error.mensajes.some(m => m.includes('actual no es correcta')) ? 'La contraseña actual no es correcta.' : error instanceof ApiRequestError && error.statusCode === 429 ? 'Demasiados intentos. Espera un minuto e inténtalo de nuevo.' : 'No se pudo cambiar la contraseña. Revisa los datos e inténtalo de nuevo.' });
    } finally {
      if (this.vigente(revision, sello)) this.update({ contrasenaPendiente: false });
    }
  };
}
