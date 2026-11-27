# RF22 — Panel móvil por proyecto (entrega local, 26/11/2026)

Base comprobada: `fb6df597f806f1beccf7ece596f1ab9fcde2e066`, árbol inicialmente limpio. Solo cambios en Frontend-SamProject; sin staging, commit ni push.

## Archivos

- `src/api/metricas.ts` (nuevo): tipos, GET dedicado y GET detalle para nombre/archivo; plazo de 15 s sobre cabeceras y cuerpo, Bearer inmutable y validación de shape/rangos.
- `src/lib/PanelProyectoController.ts` (nuevo): controlador local por proyecto/sello de sesión, sin caché compartida; carga, actualización y purga ante errores/acceso perdido.
- `src/screens/PanelProyectoScreen.tsx` (nuevo): panel solo lectura y gráficas primitivas, integración de foco y AppState.
- `src/screens/ProyectoScreen.tsx`: enlace accesible «Ver panel del proyecto»; conserva el resto de la pantalla.
- `src/navigation/types.ts`: ruta tipada `PanelProyecto` con solo `proyectoId`.
- `src/navigation/AppNavigator.tsx`: registro autenticado de la ruta con React Navigation existente, sin migrar a Router.
- `tests/rf22-panel.test.cjs` (nuevo): API, controlador, presentación y harness de hooks/hosts simulados.
- `docs/RF22_PANEL_MOVIL.md` (este informe).

## Implementado / semántica

RF22 móvil por proyecto: avance destacado, total contable, barras de pendientes/en curso/completadas, trabajo pendiente y vencidas separado. Skill `frontend-design` aplicada: paleta institucional, Georgia existente para jerarquía, texto legible y desplazable, controles de al menos 44 dp (entrada 48 dp), progreso con valor accesible, barras con nombres/cifras y no solo color. Sin imágenes nuevas ni modificaciones del logo institucional existente. `docs/diseno/DESIGN.md` no existe en el workspace.

Se consume contrato v1.8 §11: `GET /proyectos/:id/metricas`, bare, sin query/body; baseURL existente ya contiene `/api/v1`. ID codificado como segmento. Todos los números son literales del endpoint, no del listado de tareas, RF11 cacheado ni del detalle de proyecto. No se suman estados, no se reconstruyen progreso/trabajoPendiente/vencidas, ni se validan mediante fórmulas de negocio. Validación de conteos enteros seguros no negativos, límite individual por total y progreso finito 0–100. Fixtures deliberadamente independientes verifican ausencia de recomposición; no representan una población backend válida ni una prueba de coherencia integral.

La única división de conteos es geometría de anchura de barras respecto de total; no se presenta como otro porcentaje. Progreso usa directamente el porcentaje dado. Pendientes = sin iniciar (`PENDIENTE`), trabajo pendiente incluye en curso, vencidas no es un cuarto estado. Explicación RF11 de subtareas/padres sin duplicación. El corte `calculadoEn` se muestra como fecha/hora del servidor convertida a hora del dispositivo, no como tiempo real. La regla de vencidas se explica como día local del servidor, sin cálculos con reloj móvil. Ritmo se rotula no disponible, no como cero; sin serie histórica inventada.

Nombre y archivo se obtienen por GET detalle real, con Bearer capturado y plazo; no se confía en parámetros de ruta para archivo/autorización. Solo se usan `id`, `nombre`, `archivado`: sus métricas RF11 no condicionan ni reemplazan valores del panel. Ambas lecturas deben confirmarse para presentar el panel. Son solicitudes independientes: archivo puede cambiar entre ambas; no se promete instantánea conjunta ni revocación inmediata.

## Estados y aislamiento

- Carga inicial sin ceros/defaults. Vacío únicamente tras respuesta confirmada con `total: 0`.
- Actualizar manual; nueva lectura al recuperar foco y al volver AppState activo mientras la pantalla está enfocada.
- Al actualizar, desenfocar o pasar a segundo plano se retiran las cifras anteriores. Error, timeout/red, 429 y respuestas inválidas no restauran el corte anterior. Reintento explícito, sin retry automático.
- 404/403 de cualquiera de las consultas purga datos y muestra aviso genérico, sin repetir mensajes privados; permite reintentar o volver al inicio. No distingue eliminado de acceso perdido.
- Proyecto archivado muestra aviso de solo lectura; este panel no ofrece escrituras ni acciones de tareas.
- Instancia por proyecto + usuario + generación + versión de credencial. Respuestas tardías de sesión anterior (incluso misma cuenta), proyecto anterior, blur/desmontaje o consulta reemplazada no publican datos ni invalidan otra sesión.
- 401 del Bearer capturado no usa cierre global de `request`; el controlador invoca cierre solo si el sello sigue vigente, siguiendo RF21/AuthContext.
- Invalidar una lectura no garantiza cancelar el transporte: puede terminar hasta el plazo de 15 s, pero se descarta su resultado. Se elimina el listener AppState al perder foco/desmontar; no hay persistencia, logs privados ni caché global del panel.
- Sin conexión no se garantiza detectar revocaciones; el texto pide reintentar y no presenta snapshots como actualizados.

## Verificaciones ejecutadas (offline)

Desde `Frontend-SamProject`:

| Comando | Resultado |
| --- | --- |
| `node --test tests/rf22-panel.test.cjs` | 13/13 pasan |
| `node --test tests/*.test.cjs` | 221/221 pasan (incluye las 13; no sumar) |
| `npm run typecheck` | Correcto, sin errores |
| `npm run lint` | Correcto, sin errores ni warnings |
| `git diff --check` | Correcto; Git puede avisar conversión LF→CRLF por configuración previa |

Pruebas: ruta/baseURL/codificación/payload/Bearer, errores sin retry, timeout de fetch/cuerpo y respuestas/401 tardíos; shape/rangos; carga/vacío/archivo, doble actualización, red/429/404 y purga, reintento, sesión misma cuenta/logout/desmontaje/blur, proyecto A→B, reactivación y consulta antigua. UI con hosts/hooks simulados verifica cifras literales, geometría, nombres y valor accesible de progreso, vacío, actualización/errores, archivo, salida al inicio y limpieza de listener. Registro/conexión de navegación y clave por proyecto/sello se verifican estructuralmente; no es un recorrido nativo completo.

Lecturas previas: AGENTS raíz/local, DERCAS DOCX, Adicendum, contrato §11, fases/estado y patrones RF21. Documentación SDK58 consultada: `https://docs.expo.dev/versions/v58.0.0/` (RN 0.88). Sin nuevas APIs Expo nativas, paquetes ni instalaciones.

## Límites y pendientes conservados

- Endpoint backend implementado solo local, no desplegado: no se arrancó backend ni se enviaron requests reales. Las pruebas usan dobles/fetch simulado; no acreditan SQL, aislamiento, concurrencia ni rendimiento reales.
- Panel consumidor de una única fuente backend; **no** se verificó coherencia integral con IA/AdminWeb, aún no implementados. RF22 global no se declara completo.
- Sin builds/APK/exportaciones ni pruebas físicas Android/iOS, lectores de pantalla, texto grande o capturas visuales nativas. Layout con scroll, sin alturas fijas de texto ni truncamiento de contenido del panel; validación física pendiente.
- No se tocaron backend (bloque1 local preservado), AdminWeb, contratos ni documentos de orquestación/diseño. Sin RF23, reportes/exportación, IA o ritmo.
- RF19/RF20/RF21 y sus pendientes de aceptación/operación siguen abiertos; suite previa preservada. SMTP continúa no operativo: esta entrega no habilita correo, push ni migraciones reales.
