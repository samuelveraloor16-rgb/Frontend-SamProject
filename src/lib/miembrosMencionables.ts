import { infiniteQueryOptions } from '@tanstack/react-query';
import { listarMiembrosMencionables } from '../api/comentarios';
import { accesoComentariosDenegado } from './comentariosLectura';

export const miembrosMencionablesKey = (tareaId: string, sesion?: string) => ['miembros-mencionables', tareaId, ...(sesion ? [sesion] : [])] as const;

export function miembrosMencionablesOptions(tareaId: string, busqueda: string, perderAcceso: () => void, sesion?: string) {
  const q = busqueda.trim();
  return infiniteQueryOptions({
    queryKey: [...miembrosMencionablesKey(tareaId, sesion), q],
    initialPageParam: 1,
    queryFn: async ({ pageParam }) => {
      try {
        return await listarMiembrosMencionables(tareaId, { page: pageParam, pageSize: 20, q: q || undefined });
      } catch (error) {
        if (accesoComentariosDenegado(error)) perderAcceso();
        throw error;
      }
    },
    getNextPageParam: ultima => ultima.meta.pagina < ultima.meta.totalPaginas ? ultima.meta.pagina + 1 : undefined,
    retry: false,
    gcTime: 0,
    staleTime: 0,
    refetchOnMount: 'always',
  });
}
