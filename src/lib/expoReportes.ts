import { Directory, File, Paths } from 'expo-file-system';
import { uuid } from 'expo';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';
import { ReporteError, reporteNombre, reporteMime, type FormatoReporte } from '../api/reportes';
import type { ArchivoReporte } from './ReporteController';
import { ReportesTemporales, type ResiduoReporte } from './ReportesTemporales';

const root = () => new Directory(Paths.cache, 'samproject-rf23-v2');
const legacy = () => new Directory(Paths.cache, 'samproject-rf23-v1');
const dirs = new Map<string, Directory>();
const createdSessions = new Set<string>();
// Fixed depth only. Unknown entries block reservations; never recursively delete them.
function inspect(dir: Directory, key: string): ResiduoReporte {
  dirs.set(key, dir);
  let bytes = 0, offered = false, fecha: number | null = null;
  for (const item of dir.list()) {
    if (!(item instanceof File)) throw new Error('Directorio inesperado');
    const info = item.info();
    if (!info.exists || !Number.isSafeInteger(info.size)) throw new Error('Archivo ilegible');
    bytes += info.size!;
    if (item.name === 'ofrecido') { offered = true; fecha = item.lastModified; }
  }
  if (key.startsWith('legacy/')) fecha = Number(/^op-(\d+)-/.exec(dir.name)?.[1]) || null;
  return { key, bytes, ofrecido: offered, fecha };
}
export const temporalesReportes = new ReportesTemporales({
  inventario() {
    dirs.clear(); const rows: ResiduoReporte[] = [];
    const old = legacy();
    old.create({ intermediates: true, idempotent: true });
    for (const item of old.list()) {
      if (item instanceof Directory && /^op-\d+-[a-z0-9]+$/.test(item.name)) rows.push(inspect(item, `legacy/${item.name}`));
      else throw new Error('Residuo legado desconocido');
    }
    const base = root();
    base.create({ intermediates: true, idempotent: true });
    for (const session of base.list()) {
      if (!(session instanceof Directory) || !/^[a-f0-9-]{36}$/.test(session.name)) throw new Error('Namespace desconocido');
      const operations = session.list();
      if (!operations.length) { session.delete(); createdSessions.delete(session.name); continue; }
      for (const op of operations) {
        if (!(op instanceof Directory) || !/^op-\d+-[a-f0-9-]{36}$/.test(op.name)) throw new Error('Operación desconocida');
        rows.push(inspect(op, `${session.name}/${op.name}`));
      }
    }
    return rows;
  },
  async escribir(key, nombre, bytes) {
    const base = root(); base.create({ intermediates: true, idempotent: true });
    const [session, name] = key.split('/');
    const parent = new Directory(base, session);
    parent.create({ idempotent: createdSessions.has(session) }); createdSessions.add(session);
    const dir = new Directory(parent, name); dir.create(); dirs.set(key, dir);
    const file = new File(dir, nombre); file.create(); await file.write(bytes);
    if (file.size !== bytes.length) throw new Error('Escritura incompleta');
    return file.uri;
  },
  marcar(key) { const dir = dirs.get(key); if (!dir) throw new Error('Archivo ausente'); new File(dir, 'ofrecido').create(); },
  borrar(key) {
    const dir = dirs.get(key); if (!dir) throw new Error('Inventario ausente');
    const items = dir.list();
    if (items.some(i => !(i instanceof File) || !['resumen-proyecto.pdf', 'resumen-proyecto.csv', 'ofrecido'].includes(i.name))) throw new Error('Residuo desconocido');
    for (const file of items) file.delete();
    if (dir.list().length) throw new Error('Borrado incompleto');
    dir.delete();
    const parent = dir.parentDirectory;
    if (!key.startsWith('legacy/') && !parent.list().length) { parent.delete(); createdSessions.delete(parent.name); }
  },
}, () => uuid.v4());
export const limpiarResiduosReportes = () => temporalesReportes.limpiar();
export async function escribirReporte(f: FormatoReporte, bytes: Uint8Array): Promise<ArchivoReporte> {
  const session = temporalesReportes.capturar();
  try { return await temporalesReportes.escribir(session, reporteNombre(f), bytes); }
  catch (e) {
    if (e instanceof Error && e.message === 'CUOTA_REPORTES') throw new ReporteError(0, 'Caché de reportes llena (24 archivos / 8 MiB). Intenta más adelante: los archivos ofrecidos recientemente no se eliminan para liberar espacio.');
    throw new ReporteError(0, 'No se pudo verificar o escribir el almacenamiento privado. Libera espacio y reintenta.');
  }
}
export const compartirDisponible = async () => Platform.OS !== 'web' && await Sharing.isAvailableAsync();
export async function compartirReporte(archivo: ArchivoReporte, f: FormatoReporte, anchor: { x: number; y: number; width: number; height: number }) {
  const invoke = () => Sharing.shareAsync(archivo.uri, { mimeType: reporteMime(f), dialogTitle: 'Compartir reporte', anchor });
  if (!archivo.invocar) throw new Error('Archivo no vigente');
  await archivo.invocar(invoke);
}
