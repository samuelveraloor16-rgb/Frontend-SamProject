import { ApiRequestError } from '../api/client';

export type ResultadoReset =
  | { tipo: 'exito' }
  | { tipo: 'incierto' }
  | { tipo: 'rechazado'; error: ApiRequestError };

/** La liberación del coordinador no depende de que la pantalla siga montada. */
export async function ejecutarReset(
  token: string,
  contrasena: string,
  deps: {
    iniciar: () => number;
    enviar: (token: string, contrasena: string) => Promise<unknown>;
    finalizar: (id: number, resultado: ResultadoReset['tipo']) => Promise<void>;
    estaActiva?: () => boolean;
    entregar?: (resultado: ResultadoReset) => void;
  },
): Promise<ResultadoReset> {
  const id = deps.iniciar();
  let resultado: ResultadoReset;
  try {
    await deps.enviar(token, contrasena);
    resultado = { tipo: 'exito' };
  } catch (error) {
    resultado = !(error instanceof ApiRequestError) || error.esErrorDeRed || error.statusCode >= 500 || error.statusCode === 408
      ? { tipo: 'incierto' } : { tipo: 'rechazado', error };
  }
  await deps.finalizar(id, resultado.tipo);
  if (deps.estaActiva?.()) deps.entregar?.(resultado);
  return resultado;
}
