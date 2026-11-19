import { Image, View, ActivityIndicator } from 'react-native';
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
import { TareaRapidaScreen } from '../screens/TareaRapidaScreen';
import { AceptarInvitacionScreen } from '../screens/AceptarInvitacionScreen';
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
  const { estado, usuario } = useAuth();

  if (estado === 'cargando') {
    return <PantallaDeCarga />;
  }

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
            <Stack.Screen name="Espacio" component={EspacioScreen} />
            <Stack.Screen name="Proyecto" component={ProyectoScreen} />
            <Stack.Screen name="Tareas" component={TareasScreen} />
            <Stack.Screen name="TareaDetalle" component={TareaDetalleScreen} />
            <Stack.Screen name="Kanban" component={KanbanScreen} />
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
            <Stack.Screen name="AceptarInvitacion" component={AceptarInvitacionScreen} />
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
