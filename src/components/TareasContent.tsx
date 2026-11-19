import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { listarBandeja, listarEspacios } from '../api/espacios';
import { listarTareasProyecto, cambiarEstadoTarea } from '../api/tareas';
import { obtenerProyecto } from '../api/proyectos';
import { mensajeDeError } from '../api/client';
import { colors } from '../theme/colors';
import type { RootStackParamList } from '../navigation/types';
import type { EstadoTarea, PrioridadTarea, TareaFiltros } from '../api/types';
import { ScreenHeader } from './ScreenHeader';
import { TareaItem } from './TareaItem';
import { EmptyState } from './EmptyState';
import { PickerModal } from './PickerModal';
import { TareaFab } from './TareaFab';
import { PRIORIDAD_ORDEN } from './PrioridadBadge';

export type TareasContentProps = {
  modo: 'proyecto' | 'bandeja';
  proyectoId?: string;
  espacioId?: string;
  /** true en la pestaña principal (sin botón atrás). */
  sinAtras?: boolean;
};

type Nav = NativeStackNavigationProp<RootStackParamList>;
type OrdenValor = 'creadoEn' | 'fechaLimite' | 'prioridad';

const ESTADO_OPCIONES = [
  { valor: 'PENDIENTE' as const, etiqueta: 'Pendiente' },
  { valor: 'EN_CURSO' as const, etiqueta: 'En curso' },
  { valor: 'HECHA' as const, etiqueta: 'Hecha' },
];

const ORDEN_OPCIONES: { valor: OrdenValor; etiqueta: string; detalle: string }[] = [
  { valor: 'creadoEn', etiqueta: 'Fecha de creación', detalle: 'Lo más reciente primero' },
  { valor: 'fechaLimite', etiqueta: 'Fecha límite', detalle: 'La más próxima primero (sin fecha al final)' },
  { valor: 'prioridad', etiqueta: 'Prioridad', detalle: 'De la más alta a la más baja' },
];

/**
 * Lista de tareas con filtros (RF-16): estado, prioridad, responsable,
 * búsqueda, vencidas y orden. En modo «bandeja» consume la Bandeja del
 * espacio (§5); en modo «proyecto», el listado del proyecto (§4).
 * El orden y el estado se persisten en el backend; la app no calcula nada.
 */
export function TareasContent({ modo, proyectoId, espacioId, sinAtras = false }: TareasContentProps) {
  const navigation = useNavigation<Nav>();
  const queryClient = useQueryClient();

  const [estado, setEstado] = useState<EstadoTarea | undefined>();
  const [prioridad, setPrioridad] = useState<PrioridadTarea | undefined>();
  const [responsableId, setResponsableId] = useState<string | undefined>();
  const [vencidas, setVencidas] = useState(false);
  const [qInput, setQInput] = useState('');
  const [q, setQ] = useState('');
  const [orden, setOrden] = useState<OrdenValor>('creadoEn');
  const [direccion, setDireccion] = useState<'asc' | 'desc'>('desc');

  const [picker, setPicker] = useState<'estado' | 'prioridad' | 'responsable' | 'orden' | null>(null);

  // Búsqueda con debounce para no lanzar una petición por tecla.
  useEffect(() => {
    const t = setTimeout(() => setQ(qInput.trim()), 350);
    return () => clearTimeout(t);
  }, [qInput]);

  // Al cambiar de criterio de orden, la dirección por defecto acompaña (contrato §4).
  const cambiarOrden = (valor: OrdenValor | undefined) => {
    if (!valor) return;
    setOrden(valor);
    setDireccion(valor === 'fechaLimite' ? 'asc' : 'desc');
  };

  const filtros: TareaFiltros = useMemo(
    () => ({
      estado,
      prioridad,
      responsableId,
      q: q || undefined,
      vencidas: vencidas || undefined,
      orden,
      direccion,
    }),
    [estado, prioridad, responsableId, q, vencidas, orden, direccion],
  );

  const scopeKey = modo === 'proyecto' ? `proyecto:${proyectoId}` : `bandeja:${espacioId}`;

  const tareasQuery = useInfiniteQuery({
    queryKey: ['tareas', scopeKey, filtros],
    enabled: modo === 'proyecto' ? !!proyectoId : !!espacioId,
    initialPageParam: 1,
    queryFn: ({ pageParam }) =>
      modo === 'proyecto'
        ? listarTareasProyecto(proyectoId!, { ...filtros, page: pageParam, pageSize: 20 })
        : listarBandeja(espacioId!, { ...filtros, page: pageParam, pageSize: 20 }),
    getNextPageParam: (last) =>
      last.meta.pagina < last.meta.totalPaginas ? last.meta.pagina + 1 : undefined,
  });

  const tareas = useMemo(
    () => tareasQuery.data?.pages.flatMap((p) => p.datos) ?? [],
    [tareasQuery.data],
  );
  const total = tareasQuery.data?.pages[0]?.meta.total;
  const bandejaProyectoId =
    modo === 'bandeja' ? tareasQuery.data?.pages[0]?.meta.proyectoId : undefined;

  // Detalle de proyecto: nombre para el encabezado, miembros para el filtro de responsable.
  const detalleQuery = useQuery({
    queryKey: modo === 'proyecto' ? ['proyecto', proyectoId] : ['proyecto-bandeja', bandejaProyectoId],
    enabled: modo === 'proyecto' ? !!proyectoId : !!bandejaProyectoId,
    queryFn: () => obtenerProyecto((modo === 'proyecto' ? proyectoId : bandejaProyectoId)!),
  });
  const proyecto = detalleQuery.data ?? null;
  const miembros = proyecto?.miembros ?? [];
  const espacioIdDelProyecto = modo === 'proyecto' ? proyecto?.espacioId : espacioId;

  const espaciosQuery = useQuery({
    queryKey: ['espacios'],
    queryFn: listarEspacios,
    enabled: modo === 'bandeja',
  });
  const nombreEspacio =
    modo === 'bandeja'
      ? espaciosQuery.data?.datos.find((e) => e.id === espacioId)?.nombre
      : undefined;

  const cambiarEstado = useMutation({
    mutationFn: ({ id, siguiente }: { id: string; siguiente: EstadoTarea }) =>
      cambiarEstadoTarea(id, siguiente),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['tareas'] });
      void queryClient.invalidateQueries({ queryKey: ['progreso'] });
      void queryClient.invalidateQueries({ queryKey: ['proyectos'] });
      void queryClient.invalidateQueries({ queryKey: ['bandeja-total'] });
    },
  });

  const hayFiltros =
    estado !== undefined ||
    prioridad !== undefined ||
    responsableId !== undefined ||
    vencidas ||
    q !== '' ||
    orden !== 'creadoEn' ||
    direccion !== 'desc';

  const limpiarFiltros = () => {
    setEstado(undefined);
    setPrioridad(undefined);
    setResponsableId(undefined);
    setVencidas(false);
    setQInput('');
    setQ('');
    setOrden('creadoEn');
    setDireccion('desc');
  };

  const responsableSeleccionado = miembros.find((m) => m.id === responsableId);
  const titulo = modo === 'bandeja' ? 'Bandeja de entrada' : proyecto?.nombre ?? 'Tareas';
  const subtitulo =
    modo === 'bandeja'
      ? nombreEspacio ?? 'Tareas rápidas sin proyecto'
      : proyecto
        ? `Progreso del backend: ${Math.round(proyecto.progreso)}% · ${proyecto.miembros.length} ${proyecto.miembros.length === 1 ? 'miembro' : 'miembros'}`
        : undefined;

  return (
    <View className="flex-1 bg-background">
      <ScreenHeader
        titulo={titulo}
        subtitulo={subtitulo}
        sinAtras={sinAtras}
        derecha={
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Ver tablero Kanban"
            hitSlop={8}
            onPress={() =>
              navigation.navigate(
                'Kanban',
                modo === 'proyecto' ? { proyectoId } : { bandeja: true, espacioId },
              )
            }
            className="flex-row items-center gap-1.5 rounded-full border border-primary px-3 py-2 active:bg-secondary"
          >
            <Ionicons name="grid-outline" size={18} color={colors.primary} />
            <Text className="text-[13px] font-semibold text-primary">Kanban</Text>
          </Pressable>
        }
      />

      {/* Buscador */}
      <View className="border-b border-secondary px-4 pb-2 pt-3">
        <View className="flex-row items-center gap-2 rounded-xl border border-secondary bg-white px-3">
          <Ionicons name="search-outline" size={18} color="#5A6660" />
          <TextInput
            accessibilityLabel="Buscar tareas"
            value={qInput}
            onChangeText={setQInput}
            placeholder="Buscar en título y descripción…"
            placeholderTextColor="#8A968E"
            autoCorrect={false}
            className="min-h-[44px] flex-1 text-[15px] text-text"
          />
          {qInput.length > 0 ? (
            <Pressable
              accessibilityLabel="Borrar búsqueda"
              hitSlop={8}
              onPress={() => setQInput('')}
            >
              <Ionicons name="close-circle" size={20} color="#8A968E" />
            </Pressable>
          ) : null}
        </View>

        {/* Fila de filtros */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 8, paddingVertical: 10 }}
        >
          <ChipFiltro
            icono="flag-outline"
            etiqueta={estado ? ESTADO_OPCIONES.find((o) => o.valor === estado)?.etiqueta ?? 'Estado' : 'Estado'}
            activo={estado !== undefined}
            onPress={() => setPicker('estado')}
          />
          <ChipFiltro
            icono="alert-circle-outline"
            etiqueta={
              prioridad
                ? { BAJA: 'Baja', MEDIA: 'Media', ALTA: 'Alta', URGENTE: 'Urgente' }[prioridad]
                : 'Prioridad'
            }
            activo={prioridad !== undefined}
            onPress={() => setPicker('prioridad')}
          />
          <ChipFiltro
            icono="person-outline"
            etiqueta={responsableSeleccionado?.nombre ?? 'Responsable'}
            activo={responsableId !== undefined}
            onPress={() => setPicker('responsable')}
          />
          <ChipFiltro
            icono="alarm-outline"
            etiqueta="Vencidas"
            activo={vencidas}
            onPress={() => setVencidas((v) => !v)}
          />
          <ChipFiltro
            icono="swap-vertical-outline"
            etiqueta={`Orden: ${ORDEN_OPCIONES.find((o) => o.valor === orden)?.etiqueta}`}
            activo={orden !== 'creadoEn' || direccion !== 'desc'}
            onPress={() => setPicker('orden')}
          />
          {hayFiltros ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Limpiar filtros"
              onPress={limpiarFiltros}
              className="flex-row items-center gap-1 self-center rounded-full px-3 py-1.5 active:bg-secondary"
            >
              <Ionicons name="close" size={16} color={colors.primary} />
              <Text className="text-[13px] font-semibold text-primary">Limpiar</Text>
            </Pressable>
          ) : null}
        </ScrollView>
      </View>

      {/* Lista */}
      <FlatList
        data={tareas}
        keyExtractor={(t) => t.id}
        contentContainerStyle={{ padding: 16, paddingBottom: 110 }}
        refreshControl={
          <RefreshControl
            refreshing={tareasQuery.isRefetching && !tareasQuery.isFetchingNextPage}
            onRefresh={() => void tareasQuery.refetch()}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        }
        ListHeaderComponent={
          total !== undefined ? (
            <Text className="mb-2 text-[12px] text-text opacity-60">
              {total} {total === 1 ? 'tarea' : 'tareas'}
              {hayFiltros ? ' con los filtros actuales' : ''}
            </Text>
          ) : undefined
        }
        ListEmptyComponent={
          tareasQuery.isLoading ? (
            <View className="items-center py-12">
              <ActivityIndicator color={colors.primary} />
            </View>
          ) : tareasQuery.isError ? (
            <View className="rounded-2xl border border-[#E5B8B3] bg-[#FAE8E6] px-5 py-5">
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
            <EmptyState
              icono="checkbox-outline"
              titulo={hayFiltros ? 'Nada coincide con esos filtros' : 'Sin tareas aquí'}
              detalle={
                hayFiltros
                  ? 'Prueba a quitar algún filtro o a cambiar la búsqueda.'
                  : 'Toca el botón + para crear tu primera tarea rápida.'
              }
              accion={
                hayFiltros ? (
                  <Pressable
                    accessibilityRole="button"
                    onPress={limpiarFiltros}
                    className="rounded-xl border border-primary px-5 py-2.5"
                  >
                    <Text className="text-[14px] font-semibold text-primary">Limpiar filtros</Text>
                  </Pressable>
                ) : undefined
              }
            />
          )
        }
        renderItem={({ item }) => (
          <TareaItem
            tarea={item}
            onCambiarEstado={(tarea, siguiente) =>
              cambiarEstado.mutate({ id: tarea.id, siguiente })
            }
            onAbrir={() => navigation.navigate('TareaDetalle', { tareaId: item.id })}
          />
        )}
        ListFooterComponent={
          tareasQuery.hasNextPage ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => void tareasQuery.fetchNextPage()}
              disabled={tareasQuery.isFetchingNextPage}
              className="mt-2 items-center rounded-xl border border-secondary bg-white py-3 active:bg-secondary"
            >
              {tareasQuery.isFetchingNextPage ? (
                <ActivityIndicator color={colors.primary} />
              ) : (
                <Text className="text-[14px] font-semibold text-primary">Cargar más</Text>
              )}
            </Pressable>
          ) : undefined
        }
      />

      {/* Cambiar estado fallido: aviso flotante */}
      {cambiarEstado.isError ? (
        <View className="absolute bottom-24 left-4 right-4 rounded-xl border border-[#E5B8B3] bg-[#FAE8E6] px-4 py-3">
          <Text className="text-[13px] leading-5 text-[#8C2F28]">
            {mensajeDeError(cambiarEstado.error)}
          </Text>
        </View>
      ) : null}

      <TareaFab onPress={() => navigation.navigate('TareaRapida', { espacioId: espacioIdDelProyecto })} />

      {/* Selectores */}
      <PickerModal<EstadoTarea>
        visible={picker === 'estado'}
        titulo="Estado"
        opciones={ESTADO_OPCIONES}
        valor={estado}
        onSeleccionar={setEstado}
        onCerrar={() => setPicker(null)}
        limpiarEtiqueta="Todos"
      />
      <PickerModal<PrioridadTarea>
        visible={picker === 'prioridad'}
        titulo="Prioridad"
        opciones={PRIORIDAD_ORDEN.map((p) => ({
          valor: p,
          etiqueta: { BAJA: 'Baja', MEDIA: 'Media', ALTA: 'Alta', URGENTE: 'Urgente' }[p],
        }))}
        valor={prioridad}
        onSeleccionar={setPrioridad}
        onCerrar={() => setPicker(null)}
        limpiarEtiqueta="Todas"
      />
      <PickerModal<string>
        visible={picker === 'responsable'}
        titulo="Responsable"
        opciones={miembros.map((m) => ({ valor: m.id, etiqueta: m.nombre, detalle: m.email }))}
        valor={responsableId}
        onSeleccionar={setResponsableId}
        onCerrar={() => setPicker(null)}
        limpiarEtiqueta={miembros.length === 0 ? 'Sin miembros en este proyecto' : 'Todos'}
      />
      <PickerModal<OrdenValor>
        visible={picker === 'orden'}
        titulo="Ordenar por"
        opciones={ORDEN_OPCIONES}
        valor={orden}
        onSeleccionar={cambiarOrden}
        onCerrar={() => setPicker(null)}
        limpiarEtiqueta="Fecha de creación"
        mostrarLimpiar={false}
      />
    </View>
  );
}

function ChipFiltro({
  icono,
  etiqueta,
  activo,
  onPress,
}: {
  icono: keyof typeof Ionicons.glyphMap;
  etiqueta: string;
  activo: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: activo }}
      onPress={onPress}
      className={`flex-row items-center gap-1.5 self-center rounded-full border px-3 py-1.5 ${
        activo ? 'border-primary bg-primary' : 'border-secondary bg-white'
      }`}
    >
      <Ionicons name={icono} size={15} color={activo ? '#F7F8F5' : colors.primary} />
      <Text
        numberOfLines={1}
        className={`max-w-[140px] text-[13px] font-semibold ${activo ? 'text-[#F7F8F5]' : 'text-text'}`}
      >
        {etiqueta}
      </Text>
      {activo ? <Ionicons name="chevron-down" size={13} color="#F7F8F5" /> : null}
    </Pressable>
  );
}
