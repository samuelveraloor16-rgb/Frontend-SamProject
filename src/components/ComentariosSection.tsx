import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import {
  accesoComentariosDenegado,
  comentariosKey,
  comentariosLecturaOptions,
} from '../lib/comentariosLectura';
import { colors } from '../theme/colors';
import { ComentarioPublicacion } from './ComentarioPublicacion';
import { useAuth } from '../auth/AuthContext';
import { miembrosMencionablesKey } from '../lib/miembrosMencionables';

/** Historial, borrador y publicación RF-19 aislados por sesión. */
export function ComentariosSection({ tareaId, soloLectura }: {
  tareaId: string;
  soloLectura: boolean;
}) {
  const auth = useAuth();
  const sello = auth.capturarSesion();
  if (!sello) return null;
  const sesion = `${sello.usuarioId}:${sello.tokenVersion}:${sello.generation}`;
  return <ComentariosSesion key={`${tareaId}:${sesion}`} tareaId={tareaId} soloLectura={soloLectura}
    sesion={sesion} vigente={() => auth.esSesionActual(sello)} />;
}

function ComentariosSesion({ tareaId, soloLectura, sesion, vigente }: {
  tareaId: string; soloLectura: boolean; sesion: string; vigente: () => boolean;
}) {
  const client = useQueryClient();
  const [accesoPerdido, setAccesoPerdido] = useState(false);
  const query = useInfiniteQuery({
    ...comentariosLecturaOptions(tareaId, () => { if (vigente()) setAccesoPerdido(true); }, sesion),
    enabled: !accesoPerdido,
  });
  const denegado = accesoPerdido || accesoComentariosDenegado(query.error);

  useEffect(() => {
    if (!denegado) return;
    client.removeQueries({ queryKey: comentariosKey(tareaId, sesion), exact: true });
    client.removeQueries({ queryKey: miembrosMencionablesKey(tareaId, sesion) });
  }, [client, tareaId, sesion, denegado]);

  // Nunca presentar páginas antiguas durante revalidación o tras acceso denegado.
  const cargando = query.isPending || (query.isFetching && !query.isFetchingNextPage);
  const comentarios = denegado || cargando ? [] : query.data?.pages.flatMap(p => p.datos) ?? [];

  return (
    <View className="mt-5 border-t border-secondary pt-5">
      <Text accessibilityRole="header" className="text-[18px] font-semibold text-primary">
        Comentarios
      </Text>
      {soloLectura ? (
        <Text className="mt-2 text-[14px] leading-5 text-text">
          Proyecto archivado: comentarios de solo lectura
        </Text>
      ) : null}
      {denegado ? (
        <Text accessibilityLiveRegion="polite" className="mt-4 text-[14px] leading-5 text-text">
          Esta tarea ya no está disponible o no tienes acceso
        </Text>
      ) : cargando ? (
        <View className="mt-4 flex-row items-center gap-2" accessibilityLiveRegion="polite">
          <ActivityIndicator color={colors.primary} accessibilityLabel="Cargando comentarios" />
          <Text className="text-[14px] text-text">Cargando comentarios…</Text>
        </View>
      ) : (
        <>
          {!query.isError && comentarios.length === 0 ? (
            <Text className="mt-4 text-[14px] text-text">Aún no hay comentarios</Text>
          ) : null}
          {comentarios.map(comentario => (
            <View key={comentario.id} className="mt-4 border-b border-secondary pb-4">
              <Text className="text-[14px] font-semibold leading-5 text-text">
                {comentario.autor.nombre}
              </Text>
              <Text className="mt-1 text-[14px] leading-5 text-text">
                {new Date(comentario.creadoEn).toLocaleString('es')}
              </Text>
              <Text className="mt-2 text-[16px] leading-6 text-text">{comentario.texto}</Text>
            </View>
          ))}
          {query.isError ? (
            <View className="mt-4" accessibilityLiveRegion="polite">
              <Text className="text-[14px] leading-5 text-[#8C2F28]">
                No se pudieron cargar los comentarios
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Reintentar cargar comentarios"
                onPress={() => void (query.isFetchNextPageError ? query.fetchNextPage() : query.refetch())}
                className="mt-2 min-h-[44px] justify-center self-start px-4"
              >
                <Text className="text-[14px] font-semibold text-primary">Reintentar</Text>
              </Pressable>
            </View>
          ) : query.hasNextPage ? (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: query.isFetching, busy: query.isFetchingNextPage }}
              disabled={query.isFetching}
              onPress={() => { if (!query.isFetching) void query.fetchNextPage(); }}
              className="mt-4 min-h-[44px] justify-center self-start px-4"
            >
              <Text className="text-[14px] font-semibold text-primary">
                {query.isFetchingNextPage ? 'Cargando más comentarios…' : 'Cargar más comentarios'}
              </Text>
            </Pressable>
          ) : null}
        </>
      )}
      {!denegado ? <ComentarioPublicacion tareaId={tareaId} sesion={sesion} vigente={vigente}
        soloLectura={soloLectura} perderAcceso={() => setAccesoPerdido(true)} /> : null}
    </View>
  );
}
