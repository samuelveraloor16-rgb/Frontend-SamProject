import { useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../auth/AuthContext';
import { listarEspacios, obtenerBandejaTotal } from '../api/espacios';
import { colors } from '../theme/colors';

const ROL_LABEL: Record<string, string> = {
  ADMINISTRADOR: 'Administrador',
  MIEMBRO: 'Miembro',
};

/**
 * Home autenticado: solo datos reales del backend.
 *  - Perfil (contexto de sesión, verificado contra /perfil al arrancar).
 *  - Espacios del usuario (GET /espacios): aquí aparece el espacio personal
 *    creado al registrarse.
 *  - Bandeja de entrada (GET /espacios/:id/bandeja?pageSize=1): meta.total
 *    lo calcula el backend; la app no cuenta nada.
 */
export function HomeScreen() {
  const { usuario, cerrarSesion } = useAuth();
  const [cerrando, setCerrando] = useState(false);

  const espaciosQuery = useQuery({
    queryKey: ['espacios'],
    queryFn: listarEspacios,
  });

  const espacios = espaciosQuery.data?.datos ?? [];
  const espacioPersonal = espacios.find((e) => e.esPersonal) ?? espacios[0] ?? null;

  const bandejaQuery = useQuery({
    queryKey: ['bandeja-total', espacioPersonal?.id],
    queryFn: () => obtenerBandejaTotal(espacioPersonal!.id),
    enabled: espacioPersonal != null,
  });

  const refrescando = espaciosQuery.isRefetching || bandejaQuery.isRefetching;
  const refrescar = () => {
    void espaciosQuery.refetch();
    if (espacioPersonal) void bandejaQuery.refetch();
  };

  const salir = async () => {
    setCerrando(true);
    try {
      await cerrarSesion();
    } finally {
      setCerrando(false);
    }
  };

  if (!usuario) return null;

  return (
    <View className="flex-1 bg-background">
      {/* Barra superior: logo + cerrar sesión */}
      <View className="flex-row items-center justify-between border-b border-secondary px-5 pb-3 pt-14">
        <Image
          source={require('../../assets/Logo.png')}
          accessibilityLabel="SamProject"
          resizeMode="contain"
          style={{ width: 118, height: 66 }}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Cerrar sesión"
          disabled={cerrando}
          onPress={salir}
          hitSlop={8}
          className="flex-row items-center gap-2 rounded-full border border-secondary px-4 py-2 active:bg-secondary"
        >
          {cerrando ? (
            <ActivityIndicator size="small" color={colors.primary} />
          ) : (
            <Ionicons name="log-out-outline" size={18} color={colors.primary} />
          )}
          <Text className="text-[14px] font-semibold text-primary">Cerrar sesión</Text>
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 24, paddingBottom: 40 }}
        refreshControl={
          <RefreshControl refreshing={refrescando} onRefresh={refrescar} tintColor={colors.primary} colors={[colors.primary]} />
        }
      >
        {/* Saludo con el nombre real del perfil */}
        <Text style={{ fontFamily: 'Georgia' }} className="text-[26px] leading-8 text-primary">
          Hola, {usuario.nombre}
        </Text>
        <Text className="mt-1 text-[14px] text-text opacity-80">{usuario.email}</Text>
        <View className="mt-4 h-[3px] w-14 rounded-full bg-tertiary" />

        {/* Espacio personal (creado al registrarse) */}
        <Text className="mb-2 mt-8 text-[13px] font-semibold text-text opacity-70">
          Tu espacio
        </Text>
        {espaciosQuery.isLoading ? (
          <View className="items-center rounded-2xl border border-secondary bg-white px-5 py-8">
            <ActivityIndicator color={colors.primary} />
            <Text className="mt-3 text-[14px] text-text">Cargando tu espacio…</Text>
          </View>
        ) : espaciosQuery.isError ? (
          <TarjetaError
            mensaje="No pudimos cargar tu espacio. Revisa tu conexión."
            onReintentar={() => void espaciosQuery.refetch()}
          />
        ) : espacioPersonal ? (
          <View className="rounded-2xl border border-secondary bg-white px-5 py-5">
            <View className="flex-row items-center gap-3">
              <View className="h-11 w-11 items-center justify-center rounded-xl bg-secondary">
                <Ionicons
                  name={espacioPersonal.esPersonal ? 'person-outline' : 'people-outline'}
                  size={22}
                  color={colors.primary}
                />
              </View>
              <View className="flex-1">
                <Text className="text-[16px] font-semibold text-text">{espacioPersonal.nombre}</Text>
                <Text className="text-[12px] text-text opacity-70">
                  {espacioPersonal.esPersonal ? 'Espacio personal' : 'Espacio de equipo'}
                </Text>
              </View>
            </View>
            <View className="mt-4 flex-row border-t border-secondary pt-4">
              <DatoEtiqueta etiqueta="Rol" valor={ROL_LABEL[espacioPersonal.miRol] ?? espacioPersonal.miRol} />
              <View className="mx-4 w-px bg-secondary" />
              <DatoEtiqueta etiqueta="Miembros" valor={String(espacioPersonal.totalMiembros)} />
            </View>
          </View>
        ) : (
          <TarjetaError mensaje="Tu cuenta aún no tiene un espacio. Inténtalo de nuevo." onReintentar={() => void espaciosQuery.refetch()} />
        )}

        {/* Bandeja de entrada (proyecto por defecto, creado con el espacio) */}
        <Text className="mb-2 mt-6 text-[13px] font-semibold text-text opacity-70">
          Bandeja de entrada
        </Text>
        {bandejaQuery.isLoading ? (
          <View className="items-center rounded-2xl border border-secondary bg-white px-5 py-8">
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : bandejaQuery.isError ? (
          <TarjetaError
            mensaje="No pudimos cargar tu Bandeja de entrada."
            onReintentar={() => void bandejaQuery.refetch()}
          />
        ) : (
          <View className="rounded-2xl border border-secondary bg-white px-5 py-5">
            <View className="flex-row items-center gap-3">
              <View className="h-11 w-11 items-center justify-center rounded-xl bg-tertiary">
                <Ionicons name="file-tray-outline" size={22} color={colors.text} />
              </View>
              <View className="flex-1">
                <Text style={{ fontFamily: 'Georgia' }} className="text-[24px] leading-7 text-primary">
                  {bandejaQuery.data?.meta.total ?? 0}
                </Text>
                <Text className="text-[13px] text-text opacity-80">
                  {bandejaQuery.data?.meta.total === 1 ? 'tarea en tu Bandeja' : 'tareas en tu Bandeja'}
                </Text>
              </View>
            </View>
            <Text className="mt-4 border-t border-secondary pt-4 text-[13px] leading-5 text-text opacity-80">
              Aquí llegan tus tareas rápidas. Las vistas de proyectos, tareas y Kanban llegarán en los
              próximos tramos de la Fase 1.
            </Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

function DatoEtiqueta({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  return (
    <View className="flex-1">
      <Text className="text-[11px] text-text opacity-60">{etiqueta}</Text>
      <Text className="mt-0.5 text-[15px] font-semibold text-text">{valor}</Text>
    </View>
  );
}

function TarjetaError({ mensaje, onReintentar }: { mensaje: string; onReintentar: () => void }) {
  return (
    <View className="rounded-2xl border border-[#E5B8B3] bg-[#FAE8E6] px-5 py-5">
      <View className="flex-row items-center gap-2">
        <Ionicons name="alert-circle-outline" size={20} color="#8C2F28" />
        <Text className="flex-1 text-[14px] leading-5 text-[#8C2F28]">{mensaje}</Text>
      </View>
      <Pressable
        accessibilityRole="button"
        onPress={onReintentar}
        className="mt-3 self-start rounded-full border border-[#8C2F28] px-4 py-2 active:bg-[#F3D4D0]"
      >
        <Text className="text-[13px] font-semibold text-[#8C2F28]">Reintentar</Text>
      </Pressable>
    </View>
  );
}
