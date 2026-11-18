import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { listarEspacios } from '../api/espacios';
import { mensajeDeError } from '../api/client';
import { colors } from '../theme/colors';
import { TareasContent } from '../components/TareasContent';
import { ScreenHeader } from '../components/ScreenHeader';

/**
 * Pestaña principal «Bandeja» (RF-13): la Bandeja de entrada del espacio
 * personal (o el primero disponible). Misma lista de tareas, mismo filtro
 * «bandeja»; desde aquí se crea la tarea rápida en dos toques.
 */
export function BandejaTabScreen() {
  const espaciosQuery = useQuery({ queryKey: ['espacios'], queryFn: listarEspacios });
  const espacios = espaciosQuery.data?.datos ?? [];
  const espacio = espacios.find((e) => e.esPersonal) ?? espacios[0] ?? null;

  if (espaciosQuery.isLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  if (espaciosQuery.isError) {
    return (
      <View className="flex-1 bg-background">
        <ScreenHeader titulo="Bandeja de entrada" sinAtras />
        <View className="m-4 rounded-2xl border border-[#E5B8B3] bg-[#FAE8E6] px-5 py-5">
          <Text className="text-[14px] leading-5 text-[#8C2F28]">
            {mensajeDeError(espaciosQuery.error, 'No pudimos cargar tus espacios.')}
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => void espaciosQuery.refetch()}
            className="mt-3 self-start rounded-full border border-[#8C2F28] px-4 py-2"
          >
            <Text className="text-[13px] font-semibold text-[#8C2F28]">Reintentar</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  if (!espacio) {
    return (
      <View className="flex-1 bg-background">
        <ScreenHeader titulo="Bandeja de entrada" sinAtras />
        <View className="items-center px-10 py-16">
          <Ionicons name="file-tray-outline" size={40} color={colors.primary} />
          <Text className="mt-4 text-center text-[15px] leading-6 text-text">
            Tu cuenta aún no tiene un espacio. Créalo desde Inicio para que tu Bandeja
            empiece a recoger tareas.
          </Text>
        </View>
      </View>
    );
  }

  return <TareasContent modo="bandeja" espacioId={espacio.id} sinAtras />;
}
