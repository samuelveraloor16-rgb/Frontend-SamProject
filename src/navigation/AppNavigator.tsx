import { Image, View, ActivityIndicator } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { LoginScreen } from '../screens/LoginScreen';
import { RegistroScreen } from '../screens/RegistroScreen';
import { HomeScreen } from '../screens/HomeScreen';
import { useAuth } from '../auth/AuthContext';
import { colors } from '../theme/colors';
import type { RootStackParamList } from './types';

const Stack = createNativeStackNavigator<RootStackParamList>();

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

/**
 * Navegación raíz condicionada por la sesión:
 *  - Sin sesión: pila pública (Acceso → Registro).
 *  - Con sesión: Inicio (datos reales del usuario/espacio/bandeja).
 */
export function AppNavigator() {
  const { estado, usuario } = useAuth();

  if (estado === 'cargando') {
    return <PantallaDeCarga />;
  }

  const autenticado = estado === 'autenticado' && usuario != null;

  return (
    <NavigationContainer>
      <Stack.Navigator
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.background },
        }}
      >
        {autenticado ? (
          <Stack.Screen name="Inicio" component={HomeScreen} />
        ) : (
          <>
            <Stack.Screen name="Acceso" component={LoginScreen} />
            <Stack.Screen name="Registro" component={RegistroScreen} />
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
