import { useEffect, useState, useSyncExternalStore } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { useAuth } from '../auth/AuthContext';
import type { SelloSesion } from '../auth/SessionController';
import { getToken } from '../api/tokenStorage';
import { actualizarPreferenciasNotificaciones, obtenerPreferenciasNotificaciones, CANALES_PREFERENCIA, type TipoPreferencia } from '../api/preferenciasNotificaciones';
import { cambiosPendientes, PreferenciasNotificacionesController } from '../lib/PreferenciasNotificacionesController';
import { ErrorBanner } from './ErrorBanner';
import { PrimaryButton } from './PrimaryButton';

const eventos: Record<TipoPreferencia, string> = { TAREA_ASIGNADA: 'Tarea asignada', TAREA_POR_VENCER: 'Tarea por vencer', TAREA_VENCIDA: 'Tarea vencida', COMENTARIO: 'Comentario', MENCION: 'Mención' };
const canales = { inApp: 'Dentro de la app', correo: 'Correo', push: 'Push' };

export function PreferenciasNotificaciones() {
  const { capturarSesion } = useAuth();
  const sello = capturarSesion(), jwt = getToken();
  return sello && jwt ? <PreferenciasSesion key={`${sello.usuarioId}:${sello.generation}:${sello.tokenVersion}`} sello={sello} jwt={jwt} /> : null;
}
function PreferenciasSesion({ sello, jwt }: { sello: SelloSesion; jwt: string }) {
  const { esSesionActual, salirLocalSiSesionActual } = useAuth();
  const [controller] = useState(() => new PreferenciasNotificacionesController({
    sello, jwt, vigente: esSesionActual,
    consultar: obtenerPreferenciasNotificaciones, guardar: actualizarPreferenciasNotificaciones,
    unauthorized: capturado => { if (esSesionActual(capturado)) void salirLocalSiSesionActual(capturado, 'Tu sesión expiró. Inicia sesión nuevamente.'); },
  }));
  const datos = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  useEffect(() => { controller.activar(); void controller.cargar(); return controller.dispose; }, [controller]);
  const ocupado = datos.fase === 'cargando' || datos.fase === 'consultando';
  const dirty = cambiosPendientes(datos.original, datos.borrador).length > 0;
  return <View style={{ marginTop: 28, borderTopWidth: 1, borderColor: '#DCE9DF', paddingTop: 24 }}>
    <Text accessibilityRole="header" style={{ fontFamily: 'Georgia', fontSize: 24, color: '#245B4A', marginBottom: 12 }}>Preferencias de notificaciones</Text>
    <Text className="text-text mb-4">Elige qué avisos recibir y por qué canal. Los permisos y dispositivos push se gestionan por separado más abajo.</Text>
    <Text className="text-text mb-4">Tus preferencias se guardan, pero el envío de correos todavía no está operativo</Text>
    <ErrorBanner mensaje={datos.error} />
    {ocupado && <><ActivityIndicator color="#245B4A" /><Text accessibilityLiveRegion="polite" className="text-text">{datos.fase === 'consultando' ? 'Consultando estado…' : 'Cargando preferencias…'}</Text></>}
    {datos.fase === 'error-carga' && <PrimaryButton titulo="Reintentar preferencias" onPress={() => void controller.cargar()} />}
    {datos.borrador?.map(fila => <View key={fila.tipo} style={{ borderBottomWidth: 1, borderColor: '#DCE9DF', paddingVertical: 14 }}>
      <Text accessibilityRole="header" className="text-primary font-semibold mb-2">{eventos[fila.tipo]}</Text>
      {CANALES_PREFERENCIA.map(canal => {
        const obligatorio = fila.tipo === 'MENCION' && canal === 'inApp';
        const disabled = obligatorio || datos.fase !== 'listo';
        return <Pressable key={canal} accessibilityRole="switch" accessibilityLabel={`${eventos[fila.tipo]}: ${canales[canal]}${obligatorio ? ', obligatorio' : ''}`} accessibilityState={{ checked: fila[canal], disabled }} disabled={disabled} onPress={() => controller.editar(fila.tipo, canal, !fila[canal])} style={{ minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <Text className="text-text" style={{ flex: 1 }}>{canales[canal]}{obligatorio ? ' (obligatorio)' : ''}</Text>
          <Text style={{ color: '#245B4A', backgroundColor: fila[canal] ? '#DCE9DF' : '#F7F8F5', borderColor: '#245B4A', borderWidth: 1, borderRadius: 8, paddingVertical: 5, paddingHorizontal: 10 }}>{fila[canal] ? 'Activado' : 'Desactivado'}</Text>
        </Pressable>;
      })}
      {datos.fase === 'revisar' && datos.original && <Text className="text-text mt-2">Estado consultado: {CANALES_PREFERENCIA.map(c => `${canales[c]} ${datos.original!.find(f => f.tipo === fila.tipo)![c] ? 'activado' : 'desactivado'}`).join('; ')}.</Text>}
    </View>)}
    {datos.mensaje && <Text accessibilityLiveRegion="polite" className="text-text my-3">{datos.mensaje}</Text>}
    {(datos.fase === 'incierto' || datos.fase === 'consultando') && <PrimaryButton titulo="Consultar estado de preferencias" onPress={() => void controller.cargar()} cargando={datos.fase === 'consultando'} />}
    {datos.fase === 'revisar' && <PrimaryButton titulo="He revisado; continuar" onPress={controller.aceptarRevision} />}
    {datos.borrador && <View style={{ marginTop: 16 }}><PrimaryButton titulo="Guardar preferencias" onPress={() => void controller.guardar()} cargando={datos.fase === 'guardando'} deshabilitado={datos.fase !== 'listo' || !dirty} /></View>}
  </View>;
}
