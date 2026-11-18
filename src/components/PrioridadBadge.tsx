import type { PrioridadTarea } from '../api/types';
import { Text, View } from 'react-native';

const PRIORIDAD: Record<PrioridadTarea, { etiqueta: string; color: string; fondo: string }> = {
  BAJA: { etiqueta: 'Baja', color: '#3F5A4D', fondo: '#E7EFE9' },
  MEDIA: { etiqueta: 'Media', color: '#6B5B15', fondo: '#F4EDD3' },
  ALTA: { etiqueta: 'Alta', color: '#8C4A12', fondo: '#F7E3CE' },
  URGENTE: { etiqueta: 'Urgente', color: '#8C2F28', fondo: '#FAE0DD' },
};

export const PRIORIDAD_ORDEN: PrioridadTarea[] = ['BAJA', 'MEDIA', 'ALTA', 'URGENTE'];

/** Etiqueta compacta de prioridad (punto + texto), semántica accesible. */
export function PrioridadBadge({ prioridad }: { prioridad: PrioridadTarea }) {
  const p = PRIORIDAD[prioridad] ?? PRIORIDAD.MEDIA;
  return (
    <View
      accessibilityLabel={`Prioridad ${p.etiqueta}`}
      className="flex-row items-center gap-1.5 self-start rounded-full px-2 py-0.5"
      style={{ backgroundColor: p.fondo }}
    >
      <View className="h-2 w-2 rounded-full" style={{ backgroundColor: p.color }} />
      <Text className="text-[11px] font-semibold" style={{ color: p.color }}>
        {p.etiqueta}
      </Text>
    </View>
  );
}
