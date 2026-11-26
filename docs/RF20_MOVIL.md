# RF-20 móvil — integración local (25/11/2026)

No declara RF-20 completo. Contrato utilizado: `CONTRATO_API.md` v1.4 §9 y D-21. No se modificaron backend, AdminWeb, contrato, ESTADO, DECISIONES ni documentos de diseño. No métricas locales, RF21, credenciales, HTTP contra la app/backend, push reales, builds/APK, staging, commit ni push.

## Baseline y alcance

- HEAD inicial: `74f76de67471cc48a1366cdc728dadf034ff4d4e`; árbol e índice inicialmente limpios. Manifest SHA256 de **todos los archivos versionados** capturado antes de instalar/editar en `%TEMP%/rf20-frontend-baseline.txt` (evidencia local, no versionada).
- Los únicos versionados cuyo hash cambió: `app.json`, `package.json`, `package-lock.json`, `src/api/auth.ts`, `src/api/client.ts`, `src/auth/AuthContext.tsx`, `src/navigation/AppNavigator.tsx`, `src/screens/PerfilScreen.tsx`, `tests/auth.test.cjs`.
- Nuevos: `src/api/dispositivos.ts`, `src/push/{PushController.ts,expoPush.ts,payload.ts}`, `src/components/PushControls.tsx`, `tests/push.test.cjs` y este informe.
- Assets intactos contra manifest inicial. Logo SHA256 `4FA1FC80726077CE4861262EEE33B35F7A2A5ECE593AF00F4D3F7E63963759F7`; icono `3586887F355D8319E2C17A211464581D92C467F7006A03CE0106D2669E3166D1`. Se conservan referencias y cambios previamente aprobados.
- UI mínima en Perfil: patrones existentes `PrimaryButton`, `FormField`, `ErrorBanner`, textos españoles y paleta institucional; sin rediseño, fuentes ni assets nuevos. Skill frontend-design consultada. `docs/diseno/DESIGN.md` no existe. Se conserva React Navigation existente y exigido por arquitectura del proyecto/alcance: no se migra a Expo Router pese a la recomendación genérica del AGENTS interno.

## Dependencias / delta lock

Comando autorizado: `npx expo install expo-notifications expo-device expo-constants` con Expo SDK **58.0.26**.

| Directa añadida | Especificación | Resuelta | Uso |
|---|---|---|---|
| expo-notifications | ~58.1.9 | 58.1.9 | permisos, canal, Expo token, recepción/respuesta/rotación |
| expo-device | ~58.0.5 | 58.0.5 | límite controlado de dispositivo físico |
| expo-constants | ~58.0.16 | 58.0.16 | projectId y detección Expo Go |

Lock: +109/-14 líneas. Expo Constants **ya existía transitiva 58.0.16**: se mueve desde `expo/node_modules` al nivel raíz, sin cambio de versión. Nuevas entradas necesarias: expo-notifications 58.1.9, expo-device 58.0.5, expo-application 58.1.2, abort-controller 3.0.0, event-target-shim 5.0.1, badgin 1.2.3 y ua-parser-js 0.7.41. No otras actualizaciones de versiones. Instalación informó 8 añadidos/1 eliminado y **3 vulnerabilidades moderadas**; no se ejecutó audit fix ni actualización masiva.

Docs consultadas: https://docs.expo.dev/versions/v58.0.0/sdk/notifications/ y tipos/API de los módulos instalados.

### Revisión previa al cierre

- Releído `Frontend-SamProject/AGENTS.md` y `package.json`: Expo `~58.0.26`. La documentación versionada de Notifications anterior se consultó antes de escribir la integración. En esta revisión se amplió la consulta a https://docs.expo.dev/versions/v58.0.0/sdk/constants/ y https://docs.expo.dev/versions/v58.0.0/sdk/device/; también https://docs.expo.dev/llms.txt. Versiones recomendadas coinciden con las instaladas. No se reinstalaron paquetes.
- APIs SDK58 utilizadas y comprobadas: `getExpoPushTokenAsync`, permisos/canal, listeners de recepción/respuesta y token nativo, `getLastNotificationResponse`, `clearLastNotificationResponse`, `setNotificationHandler` con `shouldShowBanner/shouldShowList`; `Device.isDevice`; `Constants.expoConfig/easConfig/expoVersion`. Config plugin conserva sus opciones SDK58 documentadas.
- **Corrección concreta:** `ExecutionEnvironment.StoreClient` incluye también development builds con expo-dev-client en SDK58; no permite distinguirlas de Expo Go. Ahora el guard usa `Constants.expoVersion` (versión de Expo Go, null fuera de él) y plataforma. Dobles reproducen StoreClient en ambos casos: Go bloqueado, development build propio permitido. No se atribuye evidencia física a esos dobles.
- **Corrección concreta:** si hay varios vínculos locales conocidos y falla el primer DELETE del logout, se deben conservar intenciones para todos e intentar los posteriores. Ahora se marcan/persisten todos antes del primer I/O y se continúa best-effort tras cada fallo. Prueba de dos vínculos acredita conservación de la intención fallida y revocación del segundo.
- Orden revisado: POST de registro en vuelo ocupa la cola; logout invalida sesión/taps inmediatamente y encola sus DELETE detrás; POST `/auth/logout` usa JWT capturado y espera esa cola. Un resultado local viejo no ejecuta compensaciones fuera de cola. Un POST que termina **en servidor** después de perder su respuesta sigue siendo un límite remoto, no garantía resuelta por abort. Transición a otra cuenta nunca reutiliza JWT del tokenStorage al ejecutar una operación encolada. Tap frío solo se resuelve tras restauración validada, acceso actual y navegador listo; salir/cambiar sesión invalida acceso pendiente.
- Aclaración de arquitectura observada: este checkout tiene `main: index.ts` → `App.tsx` → `src/navigation/AppNavigator.tsx`, React Navigation; **no** tiene dependencia `expo-router`, `src/app`, `app` ni `_layout.tsx`. AGENTS recomienda Router, pero no demuestra que esté instalado. Se preservó el árbol real existente, sin migración ni añadir Router. No es correcto afirmar una arquitectura Expo Router existente en este checkout.
- Resultados de esta revisión: **19/19** RF20 y **195/195** suite completa (incluye RF20); lint/typecheck/diff-check correctos, solo advertencias Git LF→CRLF. HEAD e índice intactos. Se mantienen todos los límites de configuración/dispositivo/red documentados abajo; los conteos 18/194 de la primera entrega al final del informe son históricos.

## Funcionamiento y aislamiento

- Cinco endpoints contractuales, IDs codificados por segmento, cuerpo exacto, sin token en listados. Todas las operaciones push capturan JWT inmutable; un 401 de este transporte no dispara el callback global de una sesión diferente. Errores se traducen a mensajes genéricos, sin tokens, códigos, JWT ni contenido remoto en logs.
- AuthContext sincroniza tras login/registro y restauración **validada por GET /perfil**, también al revalidar/cambiar sesión. La generación y JWT se comparan después de cada await antes de publicar/navegar. Consultas de acceso no usan caché. Se conserva limpieza de QueryClient y navegación remonta por generación; callback de navegación también comprueba el sello de sesión.
- Registro automático solo con permiso ya concedido; solicitud de permiso únicamente desde botón explícito en Perfil. Android crea canal `default` antes del permiso/token. iOS admite autorización provisional/efímera. Rechazo, fallo de permiso/token, proyecto ausente y Expo Go no bloquean el resto de la app.
- Plugin expo-notifications con canal/color, APNs remoto habilitado y **sin background tasks**, sonidos/iconos personalizados ni exact alarms. Android declara POST_NOTIFICATIONS. No se añade ID de proyecto inventado, Firebase, Apple, llave ni credencial.
- Listener de cambio de token **nativo** ignora ese valor y vuelve a obtener `getExpoPushTokenAsync({ projectId })`; solo Expo Push Token se envía al servidor. Rotación: alta nueva, persistir ID, revocar ID anterior conocido. Mutaciones de dispositivos serializadas; ninguna respuesta tardía genera un DELETE compensatorio fuera de esa cola ni revoca un vínculo nuevo por tomar el ID de otra sesión.
- `DELETE` del dispositivo conocido se intenta **antes** de `POST /auth/logout`, conservando Bearer capturado aunque la sesión/caché ya se oculten/limpien. El POST mantiene el plazo previo de 15 s. Registro nativo y API de dispositivos tienen plazo de 10 s; fallo de revocación no impide logout.
- SecureStore adicional guarda solo IDs de dispositivo/dueño y booleano pendiente, nunca token push, JWT para reintento, código de transferencia ni payload. Intención se guarda antes de DELETE; se elimina tras 204/404. Se reintenta al volver a primer plano o pulsar reintento **solo si la cuenta propietaria está autenticada**, antes de re-registrar; no se usa la cuenta nueva para borrar el recurso anterior. Sin JWT válido no existe endpoint seguro para revocar anónimamente: requiere volver a iniciar sesión con el propietario. No se añade dependencia de conectividad; primer plano/reintento son los disparadores.
- Lista paginada de dispositivos propios, revocación explícita, código del dueño con consentimiento y transferencia destino con código + segunda confirmación. **409 nunca dispara transferencia automática**. Alertas tardías comprueban sello antes de ejecutar. Códigos solo en memoria de la pantalla. La revocación manual del vínculo local pausa re-registro automático durante la sesión del controlador, hasta activación explícita o cambio de sesión; no constituye preferencia RF21 persistente.
- Transferir en el mismo dispositivo no permite saltarse logout: cerrar sesión revoca el vínculo y puede invalidar el código. Para el caso de token ajeno, el dueño autoriza desde **otra instalación** donde siga conectado, seleccionando ese dispositivo del listado; la cuenta destino introduce el código en la instalación receptora. No se conserva la sesión vieja ni se omite DELETE para facilitar el traspaso.

## Recepción y navegación

- Primer plano suprime banner/lista/sonido/badge nativos: nunca muestra título/body remotos. Recepción valida payload y reconsulta tarea/proyecto antes de mostrar solo un mensaje genérico de actualización. No crea avisos in-app RF21.
- Tap caliente y última respuesta fría van al mismo controlador, con dedup local acotada y limpieza de última respuesta nativa. Tap frío espera restauración validada y navegador listo; se descarta si termina sin sesión. Un cambio de sesión invalida taps pendientes y respuestas en vuelo.
- Data estricta: exactamente tipo conocido + tareaId/proyectoId/espacioId/comentarioId; sin URLs ni campos adicionales. IDs opacos acotados, sin asumir UUID/CUID; solo letras ASCII, cifras, guion/guion bajo. COMENTARIO/MENCION requieren comentarioId; otros tipos requieren null. Este filtro conservador rechaza IDs con separadores/rutas en lugar de interpretarlos.
- Antes de navegar: GET tarea y GET proyecto con **JWT de la sesión actual**, comparar IDs y pertenencia al espacio. 401/403/404, red, tarea movida, identidad distinta o sesión cambiada ⇒ no abrir. Se navega únicamente a ruta fija TareaDetalle con tareaId. No se fía del contenido del push ni se renderiza texto recibido. La pantalla vuelve a consultar detalle con sus controles previos.

## Límites de garantías / pendientes

- **Offline no garantiza silencio**: si DELETE y logout no llegan al servidor, pueden seguir llegando avisos genéricos. JWT vencido no silencia el vínculo. El SO controla notificaciones ya entregadas y presentación con app cerrada; el cliente no puede retirarlas retroactivamente ni validar acceso antes de que el SO muestre el payload mínimo del servidor.
- Timeout/abort no prueba cancelación remota. La cola evita efectos **locales** tardíos sobre el vínculo nuevo, pero la API DELETE no tiene precondición de generación/CAS: no permite demostrar ausencia de todo I/O remoto rezagado o transferencias concurrentes entre instalaciones. No se afirma exactly-once ni garantía distribuida nueva.
- Si un POST se confirma pero se pierde su respuesta, el cliente puede no conocer el ID creado y no puede deducirlo del GET (que oculta tokens). No se adivina ni se borran todos los dispositivos. Logout remoto exitoso aporta invalidación por versión del backend; si también falla, persiste el riesgo offline. El usuario puede listar/revocar bajo la cuenta propietaria. Fallo de SecureStore puede impedir persistir intención; no se declara revocación confirmada.
- Falta projectId real en configuración EAS, credenciales FCM/APNs y configuración operativa autorizada del backend; Expo Go no acredita push remoto (Android no lo soporta desde SDK53; esta implementación desactiva push en Expo Go en ambas plataformas). Nuevos módulos/plugin requieren compilación propia posterior, **no realizada aquí**.
- Falta validación física Android/iOS: permisos/rechazo/cambio en Ajustes, rotación real, canales, login/restauración/logout offline, red incierta, recepción con app cerrada, tap frío/caliente, cambio/revocación de acceso entre dispositivos, transferencias y accesibilidad/teclado. Dobles de Node no sustituyen estas pruebas.

## Verificaciones

- `node --test tests/push.test.cjs`: permisos/config/errores, listener Expo/nativo, cinco endpoints, registro/rotación, intención offline/404, respuesta tardía, consentimiento, payload, acceso revocado/movido, arranque frío/caliente y orden real con SessionController.
- `node --test tests/*.test.cjs`: regresión auth/RF19 + RF20. Se añadió únicamente mock host PushControls al harness previo de Perfil; no se eliminaron pruebas previas.
- `npm run typecheck`, `npm run lint`, `npx expo config --type public`, `git diff --check`.
- Resultados finales: RF20 **18/18**; completa **194/194** (incluye RF20; no sumar). Lint y typecheck correctos, cero errores/warnings de ESLint. Config pública Expo correcta; diff-check correcto (Git solo advierte LF→CRLF preexistente). Primera corrida detectó que el harness previo de Perfil requería registrar el nuevo host PushControls; se corrigió ese mock sin eliminar aserciones. Los dobles de Constants necesitaron `__esModule` por interoperabilidad de TS6; corregidos antes del resultado final.
- Sin export/build ni HTTP real contra servicios del proyecto. Manifest demuestra que assets y demás archivos versionados permanecen intactos; índice vacío y HEAD sin mover.
