import { Ionicons } from '@expo/vector-icons';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { HomeScreen } from '../screens/HomeScreen';
import { PendingScreen } from '../screens/PendingScreen';
import { colors } from '../theme/colors';
import type { MainTabParamList } from './types';

const Tab = createBottomTabNavigator<MainTabParamList>();

/**
 * Navegación mínima de scaffold (sin pantallas de negocio).
 * Las secciones reales (espacios, proyectos, tareas, Kanban) se
 * añadirán en pasos posteriores de la Fase 1.
 */
export function MainTabs() {
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.text,
        tabBarStyle: { backgroundColor: colors.background },
      }}
    >
      <Tab.Screen
        name="Inicio"
        component={HomeScreen}
        options={{
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="home-outline" color={color} size={size} />
          ),
        }}
      />
      <Tab.Screen
        name="Proximamente"
        component={PendingScreen}
        options={{
          title: 'Próximamente',
          tabBarLabel: 'Próximamente',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="time-outline" color={color} size={size} />
          ),
        }}
      />
    </Tab.Navigator>
  );
}
