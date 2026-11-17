import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { colors } from '../theme/colors';
import { MainTabs } from './MainTabs';
import type { RootStackParamList } from './types';

const Stack = createNativeStackNavigator<RootStackParamList>();

/**
 * Navegador raíz: pila nativa que envuelve las pestañas.
 * Aquí se colgarán las pantallas modales/pantalla completa de la Fase 1
 * (detalle de tarea, etc.) cuando existan.
 */
export function AppNavigator() {
  return (
    <NavigationContainer>
      <Stack.Navigator
        screenOptions={{
          headerStyle: { backgroundColor: colors.background },
          headerTintColor: colors.primary,
          headerTitleStyle: { color: colors.primary, fontWeight: '600' },
        }}
      >
        <Stack.Screen
          name="MainTabs"
          component={MainTabs}
          options={{ title: 'SamProject' }}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
