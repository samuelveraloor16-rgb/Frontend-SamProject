import { Text, View } from 'react-native';

type ErrorBannerProps = {
  mensaje: string | null;
};

/** Aviso de error inline (servidor o negocio). No es decorativo: explica qué pasó. */
export function ErrorBanner({ mensaje }: ErrorBannerProps) {
  if (!mensaje) return null;
  return (
    <View
      accessibilityLiveRegion="polite"
      className="mb-4 w-full rounded-xl border border-[#E5B8B3] bg-[#FAE8E6] px-4 py-3"
    >
      <Text className="text-[14px] leading-5 text-[#8C2F28]">{mensaje}</Text>
    </View>
  );
}
