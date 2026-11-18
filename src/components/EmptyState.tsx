import { Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme/colors';

type EmptyStateProps = {
  icono: keyof typeof Ionicons.glyphMap;
  titulo: string;
  detalle?: string;
  accion?: React.ReactNode;
};

/** Estado vacío centrado: invita a actuar, no decora. */
export function EmptyState({ icono, titulo, detalle, accion }: EmptyStateProps) {
  return (
    <View className="items-center px-8 py-10">
      <View className="h-14 w-14 items-center justify-center rounded-2xl bg-secondary">
        <Ionicons name={icono} size={26} color={colors.primary} />
      </View>
      <Text className="mt-4 text-center text-[16px] font-semibold text-text">{titulo}</Text>
      {detalle ? (
        <Text className="mt-1 text-center text-[13px] leading-5 text-text opacity-80">{detalle}</Text>
      ) : null}
      {accion ? <View className="mt-5">{accion}</View> : null}
    </View>
  );
}
