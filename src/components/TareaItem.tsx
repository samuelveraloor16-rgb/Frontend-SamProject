import { formatFechaLimite } from '../lib/format';
import type { Tarea } from '../api/types';
import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { PrioridadBadge } from './PrioridadBadge';

const ESTADO_SIGUIENTE: Record<Tarea['estado'], Tarea['estado']> = {
  PENDIENTE: 'EN_CURSO',
  EN_CURSO: 'HECHA',
  HECHA: 'PENDIENTE',
};

const ESTADO_ICON: Record<Tarea['estado'], keyof typeof Ionicons.glyphMap> = {
  PENDIENTE: 'ellipse-outline',
  EN_CURSO: 'time-outline',
  HECHA: 'checkmark-circle',
};

type TareaItemProps = {
  tarea: Tarea;
  /** Cambia el estado al siguiente (PENDIENTE → EN_CURSO → HECHA → PENDIENTE). */
  onCambiarEstado: (tarea: Tarea, siguiente: Tarea['estado']) => void;
};

/** Fila de tarea para listas: casilla de estado, título, metadatos y badge de vencida. */
export function TareaItem({ tarea, onCambiarEstado }: TareaItemProps) {
  const hecha = tarea.estado === 'HECHA';
  return (
    <View
      className={`mb-2 flex-row items-start gap-3 rounded-2xl border bg-white px-4 py-3 ${
        tarea.vencida ? 'border-[#E5B8B3]' : 'border-secondary'
      }`}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Estado: ${etiquetaEstado(tarea.estado)}. Tocar para cambiar.`}
        hitSlop={8}
        onPress={() => onCambiarEstado(tarea, ESTADO_SIGUIENTE[tarea.estado])}
        className="pt-0.5"
      >
        <Ionicons
          name={ESTADO_ICON[tarea.estado]}
          size={24}
          color={hecha ? colors.primary : tarea.vencida ? '#B3261E' : '#8A968E'}
        />
      </Pressable>

      <View className="flex-1">
        <Text
          numberOfLines={2}
          className={`text-[15px] font-semibold leading-5 ${
            hecha ? 'text-text opacity-50' : 'text-text'
          }`}
          style={hecha ? { textDecorationLine: 'line-through' } : undefined}
        >
          {tarea.titulo}
        </Text>

        <View className="mt-1.5 flex-row flex-wrap items-center gap-2">
          <PrioridadBadge prioridad={tarea.prioridad} />
          {tarea.fechaLimite ? (
            <View className="flex-row items-center gap-1">
              <Ionicons
                name="calendar-outline"
                size={13}
                color={tarea.vencida ? '#B3261E' : '#5A6660'}
              />
              <Text
                className={`text-[12px] ${tarea.vencida ? 'font-semibold text-[#B3261E]' : 'text-text opacity-75'}`}
              >
                {formatFechaLimite(tarea.fechaLimite)}
              </Text>
            </View>
          ) : null}
          {tarea.vencida ? (
            <View className="rounded-full bg-[#FAE0DD] px-2 py-0.5">
              <Text className="text-[11px] font-bold text-[#8C2F28]">Vencida</Text>
            </View>
          ) : null}
          {tarea.subtareas > 0 ? (
            <View className="flex-row items-center gap-1">
              <Ionicons name="git-branch-outline" size={13} color="#5A6660" />
              <Text className="text-[12px] text-text opacity-75">
                {tarea.subtareas} {tarea.subtareas === 1 ? 'subtarea' : 'subtareas'}
              </Text>
            </View>
          ) : null}
        </View>

        {tarea.responsable ? (
          <Text className="mt-1.5 text-[12px] text-text opacity-70">
            Responsable: {tarea.responsable.nombre}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

function etiquetaEstado(estado: Tarea['estado']): string {
  switch (estado) {
    case 'PENDIENTE':
      return 'Pendiente';
    case 'EN_CURSO':
      return 'En curso';
    case 'HECHA':
      return 'Hecha';
  }
}
