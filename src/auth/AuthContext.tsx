/**
 * Sesión de SamProject: token en memoria + SecureStore (ver api/tokenStorage),
 * usuario en contexto. El árbol de la app consume esto; TanStack Query
 * maneja los datos remotos (espacios, bandeja, ...).
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { cerrarSesionRemota, iniciarSesion, obtenerPerfil, registrar } from '../api/auth';
import { loadToken, saveToken, clearToken } from '../api/tokenStorage';
import { setUnauthorizedHandler } from '../api/client';
import type { Usuario } from '../api/types';

export type EstadoSesion = 'cargando' | 'autenticado' | 'no-autenticado';

type AuthContextValue = {
  estado: EstadoSesion;
  usuario: Usuario | null;
  iniciarSesion: (email: string, contrasena: string) => Promise<void>;
  registrarse: (nombre: string, email: string, contrasena: string) => Promise<void>;
  cerrarSesion: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [estado, setEstado] = useState<EstadoSesion>('cargando');
  const [usuario, setUsuario] = useState<Usuario | null>(null);

  const limpiarSesion = useCallback(() => {
    setUsuario(null);
    setEstado('no-autenticado');
    queryClient.clear();
  }, [queryClient]);

  // Arranque: hidratar token desde SecureStore y validarlo contra /perfil.
  useEffect(() => {
    let activo = true;
    (async () => {
      const token = await loadToken();
      if (!token) {
        if (activo) setEstado('no-autenticado');
        return;
      }
      try {
        const perfil = await obtenerPerfil();
        if (!activo) return;
        setUsuario(perfil);
        setEstado('autenticado');
      } catch {
        await clearToken();
        if (activo) setEstado('no-autenticado');
      }
    })();
    return () => {
      activo = false;
    };
  }, []);

  // Cualquier 401 de la API cierra la sesión local.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      void clearToken();
      limpiarSesion();
    });
    return () => setUnauthorizedHandler(null);
  }, [limpiarSesion]);

  const establecerSesion = useCallback(
    async (auth: { usuario: Usuario; accessToken: string }) => {
      await saveToken(auth.accessToken);
      queryClient.clear();
      setUsuario(auth.usuario);
      setEstado('autenticado');
    },
    [queryClient],
  );

  const iniciarSesionCb = useCallback(
    async (email: string, contrasena: string) => {
      const auth = await iniciarSesion({ email: email.trim().toLowerCase(), contrasena });
      await establecerSesion(auth);
    },
    [establecerSesion],
  );

  const registrarseCb = useCallback(
    async (nombre: string, email: string, contrasena: string) => {
      const auth = await registrar({ nombre: nombre.trim(), email: email.trim().toLowerCase(), contrasena });
      await establecerSesion(auth);
    },
    [establecerSesion],
  );

  const cerrarSesion = useCallback(async () => {
    try {
      await cerrarSesionRemota();
    } catch {
      // Aunque el servidor falle (token ya inválido, sin red), la sesión
      // local se cierra igual.
    }
    await clearToken();
    limpiarSesion();
  }, [limpiarSesion]);

  const value = useMemo<AuthContextValue>(
    () => ({ estado, usuario, iniciarSesion: iniciarSesionCb, registrarse: registrarseCb, cerrarSesion }),
    [estado, usuario, iniciarSesionCb, registrarseCb, cerrarSesion],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth debe usarse dentro de <AuthProvider>');
  return ctx;
}
