import { useCallback, useRef, useState, useSyncExternalStore, type ComponentRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useAuth } from '../auth/AuthContext';
import type { SelloSesion } from '../auth/SessionController';
import { descargarReporte, type FormatoReporte } from '../api/reportes';
import { ReporteController } from '../lib/ReporteController';
import { compartirDisponible, compartirReporte, escribirReporte, limpiarResiduosReportes } from '../lib/expoReportes';
import { registrarReporte } from '../lib/reportesSesion';
import { PrimaryButton } from './PrimaryButton';
import { colors } from '../theme/colors';

class PosicionReporte {
  private pending = false;
  private anchor = { x: 0, y: 0, width: 1, height: 1 };
  reservar() { if (this.pending) return false; this.pending = true; return true; }
  liberar() { this.pending = false; }
  actualizar(x: number, y: number, width: number, height: number) { this.anchor = { x, y, width: Math.max(1, width), height: Math.max(1, height) }; }
  obtener() { return this.anchor; }
}

/** Same typography and institutional palette as the panel; no new visual system. */
export function ReportesProyecto({ id, sello, jwt, sinAcceso }: { id: string; sello: SelloSesion; jwt: string; sinAcceso: () => void }) {
  const { esSesionActual, salirLocalSiSesionActual } = useAuth();
  const box = useRef<ComponentRef<typeof View>>(null);
  const [position] = useState(() => new PosicionReporte());
  const [c] = useState(() => new ReporteController({ id, sello, jwt, vigente: esSesionActual,
    descargar: descargarReporte, escribir: escribirReporte, disponible: compartirDisponible,
    compartir: (archivo, f) => compartirReporte(archivo, f, position.obtener()), sinAcceso,
    unauthorized: () => { if (esSesionActual(sello)) void salirLocalSiSesionActual(sello, 'Tu sesión expiró. Inicia sesión nuevamente.'); },
  }));
  const state = useSyncExternalStore(c.subscribe, c.getSnapshot, c.getSnapshot);
  useFocusEffect(useCallback(() => {
    c.activar(); limpiarResiduosReportes();
    const unsubscribe = registrarReporte(() => { if (!esSesionActual(sello)) c.suspender(); });
    return () => { unsubscribe(); c.suspender(); };
  }, [c, esSesionActual, sello]));
  const busy = state.fase !== 'inicial';
  const iniciar = (f: FormatoReporte) => {
    if (busy || !box.current || !position.reservar()) return;
    // Resolve actual window coordinates before the native sheet (including iPad).
    box.current?.measureInWindow((x, y, width, height) => {
      position.actualizar(x, y, width, height);
      void c.iniciar(f).finally(() => { position.liberar(); });
    });
  };
  return <View ref={box} collapsable={false} style={styles.section}>
    <Text accessibilityRole="header" style={styles.heading}>Reporte del proyecto</Text>
    <Text style={styles.note}>Se solicita un nuevo corte al servidor. Puede diferir del panel. Guardar depende de los destinos que ofrezca tu dispositivo.</Text>
    <PrimaryButton titulo="Compartir PDF" deshabilitado={busy} cargando={busy} onPress={() => iniciar('pdf')} />
    <PrimaryButton titulo="Compartir CSV" deshabilitado={busy} cargando={busy} onPress={() => iniciar('csv')} />
    {state.fase === 'descargando' && <PrimaryButton titulo="Cancelar descarga" onPress={c.cancelar} />}
    {state.mensaje && <Text accessibilityLiveRegion="polite" style={styles.note}>{state.mensaje}</Text>}
    <Text style={styles.note}>Compartir entrega una copia a otra aplicación. Cerrar sesión no puede retirar esas copias.</Text>
  </View>;
}
const styles = StyleSheet.create({
  section: { gap: 12, paddingVertical: 12 },
  heading: { fontFamily: 'Georgia', fontSize: 24, color: colors.primary },
  note: { fontSize: 14, lineHeight: 21, color: colors.text },
});
