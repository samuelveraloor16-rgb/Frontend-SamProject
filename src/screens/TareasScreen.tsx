import { useRoute, type RouteProp } from '@react-navigation/native';
import type { RootStackParamList } from '../navigation/types';
import { TareasContent } from '../components/TareasContent';

type Ruta = RouteProp<RootStackParamList, 'Tareas'>;

/** Pantalla de lista de tareas (RF-16): proyecto o Bandeja, con filtros. */
export function TareasScreen() {
  const route = useRoute<Ruta>();
  const params = route.params ?? {};
  const modo = params.bandeja ? 'bandeja' : 'proyecto';
  return (
    <TareasContent
      modo={modo}
      proyectoId={params.proyectoId}
      espacioId={params.espacioId}
    />
  );
}
