import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { obtenerProgreso, obtenerProyecto } from '../api/proyectos';
import { cambiarEstadoTarea, listarTareasProyecto } from '../api/tareas';
import { mensajeDeError } from '../api/client';
import { colors } from '../theme/colors';
import type { RootStackParamList } from '../navigation/types';
import { ScreenHeader } from '../components/ScreenHeader';
import { ProgresoBar } from '../components/ProgresoBar';
import { TareaItem } from '../components/TareaItem';
import { TareaFab } from '../components/TareaFab';
import type { EstadoTarea } from '../api/types';

type Nav = NativeStackNavigationProp<RootStackParamList>;
type Ruta = RouteProp<RootStackParamList, 'Proyecto'>;

/**
 * Detalle de proyecto (RF-11): progreso y vencidas calculados por el backend,
 * tareas en lista, tarea rápida en dos toques (FAB → campo único → Guardar).
 */
export function ProyectoScreen() {
  const route = useRoute<Ruta>();
  const { proyectoId } = route.params;
  const navigation = useNavigation<Nav>();
  const queryClient = useQueryClient();

  const proyectoQuery = useQuery({
    queryKey: ['proyecto', proyectoId],
    queryFn: () => obtenerProyecto(proyectoId),
  });
  const progresoQuery = useQuery({
    queryKey: ['progreso', proyectoId],
    queryFn: () => obtenerProgreso(proyectoId),
  });
  const tareasQuery = useQuery({
    queryKey: ['tareas', `proyecto:${proyectoId}`, { paginaProyecto: true }],
    queryFn: () => listarTareasProyecto(proyectoId, { pageSize: 30 }),
  });

  const cambiarEstado = useMutation({
    mutationFn: ({ id, estado }: { id: string; estado: EstadoTarea }) =>
      cambiarEstadoTarea(id, estado),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['tareas'] });
      void queryClient.invalidateQueries({ queryKey: ['progreso', proyectoId] });
      void queryClient.invalidateQueries({ queryKey: ['proyecto', proyectoId] });
      void queryClient.invalidateQueries({ queryKey: ['proyectos'] });
    },
  });

  const proyecto = proyectoQuery.data ?? null;
  const progreso = progresoQuery.data ?? null;
  const tareas = tareasQuery.data?.datos ?? [];
  const refrescando =
    proyectoQuery.isRefetching || progresoQuery.isRefetching || tareasQuery.isRefetching;

  const refrescar = () => {
    void proyectoQuery.refetch();
    void progresoQuery.refetch();
    void tareasQuery.refetch();
  };

  return (
    <View className="flex-1 bg-background">
      <ScreenHeader
        titulo={proyecto?.nombre ?? 'Proyecto'}
        subtitulo={proyecto?.archivado ? 'Archivado · solo lectura' : undefined}
        derecha={
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Ver tablero Kanban"
            hitSlop={8}
            onPress={() => navigation.navigate('Kanban', { proyectoId })}
            className="flex-row items-center gap-1.5 rounded-full border border-primary px-3 py-2 active:bg-secondary"
          >
            <Ionicons name="grid-outline" size={18} color={colors.primary} />
            <Text className="text-[13px] font-semibold text-primary">Kanban</Text>
          </Pressable>
        }
      />

      <FlatList
        data={tareas}
        keyExtractor={(t) => t.id}
        contentContainerStyle={{ padding: 20, paddingBottom: 120 }}
        refreshControl={
          <RefreshControl
            refreshing={refrescando}
            onRefresh={refrescar}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        }
        ListHeaderComponent={
          <>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Ver panel del proyecto"
              onPress={() => navigation.navigate('PanelProyecto', { proyectoId })}
              style={{ minHeight: 48, justifyContent: 'center', padding: 12, marginBottom: 16, borderWidth: 1, borderColor: colors.primary, borderRadius: 12 }}
            >
              <Text style={{ color: colors.primary, fontSize: 16, fontWeight: '600' }}>Ver panel del proyecto</Text>
            </Pressable>
            {proyecto?.archivado ? (
              <View className="mb-4 flex-row items-center gap-2 rounded-xl border border-tertiary bg-[#FBF9EE] px-4 py-3">
                <Ionicons name="archive-outline" size={18} color={colors.text} />
                <Text className="flex-1 text-[13px] leading-5 text-text">
                  Proyecto archivado: las tareas son de solo lectura.
                </Text>
              </View>
            ) : null}

            {/* Progreso (RF-11, calculado por el backend) */}
            <View className="rounded-2xl border border-secondary bg-white px-5 py-5">
              <View className="flex-row items-end justify-between">
                <View>
                  <Text className="text-[11px] font-semibold text-text opacity-60">
                    PROGRESO
                  </Text>
                  <Text
                    style={{ fontFamily: 'Georgia' }}
                    className="mt-1 text-[44px] leading-[46px] text-primary"
                  >
                    {progreso ? `${progreso.progreso.toFixed(progreso.progreso % 1 === 0 ? 0 : 1)}` : '—'}
                    <Text className="text-[22px]">%</Text>
                  </Text>
                </View>
                {progreso ? (
                  <View className="items-end">
                    <Text className="text-[13px] text-text opacity-75">
                      {progreso.hechas} de {progreso.total} hechas
                    </Text>
                    {progreso.vencidas > 0 ? (
                      <Text className="mt-1 text-[13px] font-semibold text-[#B3261E]">
                        {progreso.vencidas} {progreso.vencidas === 1 ? 'vencida' : 'vencidas'}
                      </Text>
                    ) : (
                      <Text className="mt-1 text-[13px] text-text opacity-60">Sin vencidas</Text>
                    )}
                  </View>
                ) : null}
              </View>
              <View className="mt-4">
                <ProgresoBar progreso={progreso?.progreso ?? 0} />
              </View>
              {progreso ? (
                <View className="mt-4 flex-row border-t border-secondary pt-4">
                  <Dato etiqueta="Pendientes" valor={String(progreso.pendientes)} />
                  <Separador />
                  <Dato etiqueta="En curso" valor={String(progreso.enCurso)} />
                  <Separador />
                  <Dato etiqueta="Hechas" valor={String(progreso.hechas)} />
                </View>
              ) : progresoQuery.isLoading ? (
                <ActivityIndicator className="mt-4" color={colors.primary} />
              ) : (
                <Text className="mt-4 text-[13px] text-[#B3261E]">
                  {mensajeDeError(progresoQuery.error, 'No pudimos cargar el progreso.')}
                </Text>
              )}
            </View>

            {proyecto?.descripcion ? (
              <Text className="mt-3 px-1 text-[13px] leading-5 text-text opacity-80">
                {proyecto.descripcion}
              </Text>
            ) : null}

            {/* Encabezado de la lista */}
            <View className="mb-2 mt-6 flex-row items-center justify-between">
              <Text className="text-[13px] font-semibold text-text opacity-70">
                Tareas{tareasQuery.data ? ` · ${tareasQuery.data.meta.total}` : ''}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Ver todas las tareas con filtros"
                onPress={() => navigation.navigate('Tareas', { proyectoId })}
                className="flex-row items-center gap-1 rounded-full px-2 py-1 active:bg-secondary"
                hitSlop={6}
              >
                <Text className="text-[13px] font-semibold text-primary">Ver todas</Text>
                <Ionicons name="chevron-forward" size={15} color={colors.primary} />
              </Pressable>
            </View>
          </>
        }
        ListEmptyComponent={
          tareasQuery.isLoading ? (
            <View className="items-center py-10">
              <ActivityIndicator color={colors.primary} />
            </View>
          ) : tareasQuery.isError ? (
            <View className="rounded-2xl border border-[#E5B8B3] bg-[#FAE8E6] px-5 py-5">
              <Text className="text-[14px] leading-5 text-[#8C2F28]">
                No pudimos cargar las tareas. {mensajeDeError(tareasQuery.error)}
              </Text>
            </View>
          ) : (
            <View className="items-center rounded-2xl border border-secondary bg-white px-6 py-10">
              <Ionicons name="checkbox-outline" size={32} color={colors.primary} />
              <Text className="mt-3 text-center text-[14px] leading-5 text-text opacity-80">
                Aún no hay tareas. La primera puede ser una tarea rápida:{'\n'}toca el botón +.
              </Text>
            </View>
          )
        }
        renderItem={({ item }) => (
          <TareaItem
            tarea={item}
            onCambiarEstado={(tarea, siguiente) =>
              cambiarEstado.mutate({ id: tarea.id, estado: siguiente })
            }
            onAbrir={() => navigation.navigate('TareaDetalle', { tareaId: item.id })}
          />
        )}
      />

      {cambiarEstado.isError ? (
        <View className="absolute bottom-24 left-4 right-4 rounded-xl border border-[#E5B8B3] bg-[#FAE8E6] px-4 py-3">
          <Text className="text-[13px] leading-5 text-[#8C2F28]">
            {mensajeDeError(cambiarEstado.error)}
          </Text>
        </View>
      ) : null}

      {/* FAB: tarea rápida en dos toques (FAB → Guardar) */}
      <TareaFab onPress={() => navigation.navigate('TareaRapida', { espacioId: proyecto?.espacioId })} />
    </View>
  );
}

function Dato({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  return (
    <View className="flex-1 items-center">
      <Text style={{ fontFamily: 'Georgia' }} className="text-[19px] text-text">
        {valor}
      </Text>
      <Text className="mt-0.5 text-[11px] text-text opacity-60">{etiqueta}</Text>
    </View>
  );
}

function Separador() {
  return <View className="w-px bg-secondary" />;
}
