# RF-23 móvil — precheck bloqueado

Fecha: 26/11/2026. **Detenido antes de implementar o instalar**: falta autorización expresa para dependencias nativas. RF-23 no está integrado ni aceptado.

## Evidencia y alcance

- Leídos AGENTS raíz/local, DERCAS DOCX v1.1 y Adicendum v1.2 (precedencia), fases/estado y contrato v1.12 §15. Skill `frontend-design` cargada. `docs/diseno/DESIGN.md` no existe. Memoria AdminWeb consultada: sigue siendo otro cliente futuro, no alcance de esta entrega.
- Frontend inicialmente limpio. `package.json`: Expo `~58.0.26`, React Native `0.88.1`; sin `expo-file-system` ni `expo-sharing` directas. Ambos directorios también ausentes en `node_modules`. No existe capacidad aprobada de escritura privada y compartición de archivos binarios Android/iOS. SecureStore no es almacenamiento de reportes; Share de React Native no sustituye un flujo de archivos multiplataforma.
- Revisados cliente JSON `src/api/client.ts` y panel `src/screens/PanelProyectoScreen.tsx`: el cliente actual fuerza Accept JSON y parsea texto JSON, no sirve sin adaptación para binarios. El panel ya aísla proyecto/sello de sesión. No se modifica ninguno.
- No se usa dependencia transitiva como directa, DOM, enlaces públicos, tokens en URL ni generación local de PDF/CSV. Backend RF23 local, AdminWeb, contrato y orquestación no intervenidos.

## Propuesta mínima que requiere aprobación

| Paquete directo | Propuesta SDK58 | Motivo | Licencia publicada |
| --- | --- | --- | --- |
| expo-file-system | `~58.0.15` (base exacta 58.0.15) | Escribir bytes recibidos en caché privada y eliminarlos; no generar documentos | MIT |
| expo-sharing | `~58.0.24` (base exacta 58.0.24) | Hoja nativa para compartir archivos PDF/CSV en Android/iOS; comprobar disponibilidad | MIT |

Versiones recomendadas en documentación versionada SDK58 consultada y confirmadas por metadatos npm de esas versiones. El mapa **instalado** `node_modules/expo/bundledNativeModules.json` indica `~58.0.14` / `~58.0.23`: los parches propuestos satisfacen esos rangos; no requiere actualizar Expo. Debe revisarse el lockfile resultante tras autorización, no asumir que el rango fijará para siempre el mismo parche.

Comando propuesto, **NO ejecutado**, desde Frontend-SamProject:

```powershell
npx expo install expo-file-system@~58.0.15 expo-sharing@~58.0.24
```

No se proponen PDF renderers, CSV serializers, document-picker, media-library, crypto ni librerías de descarga adicionales. Fetch autenticado ya existe; `expo/fetch` está incluido en Expo y es una opción a validar para lectura binaria acotada. Compartir necesita un archivo local, por eso son dos módulos mínimos. Metadatos npm de sharing declaran `@expo/plist`, `@expo/config-types` y `@expo/config-plugins`; revisar delta transitivo real, licencias y advisories del grafo resuelto antes de continuar. No se hizo auditoría ni se afirma ausencia de vulnerabilidades. FileSystem no declara dependencies runtime en esos metadatos.

No habilitar exposición de Documents en Files/iTunes, extensiones de recepción de contenido ni permisos amplios de almacenamiento. Un build propio deberá incluir los módulos; no se construye APK ni binario en esta tarea. Inclusión en Expo Go según documentación no equivale a aceptación física.

## Condiciones para retomar tras aprobación

- Solo GET `/proyectos/:id/reportes/resumen.csv` y `.pdf`, sin query/body. JWT exclusivamente Authorization Bearer, en memoria: nunca URL, logs, nombres o archivos. HTTPS en integración productiva; no seguir redirecciones hacia destinos no aprobados con credenciales.
- Validar estado y headers antes de escribir/compartir: CSV `text/csv; charset=utf-8`, PDF `application/pdf`; attachment con nombre fijo `resumen-proyecto.csv`/`.pdf`; `private, no-store` y `nosniff`. Rechazar respuesta inesperada, vacía, truncada o >1 MiB, incluso si Content-Length falta o miente. Comprobar firma PDF/BOM CSV sin interpretar métricas ni reconstruir contenido. Buffer acotado; errores JSON nunca se guardan como reporte.
- 401 solo invalida sesión capturada todavía vigente; 403 defensivo sin inventar restricción admin (contrato no añade 403 propio), 404 indistinguible, 422 con mensaje seguro y 429/5xx/red/respuesta inválida sin falso éxito. Cancelar petición y descartar respuestas tardías al cambiar sesión/proyecto/salir. Impedir duplicados y compartir si sello perdió vigencia.
- Caché privada por operación, nombre contractual dentro de directorio aislado sin identidad ni JWT; limpiar errores/cancelaciones y residuos propios al reiniciar. Definir y probar conservación mínima mientras el receptor necesita leer: no borrar prematuramente al abrir la hoja ni conservar indefinidamente. Revocar sesión no puede retirar copias ya entregadas a otras aplicaciones; advertir esa frontera.
- `Sharing.shareAsync` retorna `Promise<void>`, no comprobante de guardado ni entrega. Cerrar/cancelar la hoja no muestra «Compartido»/«Guardado». En ambos sistemas solo se ofrece compartir; guardar depende de destinos instalados y elección del usuario, sin prometer descarga permanente. Probar iPad anchor y ausencia de destinos.
- Después de autorización, diseñar acciones españolas «Compartir PDF»/«Compartir CSV» desde proyecto/panel, paleta institucional (#245B4A, #DCE9DF, #D5C78E, #F7F8F5, #34413A), coherentes con PrimaryButton, nombres/roles accesibles, objetivos mínimos 44 dp, busy/disabled y mensajes legibles. No se han añadido botones falsos ni UI parcial.
- Backend es única fuente de métricas y documento. Ritmo permanece no disponible; solicitudes distintas pueden tener cortes distintos. No prometer instantánea conjunta panel/reporte.

## Verificación y pendientes

Solo este informe fue creado. Sin instalaciones, cambios de código/UI/config/lockfile, solicitudes autenticadas, reportes generados, tokens escritos, pruebas físicas, APK ni git add/commit/push. Diff-check del informe y árbol frontend verificados; tests/lint/typecheck no ejecutados porque se detuvo antes de código (no se atribuyen pruebas previas).

RF19: aceptación integral/dispositivos, respaldo HMAC y operación de limpieza pendientes. RF20: credenciales, PostgreSQL, recepción física y retención segura pendientes. RF21: verificación de correo/vigencia, SMTP no operativo, SQL real y tipos nuevos móviles pendientes. RF22: integración/SQL/concurrencia reales, aceptación visual/accesible y coherencia futura con IA/AdminWeb pendientes; cobertura histórica no acreditada, ritmo no operativo. RF23: autorización dependencias, implementación, pruebas focalizadas/estáticas, limpieza privada y descarga/hoja nativa reales Android/iOS pendientes. Ninguno se cierra en este precheck.

Fuentes consultadas (26/11/2026):
- https://docs.expo.dev/versions/v58.0.0/sdk/filesystem/
- https://docs.expo.dev/versions/v58.0.0/sdk/sharing/
- https://registry.npmjs.org/expo-file-system/58.0.15
- https://registry.npmjs.org/expo-sharing/58.0.24
