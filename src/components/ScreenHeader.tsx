import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { colors } from '../theme/colors';

type ScreenHeaderProps = {
  titulo: string;
  subtitulo?: string;
  /** true en pantallas raíz de una pestaña (sin botón atrás). */
  sinAtras?: boolean;
  derecha?: React.ReactNode;
};

/** Barra superior institucional: atrás + título Georgia + acción opcional a la derecha. */
export function ScreenHeader({ titulo, subtitulo, sinAtras = false, derecha }: ScreenHeaderProps) {
  const navigation = useNavigation();
  return (
    <View className="border-b border-secondary bg-background px-4 pb-3 pt-14">
      <View className="flex-row items-center gap-2">
        {sinAtras ? (
          <View className="h-11 w-11" />
        ) : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Volver"
            hitSlop={8}
            onPress={() => navigation.goBack()}
            className="h-11 w-11 items-center justify-center rounded-full active:bg-secondary"
          >
            <Ionicons name="arrow-back" size={22} color={colors.primary} />
          </Pressable>
        )}
        <View className="flex-1">
          <Text
            accessibilityRole="header"
            numberOfLines={1}
            style={{ fontFamily: 'Georgia' }}
            className="text-[20px] leading-6 text-primary"
          >
            {titulo}
          </Text>
          {subtitulo ? (
            <Text numberOfLines={1} className="mt-0.5 text-[12px] text-text opacity-70">
              {subtitulo}
            </Text>
          ) : null}
        </View>
        {derecha}
      </View>
    </View>
  );
}
