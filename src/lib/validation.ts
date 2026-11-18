/**
 * Validación en cliente alineada con las reglas del contrato
 * (CONTRATO_API.md §1: registro/login). El backend es la autoridad;
 * esto solo evita viajes obvios y mejora el feedback.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function esEmailValido(email: string): boolean {
  return EMAIL_RE.test(email.trim());
}

/** nombre: 2–80 caracteres. */
export function validarNombre(nombre: string): string | null {
  const limpio = nombre.trim();
  if (limpio.length < 2) return 'El nombre debe tener al menos 2 caracteres.';
  if (limpio.length > 80) return 'El nombre no puede superar los 80 caracteres.';
  return null;
}

export function validarEmail(email: string): string | null {
  if (!esEmailValido(email)) return 'Ingresa un correo válido (p. ej. ana@example.com).';
  return null;
}

/** contraseña: 8–72 chars, al menos una letra y un número. */
export function validarContrasena(contrasena: string): string | null {
  if (contrasena.length < 8) return 'La contraseña debe tener al menos 8 caracteres.';
  if (contrasena.length > 72) return 'La contraseña no puede superar los 72 caracteres.';
  if (!/[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/.test(contrasena)) return 'La contraseña debe incluir al menos una letra.';
  if (!/\d/.test(contrasena)) return 'La contraseña debe incluir al menos un número.';
  return null;
}

export function validarConfirmacion(contrasena: string, confirmacion: string): string | null {
  if (contrasena !== confirmacion) return 'Las contraseñas no coinciden.';
  return null;
}
