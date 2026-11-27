import type { NavigatorScreenParams } from '@react-navigation/native';

export type PrincipalTabParamList = {
  Inicio: undefined;
  Bandeja: undefined;
};

export type RootStackParamList = {
  /** Público: acceso y registro. */
  Acceso: undefined;
  Registro: undefined;
  Recuperar: undefined;
  Perfil: undefined;
  Notificaciones: undefined;
  CambiarContrasena: undefined;
  /** Autenticado: pestañas principales (Inicio, Bandeja). */
  Principal: NavigatorScreenParams<PrincipalTabParamList> | undefined;
  /** Espacio de trabajo: proyectos, miembros e invitaciones. */
  Espacio: { espacioId: string };
  /** Detalle de proyecto: progreso RF-11 + tareas en lista. */
  Proyecto: { proyectoId: string };
  /** Panel RF22: consulta dedicada, solo lectura. */
  PanelProyecto: { proyectoId: string };
  /**
   * Lista de tareas con filtros (RF-16).
   * - `proyectoId`: tareas de un proyecto.
   * - `bandeja` + `espacioId`: Bandeja de entrada de ese espacio.
   */
  Tareas: { proyectoId?: string; espacioId?: string; bandeja?: boolean } | undefined;
  /** Detalle de tarea: ver y editar (RF-12). */
  TareaDetalle: { tareaId: string };
  /** Tablero Kanban (RF-17). Mismos modos que Tareas. */
  Kanban: { proyectoId?: string; espacioId?: string; bandeja?: boolean } | undefined;
  /** Calendario del espacio (RF-18): vista mensual/semanal + tareas del día. */
  Calendario: { espacioId: string };
  /** Tarea rápida → Bandeja (RF-13). Sin espacioId: Bandeja del espacio personal. */
  TareaRapida: { espacioId?: string } | undefined;
  /** Aceptación de invitación por token (RF-06). Enlace: samproject://invitar?token=... */
  AceptarInvitacion: { token?: string } | undefined;
};
