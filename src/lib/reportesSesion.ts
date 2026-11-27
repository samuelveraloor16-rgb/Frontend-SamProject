const listeners = new Set<() => void>();
export function registrarReporte(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; }
export function sincronizarReportes() { listeners.forEach(fn => fn()); }
