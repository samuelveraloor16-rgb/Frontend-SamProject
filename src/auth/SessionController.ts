import type { Usuario } from '../api/types';

export type EstadoSesion = 'cargando' | 'borrando' | 'autenticado' | 'no-autenticado' | 'error-validacion' | 'error-borrado';
type Snapshot = { estado: EstadoSesion; usuario: Usuario | null; aviso: string | null; errorValidacion: string | null };
export type SelloSesion = { generation: number; tokenVersion: number; usuarioId: string };
export class AutenticacionEnCursoError extends Error {
  constructor() { super('Hay otra operación de acceso en curso. Espera a que termine.'); this.name = 'AutenticacionEnCursoError'; }
}
export class RegistroSinSesionError extends Error {
  constructor() { super('La cuenta se creó, pero no se inició sesión. Inicia sesión con esa cuenta.'); this.name = 'RegistroSinSesionError'; }
}
type Auth = { usuario: Usuario; accessToken: string };
type Dependencies = {
  clearToken: () => Promise<void>; saveToken: (token: string) => Promise<void>;
  loadToken: () => Promise<string | null>;
  getToken: () => string | null; getTokenVersion: () => number;
  perfil: () => Promise<Usuario>; logout: () => Promise<unknown>;
  login: (email: string, contrasena: string) => Promise<Auth>;
  registro: (nombre: string, email: string, contrasena: string) => Promise<Auth>;
  clearCache: () => void; status: (error: unknown) => number | undefined;
  storageCritical: (error: unknown) => boolean;
};

/** El JWT persistido se revalida antes de mostrar datos. */
export class SessionController {
  private snapshot: Snapshot = { estado: 'cargando', usuario: null, aviso: null, errorValidacion: null };
  private listeners = new Set<() => void>();
  private generation = 0;
  private cleanupRequired = true;
  private cleanupMessage: string | null = null;
  private cleaning = false;
  private logoutPending = false;
  private cleanupPurpose: 'inicio' | 'salida' = 'inicio';
  private authPending = false;
  private revalidationPending = false;
  private discardPendingAuth = false;
  private credentialOwner: string | null = null;
  private resetSerial = 0;
  private resets = new Map<number, { done: Promise<void>; finish: () => void }>();
  private bootstrapDone: Promise<void> | null = null;
  constructor(private readonly d: Dependencies) {}
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private update(patch: Partial<Snapshot>) {
    this.snapshot = { ...this.snapshot, ...patch };
    this.listeners.forEach(listener => listener());
  }
  private notificarRegistroSinSesion(): never {
    const error = new RegistroSinSesionError();
    this.cleanupMessage = [this.cleanupMessage, error.message].filter(Boolean).join(' ');
    this.update({ aviso: [this.snapshot.aviso, error.message].filter(Boolean).join(' ') });
    throw error;
  }
  private hide(estado: 'cargando' | 'borrando' = 'cargando') { this.d.clearCache(); this.update({ estado, usuario: null }); }

  bootstrap = (): Promise<void> => {
    if (this.bootstrapDone) return this.bootstrapDone;
    const operation = this.restore();
    this.bootstrapDone = operation;
    void operation.then(() => { if (this.bootstrapDone === operation) this.bootstrapDone = null; }, () => { if (this.bootstrapDone === operation) this.bootstrapDone = null; });
    return operation;
  };
  private restore = async () => {
    if (this.cleaning) return;
    this.cleaning = true;
    const current = ++this.generation;
    this.hide();
    try {
      await this.d.loadToken();
      if (current !== this.generation) return;
      this.cleanupRequired = false;
    } catch (error) {
      if (current === this.generation) {
        this.cleanupRequired = true;
        this.cleanupPurpose = 'inicio';
        this.update({ estado: 'error-borrado', errorValidacion: this.storageMessage(error, 'inicio') });
      }
      return;
    } finally { this.cleaning = false; }
    if (current === this.generation) await this.revalidar();
  };
  retryCleanup = async () => { if (this.cleanupRequired) { if (this.cleanupPurpose === 'inicio') await this.bootstrap(); else await this.cleanup(); } };
  private storageMessage(error: unknown, purpose: 'inicio' | 'salida'): string {
    const base = purpose === 'inicio'
      ? 'No se pudo comprobar o limpiar el almacenamiento seguro. No se ha restaurado ninguna sesión. Reintenta antes de continuar.'
      : 'No se pudo completar la limpieza del almacenamiento seguro. No se ha confirmado el cierre local. Reintenta antes de continuar.';
    return this.d.storageCritical(error)
      ? base + ' Aviso crítico: el dispositivo no pudo guardar el estado de cierre ni borrar la credencial. Si se reinicia, una sesión anterior podría volver a aparecer. No compartas el dispositivo; reintenta y cambia tu contraseña desde otro dispositivo para invalidar sesiones si no puedes completar el cierre.'
      : base;
  }
  private async cleanup() {
    if (this.cleaning) return;
    this.cleaning = true;
    const current = ++this.generation;
    this.credentialOwner = null;
    this.hide('borrando');
    try {
      await this.d.clearToken();
      if (current !== this.generation) return;
      this.cleanupRequired = false;
      if (!this.logoutPending) {
        this.update({ estado: 'no-autenticado', aviso: this.cleanupMessage ?? this.snapshot.aviso, errorValidacion: null });
        this.cleanupMessage = null;
      }
    } catch (error) {
      if (current === this.generation) {
        this.cleanupRequired = true;
        const message = this.storageMessage(error, this.cleanupPurpose) + (this.logoutPending ? ' El cierre en el servidor aún no se ha confirmado.' : '');
        this.update({ estado: 'error-borrado', errorValidacion: message });
      }
    } finally { this.cleaning = false; }
  }
  salirLocal = async (mensaje?: string) => {
    const boot = this.cleaning && this.cleanupPurpose === 'inicio' ? this.bootstrapDone : null;
    if (boot) ++this.generation;
    this.cleanupRequired = true;
    this.cleanupPurpose = 'salida';
    this.cleanupMessage = mensaje ?? null;
    if (boot) await boot;
    await this.cleanup();
  };
  cerrarSesion = async () => {
    if (this.cleanupRequired || this.cleaning || this.snapshot.estado !== 'autenticado') return;
    // Capturar el Bearer en fetch antes de dejar de utilizarlo en memoria.
    const remote = this.d.logout().then(() => true, error => this.d.status(error) === 401);
    this.logoutPending = true;
    this.cleanupRequired = true;
    this.cleanupPurpose = 'salida';
    this.cleanupMessage = null;
    const local = this.cleanup();
    const confirmed = await remote;
    await local;
    this.logoutPending = false;
    if (!confirmed) {
      this.cleanupMessage = [this.cleanupMessage, 'No se pudo confirmar el cierre en el servidor. Podría procesarse después y cerrar una sesión iniciada de nuevo.'].filter(Boolean).join(' ');
      if (this.cleanupRequired && this.getSnapshot().estado === 'error-borrado') this.update({ errorValidacion: (this.getSnapshot().errorValidacion ?? '') + ' No se pudo confirmar el cierre en el servidor; podría procesarse después.' });
    }
    if (!this.cleanupRequired && !this.cleaning) {
      this.update({ estado: 'no-autenticado', aviso: this.cleanupMessage, errorValidacion: null });
      this.cleanupMessage = null;
    }
  };
  unauthorized = () => { if (!this.cleanupRequired) void this.salirLocal('Tu sesión ya no es válida. Inicia sesión de nuevo.'); };
  iniciarReset = (): number => {
    const id = ++this.resetSerial;
    let finish!: () => void;
    const done = new Promise<void>(resolve => { finish = resolve; });
    this.resets.set(id, { done, finish });
    return id;
  };
  finalizarReset = async (id: number, resultado: 'exito' | 'incierto' | 'rechazado') => {
    const reset = this.resets.get(id);
    if (!reset) return;
    // Marcar la revalidación antes de desbloquear cualquier autenticación.
    const validation = resultado === 'rechazado' ? Promise.resolve() : this.revalidarTrasReset(resultado === 'incierto');
    this.resets.delete(id);
    reset.finish();
    await validation;
  };
  private async esperarResets(): Promise<void> {
    while (this.resets.size) await Promise.all([...this.resets.values()].map(reset => reset.done));
  }
  revalidarTrasReset = async (incierto: boolean) => {
    if (incierto && this.authPending) this.discardPendingAuth = true;
    await this.revalidar();
  };
  revalidar = async () => {
    if (this.authPending) { this.revalidationPending = true; return; }
    if (this.cleanupRequired || this.cleaning) return;
    const current = ++this.generation;
    this.hide();
    if (!this.d.getToken()) { this.update({ estado: 'no-autenticado' }); return; }
    const version = this.d.getTokenVersion();
    try {
      const usuario = await this.d.perfil();
      if (current === this.generation && version === this.d.getTokenVersion()) {
        this.credentialOwner = usuario.id;
        this.update({ estado: 'autenticado', usuario, errorValidacion: null });
      }
    } catch (error) {
      if (current !== this.generation || version !== this.d.getTokenVersion()) return;
      if (this.d.status(error) === 401) await this.salirLocal('Tu sesión ya no es válida. Inicia sesión de nuevo.');
      else this.update({ estado: 'error-validacion', errorValidacion: this.d.status(error) === 0 ? 'No se pudo comprobar tu sesión. Revisa tu conexión.' : 'No se pudo comprobar tu sesión. Inténtalo de nuevo.' });
    }
  };
  private async authenticate(request: () => Promise<Auth>, registro = false) {
    if (this.authPending) throw new AutenticacionEnCursoError();
    if (this.cleanupRequired || this.cleaning || this.snapshot.estado !== 'no-autenticado') throw new AutenticacionEnCursoError();
    this.authPending = true;
    const current = ++this.generation;
    let registroCreado = false;
    try {
      const auth = await request();
      registroCreado = registro;
      await this.esperarResets();
      if (current !== this.generation || this.cleanupRequired) {
        if (registro) this.notificarRegistroSinSesion();
        return;
      }
      if (this.discardPendingAuth) {
        this.update({ aviso: registro ? 'La cuenta se creó, pero no se inició sesión. No se pudo confirmar el restablecimiento; inicia sesión de nuevo.' : 'No se pudo confirmar el restablecimiento. Inicia sesión de nuevo.' });
        return;
      }
      try { await this.d.saveToken(auth.accessToken); }
      catch (error) {
        if (current !== this.generation) { if (registro) this.notificarRegistroSinSesion(); return; }
        this.cleanupRequired = true; this.cleanupPurpose = 'salida';
        if (registro) this.cleanupMessage = 'La cuenta se creó, pero no se inició sesión. Inicia sesión cuando se resuelva el almacenamiento.';
        this.d.clearCache();
        this.update({ estado: 'error-borrado', usuario: null, errorValidacion: this.storageMessage(error, 'salida') + (registro ? ' La cuenta se creó, pero no se inició sesión.' : ' No se inició sesión.') });
        return;
      }
      await this.esperarResets();
      if (current !== this.generation || this.cleanupRequired) {
        if (registro) this.notificarRegistroSinSesion();
        return;
      }
      if (this.discardPendingAuth) {
        await this.salirLocal(registro ? 'La cuenta se creó, pero no se inició sesión. No se pudo confirmar el restablecimiento; inicia sesión de nuevo.' : 'No se pudo confirmar el restablecimiento. Inicia sesión de nuevo.');
        return;
      }
      this.credentialOwner = auth.usuario.id;
      this.d.clearCache();
      if (!this.revalidationPending) this.update({ estado: 'autenticado', usuario: auth.usuario, aviso: null });
    } finally {
      this.authPending = false;
      this.discardPendingAuth = false;
      if (this.revalidationPending) {
        this.revalidationPending = false;
        await this.revalidar();
        if (registroCreado && this.getSnapshot().estado !== 'autenticado') {
          this.update({ aviso: 'La cuenta se creó. Comprueba tu sesión o inicia sesión de nuevo.' });
        }
      }
    }
  }
  iniciarSesion = (email: string, contrasena: string) => this.authenticate(() => this.d.login(email.trim().toLowerCase(), contrasena));
  registrarse = (nombre: string, email: string, contrasena: string) => this.authenticate(() => this.d.registro(nombre.trim(), email.trim().toLowerCase(), contrasena), true);
  capturarSesion = (): SelloSesion | null => this.snapshot.estado === 'autenticado' && this.snapshot.usuario && this.d.getToken()
    ? { generation: this.generation, tokenVersion: this.d.getTokenVersion(), usuarioId: this.snapshot.usuario.id } : null;
  credencialActual = (): { usuarioId: string; tokenVersion: number } | null =>
    !this.cleanupRequired && !!this.d.getToken() && this.credentialOwner
      ? { usuarioId: this.credentialOwner, tokenVersion: this.d.getTokenVersion() } : null;
  esSesionActual = (sello: SelloSesion | null): boolean => !!sello && this.snapshot.estado === 'autenticado' && this.generation === sello.generation && this.d.getTokenVersion() === sello.tokenVersion && this.snapshot.usuario?.id === sello.usuarioId;
  esCredencialActual = (sello: SelloSesion | null): boolean => !!sello && !this.cleanupRequired && !this.cleaning && !!this.d.getToken() && this.d.getTokenVersion() === sello.tokenVersion && this.credentialOwner === sello.usuarioId;
  actualizarUsuario = (usuario: Usuario, sello: SelloSesion | null) => { if (this.esSesionActual(sello) && usuario.id === sello?.usuarioId) this.update({ usuario }); };
  salirLocalSiSesionActual = async (sello: SelloSesion | null, aviso: string) => { if (this.esCredencialActual(sello)) await this.salirLocal(aviso); };
  limpiarAviso = () => this.update({ aviso: null });
}
