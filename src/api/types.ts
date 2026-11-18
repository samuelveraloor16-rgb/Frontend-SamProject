/**
 * Tipos del contrato de API (docs/orquestacion/CONTRATO_API.md v1.1).
 * Solo se modelan los recursos que la app consume en este tramo:
 * auth, perfil, espacios y la Bandeja de entrada (meta).
 */

export type Usuario = {
  id: string;
  email: string;
  nombre: string;
  fotoUrl: string | null;
  creadoEn: string;
};

/** Envelope de registro/login (CONTRATO_API.md §1). */
export type AuthResponse = {
  usuario: Usuario;
  accessToken: string;
  tokenType: 'Bearer';
  expiresIn: string;
};

export type RolEspacio = 'ADMINISTRADOR' | 'MIEMBRO';

/** Objeto Espacio (vista pública, CONTRATO_API.md §2). */
export type Espacio = {
  id: string;
  nombre: string;
  esPersonal: boolean;
  asistenteActivo: boolean;
  miRol: RolEspacio;
  totalMiembros: number;
  creadoEn: string;
};

/** Envelope de lista paginada (CONTRATO_API.md §0, Paginación). */
export type Paginated<T, TMeta extends object = object> = {
  datos: T[];
  meta: {
    pagina: number;
    tamanoPagina: number;
    total: number;
    totalPaginas: number;
  } & TMeta;
};

/** Resumen mínimo de tarea dentro de la Bandeja (lo que la app usa). */
export type TareaResumen = {
  id: string;
  titulo: string;
  estado: 'PENDIENTE' | 'EN_CURSO' | 'HECHA';
  prioridad: 'BAJA' | 'MEDIA' | 'ALTA';
  fechaLimite: string | null;
  vencida: boolean;
};

/** GET /espacios/:espacioId/bandeja — meta incluye proyectoId (CONTRATO_API.md §5). */
export type BandejaResponse = Paginated<TareaResumen, { proyectoId: string }>;

/** Formato único de errores de la API (CONTRATO_API.md §0). */
export type ApiErrorBody = {
  statusCode: number;
  message: string | string[];
  error: string;
};
