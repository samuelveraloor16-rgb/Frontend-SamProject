import { useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useAuth } from '../auth/AuthContext';
import { crearEspacio, listarEspacios, obtenerBandejaTotal } from '../api/espacios';
import { mensajeDeError } from '../api/client';
import { colors } from '../theme/colors';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import type { PrincipalTabParamList, RootStackParamList } from '../navigation/types';

const ROL_LABEL: Record<string, string> = {
  ADMINISTRADOR: 'Administrador',
  MIEMBRO: 'Miembro',
};

type Nav = NativeStackNavigationProp<RootStackParamList>;
type TabNav = BottomTabNavigationProp<PrincipalTabParamList>;

/**
 * Home autenticado (RF-05): solo datos reales del backend.
 * Lista los espacios del usuario con rol y total de miembros;
 * si no hay ninguno, ofrece crear uno.
 */
export function HomeScreen() {
  const { usuario, cerrarSesion, aviso } = useAuth();
  const navigation = useNavigation<Nav>();
  const tabNavigation = useNavigation<TabNav>();
  const queryClient = useQueryClient();
  const [cerrando, setCerrando] = useState(false);

  const espaciosQuery = useQuery({ queryKey: ['espacios'], queryFn: listarEspacios });
  const espacios = espaciosQuery.data?.datos ?? [];
  const espacioPersonal = espacios.find((e) => e.esPersonal) ?? null;

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
          <RefreshControl
            refreshing={refrescando}
            onRefresh={refrescar}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        }
      >
        {aviso ? <Text accessibilityLiveRegion="polite" className="mb-4 text-text">{aviso}</Text> : null}
        <Text style={{ fontFamily: 'Georgia' }} className="text-[26px] leading-8 text-primary">
          Hola, {usuario.nombre}
        </Text>
        <Text className="mt-1 text-[14px] text-text opacity-80">{usuario.email}</Text>
        <Pressable accessibilityRole="button" onPress={() => navigation.navigate('Perfil')} style={{ minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' }}>
          <Text className="text-primary font-semibold underline">Perfil</Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Notificaciones" onPress={() => navigation.navigate('Notificaciones')} style={{ minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' }}>
          <Text className="text-primary font-semibold underline">Notificaciones</Text>
        </Pressable>
        <View className="mt-4 h-[3px] w-14 rounded-full bg-tertiary" />

        {/* Espacios del usuario */}
        <View className="mb-2 mt-8 flex-row items-end justify-between">
          <Text className="text-[13px] font-semibold text-text opacity-70">Tus espacios</Text>
          {espacios.length > 0 ? (
            <Text className="text-[12px] text-text opacity-60">
              {espacios.length} {espacios.length === 1 ? 'espacio' : 'espacios'}
            </Text>
          ) : null}
        </View>

        {espaciosQuery.isLoading ? (
          <View className="items-center rounded-2xl border border-secondary bg-white px-5 py-8">
            <ActivityIndicator color={colors.primary} />
            <Text className="mt-3 text-[14px] text-text">Cargando tus espacios…</Text>
          </View>
        ) : espaciosQuery.isError ? (
          <TarjetaError
            mensaje="No pudimos cargar tus espacios. Revisa tu conexión."
            onReintentar={() => void espaciosQuery.refetch()}
          />
        ) : espacios.length === 0 ? (
          <CrearEspacioCard
            nombreSugerido={`Espacio de ${usuario.nombre}`}
            onCreado={() => void queryClient.invalidateQueries({ queryKey: ['espacios'] })}
          />
        ) : (
          espacios.map((espacio) => (
            <Pressable
              key={espacio.id}
              accessibilityRole="button"
              accessibilityLabel={`Abrir ${espacio.nombre}`}
              onPress={() => navigation.navigate('Espacio', { espacioId: espacio.id })}
              className="mb-3 flex-row items-center gap-3 rounded-2xl border border-secondary bg-white px-4 py-4 active:bg-secondary"
            >
              <View className="h-12 w-12 items-center justify-center rounded-xl bg-secondary">
                <Ionicons
                  name={espacio.esPersonal ? 'person-outline' : 'people-outline'}
                  size={22}
                  color={colors.primary}
                />
              </View>
              <View className="flex-1">
                <Text numberOfLines={1} className="text-[16px] font-semibold text-text">
                  {espacio.nombre}
                </Text>
                <Text className="mt-0.5 text-[12px] text-text opacity-70">
                  {espacio.esPersonal ? 'Espacio personal' : 'Espacio de equipo'} ·{' '}
                  {ROL_LABEL[espacio.miRol] ?? espacio.miRol} · {espacio.totalMiembros}{' '}
                  {espacio.totalMiembros === 1 ? 'miembro' : 'miembros'}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={colors.primary} />
            </Pressable>
          ))
        )}

        {/* Acceso rápido a la Bandeja (pestaña principal) */}
        <Text className="mb-2 mt-6 text-[13px] font-semibold text-text opacity-70">
          Bandeja de entrada
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Abrir Bandeja de entrada"
          onPress={() => tabNavigation.navigate('Bandeja')}
          className="flex-row items-center gap-3 rounded-2xl border border-secondary bg-white px-4 py-4 active:bg-secondary"
        >
          <View className="h-12 w-12 items-center justify-center rounded-xl bg-tertiary">
            <Ionicons name="file-tray-outline" size={22} color={colors.text} />
          </View>
          <View className="flex-1">
            {bandejaQuery.isLoading ? (
              <ActivityIndicator color={colors.primary} style={{ alignSelf: 'flex-start' }} />
            ) : (
              <Text style={{ fontFamily: 'Georgia' }} className="text-[22px] leading-6 text-primary">
                {bandejaQuery.data?.meta.total ?? 0}
              </Text>
            )}
            <Text className="mt-0.5 text-[13px] text-text opacity-80">
              {bandejaQuery.data?.meta.total === 1
                ? 'tarea esperando en tu Bandeja'
                : 'tareas esperando en tu Bandeja'}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={colors.primary} />
        </Pressable>

        {/* Aceptar invitación por token */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Aceptar una invitación con token"
          onPress={() => navigation.navigate('AceptarInvitacion', undefined)}
          className="mt-6 flex-row items-center justify-center gap-2 self-center rounded-full px-4 py-2 active:bg-secondary"
          hitSlop={6}
        >
          <Ionicons name="mail-open-outline" size={18} color={colors.primary} />
          <Text className="text-[13px] font-semibold text-primary underline">
            ¿Tienes una invitación? Aceptarla
          </Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

/** Tarjeta de creación de espacio cuando la cuenta no tiene ninguno. */
function CrearEspacioCard({
  nombreSugerido,
  onCreado,
}: {
  nombreSugerido: string;
  onCreado: () => void;
}) {
  const [nombre, setNombre] = useState(nombreSugerido);
  const crear = useMutation({
    mutationFn: (n: string) => crearEspacio(n.trim()),
    onSuccess: onCreado,
  });
  const valido = nombre.trim().length >= 2;

  return (
    <View className="rounded-2xl border border-secondary bg-white px-5 py-5">
      <View className="flex-row items-center gap-3">
        <View className="h-11 w-11 items-center justify-center rounded-xl bg-secondary">
          <Ionicons name="add-circle-outline" size={24} color={colors.primary} />
        </View>
        <Text className="flex-1 text-[15px] font-semibold text-text">Aún no tienes un espacio</Text>
      </View>
      <Text className="mt-3 text-[13px] leading-5 text-text opacity-80">
        Crea tu espacio para organizar proyectos y tareas. Serás su administrador.
      </Text>
      <TextInput
        accessibilityLabel="Nombre del espacio"
        value={nombre}
        onChangeText={setNombre}
        placeholder="Nombre del espacio"
        placeholderTextColor="#8A968E"
        maxLength={120}
        className="mt-3 min-h-[48px] rounded-xl border border-secondary bg-background px-4 text-[15px] text-text"
      />
      {crear.isError ? (
        <Text className="mt-2 text-[13px] text-[#B3261E]">{mensajeDeError(crear.error)}</Text>
      ) : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Crear espacio"
        disabled={!valido || crear.isPending}
        onPress={() => crear.mutate(nombre)}
        className={`mt-3 items-center rounded-xl py-3 ${!valido || crear.isPending ? 'bg-[#3F6E5B] opacity-60' : 'bg-primary'}`}
      >
        {crear.isPending ? (
          <ActivityIndicator color="#F7F8F5" />
        ) : (
          <Text className="text-[15px] font-semibold text-[#F7F8F5]">Crear mi espacio</Text>
        )}
      </Pressable>
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
