import { useEffect, useRef, useState } from 'react';
import { Image, View, ActivityIndicator, Text, Linking } from 'react-native';
import { NavigationContainer, type LinkingOptions } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import { LoginScreen } from '../screens/LoginScreen';
import { RegistroScreen } from '../screens/RegistroScreen';
import { HomeScreen } from '../screens/HomeScreen';
import { BandejaTabScreen } from '../screens/BandejaTabScreen';
import { EspacioScreen } from '../screens/EspacioScreen';
import { ProyectoScreen } from '../screens/ProyectoScreen';
import { TareasScreen } from '../screens/TareasScreen';
import { TareaDetalleScreen } from '../screens/TareaDetalleScreen';
import { KanbanScreen } from '../screens/KanbanScreen';
import { CalendarioScreen } from '../screens/CalendarioScreen';
import { TareaRapidaScreen } from '../screens/TareaRapidaScreen';
import { AceptarInvitacionScreen } from '../screens/AceptarInvitacionScreen';
import { RecuperarScreen, ResetScreen } from '../screens/RecuperacionScreen';
import { PerfilScreen, CambiarContrasenaScreen } from '../screens/PerfilScreen';
import { PrimaryButton } from '../components/PrimaryButton';
import { parseResetLink, ResetLinkCoordinator, type ResetLinkState } from '../lib/resetLink';
import { useAuth } from '../auth/AuthContext';
import { colors } from '../theme/colors';
import type { PrincipalTabParamList, RootStackParamList } from './types';

const Stack = createNativeStackNavigator<RootStackParamList>();
const Tabs = createBottomTabNavigator<PrincipalTabParamList>();

/** Pestañas principales (autenticadas): Inicio y Bandeja. */
function PrincipalTabs() {
  return (
    <Tabs.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: '#8A968E',
        tabBarStyle: { backgroundColor: '#FFFFFF', borderTopColor: colors.secondary },
        tabBarLabelStyle: { fontSize: 12, fontWeight: '600' },
        tabBarIcon: ({ color, size }) => (
          <Ionicons
            name={route.name === 'Inicio' ? 'home-outline' : 'file-tray-outline'}
            size={size}
            color={color}
          />
        ),
      })}
    >
      <Tabs.Screen name="Inicio" component={HomeScreen} />
      <Tabs.Screen name="Bandeja" component={BandejaTabScreen} options={{ title: 'Bandeja' }} />
    </Tabs.Navigator>
  );
}

/** Deep links samproject:// (invitación, reset, etc.). */
const linking: LinkingOptions<RootStackParamList> = {
  prefixes: ['samproject://'],
  async getInitialURL() { const url = await Linking.getInitialURL(); return url && !parseResetLink(url) ? url : null; },
  subscribe(listener) { const sub = Linking.addEventListener('url', ({ url }) => { if (!parseResetLink(url)) listener(url); }); return () => sub.remove(); },
  config: {
    screens: {
      Principal: {
        screens: {
          Inicio: 'inicio',
          Bandeja: 'bandeja',
        },
      },
      Espacio: 'espacios/:espacioId',
      Proyecto: 'proyectos/:proyectoId',
      Calendario: 'espacios/:espacioId/calendario',
      AceptarInvitacion: 'invitar',
    },
  },
};

/** Pantalla de arranque mientras se hidrata el token desde SecureStore. */
function PantallaDeCarga() {
  return (
    <View className="flex-1 items-center justify-center bg-background">
      <Image
        source={require('../../assets/Logo.png')}
        accessibilityLabel="Logotipo de SamProject"
        resizeMode="contain"
        style={{ width: 200, height: 112 }}
      />
      <ActivityIndicator className="mt-6" color={colors.primary} />
    </View>
  );
}

export function AppNavigator() {
  const { estado, usuario, aviso, errorValidacion, revalidar, reintentarBorrado } = useAuth();
  const coordinator = useRef(new ResetLinkCoordinator());
  const [reset, setReset] = useState<ResetLinkState | null>(null);
  const [recuperar, setRecuperar] = useState(false);
  useEffect(() => {
    let activo = true;
    const handle = (url: string, initial = false) => {
      const parsed = parseResetLink(url);
      if (!parsed) return;
      setRecuperar(false); setReset(coordinator.current.receive(url, initial));
    };
    const sub = Linking.addEventListener('url', ({ url }) => handle(url));
    void Linking.getInitialURL().then(url => { if (activo && url) handle(url, true); }).catch(() => {});
    return () => { activo = false; sub.remove(); };
  }, []);

  const errorBorrado = <View className="flex-1 justify-center bg-background px-6"><Text accessibilityRole="header" className="text-primary text-[24px] mb-4">No se pudo proteger la sesión</Text>{aviso ? <Text accessibilityLiveRegion="polite" className="text-text mb-3">{aviso}</Text> : null}<Text accessibilityLiveRegion="polite" className="text-text mb-5">{errorValidacion}</Text><PrimaryButton titulo="Reintentar" onPress={() => void reintentarBorrado()} /></View>;
  if (reset) {
    const bloqueado = estado === 'borrando' || estado === 'error-borrado';
    return <View style={{ flex: 1 }}>
      <View style={{ flex: 1, display: bloqueado ? 'none' : 'flex' }} accessibilityElementsHidden={bloqueado} importantForAccessibility={bloqueado ? 'no-hide-descendants' : 'auto'}>
        <ResetScreen key={reset.id} token={reset.token} esActual={() => coordinator.current.isCurrent(reset.id)} descartar={() => setReset(coordinator.current.discard(reset.id))} cerrar={() => setReset(coordinator.current.close(reset.id))} solicitar={() => { const siguiente = coordinator.current.close(reset.id); setReset(siguiente); if (!siguiente) setRecuperar(true); }} />
      </View>
      {estado === 'borrando' ? <PantallaDeCarga /> : estado === 'error-borrado' ? errorBorrado : null}
    </View>;
  }
  if (estado === 'error-borrado') return errorBorrado;
  if (estado === 'borrando') return <PantallaDeCarga />;
  if (recuperar) return <RecuperarScreen navigation={{ goBack: () => setRecuperar(false) }} />;

  if (estado === 'cargando') {
    return <PantallaDeCarga />;
  }
  if (estado === 'error-validacion') return <View className="flex-1 justify-center bg-background px-6"><Text accessibilityRole="header" className="text-primary text-[24px] mb-4">Comprobar sesión</Text>{aviso ? <Text accessibilityLiveRegion="polite" className="text-text mb-3">{aviso}</Text> : null}<Text accessibilityLiveRegion="polite" className="text-text mb-5">{errorValidacion}</Text><PrimaryButton titulo="Reintentar" onPress={() => void revalidar()} /></View>;

  const autenticado = estado === 'autenticado' && usuario != null;

  return (
    <NavigationContainer linking={linking}>
      <Stack.Navigator
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.background },
        }}
      >
        {autenticado ? (
          <>
            <Stack.Screen name="Principal" component={PrincipalTabs} />
            <Stack.Screen name="Perfil" component={PerfilScreen} />
            <Stack.Screen name="CambiarContrasena" component={CambiarContrasenaScreen} />
            <Stack.Screen name="Espacio" component={EspacioScreen} />
            <Stack.Screen name="Proyecto" component={ProyectoScreen} />
            <Stack.Screen name="Tareas" component={TareasScreen} />
            <Stack.Screen name="TareaDetalle" component={TareaDetalleScreen} />
            <Stack.Screen name="Kanban" component={KanbanScreen} />
            <Stack.Screen name="Calendario" component={CalendarioScreen} />
            <Stack.Screen
              name="TareaRapida"
              component={TareaRapidaScreen}
              options={{ presentation: 'modal' }}
            />
            <Stack.Screen name="AceptarInvitacion" component={AceptarInvitacionScreen} />
          </>
        ) : (
          <>
            <Stack.Screen name="Acceso" component={LoginScreen} />
            <Stack.Screen name="Registro" component={RegistroScreen} />
            <Stack.Screen name="Recuperar" component={RecuperarScreen} />
            <Stack.Screen name="AceptarInvitacion" component={AceptarInvitacionScreen} />
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
