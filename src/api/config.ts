/**
 * Configuración del cliente API (placeholder de Fase 1 — scaffold).
 *
 * La URL base se toma de la variable de entorno EXPO_PUBLIC_API_URL
 * (Expo la inyecta en tiempo de build; ver .env.example).
 *
 *   Desarrollo local con emulador/dispositivo en la misma máquina:
 *     EXPO_PUBLIC_API_URL=http://localhost:3000/api/v1        (emulador Android: 10.0.2.2:3000)
 *   Dispositivo físico (Expo Go), mismo Wi-Fi:
 *     EXPO_PUBLIC_API_URL=http://<IP-LAN>:3000/api/v1         (p. ej. http://192.168.1.100:3000/api/v1)
 *
 * El contrato completo de la API (Fase 1, hasta Kanban) está en
 * docs/orquestacion/CONTRATO_API.md. La app NO calcula métricas:
 * los números vienen siempre del backend.
 */

const DEFAULT_API_URL = 'http://localhost:3000/api/v1';

export const API_BASE_URL: string =
  process.env.EXPO_PUBLIC_API_URL ?? DEFAULT_API_URL;
