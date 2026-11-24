import * as SecureStore from 'expo-secure-store';

const TOKEN_KEY = 'samproject.accessToken';
const PENDING_KEY = 'samproject.pendingCleanup';
let memoryToken: string | null = null;
let version = 0;
let pending: Promise<void> = Promise.resolve();

export class SecureStorageError extends Error {
  constructor(readonly operation: 'read' | 'save' | 'cleanup', readonly critical: boolean) {
    super('No se pudo completar la operación de almacenamiento seguro.');
    this.name = 'SecureStorageError';
  }
}
function serial<T>(operation: () => Promise<T>): Promise<T> {
  const result = pending.then(operation, operation);
  pending = result.then(() => undefined, () => undefined);
  return result;
}
export function getToken(): string | null { return memoryToken; }
export function getTokenVersion(): number { return version; }

/** Un marcador ya confirmado mantiene el arranque bloqueado si falla el borrado. */
async function finishCleanup(markerConfirmed: boolean): Promise<void> {
  try { await SecureStore.deleteItemAsync(TOKEN_KEY); }
  catch { throw new SecureStorageError('cleanup', !markerConfirmed); }
  try { await SecureStore.deleteItemAsync(PENDING_KEY); }
  catch { throw new SecureStorageError('cleanup', false); }
}

/** No leer el JWT mientras exista una limpieza incompleta. */
export function loadToken(): Promise<string | null> {
  const ticket = version;
  return serial(async () => {
    let marker: string | null;
    try { marker = await SecureStore.getItemAsync(PENDING_KEY); }
    catch { throw new SecureStorageError('read', false); }
    if (marker !== null) {
      await finishCleanup(true);
      if (version === ticket) memoryToken = null;
      return null;
    }
    let token: string | null;
    try { token = await SecureStore.getItemAsync(TOKEN_KEY); }
    catch { throw new SecureStorageError('read', false); }
    if (version === ticket) memoryToken = token;
    return version === ticket ? token : null;
  });
}

/** Marcar antes de guardar: si se interrumpe, el siguiente arranque limpia. */
export function saveToken(token: string): Promise<void> {
  const ticket = ++version;
  return serial(async () => {
    if (version !== ticket) return;
    let marked = false;
    try {
      await SecureStore.setItemAsync(PENDING_KEY, '1'); marked = true;
      await SecureStore.setItemAsync(TOKEN_KEY, token);
      if (version !== ticket) { await finishCleanup(true); return; }
      await SecureStore.deleteItemAsync(PENDING_KEY);
      if (version === ticket) memoryToken = token;
      else await finishCleanup(false);
    } catch {
      if (version === ticket) memoryToken = null;
      // No anunciar acceso si la escritura o su confirmación fallaron.
      try { await finishCleanup(marked); }
      catch (error) { throw error; }
      throw new SecureStorageError('save', false);
    }
  });
}

/** Dejar de usar el JWT inmediatamente; proteger la limpieza entre arranques. */
export function clearToken(): Promise<void> {
  memoryToken = null;
  version++;
  return serial(async () => {
    let marked = false;
    try { await SecureStore.setItemAsync(PENDING_KEY, '1'); marked = true; }
    catch { /* Se intenta borrar el JWT incluso si no se puede marcar. */ }
    await finishCleanup(marked);
  });
}
