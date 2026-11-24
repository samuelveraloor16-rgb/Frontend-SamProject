import { createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { actualizarPerfil, cambiarContrasena, cerrarSesionRemota, iniciarSesion, obtenerPerfil, registrar } from '../api/auth';
import { saveToken, clearToken, loadToken, getToken, getTokenVersion, SecureStorageError } from '../api/tokenStorage';
import { ApiRequestError, setUnauthorizedHandler } from '../api/client';
import { SessionController, type SelloSesion } from './SessionController';
import { ProfileWriteCoordinator } from './ProfileWriteCoordinator';
import type { Usuario } from '../api/types';

type AuthContextValue = ReturnType<SessionController['getSnapshot']> & {
  iniciarSesion: (email: string, contrasena: string) => Promise<void>;
  registrarse: (nombre: string, email: string, contrasena: string) => Promise<void>;
  cerrarSesion: () => Promise<void>; salirLocal: (aviso?: string) => Promise<void>;
  revalidar: () => Promise<void>; reintentarBorrado: () => Promise<void>;
  revalidarTrasReset: (incierto: boolean) => Promise<void>;
  iniciarReset: () => number;
  finalizarReset: (id: number, resultado: 'exito' | 'incierto' | 'rechazado') => Promise<void>;
  capturarSesion: () => SelloSesion | null; esSesionActual: (sello: SelloSesion | null) => boolean;
  esCredencialActual: (sello: SelloSesion | null) => boolean;
  actualizarUsuario: (usuario: Usuario, sello: SelloSesion | null) => void;
  salirLocalSiSesionActual: (sello: SelloSesion | null, aviso: string) => Promise<void>; limpiarAviso: () => void;
  perfilEscrituras: ProfileWriteCoordinator;
};
const AuthContext = createContext<AuthContextValue | null>(null);
export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [controller] = useState(() => new SessionController({
    clearToken, saveToken, loadToken, getToken, getTokenVersion,
    perfil: obtenerPerfil, logout: cerrarSesionRemota,
    login: (email, contrasena) => iniciarSesion({ email, contrasena }),
    registro: (nombre, email, contrasena) => registrar({ nombre, email, contrasena }),
    clearCache: () => queryClient.clear(),
    status: error => error instanceof ApiRequestError ? error.statusCode : undefined,
    storageCritical: error => error instanceof SecureStorageError && error.critical,
  }));
  const [perfilEscrituras] = useState(() => new ProfileWriteCoordinator({
    credencial: controller.credencialActual, sello: controller.capturarSesion, credencialVigente: controller.esCredencialActual,
    actualizarUsuario: (usuario, sello) => {
      const actual = controller.capturarSesion();
      if (actual && actual.usuarioId === sello.usuarioId && actual.tokenVersion === sello.tokenVersion) controller.actualizarUsuario(usuario, actual);
    },
    guardar: actualizarPerfil, consultar: obtenerPerfil, cambiar: cambiarContrasena, salir: controller.salirLocalSiSesionActual,
  }));
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  useEffect(() => {
    setUnauthorizedHandler(controller.unauthorized);
    const unsubscribe = controller.subscribe(perfilEscrituras.sincronizar);
    void controller.bootstrap();
    return () => { unsubscribe(); setUnauthorizedHandler(null); };
  }, [controller, perfilEscrituras]);
  return <AuthContext.Provider value={{ ...snapshot, iniciarSesion: controller.iniciarSesion, registrarse: controller.registrarse,
    cerrarSesion: controller.cerrarSesion, salirLocal: controller.salirLocal, revalidar: controller.revalidar, revalidarTrasReset: controller.revalidarTrasReset,
    iniciarReset: controller.iniciarReset, finalizarReset: controller.finalizarReset,
    reintentarBorrado: controller.retryCleanup, actualizarUsuario: controller.actualizarUsuario,
    capturarSesion: controller.capturarSesion, esSesionActual: controller.esSesionActual, esCredencialActual: controller.esCredencialActual,
    salirLocalSiSesionActual: controller.salirLocalSiSesionActual, limpiarAviso: controller.limpiarAviso, perfilEscrituras }}>
    {children}
  </AuthContext.Provider>;
}
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth debe usarse dentro de <AuthProvider>');
  return ctx;
}
