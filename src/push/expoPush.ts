import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { IosAuthorizationStatus, AndroidImportance } from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { dispositivosApi } from '../api/dispositivos';
import { ApiRequestError, request } from '../api/client';
import { PushController, type Binding } from './PushController';
import { opaqueId } from './payload';
import type { Proyecto, TareaDetalle } from '../api/types';

const key = 'samproject.push.revocations.v1';
// SDK58: StoreClient también incluye expo-dev-client. expoVersion identifica Expo Go.
export const nativePushAvailable = () => (Platform.OS === 'android' || Platform.OS === 'ios') && Constants.expoVersion == null;
function allowed(p: Notifications.NotificationPermissionsStatus) {
  return Platform.OS === 'ios'
    ? p.ios?.status !== undefined && [IosAuthorizationStatus.AUTHORIZED, IosAuthorizationStatus.PROVISIONAL, IosAuthorizationStatus.EPHEMERAL].includes(p.ios.status)
    : p.granted;
}
export async function expoToken(ask: boolean) {
  if (!nativePushAvailable()) return { motivo: 'Push requiere una compilación de desarrollo propia; no está disponible en Expo Go ni en web.' };
  if (!Device.isDevice) return { motivo: 'Comprueba las notificaciones push en un dispositivo físico.' };
  const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  if (typeof projectId !== 'string' || !/^[0-9a-f-]{36}$/i.test(projectId)) return { motivo: 'Falta configurar el projectId de Expo para activar notificaciones.' };
  if (Platform.OS === 'android') await Notifications.setNotificationChannelAsync('default', { name: 'Actualizaciones de tareas', importance: AndroidImportance.DEFAULT });
  let p = await Notifications.getPermissionsAsync();
  if (!allowed(p) && ask && p.canAskAgain) p = await Notifications.requestPermissionsAsync({ ios: { allowAlert: true, allowBadge: false, allowSound: false } });
  if (!allowed(p)) return { motivo: 'Notificaciones sin permiso. Puedes habilitarlas en Ajustes y reintentar aquí.' };
  const { data } = await Notifications.getExpoPushTokenAsync({ projectId });
  if (!/^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]+\]$/.test(data) || data.length > 512) throw new Error('Token Expo no válido.');
  return { token: data, plataforma: Platform.OS === 'ios' ? 'IOS' as const : 'ANDROID' as const };
}
export function createPushController() {
  return new PushController({
    api: dispositivosApi, token: async ask => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try { return await Promise.race([expoToken(ask), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Tiempo de espera agotado.')), 10000); })]); }
      finally { clearTimeout(timer); }
    },
    load: async () => {
      const raw = await SecureStore.getItemAsync(key);
      if (!raw) return [];
      const data: unknown = JSON.parse(raw);
      if (!Array.isArray(data) || !data.every(b => b && opaqueId(b.id) && opaqueId(b.usuarioId) && typeof b.pendiente === 'boolean')) throw new Error('No se pudo leer el estado de revocación.');
      return data as Binding[];
    },
    save: bindings => SecureStore.setItemAsync(key, JSON.stringify(bindings)),
    status: e => e instanceof ApiRequestError ? e.statusCode : undefined,
    tarea: (jwt, id) => request<TareaDetalle>(`/tareas/${encodeURIComponent(id)}`, { bearer: jwt }),
    proyecto: (jwt, id) => request<Proyecto>(`/proyectos/${encodeURIComponent(id)}`, { bearer: jwt }),
  });
}
/** No presentar contenido remoto en primer plano (el SO controla la bandeja en segundo plano). */
export function listenPush(controller: PushController) {
  if (!nativePushAvailable()) return () => {};
  Notifications.setNotificationHandler({ handleNotification: async () => ({ shouldShowBanner: false, shouldShowList: false, shouldPlaySound: false, shouldSetBadge: false }) });
  const received = Notifications.addNotificationReceivedListener(n => { void controller.receive(n.request.content.data); });
  const response = (r: Notifications.NotificationResponse, cold = false) => {
    if (r.actionIdentifier === Notifications.DEFAULT_ACTION_IDENTIFIER) controller.tap(r.notification.request.content.data, r.notification.request.identifier, cold);
    Notifications.clearLastNotificationResponse();
  };
  const tapped = Notifications.addNotificationResponseReceivedListener(r => response(r));
  // El listener recibe token NATIVO: ignorar su valor, volver a pedir Expo Push Token.
  const rotated = Notifications.addPushTokenListener(() => { void controller.refresh(false); });
  const last = Notifications.getLastNotificationResponse();
  if (last) response(last, true);
  return () => { received.remove(); tapped.remove(); rotated.remove(); };
}
