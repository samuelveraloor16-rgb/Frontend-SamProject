# RF21 — Preferencias de notificaciones móviles

Fecha: 2026-11-26. Entrega local parcial de Fase 2, exclusivamente Frontend-SamProject. No declara RF21 completo ni avanza otros RF.

## Archivos exactos

- `src/api/preferenciasNotificaciones.ts` (nuevo): tipos, GET y PATCH sobre request existente, Bearer capturado, lista permitida de campos y plazo de 15 segundos sobre cabeceras/cuerpo.
- `src/lib/PreferenciasNotificacionesController.ts` (nuevo): matriz validada del servidor, borrador y diferencias por canal, exclusión de MENCION.inApp, coordinación síncrona y revisión de resultado incierto.
- `src/components/PreferenciasNotificaciones.tsx` (nuevo): sección de Perfil, cinco eventos y tres canales accesibles, carga/reintento/consulta/revisión/guardado.
- `src/screens/PerfilScreen.tsx`: monta la sección, sin retirar ni modificar PushControls RF20.
- `tests/rf21-preferencias.test.cjs` (nuevo): 13 pruebas focalizadas node:test con transpile TypeScript y dobles locales.
- `tests/auth.test.cjs`: añade únicamente el doble del componente nuevo al harness de Perfil; conserva las aserciones anteriores.
- `docs/RF21_PREFERENCIAS_MOVIL.md` (nuevo): este informe.

## Comportamiento y contrato

Se consultaron AGENTS raíz/local, DERCAS docx, adicendum, fases/estado y contrato v1.7 §10. No existe `docs/diseno/DESIGN.md` en este espacio. Skill frontend-design utilizada; se mantiene el diseño existente: Georgia en encabezados, fondo #F7F8F5, verde #245B4A, texto #34413A y separadores #DCE9DF; sin rediseñar marca/logotipo ni navegación React Navigation.

GET `/perfil/preferencias-notificaciones` sin query/body. Solo muestra controles con una matriz real válida y completa, nunca defaults locales como datos cargados. Presenta TAREA_ASIGNADA, TAREA_POR_VENCER, TAREA_VENCIDA, COMENTARIO y MENCION; canales inApp/correo/push. MENCION.inApp siempre activada y bloqueada tanto en UI como en coordinador.

PATCH en guardar manual, exclusivamente filas y canales distintos del último estado confirmado. Revertir una edición elimina dirty; guardar sin cambios no solicita PATCH. No envía usuarioId, matriz completa por defecto ni campos ajenos. Bloquea edición/GET/PATCH durante envío y evita doble clic desde el propio controlador, antes de renderizar. Adopta la matriz completa únicamente tras respuesta válida.

Errores de carga con reintento explícito; rechazo 400 conserva borrador y permite corregir. Red, plazo vencido, 408, 5xx o respuesta inválida de escritura producen incertidumbre sin autoretry. Se requiere consultar estado y revisar antes de volver a guardar. La consulta conserva solo los canales pendientes sobre la matriz nueva, sin convertir cambios concurrentes ajenos en cambios locales. Presenta el estado consultado junto al borrador para revisión.

Instancia en memoria por montaje y sello de AuthContext (usuario, generación y versión de token), JWT inmutable y comprobación esSesionActual antes de aplicar respuestas o procesar 401. El Bearer explícito evita que request cierre globalmente una sesión nueva ante 401 antiguo. Desmontaje invalida revisiones y borra el estado local; respuestas tardías no publican datos ni disparan cierre. Sin caché persistente o compartida entre cuentas. Se siguen los patrones de sellos, bloqueo y consulta/revisión de ProfileWriteCoordinator sin modificarlo.

Correo configurable con la nota literal: “Tus preferencias se guardan, pero el envío de correos todavía no está operativo”. Push por evento no solicita permisos, registra dispositivos ni sustituye los controles RF20.

## Verificación ejecutada

- `node --test tests/rf21-preferencias.test.cjs`: **13/13** en ejecución focalizada final.
- `node --test tests/*.test.cjs`: **208/208**, cero fallos, aproximadamente 5,5 segundos. Incluye las **13 pruebas RF21** y regresión auth/RF19/RF20.
- `npm run lint`: OK, sin errores ni warnings de ESLint.
- `npm run typecheck`: OK.
- `git diff --check`: OK (Git avisa conversión futura LF→CRLF en los dos archivos previamente versionados; no es error de whitespace).
- Primera ejecución total detectó 17 fallos del harness de Perfil por dependencia nueva no declarada; se añadió el doble correspondiente y se repitió la suite íntegra con el resultado anterior. No se eliminaron pruebas.

Cobertura focalizada: payload mínimo, datos reales, MENCION bloqueada, no-op/reversión, bloqueo y doble clic, errores de carga/red/400/401/429/500, matriz inválida, incertidumbre sin retry, consulta/revisión, preservación de canales concurrentes, plazo sobre fetch/cuerpo, GET/PATCH tardíos tras sesión nueva de la misma cuenta/logout/desmontaje y reactivación de efecto. UI comprobada de forma estática, no con renderizador nativo ni dispositivo.

Documentación consultada mediante webfetch normal: https://docs.expo.dev/versions/v58.0.0/ (expo instalado ~58.0.26; RN 0.88), https://reactnative.dev/docs/0.88/accessibility (switch, checked/disabled y etiquetas). No se añadieron APIs Expo nuevas ni dependencias.

## Límites y pendientes

- Sin integración con servidor real, migraciones, prueba PostgreSQL ni validación UI física Android/iOS, VoiceOver/TalkBack o capturas. Los dobles no acreditan esas verificaciones.
- Correo sigue pendiente/no operativo; no se envió correo, push ni tráfico a servicios de negocio. No se arrancó backend.
- Una consulta posterior no demuestra que una solicitud incierta nunca vaya a confirmar más tarde; la UI lo advierte. Abort/plazo no cancelan escritura remota. No existe orden global entre clientes.
- El borrador y el estado incierto son por montaje, no durables: al salir de Perfil se descartan, y al volver se consulta nuevamente el servidor. Una escritura remota anterior podría aún procesarse después de esa lectura; no se garantiza cancelación ni preservación del borrador al reabrir. No hay reenvío automático al montar.
- No se amplió aquí el listado de avisos RF19 ni se implementaron fases posteriores.
- Backend, AdminWeb, contratos, documentos de orquestación, dependencias y configuración intactos. Sin MCP/memoria/subagentes, APK, pruebas físicas ni git add/commit/push; staging vacío al verificar. Contrato API y estilo institucional respetados.
