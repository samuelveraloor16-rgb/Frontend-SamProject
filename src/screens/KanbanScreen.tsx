import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRoute, type RouteProp } from '@react-navigation/native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  runOnJS,
  type SharedValue,
} from 'react-native-reanimated';
import { listarBandeja, listarEspacios } from '../api/espacios';
import { listarTareasProyecto, cambiarEstadoTarea } from '../api/tareas';
import { obtenerProyecto } from '../api/proyectos';
import { mensajeDeError } from '../api/client';
import { formatFechaLimite } from '../lib/format';
import { colors } from '../theme/colors';
import type { RootStackParamList } from '../navigation/types';
import type { EstadoTarea, Tarea } from '../api/types';
import { ScreenHeader } from '../components/ScreenHeader';
import { PrioridadBadge } from '../components/PrioridadBadge';

type Ruta = RouteProp<RootStackParamList, 'Kanban'>;

const COLUMNAS: { clave: EstadoTarea; titulo: string; punto: string }[] = [
  { clave: 'PENDIENTE', titulo: 'Pendiente', punto: '#8A968E' },
  { clave: 'EN_CURSO', titulo: 'En curso', punto: '#D5C78E' },
  { clave: 'HECHA', titulo: 'Hecha', punto: '#245B4A' },
];

const PAD = 12;
const GAP = 10;
const ALTO_CARD = 108;

/**
 * Tablero Kanban (RF-17): tres columnas por estado.
 * Arrastrar (mantener pulsado) una tarjeta a otra columna persiste el cambio
 * con `PATCH /tareas/:id/estado`. El reorden fino dentro de una columna no
 * tiene endpoint en el contrato (PATCH /tareas/:id no acepta orden), así que
 * se conserva el orden estable que devuelve el backend.
 */
export function KanbanScreen() {
  const route = useRoute<Ruta>();
  const params = route.params ?? {};
  const modo: 'proyecto' | 'bandeja' = params.proyectoId ? 'proyecto' : 'bandeja';
  const proyectoId = params.proyectoId;
  const espacioId = params.espacioId;
  const queryClient = useQueryClient();
  const { width } = useWindowDimensions();

  const colW = (width - PAD * 2 - GAP * 2) / 3;
  const cardW = colW - 12;

  const [dragTask, setDragTask] = useState<{ tarea: Tarea; origen: EstadoTarea } | null>(null);
  const [destinoActivo, setDestinoActivo] = useState<EstadoTarea | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const dragX = useSharedValue(0);
  const dragY = useSharedValue(0);
  const destinoRef = useRef<EstadoTarea | null>(null);
  const dragTaskRef = useRef(dragTask);
  const [override, setOverride] = useState<{
    stamp: number;
    cols: Record<EstadoTarea, Tarea[]>;
  } | null>(null);

  const tareasQuery = useQuery({
    queryKey: ['tareas', modo === 'proyecto' ? `proyecto:${proyectoId}` : `bandeja:${espacioId}`, { kanban: true }],
    enabled: modo === 'proyecto' ? !!proyectoId : !!espacioId,
    queryFn: () =>
      modo === 'proyecto'
        ? listarTareasProyecto(proyectoId!, { pageSize: 100 })
        : listarBandeja(espacioId!, { pageSize: 100 }),
  });

  const bandejaProyectoId =
    modo === 'bandeja' ? tareasQuery.data?.meta.proyectoId : undefined;
  const detalleQuery = useQuery({
    queryKey: modo === 'proyecto' ? ['proyecto', proyectoId] : ['proyecto-bandeja', bandejaProyectoId],
    enabled: modo === 'proyecto' ? !!proyectoId : !!bandejaProyectoId,
    queryFn: () => obtenerProyecto((modo === 'proyecto' ? proyectoId : bandejaProyectoId)!),
  });
  const proyecto = detalleQuery.data ?? null;
  const archivado = proyecto?.archivado === true;

  const espaciosQuery = useQuery({
    queryKey: ['espacios'],
    queryFn: listarEspacios,
    enabled: modo === 'bandeja',
  });
  const nombreEspacio =
    modo === 'bandeja'
      ? espaciosQuery.data?.datos.find((e) => e.id === espacioId)?.nombre
      : undefined;

  useEffect(() => {
    dragTaskRef.current = dragTask;
  }, [dragTask]);

  // Agrupa por estado (tareas raíz; las subtareas se distinguen por tareaPadreId y se ocultan aquí).
  const dataUpdatedAt = tareasQuery.dataUpdatedAt;
  const grouped = useMemo<Record<EstadoTarea, Tarea[]>>(() => {
    const raiz = (tareasQuery.data?.datos ?? []).filter((t) => t.tareaPadreId === null);
    return {
      PENDIENTE: raiz.filter((t) => t.estado === 'PENDIENTE'),
      EN_CURSO: raiz.filter((t) => t.estado === 'EN_CURSO'),
      HECHA: raiz.filter((t) => t.estado === 'HECHA'),
    };
  }, [tareasQuery.data]);
  // Override local hasta que la recarga del servidor confirme el cambio.
  const columns = override && override.stamp === dataUpdatedAt ? override.cols : grouped;

  const cambiarEstado = useMutation({
    mutationFn: ({ id, estado }: { id: string; estado: EstadoTarea }) =>
      cambiarEstadoTarea(id, estado),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['tareas'] });
      void queryClient.invalidateQueries({ queryKey: ['progreso'] });
      void queryClient.invalidateQueries({ queryKey: ['proyectos'] });
      void queryClient.invalidateQueries({ queryKey: ['bandeja-total'] });
    },
    onError: (error) => {
      setErrorMsg(mensajeDeError(error));
      setOverride(null); // revertir al estado del servidor
      void tareasQuery.refetch();
    },
  });

  const columnaEnX = useCallback(
    (absX: number): EstadoTarea => {
      for (let i = 0; i < COLUMNAS.length; i++) {
        const colX = PAD + i * (colW + GAP);
        if (absX >= colX && absX < colX + colW) return COLUMNAS[i].clave;
      }
      return absX < PAD ? 'PENDIENTE' : 'HECHA';
    },
    [colW],
  );

  const fijarDestino = useCallback((destino: EstadoTarea | null) => {
    destinoRef.current = destino;
    setDestinoActivo(destino);
  }, []);

  const iniciarArrastre = useCallback(
    (tarea: Tarea, origen: EstadoTarea, x: number, y: number) => {
       
      dragX.value = x;
       
      dragY.value = y;
      setErrorMsg(null);
      const nuevo = { tarea, origen };
      dragTaskRef.current = nuevo;
      setDragTask(nuevo);
      fijarDestino(origen);
    },
    // dragX/dragY son SharedValues estables; se omiten a propósito.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fijarDestino],
  );

  const moverArrastre = useCallback(
    (x: number, y: number) => {
      // eslint-disable-next-line react-hooks/immutability -- patrón oficial de reanimated (SharedValue.value)
      dragX.value = x;
      // eslint-disable-next-line react-hooks/immutability -- patrón oficial de reanimated (SharedValue.value)
      dragY.value = y;
      const destino = columnaEnX(x);
      if (destinoRef.current !== destino) fijarDestino(destino);
    },
    // dragX/dragY son SharedValues estables; se omiten a propósito.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [columnaEnX, fijarDestino],
  );

  const finalizarArrastre = useCallback(
    (x: number) => {
      const actual = dragTaskRef.current;
      dragTaskRef.current = null; // idempotente: onEnd y onFinalize disparan a la vez
      setDragTask(null);
      fijarDestino(null);
      if (!actual || Number.isNaN(x)) return;
      const destino = columnaEnX(x);
      if (destino === actual.origen) return;
      setOverride({
        stamp: dataUpdatedAt,
        cols: {
          ...columns,
          [actual.origen]: columns[actual.origen].filter((t) => t.id !== actual.tarea.id),
          [destino]: [...columns[destino], { ...actual.tarea, estado: destino }],
        },
      });
      cambiarEstado.mutate({ id: actual.tarea.id, estado: destino });
    },
    [columnaEnX, cambiarEstado, fijarDestino, columns, dataUpdatedAt],
  );

  const titulo = modo === 'bandeja' ? 'Kanban · Bandeja' : `Kanban · ${proyecto?.nombre ?? 'Proyecto'}`;
  const subtitulo = archivado
    ? 'Proyecto archivado: solo lectura'
    : modo === 'bandeja' && nombreEspacio
      ? `${nombreEspacio} · mantén pulsada una tarjeta y arrástrala`
      : 'Mantén pulsada una tarjeta y arrástrala a otra columna';

  return (
    <View className="flex-1 bg-background">
      <ScreenHeader titulo={titulo} subtitulo={subtitulo} />

      {tareasQuery.isLoading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : tareasQuery.isError ? (
        <View className="m-4 rounded-2xl border border-[#E5B8B3] bg-[#FAE8E6] px-5 py-5">
          <Text className="text-[14px] leading-5 text-[#8C2F28]">
            No pudimos cargar las tareas. {mensajeDeError(tareasQuery.error)}
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => void tareasQuery.refetch()}
            className="mt-3 self-start rounded-full border border-[#8C2F28] px-4 py-2"
          >
            <Text className="text-[13px] font-semibold text-[#8C2F28]">Reintentar</Text>
          </Pressable>
        </View>
      ) : (
        <View className="flex-1 flex-row px-3 pt-3" style={{ gap: GAP }}>
          {COLUMNAS.map((col) => {
            const tareas = columns[col.clave];
            const resaltada = destinoActivo === col.clave;
            return (
              <View
                key={col.clave}
                style={{ width: colW }}
                className={`flex-1 rounded-2xl border ${
                  resaltada ? 'border-primary bg-secondary' : 'border-secondary bg-[#EFF3EE]'
                }`}
              >
                <View className="flex-row items-center gap-1.5 border-b border-secondary px-2 py-2">
                  <View className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: col.punto }} />
                  <Text numberOfLines={1} className="flex-1 text-[12px] font-bold text-text">
                    {col.titulo}
                  </Text>
                  <Text className="text-[12px] font-semibold text-text opacity-60">{tareas.length}</Text>
                </View>
                <ScrollView
                  scrollEnabled={!dragTask}
                  contentContainerStyle={{ padding: 6, paddingBottom: 24 }}
                  showsVerticalScrollIndicator={false}
                >
                  {tareas.map((tarea) =>
                    dragTask?.tarea.id === tarea.id ? (
                      <VistaPlaceholder key={tarea.id} alto={ALTO_CARD} />
                    ) : (
                      <TarjetaArrastrable
                        key={tarea.id}
                        tarea={tarea}
                        origen={col.clave}
                        ancho={cardW}
                        deshabilitada={archivado || cambiarEstado.isPending}
                        onIniciar={iniciarArrastre}
                        onMover={moverArrastre}
                        onFinalizar={finalizarArrastre}
                      />
                    ),
                  )}
                  {tareas.length === 0 ? (
                    <Text className="px-2 py-6 text-center text-[11px] leading-4 text-text opacity-50">
                      Sin tareas
                    </Text>
                  ) : null}
                </ScrollView>
              </View>
            );
          })}
        </View>
      )}

      {/* Aviso de error flotante */}
      {errorMsg ? (
        <View className="absolute bottom-6 left-4 right-4 flex-row items-start gap-2 rounded-xl border border-[#E5B8B3] bg-[#FAE8E6] px-4 py-3">
          <Ionicons name="alert-circle-outline" size={18} color="#8C2F28" />
          <Text className="flex-1 text-[13px] leading-5 text-[#8C2F28]">{errorMsg}</Text>
          <Pressable accessibilityLabel="Cerrar aviso" onPress={() => setErrorMsg(null)} hitSlop={8}>
            <Ionicons name="close" size={18} color="#8C2F28" />
          </Pressable>
        </View>
      ) : null}

      {/* Tarjeta flotante mientras se arrastra */}
      {dragTask ? <TarjetaFlotante tarea={dragTask.tarea} ancho={cardW} x={dragX} y={dragY} /> : null}
    </View>
  );
}

function VistaPlaceholder({ alto }: { alto: number }) {
  return (
    <View
      style={{ height: alto }}
      className="mb-2 rounded-xl border border-dashed border-primary opacity-40"
    />
  );
}

type TarjetaArrastrableProps = {
  tarea: Tarea;
  origen: EstadoTarea;
  ancho: number;
  deshabilitada: boolean;
  onIniciar: (tarea: Tarea, origen: EstadoTarea, x: number, y: number) => void;
  onMover: (x: number, y: number) => void;
  onFinalizar: (x: number) => void;
};

/** Tarjeta con gesto de arrastre (mantener pulsado). La posición absoluta viaja al overlay. */
function TarjetaArrastrable({
  tarea,
  origen,
  ancho,
  deshabilitada,
  onIniciar,
  onMover,
  onFinalizar,
}: TarjetaArrastrableProps) {
  const pan = Gesture.Pan()
    .activateAfterLongPress(220)
    .enabled(!deshabilitada)
    .onStart((e) => {
      runOnJS(onIniciar)(tarea, origen, e.absoluteX, e.absoluteY);
    })
    .onUpdate((e) => {
      runOnJS(onMover)(e.absoluteX, e.absoluteY);
    })
    .onEnd((e) => {
      runOnJS(onFinalizar)(e.absoluteX);
    })
    .onFinalize(() => {
      // Si el gesto se cancela sin terminar, devolver el estado.
      runOnJS(onFinalizar)(Number.NaN);
    });

  return (
    <GestureDetector gesture={pan}>
      <View style={{ width: ancho, height: ALTO_CARD }} className="mb-2">
        <ContenidoTarjeta tarea={tarea} />
      </View>
    </GestureDetector>
  );
}

function TarjetaFlotante({
  tarea,
  ancho,
  x,
  y,
}: {
  tarea: Tarea;
  ancho: number;
  x: SharedValue<number>;
  y: SharedValue<number>;
}) {
  const estilo = useAnimatedStyle(() => ({
    left: x.value - ancho / 2,
    top: y.value - ALTO_CARD / 2,
    transform: [{ scale: 1.04 }],
  }));
  return (
    <Animated.View
      pointerEvents="none"
      style={[{ position: 'absolute', width: ancho, height: ALTO_CARD, zIndex: 50 }, estilo]}
    >
      <ContenidoTarjeta tarea={tarea} flotante />
    </Animated.View>
  );
}

function ContenidoTarjeta({ tarea, flotante = false }: { tarea: Tarea; flotante?: boolean }) {
  return (
    <View
      className={`flex-1 rounded-xl border bg-white px-2.5 py-2 ${
        flotante
          ? 'border-primary shadow-lg'
          : tarea.vencida
            ? 'border-[#E5B8B3]'
            : 'border-secondary'
      }`}
      style={
        flotante
          ? { shadowColor: '#245B4A', shadowOpacity: 0.35, shadowRadius: 10, elevation: 8 }
          : undefined
      }
    >
      <PrioridadBadge prioridad={tarea.prioridad} />
      <Text numberOfLines={2} className="mt-1 flex-1 text-[12px] font-semibold leading-4 text-text">
        {tarea.titulo}
      </Text>
      <View className="flex-row items-center justify-between">
        <View className="flex-row items-center gap-1">
          {tarea.fechaLimite ? (
            <>
              <Ionicons
                name="calendar-outline"
                size={11}
                color={tarea.vencida ? '#B3261E' : '#5A6660'}
              />
              <Text
                className={`text-[10px] ${tarea.vencida ? 'font-bold text-[#B3261E]' : 'text-text opacity-70'}`}
              >
                {formatFechaLimite(tarea.fechaLimite)}
              </Text>
            </>
          ) : (
            <Text className="text-[10px] text-text opacity-40">Sin fecha</Text>
          )}
        </View>
        {tarea.responsable ? (
          <View className="h-5 w-5 items-center justify-center rounded-full bg-secondary">
            <Text className="text-[9px] font-bold text-primary">
              {iniciales(tarea.responsable.nombre)}
            </Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}

function iniciales(nombre: string): string {
  const partes = nombre.trim().split(/\s+/);
  const a = partes[0]?.[0] ?? '';
  const b = partes.length > 1 ? partes[partes.length - 1][0] : '';
  return (a + b).toUpperCase();
}
