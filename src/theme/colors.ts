/**
 * Paleta institucional SamProject (fija, no modificable).
 * Úsala para estilos que no puedan expresarse con las clases de NativeWind.
 */
export const colors = {
  primary: '#245B4A',
  secondary: '#DCE9DF',
  tertiary: '#D5C78E',
  background: '#F7F8F5',
  text: '#34413A',
} as const;

export type InstitutionalColor = keyof typeof colors;
