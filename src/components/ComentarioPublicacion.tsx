import { useLayoutEffect, useState, useSyncExternalStore } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { crearComentario } from '../api/comentarios';
import { accesoComentariosDenegado, comentariosKey } from '../lib/comentariosLectura';
import { ComentarioWriteCoordinator } from '../lib/ComentarioWriteCoordinator';
import { validarTextoComentario } from '../lib/menciones';
import { ComentarioBorrador } from './ComentarioBorrador';

/** Guardas imperativas para callbacks tardíos y eventos previos al render. */
class ContextoPublicacion {
  activo = true;
  revision = 0;
  procesado: object | null = null;
  constructor(public vigente: () => boolean, public perderAcceso: () => void, public soloLectura: boolean) {}
  actualizar(vigente: () => boolean, perderAcceso: () => void, soloLectura: boolean) {
    this.vigente = vigente; this.perderAcceso = perderAcceso; this.soloLectura = soloLectura;
  }
  activar() { this.activo = true; }
  desactivar() { this.activo = false; }
  confirmar(comentario: object) { this.procesado = comentario; this.revision += 1; }
}

/** Una instancia por tarea y sesión. No persiste intenciones ni reintenta sola. */
export function ComentarioPublicacion({ tareaId, sesion, vigente, perderAcceso, soloLectura }: {
  tareaId: string; sesion: string; vigente: () => boolean;
  perderAcceso: () => void; soloLectura: boolean;
}) {
  const client = useQueryClient();
  const [contexto] = useState(() => new ContextoPublicacion(vigente, perderAcceso, soloLectura));
  useLayoutEffect(() => { contexto.actualizar(vigente, perderAcceso, soloLectura); }, [contexto, vigente, perderAcceso, soloLectura]);
  const [coordinador] = useState(() => new ComentarioWriteCoordinator({
    crear: async (id, texto, clave) => {
      try { return await crearComentario(id, { texto }, clave); }
      catch (error) {
        if (contexto.activo && contexto.vigente() && accesoComentariosDenegado(error)) contexto.perderAcceso();
        throw error;
      }
    },
  }));
  const snapshot = useSyncExternalStore(coordinador.subscribe, coordinador.getSnapshot, coordinador.getSnapshot);
  const [revision, setRevision] = useState(0);
  const [confirmado, setConfirmado] = useState<object | null>(null);
  useLayoutEffect(() => { contexto.activar(); return () => { contexto.desactivar(); }; }, [contexto]);
  useLayoutEffect(() => coordinador.subscribe(() => {
    const resultado = coordinador.getSnapshot();
    if (resultado.fase !== 'confirmado' || !resultado.comentario || contexto.procesado === resultado.comentario) return;
    if (!contexto.activo || !contexto.vigente()) return;
    contexto.confirmar(resultado.comentario);
    // Se reemplaza el borrador bloqueado confirmado; no se inserta una copia local.
    setRevision(contexto.revision);
    setConfirmado(resultado.comentario);
    void client.invalidateQueries({ queryKey: comentariosKey(tareaId, sesion), exact: true });
  }), [coordinador, client, tareaId, sesion, contexto]);
  const bloqueado = soloLectura || snapshot.fase === 'publicando' || snapshot.fase === 'incierto' ||
    (snapshot.fase === 'confirmado' && confirmado !== snapshot.comentario);
  const puedeEditar = () => {
    const estado = coordinador.getSnapshot();
    return revision === contexto.revision && contexto.activo && contexto.vigente() && !contexto.soloLectura &&
      estado.fase !== 'publicando' && estado.fase !== 'incierto' &&
      (estado.fase !== 'confirmado' || contexto.procesado === estado.comentario);
  };
  const publicar = (texto: string) => {
    if (!puedeEditar() || validarTextoComentario(texto)) return;
    void coordinador.publicar(tareaId, texto);
  };
  const mostrarBorrador = !soloLectura || snapshot.fase === 'publicando' || snapshot.fase === 'incierto';
  return <View>
    {mostrarBorrador ? <ComentarioBorrador key={revision} tareaId={tareaId} sesion={sesion} perderAcceso={perderAcceso}
      publicacion={{ bloqueado, puedeEditar, publicar }} /> : null}
    {snapshot.fase === 'publicando' ? <Text accessibilityLiveRegion="polite" className="mt-2 text-text">Publicando comentario…</Text> : null}
    {snapshot.error || snapshot.mensaje ? <Text accessibilityLiveRegion="polite" className="mt-2 text-[14px] leading-5 text-text">{snapshot.error ?? snapshot.mensaje}</Text> : null}
    {snapshot.fase === 'incierto' ? <View className="mt-2 gap-2">
      <Text className="text-[14px] leading-5 text-text">El texto, la tarea y la clave se conservan solo en memoria. Si abandonas esta pantalla, cierras o reinicias la app, perderás esta intención y publicar otra vez podría duplicar el comentario. No edites ni inicies otra publicación; reintenta únicamente esta misma intención. Después de 24 horas, verifica la situación antes de volver a publicar.</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Reintentar la misma publicación"
        className="min-h-[44px] justify-center px-4"
        onPress={() => { if (contexto.activo && contexto.vigente()) void coordinador.reintentar(); }}>
        <Text className="text-[16px] font-semibold text-primary">Reintentar la misma publicación</Text>
      </Pressable>
    </View> : null}
  </View>;
}
