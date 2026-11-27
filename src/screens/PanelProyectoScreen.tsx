import { useCallback, useState, useSyncExternalStore } from 'react';
import { ActivityIndicator, AppState, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useAuth } from '../auth/AuthContext';
import type { SelloSesion } from '../auth/SessionController';
import { getToken } from '../api/tokenStorage';
import { obtenerMetricasProyecto, obtenerProyectoParaPanel, type MetricasProyecto } from '../api/metricas';
import { PanelProyectoController } from '../lib/PanelProyectoController';
import type { RootStackParamList } from '../navigation/types';
import { ScreenHeader } from '../components/ScreenHeader';
import { PrimaryButton } from '../components/PrimaryButton';
import { colors } from '../theme/colors';

export function PanelProyectoScreen() {
  const { params: { proyectoId } } = useRoute<RouteProp<RootStackParamList, 'PanelProyecto'>>();
  const { capturarSesion } = useAuth();
  const sello = capturarSesion(), jwt = getToken();
  return sello && jwt ? <PanelSesion key={`${proyectoId}:${sello.usuarioId}:${sello.generation}:${sello.tokenVersion}`} proyectoId={proyectoId} sello={sello} jwt={jwt} /> : null;
}
function PanelSesion({ proyectoId, sello, jwt }: { proyectoId: string; sello: SelloSesion; jwt: string }) {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { esSesionActual, salirLocalSiSesionActual } = useAuth();
  const [controller] = useState(() => new PanelProyectoController({
    proyectoId, sello, jwt, vigente: esSesionActual, metricas: obtenerMetricasProyecto, proyecto: obtenerProyectoParaPanel,
    unauthorized: capturado => { if (esSesionActual(capturado)) void salirLocalSiSesionActual(capturado, 'Tu sesión expiró. Inicia sesión nuevamente.'); },
  }));
  const datos = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  useFocusEffect(useCallback(() => {
    const cargar = () => { controller.activar(); void controller.cargar(); };
    if (AppState.currentState === 'active') cargar();
    const sub = AppState.addEventListener('change', state => { if (state === 'active') cargar(); else controller.suspender(); });
    return () => { sub.remove(); controller.suspender(); };
  }, [controller]));
  const ocupado = datos.fase === 'cargando';
  return <View style={styles.screen}>
    <ScreenHeader titulo="Panel del proyecto" />
    <ScrollView contentContainerStyle={styles.content}>
      {datos.proyecto && <><Text accessibilityRole="header" style={styles.heading}>{datos.proyecto.nombre}</Text>
        {datos.proyecto.archivado && <Text style={styles.archive}>Proyecto archivado · solo lectura</Text>}</>}
      {(ocupado || datos.fase === 'inicial') && <View accessibilityLiveRegion="polite" style={styles.section}><ActivityIndicator color={colors.primary} /><Text style={styles.body}>Consultando un nuevo corte…</Text></View>}
      {datos.error && <View accessibilityLiveRegion="polite" style={styles.warning}><Text style={styles.body}>{datos.error}</Text><Text style={styles.body}>No se muestran cifras anteriores. Reintenta cuando tengas conexión para comprobar el acceso y obtener otro corte.</Text></View>}
      {datos.metricas && <MetricasPanel metricas={datos.metricas} />}
      <PrimaryButton titulo={datos.error ? 'Reintentar panel' : 'Actualizar panel'} cargando={ocupado} onPress={() => void controller.cargar()} />
      {datos.fase === 'sin-acceso' && <View style={styles.section}><PrimaryButton titulo="Volver al inicio" onPress={() => navigation.navigate('Principal')} /></View>}
      <Text style={styles.note}>El panel no es en tiempo real. Se consulta al volver a esta pantalla o al actualizar. Sin conexión no se puede comprobar si el acceso sigue vigente.</Text>
    </ScrollView>
  </View>;
}

/** Solo geometría: las etiquetas siempre presentan los valores crudos del backend. */
export function MetricasPanel({ metricas: m }: { metricas: MetricasProyecto }) {
  return <>
    <View style={styles.progress}>
      <Text style={styles.body}>Avance del proyecto</Text>
      <Text style={styles.number}>{m.progreso}%</Text>
      <View accessibilityRole="progressbar" accessibilityLabel="Avance del proyecto" accessibilityValue={{ min: 0, max: 100, now: m.progreso, text: `${m.progreso}%` }} style={styles.track}>
        <View style={[styles.fill, { width: `${m.progreso}%`, backgroundColor: colors.primary }]} />
      </View>
      <Text style={styles.body}>{m.hechas} completadas · Total contable: {m.total}</Text>
    </View>
    <Text style={styles.note}>Corte del servidor: {new Date(m.calculadoEn).toLocaleString('es')} (hora del dispositivo). No indica cambios posteriores.</Text>
    {m.total === 0 && <Text accessibilityLiveRegion="polite" style={styles.archive}>Este proyecto aún no tiene tareas contables.</Text>}
    <View style={styles.section}>
      <Text accessibilityRole="header" style={styles.heading}>Tareas por estado</Text>
      <Barra etiqueta="Pendientes (sin iniciar)" valor={m.pendientes} total={m.total} color={colors.text} />
      <Barra etiqueta="En curso" valor={m.enCurso} total={m.total} color={colors.tertiary} />
      <Barra etiqueta="Completadas" valor={m.hechas} total={m.total} color={colors.primary} />
      <Text style={styles.body}>Trabajo pendiente: {m.trabajoPendiente}</Text>
      <Text style={styles.note}>Incluye pendientes y en curso. Se cuentan tareas sin subtareas y subtareas, sin duplicar el padre.</Text>
    </View>
    <View style={styles.warning}>
      <Text accessibilityRole="header" style={styles.heading}>Vencidas: {m.vencidas}</Text>
      <Text style={styles.body}>Son parte del trabajo pendiente, no un estado adicional.</Text>
      <Text style={styles.note}>El servidor aplica el inicio de su día local para determinar el vencimiento; no se usa el reloj del móvil.</Text>
    </View>
    <Text style={styles.note}>Ritmo semanal no disponible en este panel.</Text>
  </>;
}
function Barra({ etiqueta, valor, total, color }: { etiqueta: string; valor: number; total: number; color: string }) {
  return <View accessible accessibilityLabel={`${etiqueta}: ${valor}`} style={styles.bar}>
    <Text style={styles.body}>{etiqueta}: {valor}</Text>
    <View importantForAccessibility="no-hide-descendants" accessibilityElementsHidden style={styles.track}>
      <View style={[styles.fill, { width: `${total > 0 ? valor / total * 100 : 0}%`, backgroundColor: color }]} />
    </View>
  </View>;
}
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: 20, paddingBottom: 48, gap: 16 },
  heading: { fontFamily: 'Georgia', fontSize: 24, color: colors.primary, marginBottom: 8 },
  body: { fontSize: 16, lineHeight: 24, color: colors.text },
  note: { fontSize: 14, lineHeight: 21, color: colors.text },
  number: { fontFamily: 'Georgia', fontSize: 48, color: colors.primary, marginVertical: 8 },
  progress: { borderLeftWidth: 4, borderColor: colors.primary, backgroundColor: colors.secondary, padding: 20, gap: 12 },
  section: { paddingVertical: 12, gap: 12 },
  archive: { backgroundColor: colors.secondary, color: colors.text, padding: 16, fontSize: 16, lineHeight: 24 },
  warning: { borderLeftWidth: 4, borderColor: colors.tertiary, padding: 16, backgroundColor: '#FFFFFF', gap: 8 },
  bar: { gap: 8, paddingVertical: 6 },
  track: { height: 12, borderRadius: 6, overflow: 'hidden', backgroundColor: '#E5EAE5' },
  fill: { height: '100%', borderRadius: 6 },
});
