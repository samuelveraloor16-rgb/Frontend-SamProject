# Frontend-SamProject

App móvil de **SamProject**: organización rápida de tareas y proyectos para estudiantes, equipos pequeños y emprendedores. Repositorio de la **Fase 1** (Núcleo/MVP, RF-01 a RF-17) y Fases 2–4 posteriores.

> Estado actual: **scaffold**. No hay pantallas de negocio ni llamadas reales a la API todavía. Solo navegación mínima "en construcción", tema institucional y estructura lista para construir.

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

## Comandos

| Comando | Qué hace |
|---|---|
| `npm start` | Servidor de desarrollo Expo (abrir con Expo Go o `a` para Android) |
| `npm run android` | `expo start --android` |
| `npm run ios` | `expo start --ios` |
| `npm run typecheck` | `tsc --noEmit` (estricto) |
| `npm run lint` | ESLint (eslint-config-expo, flat config) |

Verificación realizada sobre este scaffold: `npx tsc --noEmit` ✓, `npm run lint` ✓, `npx expo install --check` ✓ ("Dependencies are up to date"), `npx expo export --platform android` ✓ (bundle generado y luego borrado; `dist-test/` no existe en el repo).

## Estructura

```
App.tsx                  Entrada: GestureHandlerRootView + SafeAreaProvider + QueryClientProvider + AppNavigator
index.ts                 registerRootComponent + import 'react-native-gesture-handler'
global.css               Directivas @tailwind (NativeWind)
tailwind.config.js       Tema con la paleta institucional
babel.config.js          babel-preset-expo (jsxImportSource nativewind) + nativewind/babel
metro.config.js          withNativeWind(..., { input: './global.css' })
eslint.config.js         flat config sobre eslint-config-expo
src/
  api/
    config.ts            API_BASE_URL desde EXPO_PUBLIC_API_URL (default http://localhost:3000/api/v1)
    client.ts            Cliente HTTP PLACEHOLDER: tipos del contrato (ApiError, Paginated<T>); NO hace llamadas todavía
  navigation/
    AppNavigator.tsx     Native-stack raíz (título "SamProject")
    MainTabs.tsx         Bottom-tabs placeholder: Inicio / Próximamente
    types.ts             ParamList tipadas
  screens/               HomeScreen, PendingScreen (placeholders "En construcción")
  components/            PlaceholderScreen (logo + texto institucional)
  theme/colors.ts        Paleta institucional (fuente única para estilos inline)
assets/
  Logo.png               Logotipo institucional (copiado del root del workspace; no se inventó otro)
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

- **No hay pantallas de negocio ni consumo de endpoints** en este scaffold. El cliente API solo define tipos y lanza un error explícito si se invoca.
- Navegación mínima: native-stack envolviendo un bottom-tabs con 2 pestañas placeholder.
- **TanStack Query** configurado con `QueryClientProvider` (retry: 1, staleTime 30 s); las decisiones de cacheo reales llegarán con las pantallas de datos.
- La app **nunca calcula métricas**: progreso, vencidas, ritmo… siempre vienen del backend.
- **Tarea rápida → Bandeja de entrada en máximo 2 toques**: requisito de diseño que se respetará en las pantallas reales.

## Backend

El backend vive en `C:\Users\samue\Desktop\DESARROLLO MOVIL MEJORADO\Backend-SamProject` (NestJS + PostgreSQL + Prisma). **No forma parte de este repo**; esta app es un cliente de su API REST (`/api/v1`). Para probar contra datos reales, arranca el backend y configura `EXPO_PUBLIC_API_URL` como se indica arriba.
