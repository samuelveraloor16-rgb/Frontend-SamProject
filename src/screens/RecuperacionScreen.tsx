import { useEffect, useRef, useState } from 'react';
import { Pressable, Text } from 'react-native';
import { AuthLayout } from '../components/AuthLayout';
import { FormField } from '../components/FormField';
import { PrimaryButton } from '../components/PrimaryButton';
import { ErrorBanner } from '../components/ErrorBanner';
import { solicitarRecuperacion, restablecerContrasena } from '../api/auth';
import { ApiRequestError, mensajeDeError } from '../api/client';
import { validarEmail, validarContrasena, validarConfirmacion } from '../lib/validation';
import { useAuth } from '../auth/AuthContext';
import { clasificarErrorReset400 } from '../lib/resetErrors';
import { ejecutarReset } from '../auth/resetOperation';

function Link({ texto, onPress }: { texto: string; onPress: () => void }) {
  return <Pressable accessibilityRole="button" onPress={onPress} style={{ minHeight: 48, justifyContent: 'center' }}><Text className="text-primary font-semibold underline">{texto}</Text></Pressable>;
}
export function RecuperarScreen({ navigation }: { navigation: { goBack: () => void } }) {
  const [email, setEmail] = useState(''); const [error, setError] = useState<string | null>(null);
  const [campo, setCampo] = useState<string | null>(null); const [cargando, setCargando] = useState(false); const [hecho, setHecho] = useState(false);
  async function enviar() {
    if (cargando) return; const problema = validarEmail(email); setCampo(problema); if (problema) return;
    setCargando(true); setError(null);
    try { await solicitarRecuperacion(email.trim().toLowerCase()); setHecho(true); }
    catch (e) { setError(e instanceof ApiRequestError && (e.esErrorDeRed || e.statusCode >= 500) ? 'No pudimos confirmar la solicitud. Puedes intentarlo de nuevo.' : mensajeDeError(e)); }
    finally { setCargando(false); }
  }
  return <AuthLayout pie={null} titulo="Recuperar contraseña" subtitulo={hecho ? 'Si el correo existe, recibirás un enlace para restablecer tu contraseña.' : 'Escribe tu correo para solicitar un enlace.'}>
    {!hecho && <><ErrorBanner mensaje={error} /><FormField label="Correo" accessibilityLabel="Correo" value={email} onChangeText={setEmail} error={campo} keyboardType="email-address" autoCapitalize="none" autoCorrect={false} autoComplete="email" editable={!cargando} /><PrimaryButton titulo="Enviar enlace" onPress={enviar} cargando={cargando} /></>}
    <Link texto="Volver a iniciar sesión" onPress={navigation.goBack} />
  </AuthLayout>;
}
export function ResetScreen({ token, cerrar, solicitar, descartar, esActual }: { token: string | null; cerrar: () => void; solicitar: () => void; descartar: () => void; esActual: () => boolean }) {
  const { iniciarReset, finalizarReset } = useAuth();
  const montada = useRef(true); const enviando = useRef(false);
  useEffect(() => { montada.current = true; return () => { montada.current = false; }; }, []);
  const [nueva, setNueva] = useState(''); const [confirmar, setConfirmar] = useState('');
  const [errores, setErrores] = useState<{ nueva?: string | null; confirmar?: string | null }>({});
  const [error, setError] = useState<string | null>(null); const [cargando, setCargando] = useState(false); const [hecho, setHecho] = useState(false); const [incierto, setIncierto] = useState(false);
  async function enviar() {
    if (!token || enviando.current || incierto) return;
    const e = { nueva: validarContrasena(nueva), confirmar: validarConfirmacion(nueva, confirmar) }; setErrores(e); if (e.nueva || e.confirmar) return;
    enviando.current = true; setCargando(true); setError(null);
    try {
      await ejecutarReset(token, nueva, {
        iniciar: iniciarReset, enviar: restablecerContrasena, finalizar: finalizarReset,
        estaActiva: () => montada.current && esActual(),
        entregar: resultado => {
          if (resultado.tipo === 'exito') { setNueva(''); setConfirmar(''); setHecho(true); descartar(); }
          else if (resultado.tipo === 'incierto') { setIncierto(true); descartar(); setNueva(''); setConfirmar(''); setError('No pudimos confirmar si se actualizó la contraseña. Intenta iniciar sesión con la nueva contraseña o solicita otro enlace.'); }
          else if (resultado.error.statusCode === 400) { const detalle = clasificarErrorReset400(resultado.error.mensajes); if (detalle.campo) setErrores(prev => ({ ...prev, nueva: detalle.campo })); if (detalle.general) setError(detalle.general); }
          else setError(mensajeDeError(resultado.error));
        },
      });
    } catch {
      if (montada.current && esActual()) { setIncierto(true); setNueva(''); setConfirmar(''); descartar(); setError('No pudimos confirmar si se actualizó la contraseña. Intenta iniciar sesión con la nueva contraseña o solicita otro enlace.'); }
    } finally { enviando.current = false; if (montada.current && esActual()) setCargando(false); }
  }
  return <AuthLayout pie={null} titulo="Restablecer contraseña" subtitulo={hecho ? 'Contraseña actualizada. Inicia sesión con tu nueva contraseña.' : 'De 8 a 72 caracteres, con al menos una letra y un número.'}>
    <ErrorBanner mensaje={error ?? (!token && !hecho ? 'El enlace es inválido o ha caducado.' : null)} />
    {!hecho && token && !incierto && <><FormField label="Nueva contraseña" accessibilityLabel="Nueva contraseña" value={nueva} onChangeText={setNueva} secureTextEntry autoCapitalize="none" autoComplete="new-password" error={errores.nueva} editable={!cargando} /><FormField label="Confirmar nueva contraseña" accessibilityLabel="Confirmar nueva contraseña" value={confirmar} onChangeText={setConfirmar} secureTextEntry autoCapitalize="none" autoComplete="new-password" error={errores.confirmar} editable={!cargando} /><PrimaryButton titulo="Restablecer contraseña" onPress={enviar} cargando={cargando} /></>}
    {!cargando && !hecho && <Link texto="Solicitar otro enlace" onPress={solicitar} />}
    {!cargando && <Link texto={hecho || incierto ? 'Continuar' : 'Cancelar'} onPress={cerrar} />}
  </AuthLayout>;
}
