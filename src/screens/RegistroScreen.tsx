import { useRef, useState, type ComponentRef } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { AuthLayout } from '../components/AuthLayout';
import { ErrorBanner } from '../components/ErrorBanner';
import { FormField } from '../components/FormField';
import { PrimaryButton } from '../components/PrimaryButton';
import { useAuth } from '../auth/AuthContext';
import { AutenticacionEnCursoError, RegistroSinSesionError } from '../auth/SessionController';
import { mensajeDeError } from '../api/client';
import {
  validarConfirmacion,
  validarContrasena,
  validarEmail,
  validarNombre,
} from '../lib/validation';
import type { RootStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'Registro'>;

type Errores = {
  nombre?: string | null;
  email?: string | null;
  contrasena?: string | null;
  confirmacion?: string | null;
};

export function RegistroScreen({ navigation }: Props) {
  const { registrarse } = useAuth();
  const [nombre, setNombre] = useState('');
  const [email, setEmail] = useState('');
  const [contrasena, setContrasena] = useState('');
  const [confirmacion, setConfirmacion] = useState('');
  const [errores, setErrores] = useState<Errores>({});
  const [errorServidor, setErrorServidor] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const envioActivo = useRef(false);
  const emailRef = useRef<ComponentRef<typeof TextInput>>(null);
  const passwordRef = useRef<ComponentRef<typeof TextInput>>(null);
  const confirmationRef = useRef<ComponentRef<typeof TextInput>>(null);

  const volverAAcceso = () => {
    if (envioActivo.current) return;
    // No apilar Acceso sobre Registro, incluso si se abrió sin historial.
    navigation.reset({ index: 0, routes: [{ name: 'Acceso' }] });
  };

  const validarTodo = (): Errores => ({
    nombre: validarNombre(nombre),
    email: validarEmail(email),
    contrasena: validarContrasena(contrasena),
    confirmacion: validarConfirmacion(contrasena, confirmacion),
  });

  const enviar = async () => {
    if (envioActivo.current) return;
    setErrorServidor(null);
    const nuevos = validarTodo();
    setErrores(nuevos);
    if (Object.values(nuevos).some((e) => e)) return;

    envioActivo.current = true;
    setEnviando(true);
    try {
      // Al registrarse, el backend crea el espacio personal y la Bandeja de
      // entrada en la misma transacción; la app los obtiene después vía /espacios.
      await registrarse(nombre, email, contrasena);
    } catch (error) {
      setErrorServidor(error instanceof AutenticacionEnCursoError || error instanceof RegistroSinSesionError ? error.message : mensajeDeError(error, 'No pudimos crear tu cuenta. Inténtalo de nuevo.'));
    } finally {
      envioActivo.current = false;
      setEnviando(false);
    }
  };

  const actualizar = (campo: keyof Errores) => (valor: string) => {
    setErrorServidor(null);
    switch (campo) {
      case 'nombre':
        setNombre(valor);
        if (errores.nombre !== undefined) setErrores((p) => ({ ...p, nombre: validarNombre(valor) }));
        break;
      case 'email':
        setEmail(valor);
        if (errores.email !== undefined) setErrores((p) => ({ ...p, email: validarEmail(valor) }));
        break;
      case 'contrasena':
        setContrasena(valor);
        setErrores((p) => ({
          ...p,
          contrasena: p.contrasena !== undefined ? validarContrasena(valor) : p.contrasena,
          confirmacion:
            p.confirmacion !== undefined ? validarConfirmacion(valor, confirmacion) : p.confirmacion,
        }));
        break;
      case 'confirmacion':
        setConfirmacion(valor);
        if (errores.confirmacion !== undefined) {
          setErrores((p) => ({ ...p, confirmacion: validarConfirmacion(contrasena, valor) }));
        }
        break;
    }
  };

  return (
    <AuthLayout
      titulo="Crea tu cuenta"
      subtitulo="Al registrarte creamos tu espacio personal y tu Bandeja de entrada."
      pie={
        <View className="flex-row flex-wrap justify-center items-center gap-1.5">
          <Text className="text-[14px] text-text">¿Ya tienes una cuenta?</Text>
          <Pressable accessibilityRole="link" disabled={enviando} accessibilityState={{ disabled: enviando }} hitSlop={8} onPress={volverAAcceso}>
            <Text className="text-[14px] font-semibold text-primary underline">Inicia sesión</Text>
          </Pressable>
        </View>
      }
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Volver a iniciar sesión"
        accessibilityState={{ disabled: enviando }}
        disabled={enviando}
        onPress={volverAAcceso}
        style={{ minHeight: 44, minWidth: 44, alignSelf: 'flex-start', justifyContent: 'center', marginBottom: 16 }}
      >
        <Text style={{ color: '#245B4A', fontSize: 16, fontWeight: '600' }}>← Volver</Text>
      </Pressable>
      <ErrorBanner mensaje={errorServidor} />
      <FormField
        label="Nombre"
        value={nombre}
        onChangeText={actualizar('nombre')}
        error={errores.nombre}
        placeholder="Ana García"
        autoCapitalize="words"
        autoComplete="name"
        editable={!enviando}
        returnKeyType="next"
        onSubmitEditing={() => emailRef.current?.focus()}
        submitBehavior="submit"
      />
      <FormField
        ref={emailRef}
        label="Correo"
        value={email}
        onChangeText={actualizar('email')}
        error={errores.email}
        placeholder="ana@example.com"
        keyboardType="email-address"
        autoCapitalize="none"
        autoComplete="email"
        autoCorrect={false}
        editable={!enviando}
        returnKeyType="next"
        onSubmitEditing={() => passwordRef.current?.focus()}
        submitBehavior="submit"
      />
      <FormField
        ref={passwordRef}
        label="Contraseña"
        value={contrasena}
        onChangeText={actualizar('contrasena')}
        error={errores.contrasena}
        placeholder="Mínimo 8 caracteres"
        secureTextEntry
        autoCapitalize="none"
        autoComplete="new-password"
        editable={!enviando}
        returnKeyType="next"
        onSubmitEditing={() => confirmationRef.current?.focus()}
        submitBehavior="submit"
      />
      <Text className="-mt-2 mb-4 text-[12px] leading-4 text-text opacity-70">
        Mínimo 8 caracteres, con al menos una letra y un número.
      </Text>
      <FormField
        ref={confirmationRef}
        label="Confirmar contraseña"
        value={confirmacion}
        onChangeText={actualizar('confirmacion')}
        error={errores.confirmacion}
        placeholder="Repite tu contraseña"
        secureTextEntry
        autoCapitalize="none"
        autoComplete="new-password"
        editable={!enviando}
        returnKeyType="go"
        onSubmitEditing={enviar}
      />
      <View className="mt-2">
        <PrimaryButton titulo="Crear cuenta" onPress={enviar} cargando={enviando} />
      </View>
    </AuthLayout>
  );
}
