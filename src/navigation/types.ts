import type { NavigatorScreenParams } from '@react-navigation/native';

export type PrincipalTabParamList = {
  Inicio: undefined;
  Bandeja: undefined;
};

export type RootStackParamList = {
  /** Público: acceso y registro. */
  Acceso: undefined;
  Registro: undefined;
  /** Autenticado: pestañas principales (Inicio, Bandeja). */
  Principal: NavigatorScreenParams<PrincipalTabParamList> | undefined;
  /** Espacio de trabajo: proyectos, miembros e invitaciones. */
  Espacio: { espacioId: string };
  /** Detalle de proyecto: progreso RF-11 + tareas en lista. */
  Proyecto: { proyectoId: string };
  /**
   * Lista de tareas con filtros (RF-16).
   * - `proyectoId`: tareas de un proyecto.
   * - `bandeja` + `espacioId`: Bandeja de entrada de ese espacio.
   */
  Tareas: { proyectoId?: string; espacioId?: string; bandeja?: boolean } | undefined;
  /** Tablero Kanban (RF-17). Mismos modos que Tareas. */
  Kanban: { proyectoId?: string; espacioId?: string; bandeja?: boolean } | undefined;
  /** Tarea rápida → Bandeja (RF-13). Sin espacioId: Bandeja del espacio personal. */
  TareaRapida: { espacioId?: string } | undefined;
  /** Aceptación de invitación por token (RF-06). Enlace: samproject://invitar?token=... */
  AceptarInvitacion: { token?: string } | undefined;
};
