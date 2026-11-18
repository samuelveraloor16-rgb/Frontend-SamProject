/**
 * Almacén del accessToken: memoria (rápido, para requests) + SecureStore
 * (persistente entre arranques, cifrado por el sistema).
 *
 * El token nunca se guarda en AsyncStorage ni en claro en disco.
 */
import * as SecureStore from 'expo-secure-store';

const SECURE_KEY = 'samproject.accessToken';

let memoryToken: string | null = null;

/** Hidrata el token desde SecureStore al arrancar la app. */
export async function loadToken(): Promise<string | null> {
  if (memoryToken) return memoryToken;
  try {
    memoryToken = await SecureStore.getItemAsync(SECURE_KEY);
  } catch {
    // SecureStore puede fallar (p. ej. dispositivo sin cifrado en algunos
    // emuladores). La sesión simplemente no persiste.
    memoryToken = null;
  }
  return memoryToken;
}

/** Token actual en memoria (null si no hay sesión). */
export function getToken(): string | null {
  return memoryToken;
}

export async function saveToken(token: string): Promise<void> {
  memoryToken = token;
  try {
    await SecureStore.setItemAsync(SECURE_KEY, token);
  } catch {
    // La sesión sigue viva en memoria aunque no persista.
  }
}

export async function clearToken(): Promise<void> {
  memoryToken = null;
  try {
    await SecureStore.deleteItemAsync(SECURE_KEY);
  } catch {
    // Nada que limpiar en SecureStore.
  }
}
