import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { aceptarInvitacion } from '../api/espacios';
import { mensajeDeError } from '../api/client';
import { colors } from '../theme/colors';
import type { RootStackParamList } from '../navigation/types';
import { useAuth } from '../auth/AuthContext';
import { ScreenHeader } from '../components/ScreenHeader';

type Nav = NativeStackNavigationProp<RootStackParamList>;
type Ruta = RouteProp<RootStackParamList, 'AceptarInvitacion'>;

/**
 * Aceptación de invitación por token (RF-06).
 * Punto de entrada: enlace samproject://invitar?token=... o pegando el token a mano.
 * El backend exige que el correo del token coincida con el del usuario autenticado.
 */
export function AceptarInvitacionScreen() {
  const route = useRoute<Ruta>();
  const navigation = useNavigation<Nav>();
  const queryClient = useQueryClient();
  const { estado } = useAuth();
  const [token, setToken] = useState(route.params?.token ?? '');

  const aceptar = useMutation({
    mutationFn: (t: string) => aceptarInvitacion(t.trim()),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['espacios'] });
    },
  });

  const valido = token.trim().length >= 16;

  const irAlEspacio = () => {
    const espacioId = aceptar.data?.espacio.id;
    if (espacioId) {
      navigation.replace('Espacio', { espacioId });
    } else {
      navigation.replace('Principal');
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      className="flex-1 bg-background"
    >
      <ScreenHeader titulo="Aceptar invitación" subtitulo="Únete a un espacio de trabajo" />
      {estado !== 'autenticado' ? (
        <View className="flex-1 items-center justify-center px-8">
          <Ionicons name="lock-closed-outline" size={40} color={colors.primary} />
          <Text style={{ fontFamily: 'Georgia' }} className="mt-4 text-center text-[20px] text-primary">
            Inicia sesión primero
          </Text>
          <Text className="mt-2 text-center text-[14px] leading-6 text-text opacity-80">
            Las invitaciones se aceptan con tu cuenta. Entra y vuelve a abrir el enlace
            (o pega el código después en Inicio).
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => navigation.navigate('Acceso')}
            className="mt-6 min-h-[52px] items-center justify-center rounded-2xl bg-primary px-8"
          >
            <Text className="text-[16px] font-semibold text-[#F7F8F5]">Ir a Acceso</Text>
          </Pressable>
        </View>
      ) : (
      <ScrollView contentContainerStyle={{ padding: 24, paddingBottom: 48 }} keyboardShouldPersistTaps="handled">
        {aceptar.isSuccess ? (
          <View className="items-center rounded-2xl border border-secondary bg-white px-6 py-10">
            <View className="h-16 w-16 items-center justify-center rounded-full bg-secondary">
              <Ionicons name="checkmark-circle" size={40} color={colors.primary} />
            </View>
            <Text style={{ fontFamily: 'Georgia' }} className="mt-5 text-center text-[21px] text-primary">
              ¡Bienvenido a {aceptar.data.espacio.nombre}!
            </Text>
            <Text className="mt-2 text-center text-[14px] leading-5 text-text opacity-80">
              {aceptar.data.mensaje}. Ya puedes ver sus proyectos y tareas.
            </Text>
            <Pressable
              accessibilityRole="button"
              onPress={irAlEspacio}
              className="mt-6 min-h-[52px] items-center justify-center rounded-2xl bg-primary px-8 active:opacity-80"
            >
              <Text className="text-[16px] font-semibold text-[#F7F8F5]">Ir al espacio</Text>
            </Pressable>
          </View>
        ) : (
          <>
            <View className="h-12 w-12 items-center justify-center rounded-2xl bg-tertiary">
              <Ionicons name="mail-open-outline" size={26} color={colors.text} />
            </View>
            <Text style={{ fontFamily: 'Georgia' }} className="mt-4 text-[22px] leading-7 text-primary">
              Tienes una invitación
            </Text>
            <Text className="mt-1 text-[14px] leading-6 text-text opacity-80">
              Si recibiste un enlace de invitación, ábrelo directamente; si te han pasado
              el código, pégalo aquí. El enlace caduca a los 7 días y solo vale para el
              correo al que se envió.
            </Text>

            <Text className="mb-1.5 mt-6 text-[13px] font-semibold text-text">
              Código de invitación
            </Text>
            <TextInput
              accessibilityLabel="Código de invitación"
              autoCapitalize="none"
              autoCorrect={false}
              value={token}
              onChangeText={(t) => {
                setToken(t);
                aceptar.reset();
              }}
              placeholder="samproject://invitar?token=… o pega el token"
              placeholderTextColor="#8A968E"
              autoFocus={!route.params?.token}
              multiline
              className="min-h-[88px] rounded-2xl border border-secondary bg-white px-4 py-3 text-[15px] text-text"
            />

            {aceptar.isError ? (
              <Text className="mt-2 text-[13px] leading-5 text-[#B3261E]">
                {mensajeDeError(aceptar.error)}
              </Text>
            ) : null}

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Aceptar invitación"
              disabled={!valido || aceptar.isPending}
              onPress={() => aceptar.mutate(limpiarToken(token))}
              className={`mt-5 min-h-[56px] flex-row items-center justify-center gap-2 rounded-2xl ${
                !valido || aceptar.isPending ? 'bg-[#3F6E5B] opacity-60' : 'bg-primary'
              }`}
            >
              {aceptar.isPending ? (
                <ActivityIndicator color="#F7F8F5" />
              ) : (
                <>
                  <Ionicons name="checkmark-circle-outline" size={22} color="#F7F8F5" />
                  <Text className="text-[17px] font-semibold text-[#F7F8F5]">Aceptar invitación</Text>
                </>
              )}
            </Pressable>
          </>
        )}
      </ScrollView>
      )}
    </KeyboardAvoidingView>
  );
}

/** Acepta tanto un token pelado como el enlace completo samproject://invitar?token=... */
function limpiarToken(entrada: string): string {
  const m = entrada.match(/token=([A-Za-z0-9]+)/);
  return m ? m[1] : entrada.trim();
}
