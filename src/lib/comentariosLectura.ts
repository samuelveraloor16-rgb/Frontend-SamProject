import { infiniteQueryOptions } from '@tanstack/react-query';
import { listarComentarios } from '../api/comentarios';
import { ApiRequestError } from '../api/client';

export const comentariosKey = (tareaId: string, sesion?: string) => ['comentarios', tareaId, ...(sesion ? [sesion] : [])] as const;

export function accesoComentariosDenegado(error: unknown): boolean {
  return error instanceof ApiRequestError && [401, 403, 404].includes(error.statusCode);
}

/** Caché efímera: volver a abrir exige consultar la autorización actual. */
export function comentariosLecturaOptions(tareaId: string, onAccesoPerdido?: () => void, sesion?: string) {
  return infiniteQueryOptions({
    queryKey: comentariosKey(tareaId, sesion),
    initialPageParam: 1,
    queryFn: async ({ pageParam }) => {
      try {
        return await listarComentarios(tareaId, { page: pageParam, pageSize: 20 });
      } catch (error) {
        if (accesoComentariosDenegado(error)) onAccesoPerdido?.();
        throw error;
      }
    },
    getNextPageParam: (lastPage) =>
      lastPage.meta.pagina < lastPage.meta.totalPaginas ? lastPage.meta.pagina + 1 : undefined,
    retry: false,
    staleTime: 0,
    gcTime: 0,
    refetchOnMount: 'always',
  });
}
