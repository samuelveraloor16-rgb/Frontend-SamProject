/**
 * Tipos del contrato de API (docs/orquestacion/CONTRATO_API.md v1.2).
 * La app NO calcula métricas: progreso, vencidas y ritmo vienen del backend.
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

export type EstadoTarea = 'PENDIENTE' | 'EN_CURSO' | 'HECHA';
export type PrioridadTarea = 'BAJA' | 'MEDIA' | 'ALTA' | 'URGENTE';

/** Miembro resumido dentro de proyecto/responsable (CONTRATO_API.md §3 y §4). */
export type MiembroResumen = {
  id: string;
  nombre: string;
  email: string;
};

export type Etiqueta = {
  id: string;
  nombre: string;
  color: string;
};

/** Objeto Proyecto (CONTRATO_API.md §3). `progreso` viene calculado del backend (RF-11). */
export type Proyecto = {
  id: string;
  nombre: string;
  descripcion: string | null;
  fechaInicio: string | null;
  fechaFin: string | null;
  archivado: boolean;
  esBandejaDeEntrada: boolean;
  espacioId: string;
  miembros: MiembroResumen[];
  progreso: number;
  creadoEn: string;
  actualizadoEn: string;
};

/** GET /proyectos/:id/progreso — RF-11, cálculo único en backend. */
export type ProgresoProyecto = {
  total: number;
  hechas: number;
  pendientes: number;
  enCurso: number;
  vencidas: number;
  progreso: number;
};

/** Resumen de subtarea embebido en el detalle (GET /tareas/:id, contrato §4). */
export type SubtareaResumen = {
  id: string;
  titulo: string;
  estado: EstadoTarea;
  prioridad: PrioridadTarea;
  vencida: boolean;
  responsable: MiembroResumen | null;
  fechaLimite: string | null;
};

/** GET /tareas/:id — `subtareas` numérico + `subtareasDetalle` solo en detalle (contrato §4). */
export type TareaDetalle = Tarea & {
  subtareasDetalle: SubtareaResumen[];
};

/** Objeto Tarea (CONTRATO_API.md §4). */
export type Tarea = {
  id: string;
  titulo: string;
  descripcion: string | null;
  estado: EstadoTarea;
  prioridad: PrioridadTarea;
  fechaLimite: string | null;
  fechaFinalizacion: string | null;
  proyectoId: string;
  responsable: MiembroResumen | null;
  tareaPadreId: string | null;
  etiquetas: Etiqueta[];
  vencida: boolean;
  subtareas: number;
  creadoEn: string;
  actualizadoEn: string;
};

/** Resumen mínimo de tarea dentro de la Bandeja (lo que la app usa). */
export type TareaResumen = {
  id: string;
  titulo: string;
  estado: EstadoTarea;
  prioridad: PrioridadTarea;
  fechaLimite: string | null;
  vencida: boolean;
};

/** GET /espacios/:espacioId/bandeja — meta incluye proyectoId (CONTRATO_API.md §5). */
export type BandejaResponse = Paginated<Tarea, { proyectoId: string }>;

/**
 * GET /espacios/:espacioId/calendario — RF-18 (CONTRATO_API.md §7, v1.2).
 * TareaPublica estándar (sin subtareasDetalle); meta añade desde/hasta efectivos
 * (YYYY-MM-DD, null si el extremo quedó abierto) y `totalDePorTareas`, total de
 * tareas del rango completo (igual a `meta.total`, clave explícita para el cliente).
 */
export type CalendarioResponse = Paginated<
  Tarea,
  { desde: string | null; hasta: string | null; totalDePorTareas: number }
>;

/** Invitación creada (POST /espacios/:id/invitaciones, §2). El token NO viaja en la respuesta. */
export type InvitacionCreada = {
  id: string;
  email: string;
  rol: RolEspacio;
  expiraEn: string;
};

/** Respuesta de aceptar una invitación (POST /invitaciones/:token/aceptar, §2). */
export type AceptarInvitacionResponse = {
  espacio: { id: string; nombre: string; miRol: RolEspacio };
  mensaje: string;
};

/** Formato único de errores de la API (CONTRATO_API.md §0). */
export type ApiErrorBody = {
  statusCode: number;
  message: string | string[];
  error: string;
};

/** Filtros y orden del listado de tareas (contrato §4 y §5). */
export type TareaFiltros = {
  estado?: EstadoTarea;
  prioridad?: PrioridadTarea;
  responsableId?: string;
  q?: string;
  vencidas?: boolean;
  orden?: 'creadoEn' | 'fechaLimite' | 'prioridad';
  direccion?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
};
