import { useCallback, useState, useSyncExternalStore } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { useQueryClient } from '@tanstack/react-query';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useAuth } from '../auth/AuthContext';
import { NotificacionesController } from '../lib/NotificacionesController';
import type { RootStackParamList } from '../navigation/types';
import type { Proyecto } from '../api/types';
import { colors } from '../theme/colors';

export function NotificacionesScreen({ navigation }: NativeStackScreenProps<RootStackParamList, 'Notificaciones'>) {
  const auth = useAuth();
  const queryClient = useQueryClient();
  const sello = auth.capturarSesion();
  if (!sello) return null;
  return <NotificacionesSesion key={`${sello.usuarioId}:${sello.tokenVersion}:${sello.generation}`}
    vigente={() => auth.esSesionActual(sello)} volver={() => navigation.goBack()}
    abrir={(tareaId, proyecto) => {
      // No presentar un detalle ni estado de archivado de una consulta anterior.
      queryClient.removeQueries({ queryKey: ['tarea', tareaId], exact: true });
      queryClient.setQueryData(['proyecto', proyecto.id], proyecto);
      navigation.navigate('TareaDetalle', { tareaId });
    }} />;
}

function NotificacionesSesion({ vigente, volver, abrir }: { vigente: () => boolean; volver: () => void; abrir: (tareaId: string, proyecto: Proyecto) => void }) {
  const [controller] = useState(() => new NotificacionesController(vigente));
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  useFocusEffect(useCallback(() => {
    void controller.cargar();
    return controller.limpiar;
  }, [controller]));
  const bloqueado = state.cargando || state.marcando.length > 0 || !!state.abriendo;
  const cargando = state.cargando || (state.pagina === 0 && !state.error);
  return <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
    <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 48 }}>
      <Accion titulo="Volver" ejecutar={volver} />
      <Text accessibilityRole="header" style={{ fontSize: 24, fontWeight: '600', color: colors.primary, marginVertical: 16 }}>Notificaciones</Text>
      <Accion titulo="Actualizar notificaciones" bloqueado={bloqueado} ejecutar={() => void controller.cargar()} />
      {cargando ? <View accessibilityLiveRegion="polite"><ActivityIndicator color={colors.primary} /><Texto texto="Cargando notificaciones…" /></View> : null}
      {state.error ? <View accessibilityLiveRegion="polite"><Texto texto={state.error} /><Accion titulo="Reintentar cargar notificaciones" ejecutar={() => void controller.cargar()} /></View> : null}
      {!cargando && !state.error && !state.avisos.length ? <Texto texto="Aún no tienes notificaciones" /> : null}
      {state.avisos.map(aviso => {
        const fecha = new Date(aviso.creadoEn).toLocaleString('es');
        const marcando = state.marcando.includes(aviso.id);
        return <View key={aviso.id} style={{ borderBottomWidth: 1, borderBottomColor: colors.secondary, paddingVertical: 16 }}>
          <Text style={{ fontSize: 16, lineHeight: 24, fontWeight: '600', color: colors.text }}>{aviso.titulo}</Text>
          <Texto texto={fecha} />
          <Texto texto={aviso.leida ? 'Leído' : 'No leído'} />
          <Accion titulo={state.abriendo === aviso.id ? 'Verificando acceso…' : 'Abrir tarea'}
            etiqueta={`Abrir tarea: ${aviso.titulo}, ${fecha}`} bloqueado={bloqueado} ocupado={state.abriendo === aviso.id}
            ejecutar={() => void controller.abrir(aviso.id, abrir)} />
          {!aviso.leida ? <Accion titulo={marcando ? 'Marcando como leído…' : state.erroresMarca[aviso.id] ? 'Reintentar marcar como leído' : 'Marcar como leído'}
            etiqueta={`Marcar como leído: ${aviso.titulo}, ${fecha}`} bloqueado={marcando || state.cargando || !!state.abriendo} ocupado={marcando}
            ejecutar={() => void controller.marcar(aviso.id)} /> : null}
          {state.erroresMarca[aviso.id] ? <View accessibilityLiveRegion="polite"><Texto texto={state.erroresMarca[aviso.id]} /></View> : null}
        </View>;
      })}
      {state.hayMas ? <Accion titulo="Cargar más notificaciones" bloqueado={bloqueado} ejecutar={() => void controller.cargar(true)} /> : null}
      {state.mensaje ? <View accessibilityLiveRegion="polite"><Texto texto={state.mensaje} /></View> : null}
    </ScrollView>
  </SafeAreaView>;
}
function Texto({ texto }: { texto: string }) {
  return <Text style={{ fontSize: 14, lineHeight: 22, color: colors.text, marginTop: 4 }}>{texto}</Text>;
}
function Accion({ titulo, etiqueta, ejecutar, bloqueado = false, ocupado = false }: {
  titulo: string; etiqueta?: string; ejecutar: () => void; bloqueado?: boolean; ocupado?: boolean;
}) {
  return <Pressable accessibilityRole="button" accessibilityLabel={etiqueta ?? titulo}
    accessibilityState={{ disabled: bloqueado, busy: ocupado }} disabled={bloqueado}
    onPress={() => { if (!bloqueado) ejecutar(); }} style={{ minHeight: 44, minWidth: 44, justifyContent: 'center', alignSelf: 'flex-start', paddingHorizontal: 8 }}>
    <Text style={{ fontSize: 14, fontWeight: '600', color: colors.primary }}>{titulo}</Text>
  </Pressable>;
}
