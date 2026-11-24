# Frontend-SamProject

App móvil de **SamProject**: organización rápida de tareas y proyectos para estudiantes, equipos pequeños y emprendedores. Repositorio de la **Fase 1** (Núcleo/MVP, RF-01 a RF-17) y Fases 2–4 posteriores.

> Estado actual: **núcleo Fase 1 conectado al backend** (RF-01 a RF-17). Login/Registro, Home con la lista real de espacios (rol y miembros), pantalla de espacio (proyectos con progreso del backend, creación de proyecto, invitación por correo para administradores + aceptación por token con deep link `samproject://invitar?token=...`), pantalla de proyecto (progreso RF-11 vía `GET /proyectos/:id/progreso`, tareas con cambio de estado en un toque, FAB de tarea rápida → Bandeja en dos toques), pantalla Tareas (filtros estado/prioridad/responsable/vencidas/búsqueda con debounce/orden, paginación infinita), Kanban de tres columnas con arrastrar y soltar (mantén pulsado; cambia de columna con `PATCH /tareas/:id/estado`) y Bandeja de entrada como pestaña principal de la navegación.

- Contexto del proyecto: `AGENTS.md` (raíz del workspace) y `..\AGENTS.md`
- Plan de Fase 1: `..\docs\orquestacion\FASE1.md`
- Contrato de API (Fase 1): `..\docs\orquestacion\CONTRATO_API.md`
- Adicendum DERCAS v1.2 (Fase 5 / AdminWeb): `..\ADICENDUM_DERCAS_v1.2.md`

## Requisitos

- **Node.js 24** (probado con 24.15.0) y npm 11
- **Expo Go** en el teléfono (Android/iOS) — no hace falta Android SDK
- El **backend** en ejecución (ver aviso más abajo)

## SDK y versiones reales instaladas

| Paquete | Versión |
|---|---|
| expo | ~58.0.26 (**SDK 58**) |
| react / react-native | 19.3.0 / 0.88.1 |
| typescript | ~6.0.3 (estricto) |
| @react-navigation/* | 7.x (native-stack + bottom-tabs) |
| @tanstack/react-query | ^5.108.0 |
| expo-secure-store | instalado vía `npx expo install` (versión compatible con SDK 58) |
| nativewind / tailwindcss | 4.2.7 / 3.4.19 |
| react-native-draggable-flatlist | ^4.0.3 |
| react-native-calendars | ^1.1314.0 |
| victory-native | ^36.9.2 (rama clásica, vía react-native-svg) |
| react-native-reanimated / gesture-handler / svg / screens / safe-area-context | 4.7.1 / ~3.3.0 / 15.16.0 / ~4.30.1 / ~5.11.1 |

> **victory-native**: se instaló la rama clásica **36.9.2** (renderiza con `react-native-svg`, ya incluido). La rama nueva (43.x) exige `@shopify/react-native-skia` + `react-native-worklets`, una carga nativa mucho mayor sin beneficio en esta fase; puede reevaluarse en la Fase 3 (panel de control). No se fuerza nada que rompa el build.

## Setup

```bash
npm install
cp .env.example .env
```

Edita `.env` y apunta `EXPO_PUBLIC_API_URL` a tu backend:

- Emulador Android: `http://10.0.2.2:3000/api/v1`
- Dispositivo físico con Expo Go (mismo Wi-Fi): `http://<IP-LAN>:3000/api/v1`
  (p. ej. `http://192.168.1.100:3000/api/v1`)

> **`.env` no se commitea** (está en `.gitignore`). Es la URL pública embebida en el bundle; los secretos viven solo en el servidor.

### Persistencia y recuperación de sesión (RF-02)

- El JWT se guarda únicamente en `expo-secure-store` y en memoria; no se usa AsyncStorage. Al arrancar se consulta `GET /perfil` antes de mostrar información privada. Si falla por red o por el servidor, se conserva el JWT y se ofrece reintentar; un 401 autenticado inicia su eliminación.
- Antes de guardar o eliminar una credencial se intenta escribir un marcador de limpieza en SecureStore. Si la app se interrumpe después de escribirlo, el siguiente arranque intenta borrar el JWT y el marcador antes de restaurar cualquier sesión. Si la lectura o limpieza falla, la app bloquea el acceso y ofrece reintentar. Si falla la escritura de un nuevo JWT, se intenta revertirla y no se anuncia que se inició sesión.
- **Límite importante:** SecureStore no ofrece una transacción atómica para estas dos claves. Si el dispositivo no permite registrar el marcador ni borrar la credencial, o si el proceso termina antes de registrar el marcador, no puede garantizarse que el cierre quede registrado tras un reinicio. Si el servidor tampoco confirmó el cierre, un JWT anterior podría volver a ser validado. La app muestra un aviso crítico cuando detecta que no pudo ni marcar ni borrar; reintenta sin compartir el dispositivo. Si no se puede completar el cierre, cambiar la contraseña desde otro dispositivo puede invalidar las sesiones de esa cuenta. Un cierre remoto sin respuesta podría ejecutarse más tarde y afectar una sesión nueva.
- Un restablecimiento sin respuesta también puede terminar en el servidor después de una consulta de perfil: un `200` anterior no demuestra que el JWT siga vigente después. Si hay un inicio de sesión en curso cuando el resultado es incierto, se descarta su credencial y se pide iniciar sesión de nuevo; para sesiones existentes se revalida sin asumir que el enlace pertenezca a la misma cuenta. Las respuestas tardías del servidor y un cierre inesperado de la app no pueden descartarse desde el cliente.
- El restablecimiento y la consulta de perfil tienen un plazo cliente de 15 segundos que incluye tanto la petición como la lectura del cuerpo. Agotar el plazo de un restablecimiento se trata como resultado incierto; abortar la espera local no confirma que el servidor haya cancelado la operación. Las respuestas que lleguen después no confirman el resultado ni ejecutan de nuevo las acciones de la pantalla.
- La confirmación de SecureStore no elimina las limitaciones del sistema operativo ni sustituye las pruebas en Android/iOS. En iOS, el llavero puede conservar elementos tras desinstalar y reinstalar; no se debe asumir que desinstalar elimina la credencial.

## Comandos

| Comando | Qué hace |
|---|---|
| `npm start` | Servidor de desarrollo Expo (abrir con Expo Go o `a` para Android) |
| `npm run android` | `expo start --android` |
| `npm run ios` | `expo start --ios` |
| `npm run typecheck` | `tsc --noEmit` (estricto) |
| `npm run lint` | ESLint (eslint-config-expo, flat config) |

Verificación: `npx tsc --noEmit` ✓, `npm run lint` ✓, `npx expo export --platform android` ✓ (bundle generado; `dist/` no se commitea). Smoke HTTP contra el backend real (registro → espacios → crear proyecto → crear tarea → progreso RF-11 → cambio de estado → filtro → tarea rápida → borrado): ✓ el 2026-11-17 contra el `dist/` servido en `:3000`.

## Estructura

```
App.tsx                  Entrada: GestureHandlerRootView + SafeAreaProvider + QueryClientProvider + AuthProvider + AppNavigator
index.ts                 registerRootComponent + import 'react-native-gesture-handler'
global.css               Directivas @tailwind (NativeWind)
tailwind.config.js       Tema con la paleta institucional
babel.config.js          babel-preset-expo (jsxImportSource nativewind) + nativewind/babel
metro.config.js          withNativeWind(..., { input: './global.css' })
eslint.config.js         flat config sobre eslint-config-expo
src/
  api/
    config.ts            API_BASE_URL desde EXPO_PUBLIC_API_URL (default http://localhost:3000/api/v1)
    client.ts            Cliente HTTP tipado: Bearer automático, ApiRequestError (mensajes del backend), 401 → cierre de sesión
    tokenStorage.ts      accessToken en memoria + SecureStore (expo-secure-store)
    auth.ts              registro / login / logout / perfil (CONTRATO_API.md §1)
    espacios.ts          espacios (listar/crear/obtener), bandeja con filtros, invitaciones (contratar §2, §5)
    proyectos.ts         proyectos (listar/crear/obtener) y progreso RF-11 (§3)
    tareas.ts            tareas: listado con filtros, creación, estado, tarea rápida (§4)
    types.ts             Usuario, Espacio, Proyecto, Tarea, ProgresoProyecto, Paginated<T>, ApiErrorBody (contrato v1.1)
  auth/
    AuthContext.tsx      Sesión: hidrata token al arrancar, valida con /perfil, 401 global → logout
  lib/
    validation.ts        Validación cliente alineada con el contrato (email, contraseña 8+ letra+número…)
  navigation/
    AppNavigator.tsx     Pila nativa condicionada por sesión + pestañas (Inicio, Bandeja) + deep links samproject://
    types.ts             RootStackParamList y PrincipalTabParamList tipadas
  screens/
    LoginScreen.tsx      Acceso (RF-02) con validación y errores del backend
    RegistroScreen.tsx   Registro (RF-01): crea cuenta; el backend crea espacio personal + Bandeja
    HomeScreen.tsx       Home (RF-05): perfil, lista real de espacios con rol y miembros, crear espacio si no hay
    BandejaTabScreen.tsx Pestaña «Bandeja» (RF-13): TareasContent en modo bandeja, espacio personal
    EspacioScreen.tsx    Espacio (RF-06/09): proyectos con progreso del backend, crear proyecto, invitar (admin)
    ProyectoScreen.tsx   Proyecto (RF-11): progreso backend, tareas, FAB de tarea rápida (2 toques)
    TareasScreen.tsx     Lista de tareas con filtros (RF-16), envuelta por TareasContent
    KanbanScreen.tsx     Kanban (RF-17): 3 columnas, arrastrar manteniendo pulsado, PATCH /tareas/:id/estado
    TareaRapidaScreen.tsx Tarea rápida → Bandeja (RF-13): un campo + Guardar
    AceptarInvitacionScreen.tsx  Aceptar invitación por token (RF-06), deep link samproject://invitar?token=
  components/            AuthLayout, FormField, PrimaryButton, ErrorBanner, ScreenHeader, EmptyState,
                         PrioridadBadge, TareaItem, ProgresoBar, PickerModal, TareaFab, TareasContent
  theme/colors.ts        Paleta institucional (fuente única para estilos inline)
assets/
  Logo.png               Logotipo institucional (intocado)
```

## Paleta institucional (fija)

| Rol | Color |
|---|---|
| Primary | `#245B4A` |
| Secondary | `#DCE9DF` |
| Tertiary | `#D5C78E` |
| Background | `#F7F8F5` |
| Text | `#34413A` |

Interfaz en **español**. Código técnico en inglés permitido.

## Decisiones y alcance

- **Núcleo Fase 1 conectado** (este tramo): espacios, proyectos, tareas, Kanban, bandeja y tarea rápida. Fuera aún: calendario (Fase 2), panel de métricas, asistente, adjuntos/comentarios.
- Sesión: `accessToken` en memoria (requests) y en SecureStore (persistencia). Arranque: hidrata el token y lo valida con `GET /perfil`; un 401 en cualquier request cierra la sesión local. Logout llama `POST /auth/logout` (best effort) e invalida el token en el servidor.
- Al registrarse, el backend crea **en la misma transacción** el espacio personal (`esPersonal: true`, rol ADMINISTRADOR) y el proyecto «Bandeja de entrada». La app **no** los crea: los obtiene con `GET /espacios` y `GET /espacios/:id/bandeja?pageSize=1` (solo `meta.total` y `meta.proyectoId`).
- **TanStack Query** en el árbol (`QueryClientProvider`) para datos remotos (espacios, bandeja) con `retry: 1, staleTime: 30 s`; la sesión vive en `AuthContext`.
- La app **nunca calcula métricas**: progreso, vencidas, ritmo… siempre vienen del backend.
- **Tarea rápida → Bandeja de entrada en máximo 2 toques**: FAB (toque 1) → pantalla con un campo + Guardar (toque 2). Sin campo `titulo` vacío no se puede guardar.
- **Kanban**: tres columnas (PENDIENTE/EN_CURSO/HECHA), tarjeta = tarea del listado agrupada en cliente. Arrastrar manteniendo pulsado; el cambio de columna persiste con `PATCH /tareas/:id/estado`. El reorden fino dentro de una columna no existe en el contrato (PATCH /tareas/:id no acepta orden) y conserva el orden estable del backend.
- **Responsable**: el selector de filtro y de asignación usa `miembros` del objeto Proyecto (detalle o bandeja vía `meta.proyectoId`). Si el contrato añade `GET /espacios/:id/miembros`, basta cambiar el origen de datos del picker.
- **Crear espacio**: el backend no expone creación de espacio personal; el botón de la cuenta vacía usa `POST /espacios` (espacio de equipo con el creador como ADMINISTRADOR).
- Tipografía de pantalla: Georgia (serif institucional) para titulares; sistema para el cuerpo. La regla dorada (`#D5C78E`) es el único motivo decorativo.

## Backend

El backend vive en `C:\Users\samue\Desktop\DESARROLLO MOVIL MEJORADO\Backend-SamProject` (NestJS + PostgreSQL + Prisma). **No forma parte de este repo**; esta app es un cliente de su API REST (`/api/v1`). Para probar contra datos reales, arranca el backend y configura `EXPO_PUBLIC_API_URL` como se indica arriba.

> **Nota de entorno (2026-11-17):** el proceso que escucha en `:3000` ya sirve el `dist/` actual (verificado con smoke HTTP: `/espacios` responde 401 sin token, no 404). Si vuelve a quedar desactualizado, hay que reiniciar el backend.
