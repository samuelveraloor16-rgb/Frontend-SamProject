/**
 * Coordinador de intención de publicación de comentarios (RF-19 móvil).
 * Patrón reutilizado de ProfileWriteCoordinator: estado solo en memoria,
 * snapshot + suscriptores, sin persistencia ni SecureStore.
 *
 * Contrato: CONTRATO_API.md v1.3 §8.3 y §8.5.
 * - Cada intención es inmutable {tareaId, texto EXACTO, clave} con clave
 *   generada UNA sola vez y conservada hasta la confirmación definitiva.
 * - Un solo envío en vuelo; guardas síncronas contra doble toque.
 * - Resultado incierto (red/timeout/408/5xx/respuesta perdida) → fase
 *   «incierto» con la MISMA intención: sin regenerar clave, sin reintento
 *   automático y sin publicación optimista.
 * - Reintento solo por acción explícita del llamador (reintentar) con la
 *   intención idéntica; `Idempotency-Replayed` true = confirmación de la MISMA
 *   intención, false = creación nueva (ambos confirman).
 * - 400/404/409 u otros errores definitivos → liberar intención y reportar,
 *   sin reintento automático (409 = conflicto «Clave reutilizada con otra
 *   petición»). Validaciones fallidas no consumen la clave en el servidor (§8.5).
 *
 * Límite de alcance: la intención NO se persiste; un reinicio de la app la
 * pierde. Tampoco ofrece descarte de una intención incierta (tras 24 h debe
 * verificarse la situación antes de iniciar otra publicación, §8.5).
 */
import { ApiRequestError, esEscrituraIncierta, mensajeDeError } from '../api/client';
import type { CrearComentarioResponse } from '../api/comentarios';
import type { Comentario } from '../api/types';
import { CLAVE_IDEMPOTENCIA_RE } from './menciones';

export type IntencionPublicacion = Readonly<{ tareaId: string; texto: string; clave: string }>;

export type FasePublicacion = 'inactivo' | 'publicando' | 'incierto' | 'confirmado' | 'error';

export type SnapshotPublicacion = {
  fase: FasePublicacion;
  /** NULL tras confirmar o tras error definitivo; conservada mientras haya duda. */
  intencion: IntencionPublicacion | null;
  /** Solo tras confirmación del servidor. */
  mensaje: string | null;
  error: string | null;
  /** Cabecera Idempotency-Replayed; null si el servidor no la expuso (no se presume). */
  replayed: boolean | null;
  comentario: Comentario | null;
};

export type DependenciasPublicacion = {
  /** Se invoca UNA sola vez por intención; nunca en un reintento. */
  generarClave?: () => string;
  crear: (tareaId: string, texto: string, clave: string) => Promise<CrearComentarioResponse>;
};

const CARACTERES_CLAVE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';

/** §8.5: 1–128 ASCII [A-Za-z0-9_-] con suficiente aleatoriedad. */
export function generarClaveIdempotencia(): string {
  const cripto = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  const uuid = cripto?.randomUUID?.();
  if (uuid) return uuid;
  let clave = `int_${Date.now().toString(36)}`;
  while (clave.length < 36) clave += CARACTERES_CLAVE[Math.floor(Math.random() * CARACTERES_CLAVE.length)];
  return clave.slice(0, 128);
}

const MENSAJE_INCIERTO = 'No pudimos confirmar la publicación. El servidor podría procesarla; puedes reintentar la misma publicación.';
const MENSAJE_CONFIRMADO = 'Comentario publicado.';
const MENSAJE_FALLIDO = 'No se pudo publicar el comentario. Inténtalo de nuevo.';

const snapshotVacio = (): SnapshotPublicacion => ({
  fase: 'inactivo', intencion: null, mensaje: null, error: null, replayed: null, comentario: null,
});

export class ComentarioWriteCoordinator {
  private snapshot: SnapshotPublicacion = snapshotVacio();
  private readonly listeners = new Set<() => void>();

  constructor(private readonly d: DependenciasPublicacion) {}

  getSnapshot = (): SnapshotPublicacion => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  private update(patch: Partial<SnapshotPublicacion>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.listeners) listener();
  }

  /**
   * Nueva intención. Guarda síncrona: mientras haya envío en vuelo o una
   * intención incierta se ignora (el llamador debe usar reintentar()).
   */
  publicar = (tareaId: string, texto: string): Promise<void> => {
    if (this.snapshot.fase === 'publicando' || this.snapshot.fase === 'incierto') return Promise.resolve();
    const generarClave = this.d.generarClave ?? generarClaveIdempotencia;
    const clave = generarClave();
    if (typeof clave !== 'string' || !CLAVE_IDEMPOTENCIA_RE.test(clave)) {
      this.update({ ...snapshotVacio(), fase: 'error', error: 'Clave de idempotencia inválida.' });
      return Promise.resolve();
    }
    const intencion: IntencionPublicacion = Object.freeze({ tareaId, texto, clave });
    this.update({ ...snapshotVacio(), fase: 'publicando', intencion });
    return this.enviar();
  };

  /** Reintento EXPLÍCITO con la misma clave, tarea y texto. Solo desde «incierto». */
  reintentar = (): Promise<void> => {
    if (this.snapshot.fase !== 'incierto' || !this.snapshot.intencion) return Promise.resolve();
    this.update({ fase: 'publicando', mensaje: null, error: null });
    return this.enviar();
  };

  /** Descarta resultado/error ya definitivos. Nunca descarta una intención incierta. */
  reiniciar = (): void => {
    if (this.snapshot.fase === 'confirmado' || this.snapshot.fase === 'error') this.update(snapshotVacio());
  };

  private mensajeDefinitivo(error: unknown): string {
    if (error instanceof ApiRequestError && error.statusCode === 409) {
      return 'Clave reutilizada con otra petición. No se publicó el comentario; revisa el borrador antes de iniciar otra publicación.';
    }
    return mensajeDeError(error, MENSAJE_FALLIDO);
  }

  private async enviar(): Promise<void> {
    const intencion = this.snapshot.intencion;
    if (!intencion || this.snapshot.fase !== 'publicando') return;
    try {
      const respuesta = await this.d.crear(intencion.tareaId, intencion.texto, intencion.clave);
      // Respuesta tardía o de otra intención: se ignora (no aplica al estado actual).
      if (this.snapshot.fase !== 'publicando' || this.snapshot.intencion?.clave !== intencion.clave) return;
      if (!respuesta || typeof respuesta.comentario?.id !== 'string') {
        this.update({ fase: 'incierto', error: MENSAJE_INCIERTO });
        return;
      }
      this.update({
        fase: 'confirmado',
        intencion: null,
        mensaje: MENSAJE_CONFIRMADO,
        error: null,
        replayed: typeof respuesta.idempotencyReplayed === 'boolean' ? respuesta.idempotencyReplayed : null,
        comentario: respuesta.comentario,
      });
    } catch (error) {
      if (this.snapshot.fase !== 'publicando' || this.snapshot.intencion?.clave !== intencion.clave) return;
      if (esEscrituraIncierta(error)) {
        this.update({ fase: 'incierto', error: MENSAJE_INCIERTO });
        return;
      }
      // Error definitivo: liberar intención (clave no consumida en validaciones) sin reintento.
      this.update({ ...snapshotVacio(), fase: 'error', error: this.mensajeDefinitivo(error) });
    }
  }
}
