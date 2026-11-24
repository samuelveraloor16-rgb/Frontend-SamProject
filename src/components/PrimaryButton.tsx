import { useState } from 'react';
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
  const [pressed, setPressed] = useState(false);
  const inactivo = cargando || deshabilitado;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={titulo}
      accessibilityState={{ disabled: inactivo, busy: cargando }}
      disabled={inactivo}
      onPress={onPress}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      // NativeWind procesa el estilo inline: no pasar un callback de Pressable.
      style={{
        minHeight: 52,
        flexShrink: 0,
        flexDirection: 'row',
        gap: 8,
        borderRadius: 12,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 20,
        paddingVertical: 14,
        backgroundColor: inactivo ? '#3F6E5B' : pressed ? '#1C4738' : colors.primary,
      }}
    >
      {cargando && <ActivityIndicator color="#F7F8F5" />}
      <Text style={{ color: '#F7F8F5', fontSize: 16, fontWeight: '600', letterSpacing: 0.4, textAlign: 'center', flexShrink: 1 }}>{titulo}</Text>
    </Pressable>
  );
}
