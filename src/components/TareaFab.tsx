import { Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme/colors';

type FabProps = {
  onPress: () => void;
  etiqueta?: string;
};

/** Botón de acción flotante para la tarea rápida (RF-13, máximo dos toques). */
export function TareaFab({ onPress, etiqueta = 'Nueva tarea rápida' }: FabProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={etiqueta}
      onPress={onPress}
      hitSlop={8}
      style={({ pressed }) => ({
        position: 'absolute',
        right: 18,
        bottom: 26,
        height: 60,
        width: 60,
        borderRadius: 30,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: pressed ? '#1C4738' : colors.primary,
        shadowColor: '#000',
        shadowOpacity: 0.22,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 3 },
        elevation: 6,
      })}
    >
      <Ionicons name="add" size={30} color="#F7F8F5" />
    </Pressable>
  );
}
