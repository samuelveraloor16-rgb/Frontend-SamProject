import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  actualizarTarea,
  cambiarEstadoTarea,
  crearSubtarea,
  eliminarTarea,
  obtenerTarea,
  type ActualizarTareaInput,
} from '../api/tareas';
import { obtenerProyecto } from '../api/proyectos';
import { listarEtiquetasEspacio } from '../api/etiquetas';
import { mensajeDeError } from '../api/client';
import { colors } from '../theme/colors';
import type { RootStackParamList } from '../navigation/types';
import type { EstadoTarea, Etiqueta, PrioridadTarea, Proyecto, TareaDetalle } from '../api/types';
import { ScreenHeader } from '../components/ScreenHeader';
import { FormField } from '../components/FormField';
import { PickerModal } from '../components/PickerModal';
import { PrioridadBadge, PRIORIDAD_ORDEN } from '../components/PrioridadBadge';
import { formatFechaCorta } from '../lib/format';

type Ruta = RouteProp<RootStackParamList, 'TareaDetalle'>;
type Nav = NativeStackNavigationProp<RootStackParamList>;

const PRIORIDAD_ETIQUETA: Record<PrioridadTarea, string> = {
  BAJA: 'Baja',
  MEDIA: 'Media',
  ALTA: 'Alta',
  URGENTE: 'Urgente',
};

const ESTADO_ETIQUETA: Record<EstadoTarea, string> = {
  PENDIENTE: 'Pendiente',
  EN_CURSO: 'En curso',
  HECHA: 'Hecha',
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

/** ISO → «YYYY-MM-DD» (fecha UTC, coherente con formatFechaLimite). */
function isoAEntrada(iso: string): string {
  return iso.slice(0, 10);
}

/** «YYYY-MM-DD» → ISO UTC. null si el formato o la fecha no son válidos. */
function entradaAIso(input: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input.trim());
  if (!m) return null;
  const anio = Number(m[1]);
  const mes = Number(m[2]);
  const dia = Number(m[3]);
  const fecha = new Date(Date.UTC(anio, mes - 1, dia));
  if (
    Number.isNaN(fecha.getTime()) ||
    fecha.getUTCFullYear() !== anio ||
    fecha.getUTCMonth() !== mes - 1 ||
    fecha.getUTCDate() !== dia
  ) {
    return null;
  }
  return fecha.toISOString();
}

/**
 * Detalle de tarea (RF-12): carga el detalle (GET /tareas/:id) y delega el
 * formulario en `DetalleContenido`, que inicializa su estado desde las props.
 */
export function TareaDetalleScreen() {
  const route = useRoute<Ruta>();
  const { tareaId } = route.params;

  const tareaQuery = useQuery({
    queryKey: ['tarea', tareaId],
    queryFn: () => obtenerTarea(tareaId),
  });
  const tarea = tareaQuery.data ?? null;

  const proyectoQuery = useQuery({
    queryKey: ['proyecto', tarea?.proyectoId],
    enabled: !!tarea?.proyectoId,
    queryFn: () => obtenerProyecto(tarea!.proyectoId),
  });
  const proyecto = proyectoQuery.data ?? null;

  const espacioId = proyecto?.espacioId;
  const etiquetasQuery = useQuery({
    queryKey: ['etiquetas', espacioId],
    enabled: !!espacioId,
    queryFn: () => listarEtiquetasEspacio(espacioId!),
  });

  if (tareaQuery.isLoading) {
    return (
      <View className="flex-1 bg-background">
        <ScreenHeader titulo="Detalle de tarea" />
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </View>
    );
  }

  if (tareaQuery.isError || !tarea) {
    return (
      <View className="flex-1 bg-background">
        <ScreenHeader titulo="Detalle de tarea" />
        <View className="flex-1 justify-center px-5">
          <View className="rounded-2xl border border-[#E5B8B3] bg-[#FAE8E6] px-5 py-5">
            <Text className="text-[14px] leading-5 text-[#8C2F28]">
              No pudimos cargar la tarea. {mensajeDeError(tareaQuery.error)}
            </Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => void tareaQuery.refetch()}
              className="mt-3 self-start rounded-full border border-[#8C2F28] px-4 py-2"
            >
              <Text className="text-[13px] font-semibold text-[#8C2F28]">Reintentar</Text>
            </Pressable>
          </View>
        </View>
      </View>
    );
  }

  return (
    <DetalleContenido
      key={tarea.id}
      tarea={tarea}
      proyecto={proyecto}
      etiquetasDisponibles={etiquetasQuery.data?.datos ?? []}
      etiquetasCargando={etiquetasQuery.isLoading}
    />
  );
}

type DetalleContenidoProps = {
  tarea: TareaDetalle;
  proyecto: Proyecto | null;
  etiquetasDisponibles: Etiqueta[];
  etiquetasCargando: boolean;
};

/**
 * Formulario de edición de la tarea. El estado inicial viene de las props;
 * solo los campos modificados viajan en el PATCH (contrato §4).
 * Un proyecto archivado deja la tarea en solo lectura.
 */
function DetalleContenido({
  tarea,
  proyecto,
  etiquetasDisponibles,
  etiquetasCargando,
}: DetalleContenidoProps) {
  const navigation = useNavigation<Nav>();
  const queryClient = useQueryClient();
  const tareaId = tarea.id;
  const soloLectura = proyecto?.archivado === true;

  const [titulo, setTitulo] = useState(tarea.titulo);
  const [descripcion, setDescripcion] = useState(tarea.descripcion ?? '');
  const [prioridad, setPrioridad] = useState<PrioridadTarea>(tarea.prioridad);
  const [fechaLimite, setFechaLimite] = useState(
    tarea.fechaLimite ? isoAEntrada(tarea.fechaLimite) : '',
  );
  const [responsableId, setResponsableId] = useState<string | undefined>(tarea.responsable?.id);
  const [etiquetaIds, setEtiquetaIds] = useState<string[]>(tarea.etiquetas.map((e) => e.id));
  const [picker, setPicker] = useState<'estado' | 'prioridad' | 'responsable' | null>(null);
  const [errorTitulo, setErrorTitulo] = useState<string | null>(null);
  const [guardadoVisible, setGuardadoVisible] = useState(false);
  const [nuevaSubtarea, setNuevaSubtarea] = useState('');

  useEffect(() => {
    if (!guardadoVisible) return;
    const t = setTimeout(() => setGuardadoVisible(false), 2500);
    return () => clearTimeout(t);
  }, [guardadoVisible]);

  const miembros = useMemo(() => proyecto?.miembros ?? [], [proyecto]);
  const fechaInvalida = fechaLimite.trim() !== '' && entradaAIso(fechaLimite) === null;

  /** Solo los campos modificados viajan en el PATCH (contrato §4). */
  const cambios = useMemo<ActualizarTareaInput>(() => {
    const c: ActualizarTareaInput = {};
    const tituloLimpio = titulo.trim();
    if (tituloLimpio !== tarea.titulo) c.titulo = tituloLimpio;
    const descripcionLimpia = descripcion.trim();
    if (descripcion !== (tarea.descripcion ?? '')) {
      c.descripcion = descripcionLimpia === '' ? null : descripcionLimpia;
    }
    const fechaOriginal = tarea.fechaLimite ? isoAEntrada(tarea.fechaLimite) : '';
    if (fechaLimite.trim() !== fechaOriginal) {
      c.fechaLimite = fechaLimite.trim() === '' ? null : entradaAIso(fechaLimite);
    }
    if (prioridad !== tarea.prioridad) c.prioridad = prioridad;
    if (responsableId !== (tarea.responsable?.id ?? undefined)) {
      c.responsableId = responsableId ?? null;
    }
    const actuales = [...etiquetaIds].sort().join(',');
    const originales = tarea.etiquetas
      .map((e) => e.id)
      .sort()
      .join(',');
    if (actuales !== originales) c.etiquetas = etiquetaIds;
    return c;
  }, [tarea, titulo, descripcion, fechaLimite, prioridad, responsableId, etiquetaIds]);

  const hayCambios = Object.keys(cambios).length > 0;
  const tituloValido = titulo.trim().length >= 1 && titulo.trim().length <= 200;
  const puedeGuardar = !soloLectura && hayCambios && tituloValido && !fechaInvalida;

  const invalidarRelacionadas = () => {
    void queryClient.invalidateQueries({ queryKey: ['tarea', tareaId] });
    void queryClient.invalidateQueries({ queryKey: ['tareas'] });
    void queryClient.invalidateQueries({ queryKey: ['progreso'] });
    void queryClient.invalidateQueries({ queryKey: ['proyectos'] });
    void queryClient.invalidateQueries({ queryKey: ['proyecto'] });
    void queryClient.invalidateQueries({ queryKey: ['bandeja-total'] });
  };

  const guardar = useMutation({
    mutationFn: () => actualizarTarea(tareaId, cambios),
    onSuccess: () => {
      invalidarRelacionadas();
      setGuardadoVisible(true);
    },
  });

  const cambiarEstado = useMutation({
    mutationFn: (estado: EstadoTarea) => cambiarEstadoTarea(tareaId, estado),
    onSuccess: invalidarRelacionadas,
  });

  const cambiarEstadoSubtarea = useMutation({
    mutationFn: ({ id, estado }: { id: string; estado: EstadoTarea }) =>
      cambiarEstadoTarea(id, estado),
    onSuccess: invalidarRelacionadas,
  });

  const eliminarSubtarea = useMutation({
    mutationFn: (id: string) => eliminarTarea(id),
    onSuccess: invalidarRelacionadas,
  });

  const agregarSubtarea = useMutation({
    mutationFn: (tituloNueva: string) => crearSubtarea(tareaId, { titulo: tituloNueva }),
    onSuccess: () => {
      setNuevaSubtarea('');
      invalidarRelacionadas();
    },
  });

  const eliminar = useMutation({
    mutationFn: () => eliminarTarea(tareaId),
    onSuccess: () => {
      invalidarRelacionadas();
      navigation.goBack();
    },
  });

  const errorFlotante =
    guardar.error ??
    cambiarEstado.error ??
    cambiarEstadoSubtarea.error ??
    eliminarSubtarea.error ??
    agregarSubtarea.error ??
    eliminar.error ??
    null;

  const confirmarEliminar = () => {
    Alert.alert(
      'Eliminar tarea',
      'Se eliminará la tarea y sus subtareas. Esta acción no se puede deshacer.',
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Eliminar', style: 'destructive', onPress: () => eliminar.mutate() },
      ],
    );
  };

  const confirmarEliminarSubtarea = (id: string, subtitulo: string) => {
    Alert.alert('Eliminar subtarea', `«${subtitulo}» se eliminará.`, [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Eliminar', style: 'destructive', onPress: () => eliminarSubtarea.mutate(id) },
    ]);
  };

  const toggleEtiqueta = (id: string) => {
    setEtiquetaIds((prev) => (prev.includes(id) ? prev.filter((e) => e !== id) : [...prev, id]));
  };

  const subtareas = tarea.subtareasDetalle ?? [];
  const esSubtarea = tarea.tareaPadreId != null;
  const responsableActual = miembros.find((m) => m.id === responsableId);

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      className="flex-1 bg-background"
    >
      <ScreenHeader
        titulo="Detalle de tarea"
        subtitulo={proyecto?.nombre}
        derecha={
          tarea.vencida ? (
            <View className="rounded-full bg-[#FAE0DD] px-3 py-1.5">
              <Text className="text-[12px] font-bold text-[#8C2F28]">Vencida</Text>
            </View>
          ) : undefined
        }
      />

      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: 20, paddingBottom: 48 }}
      >
        {soloLectura ? (
          <View className="mb-4 flex-row items-center gap-2 rounded-xl border border-tertiary bg-[#FBF9EE] px-4 py-3">
            <Ionicons name="archive-outline" size={18} color={colors.text} />
            <Text className="flex-1 text-[13px] leading-5 text-text">
              Proyecto archivado: la tarea es de solo lectura.
            </Text>
          </View>
        ) : null}

        {/* Estado y fecha de finalización */}
        <View className="mb-4 flex-row flex-wrap items-center gap-2">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Estado: ${ESTADO_ETIQUETA[tarea.estado]}. Tocar para cambiar.`}
            disabled={soloLectura}
            onPress={() => setPicker('estado')}
            className="flex-row items-center gap-1.5 rounded-full border border-primary bg-primary px-4 py-2 active:opacity-80"
          >
            <Ionicons name={ESTADO_ICON[tarea.estado]} size={16} color="#F7F8F5" />
            <Text className="text-[13px] font-semibold text-[#F7F8F5]">
              {ESTADO_ETIQUETA[tarea.estado]}
            </Text>
            <Ionicons name="chevron-down" size={13} color="#F7F8F5" />
          </Pressable>
          {tarea.estado === 'HECHA' && tarea.fechaFinalizacion ? (
            <Text className="text-[12px] text-text opacity-70">
              Completada el {formatFechaCorta(tarea.fechaFinalizacion)}
            </Text>
          ) : null}
        </View>

        {/* Formulario principal */}
        <View className="rounded-2xl border border-secondary bg-white px-5 py-5">
          <FormField
            label="Título"
            value={titulo}
            onChangeText={(t) => {
              setTitulo(t);
              setErrorTitulo(null);
              guardar.reset();
            }}
            editable={!soloLectura}
            maxLength={200}
            error={errorTitulo}
            placeholder="¿Qué hay que hacer?"
          />

          <FormField
            label="Descripción"
            value={descripcion}
            onChangeText={(t) => {
              setDescripcion(t);
              guardar.reset();
            }}
            editable={!soloLectura}
            multiline
            numberOfLines={5}
            textAlignVertical="top"
            placeholder="Detalles, contexto, enlaces…"
            style={{ minHeight: 120 }}
          />

          <Text className="mb-1.5 text-[13px] font-semibold text-text">Prioridad</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Prioridad: ${PRIORIDAD_ETIQUETA[prioridad]}. Tocar para cambiar.`}
            disabled={soloLectura}
            onPress={() => setPicker('prioridad')}
            className="mb-4 min-h-[52px] flex-row items-center justify-between rounded-xl border border-[#D5DFD8] bg-white px-4 py-3 active:bg-secondary"
          >
            <PrioridadBadge prioridad={prioridad} />
            <Ionicons name="chevron-down" size={18} color="#8A968E" />
          </Pressable>

          <Text className="mb-1.5 text-[13px] font-semibold text-text">Fecha límite</Text>
          <View className="mb-1 flex-row items-center gap-2">
            <View className="min-h-[52px] flex-1 flex-row items-center gap-2 rounded-xl border border-[#D5DFD8] bg-white px-4">
              <Ionicons name="calendar-outline" size={18} color="#5A6660" />
              <TextInput
                accessibilityLabel="Fecha límite en formato año-mes-día"
                value={fechaLimite}
                onChangeText={(t) => {
                  setFechaLimite(t);
                  guardar.reset();
                }}
                editable={!soloLectura}
                placeholder="AAAA-MM-DD"
                placeholderTextColor="#8A968E"
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="numbers-and-punctuation"
                maxLength={10}
                className="min-h-[48px] flex-1 text-[16px] text-text"
              />
              {fechaLimite.length > 0 ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Quitar fecha límite"
                  hitSlop={8}
                  disabled={soloLectura}
                  onPress={() => setFechaLimite('')}
                >
                  <Ionicons name="close-circle" size={20} color="#8A968E" />
                </Pressable>
              ) : null}
            </View>
          </View>
          {fechaInvalida ? (
            <Text className="mb-3 text-[13px] leading-5 text-[#B3261E]">
              Usa el formato AAAA-MM-DD con una fecha válida (p. ej. 2026-12-01).
            </Text>
          ) : (
            <View className="mb-4" />
          )}

          <Text className="mb-1.5 text-[13px] font-semibold text-text">Responsable</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Cambiar responsable"
            disabled={soloLectura}
            onPress={() => setPicker('responsable')}
            className="mb-4 min-h-[52px] flex-row items-center justify-between rounded-xl border border-[#D5DFD8] bg-white px-4 py-3 active:bg-secondary"
          >
            {responsableActual ? (
              <View className="flex-1 pr-3">
                <Text className="text-[15px] text-text">{responsableActual.nombre}</Text>
                <Text className="text-[12px] text-text opacity-60">{responsableActual.email}</Text>
              </View>
            ) : responsableId && tarea.responsable ? (
              <View className="flex-1 pr-3">
                <Text className="text-[15px] text-text">{tarea.responsable.nombre}</Text>
                <Text className="text-[12px] text-text opacity-60">{tarea.responsable.email}</Text>
              </View>
            ) : (
              <Text className="flex-1 text-[15px] text-text opacity-60">Sin responsable</Text>
            )}
            <Ionicons name="chevron-down" size={18} color="#8A968E" />
          </Pressable>

          <Text className="mb-1.5 text-[13px] font-semibold text-text">Etiquetas</Text>
          {etiquetasCargando ? (
            <ActivityIndicator className="mb-4 self-start" color={colors.primary} />
          ) : etiquetasDisponibles.length === 0 ? (
            <Text className="mb-4 text-[13px] text-text opacity-60">
              Este espacio aún no tiene etiquetas.
            </Text>
          ) : (
            <View className="mb-4 flex-row flex-wrap gap-2">
              {etiquetasDisponibles.map((etiqueta) => {
                const seleccionada = etiquetaIds.includes(etiqueta.id);
                return (
                  <Pressable
                    key={etiqueta.id}
                    accessibilityRole="button"
                    accessibilityState={{ selected: seleccionada }}
                    accessibilityLabel={`Etiqueta ${etiqueta.nombre}`}
                    disabled={soloLectura}
                    onPress={() => toggleEtiqueta(etiqueta.id)}
                    className={`flex-row items-center gap-1.5 rounded-full border px-3 py-2 ${
                      seleccionada ? 'border-primary bg-primary' : 'border-secondary bg-white'
                    }`}
                  >
                    <View
                      className="h-2.5 w-2.5 rounded-full"
                      style={{ backgroundColor: etiqueta.color }}
                    />
                    <Text
                      className={`text-[13px] font-semibold ${
                        seleccionada ? 'text-[#F7F8F5]' : 'text-text'
                      }`}
                    >
                      {etiqueta.nombre}
                    </Text>
                    {seleccionada ? (
                      <Ionicons name="checkmark" size={13} color="#F7F8F5" />
                    ) : null}
                  </Pressable>
                );
              })}
            </View>
          )}

          {!soloLectura ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Guardar cambios"
              disabled={!puedeGuardar || guardar.isPending}
              onPress={() => {
                if (!tituloValido) {
                  setErrorTitulo('El título es obligatorio (máximo 200 caracteres).');
                  return;
                }
                guardar.mutate();
              }}
              className={`min-h-[52px] flex-row items-center justify-center gap-2 rounded-2xl ${
                !puedeGuardar || guardar.isPending ? 'bg-[#3F6E5B] opacity-60' : 'bg-primary'
              }`}
            >
              {guardar.isPending ? (
                <ActivityIndicator color="#F7F8F5" />
              ) : (
                <>
                  <Ionicons name="checkmark" size={20} color="#F7F8F5" />
                  <Text className="text-[16px] font-semibold text-[#F7F8F5]">
                    Guardar cambios
                  </Text>
                </>
              )}
            </Pressable>
          ) : null}
        </View>

        {/* Subtareas (un solo nivel: no se muestran si esta tarea ya es subtarea) */}
        {!esSubtarea ? (
          <View className="mt-5 rounded-2xl border border-secondary bg-white px-5 py-5">
            <View className="flex-row items-center justify-between">
              <Text style={{ fontFamily: 'Georgia' }} className="text-[17px] text-primary">
                Subtareas
              </Text>
              <Text className="text-[12px] text-text opacity-60">
                {subtareas.length} {subtareas.length === 1 ? 'subtarea' : 'subtareas'}
              </Text>
            </View>

            {subtareas.length > 0 ? (
              <View className="mt-3">
                {subtareas.map((sub, indice) => {
                  const hecha = sub.estado === 'HECHA';
                  const esUltima = indice === subtareas.length - 1;
                  return (
                    <View
                      key={sub.id}
                      className={`flex-row items-center gap-3 py-3 ${
                        esUltima ? '' : 'border-b border-secondary'
                      }`}
                    >
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Estado: ${ESTADO_ETIQUETA[sub.estado]}. Tocar para cambiar.`}
                        hitSlop={8}
                        disabled={soloLectura}
                        onPress={() =>
                          cambiarEstadoSubtarea.mutate({
                            id: sub.id,
                            estado: ESTADO_SIGUIENTE[sub.estado],
                          })
                        }
                      >
                        <Ionicons
                          name={ESTADO_ICON[sub.estado]}
                          size={22}
                          color={hecha ? colors.primary : sub.vencida ? '#B3261E' : '#8A968E'}
                        />
                      </Pressable>
                      <View className="flex-1">
                        <Text
                          numberOfLines={2}
                          className={`text-[14px] leading-5 ${
                            hecha ? 'text-text opacity-50' : 'text-text'
                          }`}
                          style={hecha ? { textDecorationLine: 'line-through' } : undefined}
                        >
                          {sub.titulo}
                        </Text>
                        {sub.fechaLimite ? (
                          <Text
                            className={`mt-0.5 text-[11px] ${
                              sub.vencida ? 'font-semibold text-[#B3261E]' : 'text-text opacity-60'
                            }`}
                          >
                            {formatFechaCorta(sub.fechaLimite)}
                          </Text>
                        ) : null}
                      </View>
                      {!soloLectura ? (
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={`Eliminar subtarea ${sub.titulo}`}
                          hitSlop={8}
                          onPress={() => confirmarEliminarSubtarea(sub.id, sub.titulo)}
                          className="h-10 w-10 items-center justify-center rounded-full active:bg-secondary"
                        >
                          <Ionicons name="trash-outline" size={19} color="#B3261E" />
                        </Pressable>
                      ) : null}
                    </View>
                  );
                })}
              </View>
            ) : (
              <Text className="mt-2 text-[13px] leading-5 text-text opacity-70">
                Aún no hay subtareas. Divide la tarea en pasos pequeños.
              </Text>
            )}

            {!soloLectura ? (
              <View className="mt-3 flex-row items-center gap-2">
                <TextInput
                  accessibilityLabel="Título de la nueva subtarea"
                  value={nuevaSubtarea}
                  onChangeText={setNuevaSubtarea}
                  onSubmitEditing={() => {
                    const t = nuevaSubtarea.trim();
                    if (t) agregarSubtarea.mutate(t);
                  }}
                  placeholder="Añadir subtarea…"
                  placeholderTextColor="#8A968E"
                  maxLength={200}
                  returnKeyType="done"
                  className="min-h-[48px] flex-1 rounded-xl border border-[#D5DFD8] bg-background px-4 text-[15px] text-text"
                />
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Añadir subtarea"
                  disabled={nuevaSubtarea.trim().length === 0 || agregarSubtarea.isPending}
                  onPress={() => agregarSubtarea.mutate(nuevaSubtarea.trim())}
                  className={`h-12 w-12 items-center justify-center rounded-xl ${
                    nuevaSubtarea.trim().length === 0 || agregarSubtarea.isPending
                      ? 'bg-secondary'
                      : 'bg-primary'
                  }`}
                >
                  {agregarSubtarea.isPending ? (
                    <ActivityIndicator color="#F7F8F5" size="small" />
                  ) : (
                    <Ionicons
                      name="add"
                      size={24}
                      color={nuevaSubtarea.trim().length === 0 ? '#8A968E' : '#F7F8F5'}
                    />
                  )}
                </Pressable>
              </View>
            ) : null}
          </View>
        ) : null}

        {/* Eliminar tarea */}
        {!soloLectura ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Eliminar tarea"
            disabled={eliminar.isPending}
            onPress={confirmarEliminar}
            className="mt-5 min-h-[52px] flex-row items-center justify-center gap-2 rounded-2xl border border-[#B3261E] active:bg-[#FAE8E6]"
          >
            {eliminar.isPending ? (
              <ActivityIndicator color="#B3261E" />
            ) : (
              <>
                <Ionicons name="trash-outline" size={20} color="#B3261E" />
                <Text className="text-[15px] font-semibold text-[#B3261E]">Eliminar tarea</Text>
              </>
            )}
          </Pressable>
        ) : null}
      </ScrollView>

      {/* Confirmación de guardado */}
      {guardadoVisible ? (
        <View className="absolute bottom-6 left-4 right-4 flex-row items-center gap-2 rounded-xl border border-primary bg-[#EAF3EE] px-4 py-3">
          <Ionicons name="checkmark-circle" size={20} color={colors.primary} />
          <Text className="text-[13px] font-semibold text-primary">Cambios guardados</Text>
        </View>
      ) : null}

      {/* Error flotante de cualquier mutación */}
      {errorFlotante ? (
        <View className="absolute bottom-6 left-4 right-4 rounded-xl border border-[#E5B8B3] bg-[#FAE8E6] px-4 py-3">
          <Text className="text-[13px] leading-5 text-[#8C2F28]">
            {mensajeDeError(errorFlotante)}
          </Text>
        </View>
      ) : null}

      {/* Selectores */}
      <PickerModal<EstadoTarea>
        visible={picker === 'estado'}
        titulo="Estado"
        opciones={[
          { valor: 'PENDIENTE', etiqueta: 'Pendiente' },
          { valor: 'EN_CURSO', etiqueta: 'En curso' },
          { valor: 'HECHA', etiqueta: 'Hecha' },
        ]}
        valor={tarea.estado}
        onSeleccionar={(estado) => {
          if (estado && estado !== tarea.estado) cambiarEstado.mutate(estado);
        }}
        onCerrar={() => setPicker(null)}
        mostrarLimpiar={false}
      />
      <PickerModal<PrioridadTarea>
        visible={picker === 'prioridad'}
        titulo="Prioridad"
        opciones={PRIORIDAD_ORDEN.map((p) => ({ valor: p, etiqueta: PRIORIDAD_ETIQUETA[p] }))}
        valor={prioridad}
        onSeleccionar={(p) => p && setPrioridad(p)}
        onCerrar={() => setPicker(null)}
        mostrarLimpiar={false}
      />
      <PickerModal<string>
        visible={picker === 'responsable'}
        titulo="Responsable"
        opciones={miembros.map((m) => ({ valor: m.id, etiqueta: m.nombre, detalle: m.email }))}
        valor={responsableId}
        onSeleccionar={setResponsableId}
        onCerrar={() => setPicker(null)}
        limpiarEtiqueta="Sin responsable"
      />
    </KeyboardAvoidingView>
  );
}
