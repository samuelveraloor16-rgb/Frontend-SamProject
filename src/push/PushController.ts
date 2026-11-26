import type { Dispositivo } from '../api/dispositivos';
import type { SelloSesion } from '../auth/SessionController';
import { parsePushPayload, type PushPayload } from './payload';
export type PushSession = SelloSesion & { jwt: string };
export type Binding = { usuarioId: string; id: string; pendiente: boolean };
type DeviceApi = {
  registrar(jwt: string, token: string, plataforma: Dispositivo['plataforma']): Promise<Dispositivo>;
  revocar(jwt: string, id: string): Promise<void>;
  codigo(jwt: string, id: string): Promise<{ codigo: string; expiraEn: string }>;
  transferir(jwt: string, codigo: string, token: string): Promise<Dispositivo>;
};
type Dependencies = {
  api: DeviceApi;
  token(ask: boolean): Promise<{ token: string; plataforma: Dispositivo['plataforma'] } | { motivo: string }>;
  load(): Promise<Binding[]>; save(bindings: Binding[]): Promise<void>;
  status(error: unknown): number | undefined;
  tarea(jwt: string, id: string): Promise<{ id: string; proyectoId: string }>;
  proyecto(jwt: string, id: string): Promise<{ id: string; espacioId: string }>;
};
/** Cola única para mutaciones: ninguna respuesta vieja desencadena DELETE fuera de ella. */
export class PushController {
  private session: PushSession | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private bindings: Binding[] = [];
  private loaded = false;
  private paused = false;
  private message = 'Las notificaciones no están activadas.';
  private listeners = new Set<() => void>();
  private seen = new Set<string>();
  private pendingTap: { data: PushPayload; generation: number | null } | null = null;
  private navigate: ((id: string) => void) | null = null;
  constructor(private d: Dependencies) {}
  subscribe = (f: () => void) => { this.listeners.add(f); return () => { this.listeners.delete(f); }; };
  getSnapshot = () => this.message;
  private say(message: string) { this.message = message; this.listeners.forEach(f => f()); }
  private serial<T>(f: () => Promise<T>): Promise<T> {
    const result = this.queue.then(f); this.queue = result.catch(() => {}); return result;
  }
  private current(s: PushSession) { return this.session?.generation === s.generation && this.session.jwt === s.jwt && this.session.usuarioId === s.usuarioId; }
  private async init() { if (!this.loaded) { this.bindings = await this.d.load(); this.loaded = true; } }
  private async persist() { await this.d.save(this.bindings); }
  setSession = (session: PushSession | null) => {
    if (session?.generation === this.session?.generation && session?.jwt === this.session?.jwt) return;
    const previous = this.session;
    this.session = session;
    if (session?.jwt !== previous?.jwt) this.paused = false;
    // Solo el tap frío durante restauración puede esperar la primera sesión validada.
    if (previous || !session) this.pendingTap = null;
    if (session) { void this.refresh(false); void this.flushTap(); }
    else this.say('Inicia sesión para gestionar notificaciones.');
  };
  refresh = (ask = true): Promise<void> => {
    const s = this.session;
    if (!s || (!ask && this.paused)) return Promise.resolve();
    if (ask) this.paused = false;
    return this.serial(async () => {
      try {
        await this.init();
        if (!this.current(s)) return;
        // Intenciones solo del dueño actual y ANTES de cualquier nuevo vínculo.
        for (const b of [...this.bindings].filter(b => b.usuarioId === s.usuarioId && b.pendiente)) {
          await this.remove(s, b);
          if (!this.current(s)) return;
        }
        const result = await this.d.token(ask);
        if (!this.current(s)) return;
        if ('motivo' in result) { this.say(result.motivo); return; }
        const device = await this.d.api.registrar(s.jwt, result.token, result.plataforma);
        // Conservar ID incluso si salió durante POST; beforeLogout está en la misma cola.
        const old = this.bindings.filter(b => b.usuarioId === s.usuarioId && b.id !== device.id);
        this.bindings = this.bindings.filter(b => b.usuarioId !== s.usuarioId);
        this.bindings.push({ usuarioId: s.usuarioId, id: device.id, pendiente: !this.current(s) }, ...old.map(b => ({ ...b, pendiente: true })));
        await this.persist();
        if (!this.current(s)) return;
        for (const b of old) { await this.remove(s, b); if (!this.current(s)) return; }
        this.say('Notificaciones activadas en este dispositivo.');
      } catch (error) {
        if (this.current(s)) this.say(this.d.status(error) === 409
          ? 'No se pudo registrar el dispositivo. La transferencia requiere un código y autorización de la cuenta propietaria.'
          : 'No se pudieron activar las notificaciones. Puedes reintentar; el resto de la app sigue disponible.');
      }
    });
  };
  private async remove(s: PushSession, b: Binding) {
    // Persistir intención ANTES del DELETE. No guardar JWT ni token push.
    this.bindings = this.bindings.map(x => x.id === b.id && x.usuarioId === b.usuarioId ? { ...x, pendiente: true } : x);
    await this.persist();
    try { await this.d.api.revocar(s.jwt, b.id); }
    catch (e) { if (this.d.status(e) !== 404) throw e; }
    this.bindings = this.bindings.filter(x => !(x.id === b.id && x.usuarioId === b.usuarioId));
    await this.persist();
  }
  beforeLogout = (): Promise<void> => {
    const s = this.session;
    this.setSession(null); // invalida taps/resultados inmediatamente
    if (!s) return Promise.resolve();
    return this.serial(async () => {
      try {
        await this.init();
        // Guardar TODAS las intenciones antes del primer I/O: un fallo no debe
        // dejar los vínculos posteriores sin marcar para el siguiente inicio.
        this.bindings = this.bindings.map(b => b.usuarioId === s.usuarioId ? { ...b, pendiente: true } : b);
        await this.persist();
        let failed = false;
        for (const b of [...this.bindings].filter(b => b.usuarioId === s.usuarioId)) {
          try { await this.remove(s, b); } catch { failed = true; }
        }
        if (failed) throw new Error('Revocación pendiente.');
      } catch {
        this.say('Revocación pendiente. Sin conexión pueden seguir llegando avisos; inicia sesión con la cuenta propietaria y reintenta.');
      }
    });
  };
  revoke = (id: string): Promise<void> => {
    const s = this.session;
    if (!s) return Promise.reject(new Error('Inicia sesión.'));
    return this.serial(async () => {
      await this.init(); if (!this.current(s)) return;
      if (this.bindings.some(b => b.id === id && b.usuarioId === s.usuarioId)) this.paused = true;
      const b = { usuarioId: s.usuarioId, id, pendiente: true };
      if (!this.bindings.some(x => x.id === id && x.usuarioId === s.usuarioId)) this.bindings.push(b);
      await this.remove(s, b);
      if (this.current(s)) this.say('Dispositivo revocado.');
    });
  };
  ownerCode = (id: string, consent: boolean) => {
    const s = this.session;
    if (!s || !consent) return Promise.reject(new Error('Se requiere autorización explícita del propietario.'));
    return this.serial(async () => {
      if (!this.current(s)) throw new Error('La sesión cambió.');
      const code = await this.d.api.codigo(s.jwt, id);
      if (!this.current(s)) throw new Error('La sesión cambió.');
      return code;
    });
  };
  transfer = (codigo: string, consent: boolean): Promise<void> => {
    const s = this.session;
    if (!s || !consent || !/^[A-Z2-9]{8}$/.test(codigo)) return Promise.reject(new Error('Se requiere código y consentimiento explícito.'));
    return this.serial(async () => {
      await this.init(); if (!this.current(s)) return;
      const result = await this.d.token(true);
      if ('motivo' in result) throw new Error(result.motivo);
      if (!this.current(s)) return;
      const device = await this.d.api.transferir(s.jwt, codigo, result.token);
      // La transferencia es explícita; nunca se llama como reacción a 409.
      this.bindings = this.bindings.filter(b => b.id !== device.id);
      this.bindings.push({ usuarioId: s.usuarioId, id: device.id, pendiente: !this.current(s) });
      await this.persist();
      if (this.current(s)) this.say('Dispositivo transferido a esta cuenta.');
    });
  };
  setNavigator = (navigate: ((id: string) => void) | null) => { this.navigate = navigate; if (navigate) void this.flushTap(); };
  discardTap = () => { this.pendingTap = null; };
  receive = async (data: unknown) => {
    const p = parsePushPayload(data), s = this.session;
    if (!p || !s) return;
    // No mostrar contenido recibido; únicamente aviso genérico tras autorización.
    if (await this.access(s, p) && this.current(s)) this.say('Hay una actualización en una tarea. Abre el aviso para consultarla.');
  };
  tap = (data: unknown, identifier: string, cold = false) => {
    const p = parsePushPayload(data);
    if (!p || this.seen.has(identifier)) return;
    this.seen.add(identifier); if (this.seen.size > 100) this.seen.delete(this.seen.values().next().value!);
    if (!this.session && !cold) return;
    this.pendingTap = { data: p, generation: this.session?.generation ?? null };
    void this.flushTap();
  };
  private async access(s: PushSession, p: PushPayload) {
    try {
      const task = await this.d.tarea(s.jwt, p.tareaId);
      if (!this.current(s) || task.id !== p.tareaId || task.proyectoId !== p.proyectoId) return false;
      const project = await this.d.proyecto(s.jwt, task.proyectoId);
      return this.current(s) && project.id === p.proyectoId && project.espacioId === p.espacioId;
    } catch { return false; }
  }
  private async flushTap() {
    const s = this.session, tap = this.pendingTap, navigate = this.navigate;
    if (!s || !tap || !navigate) return;
    this.pendingTap = null;
    if (tap.generation !== null && tap.generation !== s.generation) return;
    if (await this.access(s, tap.data) && this.current(s) && this.navigate === navigate) navigate(tap.data.tareaId);
    else if (this.current(s)) this.say('No se pudo abrir la tarea. Puede que ya no tengas acceso.');
  }
}
