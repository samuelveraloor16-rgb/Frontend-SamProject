import { ActivityIndicator, Pressable, Text } from 'react-native';
import { colors } from '../theme/colors';

type PrimaryButtonProps = {
  titulo: string;
  onPress: () => void;
  cargando?: boolean;
  deshabilitado?: boolean;
};

/** Botón primario institucional: verde profundo, texto claro, estado de carga. */
export function PrimaryButton({ titulo, onPress, cargando = false, deshabilitado = false }: PrimaryButtonProps) {
  const inactivo = cargando || deshabilitado;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: inactivo, busy: cargando }}
      disabled={inactivo}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: 52,
        borderRadius: 12,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 20,
        backgroundColor: inactivo ? '#3F6E5B' : pressed ? '#1C4738' : colors.primary,
        opacity: deshabilitado && !cargando ? 0.6 : 1,
      })}
    >
      {cargando ? (
        <ActivityIndicator color="#F7F8F5" />
      ) : (
        <Text className="text-[16px] font-semibold tracking-wide text-[#F7F8F5]">{titulo}</Text>
      )}
    </Pressable>
  );
}
