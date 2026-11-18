import { View } from 'react-native';
import { colors } from '../theme/colors';

type ProgresoBarProps = {
  /** Porcentaje 0-100 calculado por el backend (RF-11). */
  progreso: number;
  alto?: number;
};

/** Barra de progreso institucional: riel secondary, relleno primary, tope tertiary al 100%. */
export function ProgresoBar({ progreso, alto = 10 }: ProgresoBarProps) {
  const valor = Math.max(0, Math.min(100, progreso));
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: Math.round(valor) }}
      className="w-full overflow-hidden rounded-full bg-secondary"
      style={{ height: alto }}
    >
      <View
        className="h-full rounded-full"
        style={{
          width: `${valor}%`,
          backgroundColor: valor >= 100 ? colors.tertiary : colors.primary,
        }}
      />
    </View>
  );
}
