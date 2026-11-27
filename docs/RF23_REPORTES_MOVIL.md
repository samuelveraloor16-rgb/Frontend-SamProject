# RF-23 móvil — entrega técnica local (aceptación integral pendiente)

## Continuación autorizada — 27/11/2026

El usuario autorizó conservar las versiones instaladas, la transitiva config-plugins y el plugin Sharing. El bloque de instalación inferior se conserva como **historia**, no como bloqueo vigente. Precheck intacto. Se implementó el flujo móvil; no se declara RF23 aceptado integralmente.

### Compatibilidad y delta completo comprobados antes del código

- Expo **58.0.26**, React Native **0.88.1**. FileSystem **58.0.15**, Sharing **58.0.24**, config-plugins **58.0.14**, todos MIT. Semver del mapa instalado admite los dos parches (`~58.0.14` / `~58.0.23`); documentación SDK58 recomienda `~58.0.15` / `~58.0.24`.
- Frente a HEAD: package.json añade solo las dos directas; lock añade sus entradas, deduplica FileSystem anidado 58.0.14 a raíz 58.0.15, actualiza config-plugins 58.0.13→58.0.14 y las dos referencias raíz. Ninguna otra entrada alterada (923→924 contando raíz). Plugin `expo-sharing` y reformateo CLI en app.json conservados; recepción desactivada por defecto, sin extensiones, Documents público, chmod ni permisos nuevos.
- **No se ejecutó ninguna instalación adicional**, actualización masiva o audit fix. La evidencia histórica de auditoría inferior no es una auditoría nueva ni garantía de seguridad. Lock conservado durante implementación: SHA256 `3D6B7F1DE41434A7076191193639CD5A2AA7ED3D755A8DB8B11B65DD1AAAF00F`.

### Implementación y archivos

- `src/api/reportes.ts`: cliente binario separado de JSON; exclusivamente los dos GET de contrato v1.12 §15, id codificado como segmento, bearer capturado en header (nunca URL/log/nombre/archivo), `credentials: omit`, `redirect: error` y rechazo adicional de URL final inesperada/redirección. Sin retries ni fallback automático. Plazo 15s para headers **y cuerpo**, abort/cancelación, buffer fijo 1MiB y conteo real por chunk; no confía en Content-Length (si existe se comprueba también igualdad).
- Headers contractuales MIME/attachment fijo/private-no-store/nosniff; vacíos, exceso, JSON y truncamientos detectables rechazados. PDF: firma y terminador EOF; CSV: BOM, UTF8 estricto, encabezado fijo y framing RFC4180 de dos registros/13 campos, preservando CRLF internos entre comillas. **No es un validador semántico ni parser integral PDF**: no demuestra que un archivo malicioso con framing correcto sea válido. No interpreta métricas ni reconstruye documentos; los bytes originales se escriben intactos.
- `src/lib/ReporteController.ts`: operación aislada por proyecto/sello, exclusión síncrona de duplicados, cancelación, comprobaciones antes/después de descargar/escribir y antes de compartir; 401 invalida solo sello vigente, 403/404 purgan panel/estado sensible, 422 PDF explica caracteres no representables/límites y ofrece solicitar CSV manualmente. 429/red/5xx/capacidad ausente/errores I/O o Sharing sin falso éxito. Share resuelto `void` solo informa hoja cerrada, nunca «guardado»/«compartido».
- `src/lib/expoReportes.ts`: adaptador SDK58 File/Directory/Paths.cache, isAvailableAsync/shareAsync; escritura binaria privada por directorio propio de operación y nombre contractual `resumen-proyecto.ext`; sin identidad en rutas. Marca propia `ofrecido` vacía y control de operaciones activas para limpieza segura.
- `src/lib/reportesSesion.ts` y `src/auth/AuthContext.tsx`: sincronización inmediata de invalidación de sesión con abort de operaciones; limpieza de residuos al arranque. No cambia navegación ni reglas de sesión.
- `src/components/ReportesProyecto.tsx`, `src/screens/PanelProyectoScreen.tsx`, `src/lib/PanelProyectoController.ts`: acciones desde panel listo, purga 403/404; foco/blur/unmount/sello/proyecto; anchor iPad con `measureInWindow` de View nativa (no componente compuesto). Diseño contenido: misma Georgia para títulos, texto 14/21, flujo vertical alineado a izquierda, separación12, paleta institucional y PrimaryButton existente ≥52dp, rol/nombre/busy/disabled; cancelar solo mientras descarga. No nuevo logo, fuentes, tarjetas decorativas ni cambios al flujo de tarea rápida.
- `tests/rf23-reportes.test.cjs` y ajuste mínimo de mock en `tests/rf22-panel.test.cjs`: API/controller/adaptador/hosts UI con dobles. Documentos precheck e instalación preservados.

### Política de archivos y límites reales — HISTÓRICA, sustituida por corrección siguiente

1. Cada operación escribe en `Paths.cache/samproject-rf23-v1/op-<instante>-<secuencia>/resumen-proyecto.ext`. No se toca ningún directorio fuera del namespace ni entradas con nombres desconocidos. Creación rechaza colisiones.
2. Fallo/cancelación/revocación antes de ofrecer: eliminar solo esa operación después de que la escritura pendiente termine. Un error de disco puede impedir borrar: se reintenta al arranque/reentrada. Parciales sin marca se limpian entonces inmediatamente; operaciones activas se excluyen.
3. Justo antes de invocar Sharing se crea marca vacía. Una vez invocado, **incluso si rechaza**, no se elimina inmediatamente: no existe evidencia fiable de que el receptor haya terminado de leer. Durante la promesa sigue protegido como activo; después queda retenido **7 días mínimos**, purgable únicamente al siguiente arranque/reentrada pasado el plazo. Sin temporizador destructivo al cerrar hoja/logout/unmount. No garantiza límite máximo si la app no vuelve a abrirse o falla I/O.
4. SDK no da acuse de lectura final por destino. Siete días es política conservadora, **no garantía de lectura indefinida**; el SO puede purgar caché antes. Copias externas no son revocables. No se demuestra permiso vigente después del snapshot backend ni se revoca retroactivamente un archivo ya entregado. No prometer que existe destino Guardar ni que el usuario lo eligió. Web no comparte archivos privados por URI y se declara no disponible (sin subir a URL pública).
5. `expo/fetch` documenta `body.getReader()` para lectura incremental. El cliente limita los bytes que acumula/acepta/escribe; **no acredita un límite de memoria/red interna del stack nativo**, sus colas o el tamaño de un chunk entregado por SDK. PDF solo firma/framing, no análisis integral. Configuración productiva debe usar HTTPS; no se cambió la URL local de desarrollo existente.

### Corrección vigente: temporales por sesión y cuota global (27/11/2026)

La política v1 anterior queda **superada**. No cambian descarga, formatos, API, panel RF22 ni diseño.

- `ReportesTemporales.ts`: gestor testeable con disco/reloj/aleatoriedad inyectados. `expoReportes.ts` usa **`uuid.v4()` de `expo` ya instalado**, documentado en SDK58 `/sdk/expo/`. Namespace `samproject-rf23-v2/<UUID sesión>/op-<instante>-<UUID operación>/resumen-proyecto.ext`: sin token, usuario ni proyecto. El sello de autenticación sigue en el controlador, nunca en disco. Rotación invalida los handles existentes; cada nuevo proceso comienza sin sesión de archivos restaurada. No hay API para listar/reabrir/recompartir cuarentena.
- AuthContext detecta invalidación del sello completo (incluye tokenVersion), rota el namespace y conserva las reglas de autenticación existentes. Fetch tardío no escribe por guardas del controlador; write tardío queda protegido hasta acabar y entonces se elimina si su sesión ya no es actual. Recibidos no ofrecidos se eliminan ante error/cancelación/logout cuando termina la escritura. Fallos de borrado son residuos, **no borrados confirmados**.
- Cuota GLOBAL: **24 operaciones/reportes y 8 MiB de contenido total**, máximo **1 MiB por reporte**. Incluye todas las sesiones v2, cuarentena y legado `samproject-rf23-v1`. Una operación usa un reporte y una marca vacía; cuota de cantidad cuenta operaciones, no los dos inodos. Inventario real más reservas síncronas de bytes completos **antes de escribir**, incluyendo escrituras concurrentes no materializadas, evita exceso transitorio de contenido por carreras en este proceso. No limita overhead de filesystem ni memoria/red nativa. Legados ya por encima del límite bloquean nuevas escrituras; no se borran ofrecidos recientes para forzar hueco.
- Lectura/escritura de disco ilegible falla cerrado y muestra mensaje seguro. No se usa `exists=false` como prueba de directorio vacío: se crea idempotentemente y se lista. Tamaños inválidos bloquean. Delete fallido no se resta del próximo inventario. Entradas desconocidas se cuentan si son archivos directos; nunca se borran; directorios desconocidos/estructura inesperada bloquean nuevas exportaciones, sin exploración recursiva. Fuera de ambos namespaces no se enumera ni elimina nada.
- La marca se crea **dentro del adaptador justo antes de invocar** Sharing, sin await intermedio; preparar/validar el handle no equivale a ofrecerlo. Fallo anterior a invocación limpia recibido. Una invocación, tanto `void` como rechazo/throw, se trata conservadoramente como ofrecida: no confirma guardado, envío, cancelación ni lectura. Handle de un solo uso. Logout no revoca URI ya entregada ni copias externas; cuarentena permanece sin posibilidad de acceso desde otra sesión de la aplicación.
- Retención: ofrecidos elegibles tras **7 días desde marca** (legado desde timestamp del directorio), nunca mientras promesa de hoja pendiente, incluso al volver `AppState active`. Arranque, foco/reentrada, logout/rotación, liberación de operación y `AppState active` ofrecen cleanup best effort; **no cron, timers destructivos ni limpieza con app cerrada**. Pasado el plazo se puede borrar en la próxima oportunidad: es una decisión conservadora, no prueba de que un lector tardío terminó. El SO puede purgar antes. Reloj hacia atrás o fecha ausente conservan y bloquean por cuota si se llena. No existe máximo temporal garantizado sin nueva oportunidad o ante fallos I/O; sí se bloquea crecimiento nuevo por la cuota.
- Modelo de archivos: rutas privadas creadas únicamente por esta app; sin entrada de rutas externas, sin API de symlinks ni recorrido recursivo. **SDK58 no expone lstat/no-follow**: no se acredita protección contra manipulación del sandbox por código nativo ajeno/dispositivo comprometido que inserte enlaces con nombres válidos. No confundir profundidad fija con detección de symlinks; garantía contra ese adversario requeriría adaptador nativo autorizado. Pendiente explícito si se exige ese modelo de amenaza.

Validación de esta corrección: `node --test tests/rf23-reportes.test.cjs tests/rf23-temporales.test.cjs tests/rf22-panel.test.cjs` **40/40** y `node --test tests/*.test.cjs` **248/248**; typecheck, lint y diff-check correctos. Pruebas Node/VM y dobles: A/B/logout/write tardío, una sola invocación/rechazo, cuotas cantidad/bytes/legado/multisesión/reservas concurrentes, errores lectura/write/delete/marca, protección hoja pendiente, expiración por lifecycle, reloj atrás y fecha ausente. No son pruebas del SO. Sin nuevas dependencias/configuración, físicas, APK, instalaciones ni Git write. Lock SHA256 conservado `3D6B7F1DE41434A7076191193639CD5A2AA7ED3D755A8DB8B11B65DD1AAAF00F`; staging vacío. Android/iOS/iPad reales y aceptación global RF19/20/21/22/23 siguen pendientes.

### Fuentes verificadas

Documentación versionada SDK58 FileSystem, Sharing, Expo/fetch (enlaces históricos abajo), índice `https://docs.expo.dev/llms.txt`, RN0.88 `https://reactnative.dev/docs/0.88/the-new-architecture/layout-measurements`. Tipos/código instalados confirman `write(): Promise<void>`, bytes Uint8Array, `redirect` en fetch, bloqueo nativo Android de redirects y modos iOS; no se inventaron APIs. `shareAsync(): Promise<void>` y anchor opcional iPad documentados. React Navigation existente conservado por instrucción expresa, no Router. AGENTS raíz/local, DERCAS docx, adicendum prioritario, contrato/fases/estado leídos; DESIGN.md ausente, skill frontend-design y memorias contexto-general/adminweb-scope consultadas.

### Verificación local

Comandos finales desde Frontend-SamProject:

- `node --test tests/rf23-reportes.test.cjs tests/rf22-panel.test.cjs`: **28/28** (15 RF23 + 13 regresión RF22).
- `node --test tests/*.test.cjs`: **236/236**, ninguna omitida.
- `npm run typecheck`, `npm run lint`, `git diff --check`: correctos. Git solo advierte conversión LF→CRLF en archivos existentes. Se corrigieron previamente tipado del ref RN0.88, reglas de inmutabilidad/hooks y mock RF22 para el nuevo componente; los resultados finales son posteriores a esas correcciones.
- Revisión estructural del lock contra HEAD: solo las cinco entradas enumeradas (raíz, config-plugins, FileSystem anidado eliminado, FileSystem raíz y Sharing). Hash final idéntico al verificado durante implementación. `git diff --cached --name-only`: vacío. `git status --short` AdminWeb: limpio. Backend ya contiene cambios RF23 ajenos a esta tarea, no se escribió allí.

Cobertura focal: headers/body streaming y límite real con Content-Length ausente/mentiroso, exacto1MiB, vacíos/truncamientos/framing/UTF8/JSON, bearer/segmento/redirect configurable, 422/429/errores HTTP, timeout/cancel ignorando abort, misma cuenta/rotación de token/sesión/logout/proyecto/unmount, escritura/hoja tardías, I/O/limpieza propia/residuos activos/retención, capacidad ausente y Promise<void>/fallo Sharing sin éxito ficticio, botones/duplicados/busy/cancel/anchor con hosts. Solo se simula que el transporte honra `redirect:error`; el código nativo instalado fue inspeccionado, no ejecutado.

Todos los tests usan Node/VM y dobles de Expo, red, filesystem y hosts React; no son renderer ni sistema operativo real. Sin solicitudes autenticadas/backend real, archivos reales del dispositivo, hojas nativas, pruebas físicas, integración SQL, APK/build/export ni git add/commit/push. Backend conserva su trabajo RF23 previo (dirty); AdminWeb no intervenido. No se modificó contrato/orquestación/diseño.

RF19: aceptación integral/dispositivos, respaldo HMAC y operación de limpieza pendientes. RF20: credenciales/PostgreSQL/recepción física/retención segura. RF21: correo verificado/vigencia, SMTP no operativo, SQL real y tipos nuevos móviles. RF22: integración/SQL/concurrencia reales, aceptación visual/accesible y coherencia futura IA/AdminWeb; cobertura histórica no acreditada, **ritmo no disponible**. RF23: aceptación real Android/iOS/iPad, lectores/texto grande, destinos/retención/lectura tardía y backend real pendientes. No se cierra ningún RF global.

---

## Historia — detención anterior ya autorizada

27/11/2026. **Sin implementación RF23 ni aceptación funcional.** El precheck del 26/11 es histórico: el usuario autorizó exclusivamente las dos dependencias directas propuestas. Se ejecutó desde este repositorio:

```powershell
npx expo install expo-file-system@~58.0.15 expo-sharing@~58.0.24
```

## Resultado verificado

- Expo instalado: **58.0.26**. FileSystem resuelto **58.0.15**, Sharing **58.0.24**. Ambos MIT; satisfacen respectivamente `~58.0.14` y `~58.0.23` del mapa local `expo/bundledNativeModules.json` (comprobado con semver).
- Únicas dependencias directas añadidas: esas dos. No se ejecutó `--fix`, `audit fix` ni otra instalación.
- **Motivo de detención preventiva:** Sharing declara `@expo/config-plugins: ^58.0.14`; npm actualizó el paquete compartido preexistente de **58.0.13 a 58.0.14**, MIT. Aunque es una dependencia transitiva exigida por Sharing, se solicita aprobación explícita del cambio compartido antes de continuar, respetando la restricción sobre paquetes preexistentes. No se afirma incompatibilidad SDK.
- Delta completo del lock frente a HEAD: raíz añade dos directas; nueva entrada raíz `expo-file-system@58.0.15`; desaparece `expo/node_modules/expo-file-system@58.0.14` por deduplicación; nueva entrada `expo-sharing@58.0.24`; actualización anterior de config-plugins. Ninguna otra entrada cambió. Entradas totales 923 → 924 incluida raíz. No hay otras transitivas nuevas; `@expo/config-types` y `@expo/plist` ya estaban presentes y permanecen sin cambios.
- CLI añadió automáticamente `expo-sharing` en plugins de `app.json` y reformateó arrays existentes. Se conserva el delta para revisión; no se activaron opciones de recepción, extensiones, Documents/Files ni permisos amplios de almacenamiento.
- `npm audit --json` antes/después: **3 moderadas, 0 altas/críticas**, mismos nombres `minimatch`, `@expo/fingerprint`, `expo`. Advisory directo observado: `GHSA-g3hv-75wg-m249` (minimatch; propagado por fingerprint/Expo). No se reportaron nuevos paquetes afectados. Esto no acredita ausencia de vulnerabilidades desconocidas; baseline sin remediar.

## Alcance y comprobaciones

Leídos AGENTS raíz/local, DERCAS DOCX, adicendum con precedencia, contrato v1.12 §15, fases/estado y precheck. `docs/diseno/DESIGN.md` ausente. Skill frontend-design cargada; memoria contexto-general/adminweb-scope consultada íntegramente. React Navigation existente se conserva por instrucción explícita; no migración a Router.

Consultadas nuevamente las páginas versionadas SDK58 de FileSystem, Sharing y Expo/fetch:

- https://docs.expo.dev/versions/v58.0.0/sdk/filesystem/
- https://docs.expo.dev/versions/v58.0.0/sdk/sharing/
- https://docs.expo.dev/versions/v58.0.0/sdk/expo/

`npm run typecheck`, `npm run lint` y `git diff --check`: correctos tras la instalación (solo avisos Git LF→CRLF). Sin pruebas focalizadas RF23 porque no se escribió código; sin repetir ni atribuir pruebas históricas RF22. No solicitudes autenticadas, descargas, archivos de reportes, hojas nativas, pruebas físicas, APK/EAS, git add/commit/push ni cambios fuera de Frontend-SamProject.

## Reanudación y pendientes

Solicitar autorización para conservar **@expo/config-plugins 58.0.14** requerido por Sharing y la deduplicación descrita. No se revierte ni fuerza el lock unilateralmente. Después implementar y probar todo el flujo seguro detallado en el precheck: límite binario real 1MiB, validación de headers/contenido, cancelación/sello de sesión, caché privada, política conservadora de limpieza y compartir sin falso éxito. Hasta entonces no hay botones nuevos ni funcionalidad RF23 en el panel.

RF22 mantiene ritmo no disponible/cobertura histórica no acreditada y aceptación real pendiente. RF19/20/21 conservan los pendientes documentados en el precheck. Contrato/API, métricas, backend, AdminWeb y documentos de orquestación/diseño intactos; identidad visual sin cambios. No se declara ningún RF cerrado.
