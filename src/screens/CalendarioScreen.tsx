import { useMemo, useState } from 'react';
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
import {
  Calendar,
  CalendarProvider,
  LocaleConfig,
  WeekCalendar,
  type CalendarProps,
  type DateData,
} from 'react-native-calendars';
import { obtenerCalendarioCompleto } from '../api/calendario';
import { obtenerEspacio } from '../api/espacios';
import { cambiarEstadoTarea } from '../api/tareas';
import { mensajeDeError } from '../api/client';
import { colors } from '../theme/colors';
import { ScreenHeader } from '../components/ScreenHeader';
import { EmptyState } from '../components/EmptyState';
import { PrioridadBadge } from '../components/PrioridadBadge';
import {
  diaSemanaCapitalizado,
  finMesUTC,
  finSemanaUTC,
  formatDiaMes,
  hoyClaveUTC,
  inicioMesUTC,
  inicioSemanaUTC,
  iniciales,
  parseClaveUTC,
} from '../lib/calendario';
import type { RootStackParamList } from '../navigation/types';
import type { EstadoTarea, Tarea } from '../api/types';

type Nav = NativeStackNavigationProp<RootStackParamList>;
type Ruta = RouteProp<RootStackParamList, 'Calendario'>;
type Modo = 'mensual' | 'semanal';

/** Tipos de marcado local (react-native-calendars no re-exporta MarkedDates/Theme). */
type PuntoDia = { key: string; color: string; selectedDotColor?: string };
type MarcadoDia = {
  type: 'multi-dot';
  dots: PuntoDia[];
  selected?: boolean;
  selectedColor?: string;
  selectedTextColor?: string;
};
type MarkedDates = Record<string, MarcadoDia>;

const ROJO = '#B3261E';
const ROJO_TEXTO = '#8C2F28';
const MARFIL = '#FBF9EE';

LocaleConfig.locales.es = {
  monthNames: [
    'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
    'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
  ],
  monthNamesShort: [
    'ene', 'feb', 'mar', 'abr', 'may', 'jun',
    'jul', 'ago', 'sep', 'oct', 'nov', 'dic',
  ],
  dayNames: ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'],
  dayNamesShort: ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'],
  today: 'Hoy',
};
LocaleConfig.defaultLocale = 'es';

const temaCalendario: CalendarProps['theme'] = {
  calendarBackground: 'transparent',
  monthTextColor: colors.primary,
  textMonthFontFamily: 'Georgia',
  textMonthFontWeight: '600',
  textMonthFontSize: 17,
  textSectionTitleColor: colors.text,
  textDayHeaderFontWeight: '700',
  textDayHeaderFontSize: 12,
  textDayFontSize: 15,
  dayTextColor: colors.text,
  todayTextColor: colors.primary,
  todayBackgroundColor: colors.secondary,
  textDisabledColor: '#C4CDC6',
  arrowColor: colors.primary,
  selectedDayBackgroundColor: colors.primary,
  selectedDayTextColor: '#F7F8F5',
  dotColor: colors.primary,
  selectedDotColor: '#F7F8F5',
  indicatorColor: colors.primary,
};

const ESTADO_SIGUIENTE: Record<EstadoTarea, EstadoTarea> = {
  PENDIENTE: 'EN_CURSO',
  EN_CURSO: 'HECHA',
  HECHA: 'PENDIENTE',
};

const ESTADO_ICON: Record<EstadoTarea, keyof typeof Ionicons.glyphMap> = {
  PENDIENTE: 'ellipse-outline',
  EN_CURSO: 'time-outline',
  HECHA: 'checkmark-circle',
};

function etiquetaEstado(estado: EstadoTarea): string {
  switch (estado) {
    case 'PENDIENTE':
      return 'Pendiente';
    case 'EN_CURSO':
      return 'En curso';
    case 'HECHA':
      return 'Hecha';
  }
}

/**
 * Calendario del espacio (RF-18): vista mensual y semanal (react-native-calendars),
 * puntos por día (verde = tareas, rojo = vencidas) y lista de tareas del día
 * seleccionado. La ventana que se pide al backend sigue al mes o a la semana
 * visible (`desde` = primer día, `hasta` = último, ambos UTC e inclusivos).
 * Las tareas HECHA se incluyen; los proyectos archivados no llegan (lo filtra el backend).
 */
export function CalendarioScreen() {
  const route = useRoute<Ruta>();
  const { espacioId } = route.params;
  const navigation = useNavigation<Nav>();
  const queryClient = useQueryClient();

  const hoy = hoyClaveUTC();
  const [modo, setModo] = useState<Modo>('mensual');
  const [fechaSeleccionada, setFechaSeleccionada] = useState(hoy);
  const [mesVisible, setMesVisible] = useState(inicioMesUTC(hoy));

  /** Ventana efectiva: mes completo visible o semana (lunes–domingo) del día seleccionado. */
  const desde = modo === 'mensual' ? mesVisible : inicioSemanaUTC(fechaSeleccionada);
  const hasta = modo === 'mensual' ? finMesUTC(mesVisible) : finSemanaUTC(fechaSeleccionada);

  const espacioQuery = useQuery({
    queryKey: ['espacio', espacioId],
    queryFn: () => obtenerEspacio(espacioId),
  });
  const calendarioQuery = useQuery({
    queryKey: ['calendario', espacioId, desde, hasta],
    queryFn: () => obtenerCalendarioCompleto(espacioId, { desde, hasta }),
  });

  const cambiarEstado = useMutation({
    mutationFn: ({ id, estado }: { id: string; estado: EstadoTarea }) =>
      cambiarEstadoTarea(id, estado),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['calendario'] });
      void queryClient.invalidateQueries({ queryKey: ['tareas'] });
      void queryClient.invalidateQueries({ queryKey: ['progreso'] });
    },
  });

  const tareas = useMemo(() => calendarioQuery.data?.datos ?? [], [calendarioQuery.data]);
  const meta = calendarioQuery.data?.meta;

  const markedDates = useMemo<MarkedDates>(() => {
    const porDia = new Map<string, { vencidas: number }>();
    for (const tarea of tareas) {
      if (!tarea.fechaLimite) continue;
      const clave = tarea.fechaLimite.slice(0, 10);
      const entry = porDia.get(clave) ?? { vencidas: 0 };
      if (tarea.vencida) entry.vencidas += 1;
      porDia.set(clave, entry);
    }
    const marcadas: MarkedDates = {};
    for (const [clave, info] of porDia) {
      const dots: PuntoDia[] = [
        { key: 'tareas', color: colors.primary, selectedDotColor: '#F7F8F5' },
      ];
      if (info.vencidas > 0) {
        dots.push({ key: 'vencidas', color: ROJO, selectedDotColor: '#F7F8F5' });
      }
      marcadas[clave] = { type: 'multi-dot', dots };
    }
    marcadas[fechaSeleccionada] = {
      ...marcadas[fechaSeleccionada],
      type: 'multi-dot',
      dots: marcadas[fechaSeleccionada]?.dots ?? [],
      selected: true,
      selectedColor: colors.primary,
      selectedTextColor: '#F7F8F5',
    };
    return marcadas;
  }, [tareas, fechaSeleccionada]);

  const tareasDelDia = useMemo(
    () => tareas.filter((t) => t.fechaLimite?.slice(0, 10) === fechaSeleccionada),
    [tareas, fechaSeleccionada],
  );

  const irAHoy = () => {
    setFechaSeleccionada(hoy);
    setMesVisible(inicioMesUTC(hoy));
  };

  const refrescando = calendarioQuery.isRefetching;
  const esError = calendarioQuery.isError;
  const seleccionadoEsHoy = fechaSeleccionada === hoy;

  return (
    <View className="flex-1 bg-background">
      <ScreenHeader
        titulo="Calendario"
        subtitulo={espacioQuery.data?.nombre}
        derecha={
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Ir a hoy"
            hitSlop={8}
            onPress={irAHoy}
            className="flex-row items-center gap-1.5 rounded-full border border-primary px-3 py-2 active:bg-secondary"
          >
            <Ionicons name="today-outline" size={17} color={colors.primary} />
            <Text className="text-[13px] font-semibold text-primary">Hoy</Text>
          </Pressable>
        }
      />

      {/* Selector de vista: Mes / Semana */}
      <View className="px-4 pt-3">
        <View
          accessibilityRole="tablist"
          className="flex-row rounded-2xl border border-secondary bg-secondary p-1"
        >
          <ModoBoton
            activo={modo === 'mensual'}
            icono="calendar-outline"
            etiqueta="Mes"
            accessibilityLabel="Vista de mes"
            onPress={() => setModo('mensual')}
          />
          <ModoBoton
            activo={modo === 'semanal'}
            icono="calendar-number-outline"
            etiqueta="Semana"
            accessibilityLabel="Vista de semana"
            onPress={() => setModo('semanal')}
          />
        </View>
      </View>

      {/* Calendario */}
      <View className="px-4 pt-3">
        <View className="overflow-hidden rounded-2xl border border-secondary bg-white py-1">
          {esError && tareas.length === 0 ? (
            <ErrorCalendario
              mensaje={mensajeDeError(calendarioQuery.error)}
              onReintentar={() => void calendarioQuery.refetch()}
            />
          ) : modo === 'mensual' ? (
            <Calendar
              current={mesVisible}
              firstDay={1}
              hideExtraDays
              enableSwipeMonths
              markingType="multi-dot"
              markedDates={markedDates}
              onDayPress={(dia: DateData) => setFechaSeleccionada(dia.dateString)}
              onMonthChange={(dia: DateData) => setMesVisible(inicioMesUTC(dia.dateString))}
              theme={temaCalendario}
            />
          ) : (
            <CalendarProvider
              date={fechaSeleccionada}
              onDateChanged={(dateString: string) => setFechaSeleccionada(dateString)}
              theme={temaCalendario}
            >
              <WeekCalendar
                firstDay={1}
                markingType="multi-dot"
                markedDates={markedDates}
                onDayPress={(dia: DateData) => setFechaSeleccionada(dia.dateString)}
                theme={temaCalendario}
              />
            </CalendarProvider>
          )}
        </View>

        {/* Ventana efectiva + total del rango (meta del backend, RF-18) */}
        {meta ? (
          <Text className="mt-2 px-1 text-[12px] leading-4 text-text opacity-75">
            {meta.totalDePorTareas === 1 ? '1 tarea' : `${meta.totalDePorTareas} tareas`} con fecha
            límite {modo === 'mensual' ? 'este mes' : 'esta semana'}
            {meta.desde && meta.hasta ? ` · ${formatDiaMes(meta.desde)} – ${formatDiaMes(meta.hasta)}` : ''}
          </Text>
        ) : null}
      </View>

      {/* Tareas del día seleccionado */}
      <FlatList
        data={tareasDelDia}
        keyExtractor={(t) => t.id}
        className="flex-1"
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 32, flexGrow: 1 }}
        refreshControl={
          <RefreshControl
            refreshing={refrescando}
            onRefresh={() => void calendarioQuery.refetch()}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        }
        ListHeaderComponent={
          <View className="flex-row items-end justify-between px-1 pb-3 pt-4">
            <View className="flex-row items-center gap-4">
              <Text
                accessibilityRole="header"
                style={{ fontFamily: 'Georgia' }}
                className="text-[46px] leading-[48px] text-primary"
              >
                {parseClaveUTC(fechaSeleccionada).getUTCDate()}
              </Text>
              <View>
                <View className="flex-row items-center gap-2">
                  <Text className="text-[12px] font-semibold text-text opacity-70">
                    {diaSemanaCapitalizado(fechaSeleccionada)}
                  </Text>
                  {seleccionadoEsHoy ? (
                    <View className="rounded-full bg-tertiary px-2 py-0.5">
                      <Text className="text-[10px] font-bold uppercase text-text">Hoy</Text>
                    </View>
                  ) : null}
                </View>
                <Text style={{ fontFamily: 'Georgia' }} className="mt-0.5 text-[15px] text-text">
                  {formatDiaMes(fechaSeleccionada)} de {parseClaveUTC(fechaSeleccionada).getUTCFullYear()}
                </Text>
              </View>
            </View>
            {!calendarioQuery.isLoading && !esError ? (
              <View className="rounded-full bg-secondary px-3 py-1.5">
                <Text className="text-[12px] font-bold text-primary">
                  {tareasDelDia.length} {tareasDelDia.length === 1 ? 'tarea' : 'tareas'}
                </Text>
              </View>
            ) : null}
          </View>
        }
        ListEmptyComponent={
          calendarioQuery.isLoading ? (
            <View className="items-center py-10">
              <ActivityIndicator color={colors.primary} />
            </View>
          ) : esError ? (
            <ErrorCalendario
              mensaje={mensajeDeError(calendarioQuery.error)}
              onReintentar={() => void calendarioQuery.refetch()}
            />
          ) : (
            <EmptyState
              icono="calendar-outline"
              titulo="Sin tareas este día"
              detalle="Las tareas con fecha límite ese día aparecerán aquí, también las completadas."
            />
          )
        }
        renderItem={({ item }) => (
          <CalendarioTareaRow
            tarea={item}
            onAbrir={() => navigation.navigate('TareaDetalle', { tareaId: item.id })}
            onCambiarEstado={(tarea) =>
              cambiarEstado.mutate({ id: tarea.id, estado: ESTADO_SIGUIENTE[tarea.estado] })
            }
          />
        )}
      />

      {cambiarEstado.isError ? (
        <View className="absolute bottom-6 left-4 right-4 rounded-xl border border-[#E5B8B3] bg-[#FAE8E6] px-4 py-3">
          <Text className="text-[13px] leading-5 text-[#8C2F28]">
            {mensajeDeError(cambiarEstado.error)}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

/** Botón del selector de vista: Mes / Semana. */
function ModoBoton({
  activo,
  icono,
  etiqueta,
  accessibilityLabel,
  onPress,
}: {
  activo: boolean;
  icono: keyof typeof Ionicons.glyphMap;
  etiqueta: string;
  accessibilityLabel: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: activo }}
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      className={`flex-1 flex-row items-center justify-center gap-2 rounded-xl py-2.5 ${
        activo ? 'bg-primary' : 'bg-transparent'
      }`}
    >
      <Ionicons name={icono} size={17} color={activo ? '#F7F8F5' : colors.primary} />
      <Text
        className={`text-[14px] font-semibold ${activo ? 'text-[#F7F8F5]' : 'text-primary'}`}
      >
        {etiqueta}
      </Text>
    </Pressable>
  );
}

/** Tarjeta de error de la ventana de calendario, con reintento. */
function ErrorCalendario({
  mensaje,
  onReintentar,
}: {
  mensaje: string;
  onReintentar: () => void;
}) {
  return (
    <View className="rounded-2xl border border-[#E5B8B3] bg-[#FAE8E6] px-5 py-5">
      <View className="flex-row items-center gap-2">
        <Ionicons name="alert-circle-outline" size={20} color={ROJO_TEXTO} />
        <Text className="flex-1 text-[14px] leading-5 text-[#8C2F28]">
          No pudimos cargar el calendario. {mensaje}
        </Text>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Reintentar"
        onPress={onReintentar}
        className="mt-3 self-start rounded-full border border-[#8C2F28] px-4 py-2 active:bg-[#F3D4D0]"
      >
        <Text className="text-[13px] font-semibold text-[#8C2F28]">Reintentar</Text>
      </Pressable>
    </View>
  );
}

/** Fila de tarea del día: estado, título, prioridad, vencida, etiquetas y avatar con iniciales. */
function CalendarioTareaRow({
  tarea,
  onAbrir,
  onCambiarEstado,
}: {
  tarea: Tarea;
  onAbrir: () => void;
  onCambiarEstado: (tarea: Tarea) => void;
}) {
  const hecha = tarea.estado === 'HECHA';
  const etiquetasVisibles = tarea.etiquetas.slice(0, 2);
  const etiquetasRestantes = tarea.etiquetas.length - etiquetasVisibles.length;

  return (
    <View
      className={`mb-2 flex-row items-center gap-3 rounded-2xl border bg-white px-3 py-3 ${
        tarea.vencida ? 'border-[#E5B8B3]' : 'border-secondary'
      }`}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Estado: ${etiquetaEstado(tarea.estado)}. Tocar para cambiar.`}
        hitSlop={8}
        onPress={() => onCambiarEstado(tarea)}
      >
        <Ionicons
          name={ESTADO_ICON[tarea.estado]}
          size={24}
          color={hecha ? colors.primary : tarea.vencida ? ROJO : '#8A968E'}
        />
      </Pressable>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Abrir tarea ${tarea.titulo}`}
        onPress={onAbrir}
        className="flex-1"
      >
        <Text
          numberOfLines={2}
          className={`text-[15px] font-semibold leading-5 ${
            hecha ? 'text-text opacity-50' : 'text-text'
          }`}
          style={hecha ? { textDecorationLine: 'line-through' } : undefined}
        >
          {tarea.titulo}
        </Text>

        <View className="mt-1.5 flex-row flex-wrap items-center gap-1.5">
          <PrioridadBadge prioridad={tarea.prioridad} />
          {tarea.vencida ? (
            <View className="rounded-full bg-[#FAE0DD] px-2 py-0.5">
              <Text className="text-[11px] font-bold text-[#8C2F28]">Vencida</Text>
            </View>
          ) : null}
          {etiquetasVisibles.map((etiqueta) => (
            <View
              key={etiqueta.id}
              className="flex-row items-center gap-1 rounded-full border border-tertiary px-2 py-0.5"
              style={{ backgroundColor: MARFIL }}
            >
              <View
                className="h-1.5 w-1.5 rounded-full"
                style={{ backgroundColor: colorEtiquetaValida(etiqueta.color) }}
              />
              <Text numberOfLines={1} className="max-w-[120px] text-[11px] font-semibold text-text opacity-80">
                {etiqueta.nombre}
              </Text>
            </View>
          ))}
          {etiquetasRestantes > 0 ? (
            <Text className="text-[11px] font-semibold text-text opacity-60">
              +{etiquetasRestantes}
            </Text>
          ) : null}
        </View>
      </Pressable>

      {tarea.responsable ? (
        <View
          accessibilityRole="image"
          accessibilityLabel={`Responsable: ${tarea.responsable.nombre}`}
          className="h-10 w-10 items-center justify-center rounded-full bg-secondary"
        >
          <Text className="text-[12px] font-bold text-primary">
            {iniciales(tarea.responsable.nombre)}
          </Text>
        </View>
      ) : (
        <View
          accessibilityRole="image"
          accessibilityLabel="Sin responsable asignado"
          className="h-10 w-10 items-center justify-center rounded-full border border-dashed border-secondary"
        >
          <Ionicons name="person-outline" size={17} color="#9AA79E" />
        </View>
      )}
    </View>
  );
}

/** Solo se pinta el color si viene en formato #RRGGBB (el backend valida; esto es defensa en profundidad). */
function colorEtiquetaValida(color: string): string {
  return /^#[0-9a-fA-F]{6}$/.test(color) ? color : colors.tertiary;
}
