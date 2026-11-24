import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { AuthLayout } from '../components/AuthLayout';
import { ErrorBanner } from '../components/ErrorBanner';
import { FormField } from '../components/FormField';
import { PrimaryButton } from '../components/PrimaryButton';
import { useAuth } from '../auth/AuthContext';
import { AutenticacionEnCursoError } from '../auth/SessionController';
import { ApiRequestError, mensajeDeError } from '../api/client';
import { validarEmail } from '../lib/validation';
import type { RootStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'Acceso'>;

export function LoginScreen({ navigation }: Props) {
  const { iniciarSesion, aviso } = useAuth();
  const [email, setEmail] = useState('');
  const [contrasena, setContrasena] = useState('');
  const [errores, setErrores] = useState<{ email?: string | null; contrasena?: string | null }>({});
  const [errorServidor, setErrorServidor] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  const enviar = async () => {
    setErrorServidor(null);
    const emailError = validarEmail(email);
    const contrasenaError = contrasena.trim().length === 0 ? 'Ingresa tu contraseña.' : null;
    setErrores({ email: emailError, contrasena: contrasenaError });
    if (emailError || contrasenaError) return;

    setEnviando(true);
    try {
      await iniciarSesion(email, contrasena);
    } catch (error) {
      setErrorServidor(error instanceof AutenticacionEnCursoError ? error.message : error instanceof ApiRequestError && error.statusCode === 401 ? 'Correo o contraseña incorrectos.' : mensajeDeError(error, 'No pudimos iniciar sesión. Inténtalo de nuevo.'));
    } finally {
      setEnviando(false);
    }
  };

  return (
    <AuthLayout
      titulo="Inicia sesión"
      subtitulo="Vuelve a tu espacio: tus proyectos, tareas y tu Bandeja te esperan."
      pie={
        <View className="flex-row items-center gap-1.5">
          <Text className="text-[14px] text-text">¿Aún no tienes cuenta?</Text>
          <Pressable
             accessibilityRole="link"
             accessibilityState={{ disabled: enviando }}
             disabled={enviando}
            hitSlop={8}
            onPress={() => navigation.navigate('Registro')}
          >
            <Text className="text-[14px] font-semibold text-primary underline">Crea una</Text>
          </Pressable>
        </View>
      }
    >
      <ErrorBanner mensaje={errorServidor ?? aviso} />
      <FormField
        label="Correo"
        value={email}
        onChangeText={(t) => {
          setEmail(t);
          if (errores.email) setErrores((p) => ({ ...p, email: validarEmail(t) }));
          setErrorServidor(null);
        }}
        error={errores.email}
        placeholder="ana@example.com"
        keyboardType="email-address"
        autoCapitalize="none"
        autoComplete="email"
        autoCorrect={false}
        editable={!enviando}
        returnKeyType="next"
      />
      <FormField
        label="Contraseña"
        value={contrasena}
        onChangeText={(t) => {
          setContrasena(t);
          if (errores.contrasena) {
            setErrores((p) => ({ ...p, contrasena: t.trim().length === 0 ? 'Ingresa tu contraseña.' : null }));
          }
          setErrorServidor(null);
        }}
        error={errores.contrasena}
        placeholder="Tu contraseña"
        secureTextEntry
        autoCapitalize="none"
        autoComplete="password"
        editable={!enviando}
        returnKeyType="go"
        onSubmitEditing={enviar}
      />
      <View className="mt-2">
        <PrimaryButton titulo="Entrar" onPress={enviar} cargando={enviando} />
      </View>
      <Pressable accessibilityRole="button" disabled={enviando} accessibilityState={{ disabled: enviando }} onPress={() => navigation.navigate('Recuperar')} style={{ minHeight: 48, justifyContent: 'center' }}><Text className="text-primary font-semibold underline">¿Olvidaste tu contraseña?</Text></Pressable>
    </AuthLayout>
  );
}
