import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useAuth } from '../auth/AuthContext';
import { obtenerPerfil } from '../api/auth';
import { mensajeDeError } from '../api/client';
import type { Usuario } from '../api/types';
import { FormField } from '../components/FormField';
import { PrimaryButton } from '../components/PrimaryButton';
import { ErrorBanner } from '../components/ErrorBanner';
import { PushControls } from '../components/PushControls';
import { validarNombre, validarContrasena, validarConfirmacion } from '../lib/validation';
import type { RootStackParamList } from '../navigation/types';

function Marco({ titulo, children, volver }: { titulo: string; children: ReactNode; volver: () => void }) {
  return <SafeAreaView style={{ flex: 1, backgroundColor: '#F7F8F5' }}><KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}><ScrollView keyboardShouldPersistTaps="handled" className="flex-1 bg-background" contentContainerStyle={{ paddingHorizontal: 24, paddingTop: 64, paddingBottom: 48 }}>
    <Pressable accessibilityRole="button" onPress={volver} style={{ minHeight: 44, justifyContent: 'center' }}><Text className="text-primary font-semibold">‹ Volver</Text></Pressable>
    <Text accessibilityRole="header" style={{ fontFamily: 'Georgia' }} className="text-[28px] text-primary mb-6">{titulo}</Text>{children}
  </ScrollView></KeyboardAvoidingView></SafeAreaView>;
}

export function PerfilScreen({ navigation }: NativeStackScreenProps<RootStackParamList, 'Perfil'>) {
  const { perfilEscrituras, actualizarUsuario, capturarSesion, esSesionActual } = useAuth();
  const datos = useSyncExternalStore(perfilEscrituras.subscribe, perfilEscrituras.getSnapshot, perfilEscrituras.getSnapshot);
  const [perfil, setPerfil] = useState<Usuario | null>(null);
  const [cargando, setCargando] = useState(true);
  const [errorCarga, setErrorCarga] = useState<string | null>(null);
  const [campo, setCampo] = useState<{ nombre?: string | null; foto?: string | null }>({});
  async function cargar() {
    const sello = capturarSesion(); if (!sello) return;
    setCargando(true); setErrorCarga(null);
    try {
      const p = await obtenerPerfil();
      if (!esSesionActual(sello) || p.id !== sello.usuarioId) return;
      setPerfil(p); actualizarUsuario(p, sello); perfilEscrituras.adoptar(p);
    } catch (error) { if (esSesionActual(sello)) setErrorCarga(mensajeDeError(error)); }
    finally { if (esSesionActual(sello)) setCargando(false); }
  }
  useEffect(() => { void Promise.resolve().then(() => cargar()); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  async function guardar() {
    // La acción del teclado también respeta el estado actual, no solo el render.
    if (perfilEscrituras.getSnapshot().fase !== 'listo') return;
    const nombre = datos.nombre.trim(), foto = datos.foto.trim();
    let fotoError: string | null = null;
    if (foto) { try { const url = new URL(foto); if (!['http:', 'https:'].includes(url.protocol) || !url.hostname) fotoError = 'Ingresa una URL http o https válida.'; } catch { fotoError = 'Ingresa una URL http o https válida.'; } }
    const errores = { nombre: validarNombre(nombre), foto: fotoError }; setCampo(errores);
    if (!errores.nombre && !errores.foto) await perfilEscrituras.guardar();
  }
  const bloqueado = datos.fase !== 'listo';
  return <Marco titulo="Perfil" volver={() => navigation.goBack()}>
    {cargando ? <><ActivityIndicator /><Text>Cargando perfil…</Text></> : <>
      <ErrorBanner mensaje={errorCarga} />
      {errorCarga && <Pressable accessibilityRole="button" onPress={() => void cargar()} style={{ minHeight: 48, justifyContent: 'center' }}><Text className="text-primary underline">Reintentar carga</Text></Pressable>}
      {perfil && <>
        <Text className="text-text mb-4">Correo: {perfil.email}</Text>
        <ErrorBanner mensaje={datos.error} />
        <FormField label="Nombre" accessibilityLabel="Nombre" value={datos.nombre} onChangeText={perfilEscrituras.editarNombre} error={campo.nombre} editable={datos.fase !== 'guardando' && datos.fase !== 'consultando'} returnKeyType="done" onSubmitEditing={guardar} />
        <FormField label="Foto (URL)" accessibilityLabel="Foto (URL)" value={datos.foto} onChangeText={perfilEscrituras.editarFoto} error={campo.foto} autoCapitalize="none" autoCorrect={false} keyboardType="url" editable={datos.fase !== 'guardando' && datos.fase !== 'consultando'} returnKeyType="done" onSubmitEditing={guardar} />
        <Pressable accessibilityRole="button" disabled={datos.fase === 'guardando' || datos.fase === 'consultando'} onPress={perfilEscrituras.quitarFoto} style={{ minHeight: 48, justifyContent: 'center' }}><Text className="text-primary underline">Quitar foto</Text></Pressable>
        {datos.mensaje && <Text accessibilityLiveRegion="polite" className="text-text mb-3">{datos.mensaje}</Text>}
        {(datos.fase === 'incierto' || datos.fase === 'consultando') && <PrimaryButton titulo="Consultar perfil" onPress={() => void perfilEscrituras.consultar()} cargando={datos.fase === 'consultando'} />}
        {datos.fase === 'revisar' && <Pressable accessibilityRole="button" onPress={perfilEscrituras.aceptarRevision} style={{ minHeight: 48, justifyContent: 'center' }}><Text className="text-primary font-semibold underline">He revisado; quiero continuar</Text></Pressable>}
        <PrimaryButton titulo="Guardar" onPress={guardar} cargando={datos.fase === 'guardando'} deshabilitado={bloqueado && datos.fase !== 'guardando'} />
        <Pressable accessibilityRole="button" onPress={() => navigation.navigate('CambiarContrasena')} style={{ minHeight: 56, justifyContent: 'center' }}><Text className="text-primary font-semibold">Cambiar contraseña ›</Text></Pressable>
      </>}
    </>}
    <PushControls />
  </Marco>;
}

export function CambiarContrasenaScreen({ navigation }: NativeStackScreenProps<RootStackParamList, 'CambiarContrasena'>) {
  const { perfilEscrituras } = useAuth();
  const datos = useSyncExternalStore(perfilEscrituras.subscribe, perfilEscrituras.getSnapshot, perfilEscrituras.getSnapshot);
  const [actual, setActual] = useState(''); const [nueva, setNueva] = useState(''); const [confirmar, setConfirmar] = useState('');
  const [errores, setErrores] = useState<{ actual?: string | null; nueva?: string | null; confirmar?: string | null }>({});
  async function enviar() {
    if (datos.contrasenaPendiente) return;
    const e = { actual: actual ? null : 'Ingresa tu contraseña actual.', nueva: validarContrasena(nueva), confirmar: validarConfirmacion(nueva, confirmar) };
    setErrores(e); if (e.actual || e.nueva || e.confirmar) return;
    const operacion = perfilEscrituras.cambiarContrasena(actual, nueva);
    setActual(''); setNueva(''); setConfirmar('');
    await operacion;
  }
  return <Marco titulo="Cambiar contraseña" volver={() => navigation.goBack()}>
    <Text className="text-text mb-4">De 8 a 72 caracteres, con al menos una letra y un número.</Text>
    {datos.contrasenaPendiente && <Text accessibilityLiveRegion="polite" className="text-text mb-4">Hay un cambio de contraseña en curso. Espera el resultado antes de intentarlo de nuevo.</Text>}
    <ErrorBanner mensaje={datos.errorContrasena} />
    <FormField label="Contraseña actual" accessibilityLabel="Contraseña actual" secureTextEntry autoComplete="current-password" autoCapitalize="none" value={actual} onChangeText={t => { setActual(t); perfilEscrituras.limpiarErrorContrasena(); }} error={errores.actual} editable={!datos.contrasenaPendiente} />
    <FormField label="Nueva contraseña" accessibilityLabel="Nueva contraseña" secureTextEntry autoComplete="new-password" autoCapitalize="none" value={nueva} onChangeText={setNueva} error={errores.nueva} editable={!datos.contrasenaPendiente} />
    <FormField label="Confirmar nueva contraseña" accessibilityLabel="Confirmar nueva contraseña" secureTextEntry autoComplete="new-password" autoCapitalize="none" value={confirmar} onChangeText={setConfirmar} error={errores.confirmar} editable={!datos.contrasenaPendiente} />
    <PrimaryButton titulo="Cambiar contraseña" onPress={enviar} cargando={datos.contrasenaPendiente} />
  </Marco>;
}
