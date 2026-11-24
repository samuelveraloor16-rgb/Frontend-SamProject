import type { ReactNode } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  Image,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Text,
  View,
} from 'react-native';

type AuthLayoutProps = {
  titulo: string;
  subtitulo: string;
  children: ReactNode;
  pie: ReactNode;
};

/**
 * Marco editorial-institucional para las pantallas de acceso:
 * fondo cálido, logo centrado, titulares en serif (Georgia) y
 * la regla de oro como único motivo decorativo.
 */
export function AuthLayout({ titulo, subtitulo, children, pie }: AuthLayoutProps) {
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#F7F8F5' }}>
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      className="flex-1 bg-background"
    >
      <ScrollView
        contentContainerStyle={{ flexGrow: 1 }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View className="items-center px-6 pb-8 pt-12">
          <Image
            source={require('../../assets/Logo.png')}
            accessibilityLabel="Logotipo de SamProject"
            resizeMode="contain"
            style={{ width: 190, height: 107 }}
          />
          <Text
            accessibilityRole="header"
            style={{ fontFamily: 'Georgia' }}
            className="mt-6 text-center text-[28px] leading-9 text-primary"
          >
            {titulo}
          </Text>
          <View className="mt-3 h-[3px] w-14 rounded-full bg-tertiary" />
          <Text className="mt-3 max-w-[340px] text-center text-[15px] leading-6 text-text">
            {subtitulo}
          </Text>

          <View className="mt-8 w-full max-w-[420px]">{children}</View>

          <View className="mt-6 items-center">{pie}</View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
