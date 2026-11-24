/** Solo mensajes conocidos del contrato/DTO; nunca refleja contenido arbitrario. */
export function clasificarErrorReset400(mensajes: string[]): { campo?: string; general?: string } {
  const validaciones = [
    'La contraseña debe tener al menos 8 caracteres',
    'La contraseña no puede superar 72 caracteres',
    'La contraseña debe incluir al menos una letra',
    'La contraseña debe incluir al menos un número',
  ];
  const campos = mensajes.filter(m => validaciones.includes(m));
  if (campos.length) return { campo: campos.join('. ') + '.' };
  if (mensajes.some(m => m === 'El enlace es inválido o ha caducado' || m === 'El token no es válido')) {
    return { general: 'El enlace es inválido o ha caducado.' };
  }
  return { general: 'No se pudo restablecer la contraseña. Revisa los datos e inténtalo de nuevo.' };
}
