import { useRef, useState, useSyncExternalStore } from 'react';
import { Alert, Text, View } from 'react-native';
import { useAuth } from '../auth/AuthContext';
import { dispositivosApi, type Dispositivo } from '../api/dispositivos';
import { getToken } from '../api/tokenStorage';
import { PrimaryButton } from './PrimaryButton';
import { FormField } from './FormField';
import { ErrorBanner } from './ErrorBanner';

/** Controles técnicos RF20, no preferencias RF21. Patrones existentes de Perfil. */
export function PushControls() {
  const { push, capturarSesion, esSesionActual } = useAuth();
  const status = useSyncExternalStore(push.subscribe, push.getSnapshot, push.getSnapshot);
  const [devices, setDevices] = useState<Dispositivo[]>([]);
  const [page, setPage] = useState(0); const [more, setMore] = useState(false);
  const [codigo, setCodigo] = useState(''); const [ownerCode, setOwnerCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const running = useRef(false);
  async function run(f: () => Promise<void>) {
    if (running.current) return;
    const s = capturarSesion(); if (!s) return;
    running.current = true; setBusy(true); setError(null); setOwnerCode(null);
    try { await f(); } catch { if (esSesionActual(s)) setError('No se pudo completar la operación. Revisa tu conexión y reintenta.'); }
    finally { running.current = false; if (esSesionActual(s)) setBusy(false); }
  }
  async function list(next: number) {
    const s = capturarSesion(), jwt = getToken(); if (!s || !jwt) return;
    const result = await dispositivosApi.listar(jwt, next);
    if (!esSesionActual(s)) return;
    setDevices(old => next === 1 ? result.datos : [...old, ...result.datos]); setPage(next); setMore(next < result.meta.totalPaginas);
  }
  function confirm(title: string, message: string, label: string, action: () => Promise<void>) {
    const sello = capturarSesion();
    Alert.alert(title, message, [{ text: 'Cancelar', style: 'cancel' }, { text: label, onPress: () => {
      if (esSesionActual(sello)) void run(action);
    } }]);
  }
  return <View style={{ marginTop: 24, gap: 12 }}>
    <Text accessibilityRole="header" className="text-primary text-xl">Notificaciones del dispositivo</Text>
    <Text accessibilityLiveRegion="polite" className="text-text">{status}</Text>
    <Text className="text-text">Al salir intentamos revocar este dispositivo antes de cerrar sesión. Sin conexión pueden seguir llegando avisos. Reintenta con la cuenta propietaria al reconectar.</Text>
    <ErrorBanner mensaje={error} />
    <PrimaryButton titulo="Activar o reintentar notificaciones" deshabilitado={busy} onPress={() => void run(() => push.refresh(true))} />
    <PrimaryButton titulo="Consultar mis dispositivos" deshabilitado={busy} onPress={() => void run(() => list(1))} />
    {devices.map(d => <View key={d.id} style={{ gap: 8 }}>
      <Text className="text-text">{d.plataforma} · {d.id}</Text>
      <PrimaryButton titulo="Revocar dispositivo" deshabilitado={busy} onPress={() => confirm('Revocar dispositivo', 'Dejará de recibir nuevos avisos. Los ya entregados no se pueden retirar.', 'Revocar', async () => { await push.revoke(d.id); await list(1); })} />
      <PrimaryButton titulo="Autorizar transferencia" deshabilitado={busy} onPress={() => confirm('Autorizar transferencia', 'El código permite trasladar este dispositivo a otra cuenta durante 5 minutos. Compártelo solo con la cuenta destinataria. Cerrar sesión aquí revoca el dispositivo local y puede invalidar el código.', 'Generar código', async () => { const s = capturarSesion(); const c = await push.ownerCode(d.id, true); if (esSesionActual(s)) setOwnerCode(`${c.codigo} · vence ${c.expiraEn}`); })} />
    </View>)}
    {more && <PrimaryButton titulo="Más dispositivos" deshabilitado={busy} onPress={() => void run(() => list(page + 1))} />}
    {ownerCode && <Text selectable accessibilityLiveRegion="polite" className="text-text">Código autorizado: {ownerCode}</Text>}
    <Text className="text-text">Para recibir un dispositivo de otra cuenta, solicita al propietario el código desde otra instalación donde siga conectado. Nunca reclamamos un token automáticamente.</Text>
    <FormField label="Código de transferencia" value={codigo} onChangeText={setCodigo} autoCapitalize="characters" autoCorrect={false} maxLength={8} editable={!busy} />
    <PrimaryButton titulo="Transferir a esta cuenta" deshabilitado={busy || !/^[A-Z2-9]{8}$/.test(codigo)} onPress={() => confirm('Recibir dispositivo', '¿Confirmas trasladar este dispositivo a tu cuenta? Dejará de recibir avisos de la cuenta anterior.', 'Confirmar transferencia', async () => { const code = codigo; setCodigo(''); await push.transfer(code, true); await list(1); })} />
  </View>;
}
