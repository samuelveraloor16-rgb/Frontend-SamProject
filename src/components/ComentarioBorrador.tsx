import { useRef, useState, type ComponentRef } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useInfiniteQuery } from '@tanstack/react-query';
import type { MiembroMencionable } from '../api/types';
import { analizarTexto, insertarMencion, previsualizarMenciones, validarTextoComentario } from '../lib/menciones';
import { miembrosMencionablesOptions } from '../lib/miembrosMencionables';
import { accesoComentariosDenegado } from '../lib/comentariosLectura';
import { colors } from '../theme/colors';

const campo = { color: colors.text, borderColor: colors.primary, borderWidth: 1, borderRadius: 8, padding: 12, fontSize: 16, minHeight: 44 };

/** Solo memoria del componente. Publicar es independiente de Guardar cambios. */
export function ComentarioBorrador({ tareaId, perderAcceso, sesion, publicacion }: {
  tareaId: string; perderAcceso: () => void; sesion?: string;
  publicacion?: { bloqueado: boolean; puedeEditar: () => boolean; publicar: (texto: string) => void };
}) {
  const [texto, setTexto] = useState('');
  const [seleccion, setSeleccion] = useState({ start: 0, end: 0 });
  const [abierto, setAbierto] = useState(false);
  const [nombres, setNombres] = useState<ReadonlyMap<string, string>>(new Map());
  const editor = useRef<ComponentRef<typeof TextInput>>(null);
  const analisis = analizarTexto(texto);
  const cerrar = () => { setAbierto(false); editor.current?.focus(); };
  const elegir = (persona: MiembroMencionable) => {
    if (publicacion && !publicacion.puedeEditar()) return;
    const resultado = insertarMencion(texto, { inicio: seleccion.start, fin: seleccion.end }, persona.id);
    setTexto(resultado.texto);
    setSeleccion({ start: resultado.cursor, end: resultado.cursor });
    setNombres(previos => new Map(previos).set(persona.id, persona.nombre));
    cerrar();
  };
  return (
    <View className="mt-5 gap-2">
      <Text className="text-[16px] font-semibold text-text">Escribe un comentario</Text>
      <Text className="text-[14px] leading-5 text-text">{publicacion ? 'Borrador local: usa Publicar para enviarlo. Guardar cambios no publica comentarios.' : 'Borrador local: no se publica ni se guarda al salir.'}</Text>
      <TextInput ref={editor} accessibilityLabel="Borrador de comentario" multiline
        textAlignVertical="top" style={{ ...campo, minHeight: 112 }} value={texto}
        editable={!publicacion?.bloqueado}
        onChangeText={valor => { if (!publicacion || publicacion.puedeEditar()) setTexto(valor); }} selection={seleccion}
        onSelectionChange={event => setSeleccion(event.nativeEvent.selection)} />
      <Text className="text-[14px] text-text">{analisis.puntosCodigo}/4000 caracteres · {analisis.ids.length}/20 personas distintas</Text>
      {texto.length > 0 && analisis.error ? (
        <Text accessibilityLiveRegion="polite" className="text-[14px] leading-5 text-[#8C2F28]">⚠ {validarTextoComentario(texto)}</Text>
      ) : null}
      <Pressable accessibilityRole="button" disabled={publicacion?.bloqueado} onPress={() => { if (!publicacion || publicacion.puedeEditar()) setAbierto(true); }} className="min-h-[44px] justify-center self-start px-4">
        <Text className="text-[16px] font-semibold text-primary">@ Mencionar</Text>
      </Pressable>
      {texto ? <View className="gap-2">
        <Text className="text-[14px] font-semibold text-text">Vista previa del borrador</Text>
        <Text className="text-[16px] leading-6 text-text">
          {analisis.menciones.length === 0 ? previsualizarMenciones(texto, nombres) : (() => {
            let fin = 0;
            const partes = analisis.menciones.flatMap(mencion => {
              const antes = previsualizarMenciones(texto.slice(fin, mencion.inicio), new Map());
              fin = mencion.fin;
              const nombre = nombres.get(mencion.id);
              return [antes, nombre ? <Text key={mencion.inicio} accessibilityLabel={`mención a ${nombre}`} style={{ backgroundColor: colors.secondary }}>{`@${nombre}`}</Text> : texto.slice(mencion.inicio, mencion.fin)];
            });
            return [...partes, previsualizarMenciones(texto.slice(fin), new Map())];
          })()}
        </Text>
      </View> : null}
      {publicacion ? <Pressable accessibilityRole="button" accessibilityLabel="Publicar comentario"
        accessibilityState={{ disabled: publicacion.bloqueado || !!validarTextoComentario(texto) }}
        disabled={publicacion.bloqueado || !!validarTextoComentario(texto)}
        onPress={() => { if (!publicacion.bloqueado && !validarTextoComentario(texto)) publicacion.publicar(texto); }}
        className="min-h-[44px] items-center justify-center rounded-lg bg-primary px-4">
        <Text className="text-[16px] font-semibold text-white">Publicar</Text>
      </Pressable> : null}
      {abierto && !publicacion?.bloqueado ? <SelectorMenciones tareaId={tareaId} sesion={sesion} elegir={elegir} cerrar={cerrar} perderAcceso={perderAcceso} /> : null}
    </View>
  );
}

function SelectorMenciones({ tareaId, elegir, cerrar, perderAcceso, sesion }: {
  tareaId: string; elegir: (persona: MiembroMencionable) => void; cerrar: () => void; perderAcceso: () => void; sesion?: string;
}) {
  const [busqueda, setBusqueda] = useState('');
  const valida = [...busqueda.trim()].length <= 80;
  const query = useInfiniteQuery({ ...miembrosMencionablesOptions(tareaId, busqueda, perderAcceso, sesion), enabled: valida });
  const cargando = query.isPending || (query.isFetching && !query.isFetchingNextPage);
  const ocultar = !valida || cargando || query.isError || accesoComentariosDenegado(query.error);
  const personas = ocultar ? [] : query.data?.pages.flatMap(pagina => pagina.datos) ?? [];
  return <Modal visible animationType="none" onRequestClose={cerrar} onDismiss={cerrar}>
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 20, gap: 16 }}>
          <Text accessibilityRole="header" className="text-[18px] font-semibold text-primary">Mencionar a una persona</Text>
          <Text className="text-[14px] leading-5 text-text">Los nombres pueden repetirse. Cada fila conserva su identificador; el nombre no confirma quién es la persona.</Text>
          <TextInput autoFocus accessibilityLabel="Buscar miembros por nombre" placeholder="Buscar por nombre" style={campo} value={busqueda} onChangeText={setBusqueda} />
          {!valida ? <Text accessibilityLiveRegion="polite" className="text-[#8C2F28]">La búsqueda no puede superar 80 caracteres.</Text> : cargando ? <View accessibilityLiveRegion="polite">
            <ActivityIndicator color={colors.primary} /><Text className="text-text">Cargando miembros…</Text>
          </View> : query.isError ? <View accessibilityLiveRegion="polite">
            <Text className="text-[#8C2F28]">No se pudieron cargar los miembros</Text>
            <Pressable accessibilityRole="button" className="min-h-[44px] justify-center" onPress={() => void (query.isFetchNextPageError ? query.fetchNextPage() : query.refetch())}><Text className="text-primary">Reintentar</Text></Pressable>
          </View> : personas.length === 0 ? <Text accessibilityLiveRegion="polite" className="text-text">{busqueda.trim() ? 'No encontramos miembros' : 'No hay miembros disponibles para mencionar'}</Text> : null}
          {personas.map(persona => <Pressable key={persona.id} accessibilityRole="button" accessibilityLabel={`Mencionar a ${persona.nombre}, identificador ${persona.id}`} onPress={() => elegir(persona)} className="min-h-[44px] border-b border-secondary py-3">
            <Text className="text-[16px] text-text">{persona.nombre}</Text>
            <Text selectable className="text-[14px] text-text">{persona.id}</Text>
          </Pressable>)}
          {!ocultar && query.hasNextPage ? <Pressable accessibilityRole="button" disabled={query.isFetching} accessibilityState={{ disabled: query.isFetching, busy: query.isFetchingNextPage }} onPress={() => { if (!query.isFetching) void query.fetchNextPage(); }} className="min-h-[44px] justify-center"><Text className="text-primary">{query.isFetchingNextPage ? 'Cargando miembros…' : 'Cargar más miembros'}</Text></Pressable> : null}
          <Pressable accessibilityRole="button" onPress={cerrar} className="min-h-[44px] justify-center"><Text className="text-[16px] font-semibold text-primary">Cerrar selector</Text></Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  </Modal>;
}
