import { Image, Text, View } from 'react-native';

type PlaceholderScreenProps = {
  titulo: string;
  detalle: string;
};

/**
 * Pantalla placeholder institucional (scaffold, Fase 1).
 * Se reemplazará por las pantallas reales cuando se construyan.
 */
export function PlaceholderScreen({ titulo, detalle }: PlaceholderScreenProps) {
  return (
    <View className="flex-1 items-center justify-center bg-background px-6">
      <Image
        source={require('../../assets/Logo.png')}
        accessibilityLabel="Logotipo de SamProject"
        resizeMode="contain"
        style={{ width: 220, height: 124 }}
      />
      <Text className="mt-6 text-2xl font-semibold text-primary">{titulo}</Text>
      <View className="mt-3 h-1 w-16 rounded-full bg-tertiary" />
      <Text className="mt-3 text-center text-base text-text">{detalle}</Text>
    </View>
  );
}
