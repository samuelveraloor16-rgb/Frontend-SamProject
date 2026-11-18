import { useEffect, useRef, useState, type ComponentRef } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { crearTareaRapida } from '../api/tareas';
import { mensajeDeError } from '../api/client';
import { colors } from '../theme/colors';
import type { RootStackParamList } from '../navigation/types';
import { ScreenHeader } from '../components/ScreenHeader';

type Ruta = RouteProp<RootStackParamList, 'TareaRapida'>;

/**
 * Tarea rápida → Bandeja de entrada (RF-13, máximo dos toques):
 * toque 1 desde cualquier pantalla (FAB), toque 2 en «Guardar».
 * Un único campo; el backend la coloca en la Bandeja del espacio indicado
 * (o del espacio personal si no se indica).
 */
export function TareaRapidaScreen() {
  const route = useRoute<Ruta>();
  const espacioId = route.params?.espacioId;
  const navigation = useNavigation();
  const queryClient = useQueryClient();
  const inputRef = useRef<ComponentRef<typeof TextInput>>(null);
  const [titulo, setTitulo] = useState('');

  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 150);
    return () => clearTimeout(t);
  }, []);

  const guardar = useMutation({
    mutationFn: (t: string) => crearTareaRapida(t.trim(), espacioId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['tareas'] });
      void queryClient.invalidateQueries({ queryKey: ['bandeja-total'] });
      void queryClient.invalidateQueries({ queryKey: ['progreso'] });
      void queryClient.invalidateQueries({ queryKey: ['proyectos'] });
      navigation.goBack();
    },
  });

  const valido = titulo.trim().length >= 1;

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      className="flex-1 bg-background"
    >
      <ScreenHeader titulo="Nueva tarea rápida" subtitulo="Llegará a tu Bandeja de entrada" />

      <View className="flex-1 px-5 pt-6">
        <View className="h-12 w-12 items-center justify-center rounded-2xl bg-tertiary">
          <Ionicons name="flash-outline" size={24} color={colors.text} />
        </View>
        <Text
          style={{ fontFamily: 'Georgia' }}
          className="mt-4 text-[22px] leading-7 text-primary"
        >
          ¿Qué hay que hacer?
        </Text>
        <Text className="mt-1 text-[13px] text-text opacity-75">
          Escribe lo justo; ya la organizarás después desde la Bandeja.
        </Text>

        <TextInput
          ref={inputRef}
          accessibilityLabel="Descripción breve de la tarea"
          value={titulo}
          onChangeText={(t) => {
            setTitulo(t);
            guardar.reset();
          }}
          onSubmitEditing={() => valido && guardar.mutate(titulo)}
          placeholder="p. ej. Comprar certificado SSL"
          placeholderTextColor="#8A968E"
          maxLength={200}
          returnKeyType="done"
          blurOnSubmit={false}
          className="mt-5 min-h-[56px] rounded-2xl border border-secondary bg-white px-4 text-[17px] text-text"
        />

        {guardar.isError ? (
          <Text className="mt-2 text-[13px] leading-5 text-[#B3261E]">
            {mensajeDeError(guardar.error)}
          </Text>
        ) : null}

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Guardar tarea rápida"
          disabled={!valido || guardar.isPending}
          onPress={() => guardar.mutate(titulo)}
          className={`mt-5 min-h-[56px] flex-row items-center justify-center gap-2 rounded-2xl ${
            !valido || guardar.isPending ? 'bg-[#3F6E5B] opacity-60' : 'bg-primary'
          }`}
        >
          {guardar.isPending ? (
            <ActivityIndicator color="#F7F8F5" />
          ) : (
            <>
              <Ionicons name="checkmark" size={22} color="#F7F8F5" />
              <Text className="text-[17px] font-semibold text-[#F7F8F5]">Guardar</Text>
            </>
          )}
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}
