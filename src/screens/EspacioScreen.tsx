import { useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { invitarMiembro, listarEspacios, obtenerEspacio } from '../api/espacios';
import { crearProyecto, listarProyectos } from '../api/proyectos';
import { mensajeDeError } from '../api/client';
import { colors } from '../theme/colors';
import type { RootStackParamList } from '../navigation/types';
import type { RolEspacio } from '../api/types';
import { ScreenHeader } from '../components/ScreenHeader';
import { EmptyState } from '../components/EmptyState';
import { ProgresoBar } from '../components/ProgresoBar';
import { PickerModal } from '../components/PickerModal';

type Nav = NativeStackNavigationProp<RootStackParamList>;
type Ruta = RouteProp<RootStackParamList, 'Espacio'>;

const ROL_LABEL: Record<RolEspacio, string> = {
  ADMINISTRADOR: 'Administrador',
  MIEMBRO: 'Miembro',
};

/**
 * Detalle de espacio (RF-06/RF-09): proyectos del espacio con su progreso
 * (calculado por el backend), creación de proyectos y, para administradores,
 * invitación de miembros por correo.
 */
export function EspacioScreen() {
  const route = useRoute<Ruta>();
  const { espacioId } = route.params;
  const navigation = useNavigation<Nav>();
  const queryClient = useQueryClient();
  const [modalProyecto, setModalProyecto] = useState(false);
  const [modalInvitar, setModalInvitar] = useState(false);

  const espacioQuery = useQuery({
    queryKey: ['espacios'],
    queryFn: listarEspacios,
    select: (data) => data.datos.find((e) => e.id === espacioId) ?? null,
  });
  const espacioDirectoQuery = useQuery({
    queryKey: ['espacio', espacioId],
    queryFn: () => obtenerEspacio(espacioId),
    enabled: espacioQuery.data === null,
  });
  const espacio = espacioQuery.data ?? espacioDirectoQuery.data ?? null;
  const esAdmin = espacio?.miRol === 'ADMINISTRADOR';

  const proyectosQuery = useQuery({
    queryKey: ['proyectos', espacioId],
    queryFn: () => listarProyectos(espacioId, { pageSize: 50 }),
  });
  const proyectos = proyectosQuery.data?.datos ?? [];

  const refrescando = espacioQuery.isRefetching || proyectosQuery.isRefetching;
  const refrescar = () => {
    void espacioQuery.refetch();
    void proyectosQuery.refetch();
  };

  return (
    <View className="flex-1 bg-background">
      <ScreenHeader
        titulo={espacio?.nombre ?? 'Espacio'}
        subtitulo={
          espacio
            ? `${espacio.esPersonal ? 'Espacio personal' : 'Espacio de equipo'} · ${ROL_LABEL[espacio.miRol]} · ${espacio.totalMiembros} ${espacio.totalMiembros === 1 ? 'miembro' : 'miembros'}`
            : undefined
        }
        derecha={
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Crear proyecto"
            hitSlop={8}
            onPress={() => setModalProyecto(true)}
            className="flex-row items-center gap-1.5 rounded-full bg-primary px-4 py-2 active:opacity-80"
          >
            <Ionicons name="add" size={18} color="#F7F8F5" />
            <Text className="text-[13px] font-semibold text-[#F7F8F5]">Proyecto</Text>
          </Pressable>
        }
      />

      <FlatList
        data={proyectos}
        keyExtractor={(p) => p.id}
        contentContainerStyle={{ padding: 20, paddingBottom: 48 }}
        refreshControl={
          <RefreshControl
            refreshing={refrescando}
            onRefresh={refrescar}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        }
        ListHeaderComponent={
          <>
            {esAdmin ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Invitar miembros por correo"
                onPress={() => setModalInvitar(true)}
                className="mb-4 flex-row items-center gap-3 rounded-2xl border border-tertiary bg-[#FBF9EE] px-4 py-3 active:opacity-80"
              >
                <Ionicons name="mail-outline" size={20} color={colors.text} />
                <View className="flex-1">
                  <Text className="text-[14px] font-semibold text-text">Invitar miembros</Text>
                  <Text className="text-[12px] text-text opacity-70">
                    Solo administradores · el invitado recibe un enlace por correo
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.text} />
              </Pressable>
            ) : null}
            <View className="mb-2 flex-row items-end justify-between">
              <Text className="text-[13px] font-semibold text-text opacity-70">Proyectos</Text>
              {!proyectosQuery.isLoading ? (
                <Text className="text-[12px] text-text opacity-60">
                  {proyectos.length} {proyectos.length === 1 ? 'proyecto' : 'proyectos'}
                </Text>
              ) : null}
            </View>
          </>
        }
        ListEmptyComponent={
          proyectosQuery.isLoading ? (
            <View className="items-center py-10">
              <ActivityIndicator color={colors.primary} />
            </View>
          ) : proyectosQuery.isError ? (
            <View className="rounded-2xl border border-[#E5B8B3] bg-[#FAE8E6] px-5 py-5">
              <Text className="text-[14px] leading-5 text-[#8C2F28]">
                No pudimos cargar los proyectos. {mensajeDeError(proyectosQuery.error)}
              </Text>
              <Pressable
                accessibilityRole="button"
                onPress={() => void proyectosQuery.refetch()}
                className="mt-3 self-start rounded-full border border-[#8C2F28] px-4 py-2"
              >
                <Text className="text-[13px] font-semibold text-[#8C2F28]">Reintentar</Text>
              </Pressable>
            </View>
          ) : (
            <EmptyState
              icono="folder-open-outline"
              titulo="Sin proyectos todavía"
              detalle="Crea el primero para empezar a organizar tareas."
              accion={
                <Pressable
                  accessibilityRole="button"
                  onPress={() => setModalProyecto(true)}
                  className="rounded-xl bg-primary px-5 py-3 active:opacity-80"
                >
                  <Text className="text-[14px] font-semibold text-[#F7F8F5]">Crear proyecto</Text>
                </Pressable>
              }
            />
          )
        }
        renderItem={({ item: proyecto }) => (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Abrir proyecto ${proyecto.nombre}`}
            onPress={() => navigation.navigate('Proyecto', { proyectoId: proyecto.id })}
            className="mb-3 rounded-2xl border border-secondary bg-white px-4 py-4 active:bg-secondary"
          >
            <View className="flex-row items-center justify-between gap-3">
              <Text numberOfLines={1} className="flex-1 text-[16px] font-semibold text-text">
                {proyecto.nombre}
              </Text>
              <Text style={{ fontFamily: 'Georgia' }} className="text-[15px] text-primary">
                {Math.round(proyecto.progreso)}%
              </Text>
            </View>
            {proyecto.descripcion ? (
              <Text numberOfLines={2} className="mt-1 text-[13px] leading-5 text-text opacity-80">
                {proyecto.descripcion}
              </Text>
            ) : null}
            <View className="mt-3">
              <ProgresoBar progreso={proyecto.progreso} alto={8} />
            </View>
            <View className="mt-2 flex-row items-center justify-between">
              <Text className="text-[11px] text-text opacity-60">
                {proyecto.miembros.length}{' '}
                {proyecto.miembros.length === 1 ? 'miembro' : 'miembros'}
              </Text>
              <Ionicons name="chevron-forward" size={18} color={colors.primary} />
            </View>
          </Pressable>
        )}
      />

      <CrearProyectoModal
        visible={modalProyecto}
        espacioId={espacioId}
        onCerrar={() => setModalProyecto(false)}
        onCreado={(proyectoId) => {
          setModalProyecto(false);
          void queryClient.invalidateQueries({ queryKey: ['proyectos', espacioId] });
          navigation.navigate('Proyecto', { proyectoId });
        }}
      />
      <InvitarModal
        visible={modalInvitar}
        espacioId={espacioId}
        espacioNombre={espacio?.nombre ?? ''}
        onCerrar={() => setModalInvitar(false)}
      />
    </View>
  );
}

/** Modal de creación de proyecto: nombre + descripción. Las fechas y miembros llegan en un tramo posterior. */
function CrearProyectoModal({
  visible,
  espacioId,
  onCerrar,
  onCreado,
}: {
  visible: boolean;
  espacioId: string;
  onCerrar: () => void;
  onCreado: (proyectoId: string) => void;
}) {
  const [nombre, setNombre] = useState('');
  const [descripcion, setDescripcion] = useState('');

  const crear = useMutation({
    mutationFn: () =>
      crearProyecto(espacioId, {
        nombre: nombre.trim(),
        descripcion: descripcion.trim() || undefined,
      }),
    onSuccess: (proyecto) => {
      setNombre('');
      setDescripcion('');
      onCreado(proyecto.id);
    },
  });
  const valido = nombre.trim().length >= 2;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onCerrar}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        className="flex-1 justify-end bg-black/40"
      >
        <View className="rounded-t-3xl bg-background px-5 pb-10 pt-3">
          <View className="mx-auto mb-3 h-1.5 w-12 rounded-full bg-secondary" />
          <Text style={{ fontFamily: 'Georgia' }} className="text-[18px] text-primary">
            Nuevo proyecto
          </Text>
          <TextInput
            accessibilityLabel="Nombre del proyecto"
            autoFocus
            value={nombre}
            onChangeText={setNombre}
            placeholder="Nombre del proyecto"
            placeholderTextColor="#8A968E"
            maxLength={120}
            className="mt-4 min-h-[48px] rounded-xl border border-secondary bg-white px-4 text-[15px] text-text"
          />
          <TextInput
            accessibilityLabel="Descripción (opcional)"
            value={descripcion}
            onChangeText={setDescripcion}
            placeholder="Descripción (opcional)"
            placeholderTextColor="#8A968E"
            maxLength={500}
            multiline
            className="mt-3 min-h-[72px] rounded-xl border border-secondary bg-white px-4 py-3 text-[15px] text-text"
          />
          {crear.isError ? (
            <Text className="mt-2 text-[13px] leading-5 text-[#B3261E]">
              {mensajeDeError(crear.error)}
            </Text>
          ) : null}
          <View className="mt-4 flex-row gap-3">
            <Pressable
              accessibilityRole="button"
              onPress={onCerrar}
              className="flex-1 items-center rounded-xl border border-secondary py-3 active:bg-secondary"
            >
              <Text className="text-[15px] font-semibold text-text">Cancelar</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Crear proyecto"
              disabled={!valido || crear.isPending}
              onPress={() => crear.mutate()}
              className={`flex-1 items-center rounded-xl py-3 ${!valido || crear.isPending ? 'bg-[#3F6E5B] opacity-60' : 'bg-primary'}`}
            >
              {crear.isPending ? (
                <ActivityIndicator color="#F7F8F5" />
              ) : (
                <Text className="text-[15px] font-semibold text-[#F7F8F5]">Crear</Text>
              )}
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

/** Modal de invitación por correo (solo administradores, RF-06). */
function InvitarModal({
  visible,
  espacioId,
  espacioNombre,
  onCerrar,
}: {
  visible: boolean;
  espacioId: string;
  espacioNombre: string;
  onCerrar: () => void;
}) {
  const [email, setEmail] = useState('');
  const [rol, setRol] = useState<RolEspacio>('MIEMBRO');
  const [rolPicker, setRolPicker] = useState(false);

  const invitar = useMutation({
    mutationFn: () => invitarMiembro(espacioId, { email: email.trim().toLowerCase(), rol }),
    onSuccess: () => {
      setEmail('');
      setRol('MIEMBRO');
    },
  });
  const emailValido = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onCerrar}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        className="flex-1 justify-end bg-black/40"
      >
        <View className="rounded-t-3xl bg-background px-5 pb-10 pt-3">
          <View className="mx-auto mb-3 h-1.5 w-12 rounded-full bg-secondary" />
          <Text style={{ fontFamily: 'Georgia' }} className="text-[18px] text-primary">
            Invitar a {espacioNombre || 'este espacio'}
          </Text>
          <Text className="mt-1 text-[13px] leading-5 text-text opacity-80">
            Enviaremos un enlace de invitación válido por 7 días. El enlace se abre con
            samproject://invitar.
          </Text>
          <TextInput
            accessibilityLabel="Correo del invitado"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            autoFocus
            value={email}
            onChangeText={(t) => {
              setEmail(t);
              invitar.reset();
            }}
            placeholder="correo@ejemplo.com"
            placeholderTextColor="#8A968E"
            className="mt-4 min-h-[48px] rounded-xl border border-secondary bg-white px-4 text-[15px] text-text"
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Rol de la invitación: ${ROL_LABEL[rol]}`}
            onPress={() => setRolPicker(true)}
            className="mt-3 flex-row items-center justify-between rounded-xl border border-secondary bg-white px-4 py-3 active:bg-secondary"
          >
            <View>
              <Text className="text-[11px] text-text opacity-60">Rol</Text>
              <Text className="text-[15px] font-semibold text-text">{ROL_LABEL[rol]}</Text>
            </View>
            <Ionicons name="chevron-down" size={18} color={colors.primary} />
          </Pressable>

          {invitar.isError ? (
            <Text className="mt-2 text-[13px] leading-5 text-[#B3261E]">
              {mensajeDeError(invitar.error)}
            </Text>
          ) : null}
          {invitar.isSuccess ? (
            <View className="mt-3 flex-row items-center gap-2 rounded-xl border border-secondary bg-secondary px-4 py-3">
              <Ionicons name="checkmark-circle" size={20} color={colors.primary} />
              <Text className="flex-1 text-[13px] leading-5 text-primary">
                Invitación enviada. El enlace caduca el{' '}
                {new Date(invitar.data.expiraEn).toLocaleDateString('es-ES')}.
              </Text>
            </View>
          ) : null}

          <View className="mt-4 flex-row gap-3">
            <Pressable
              accessibilityRole="button"
              onPress={onCerrar}
              className="flex-1 items-center rounded-xl border border-secondary py-3 active:bg-secondary"
            >
              <Text className="text-[15px] font-semibold text-text">Cerrar</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Enviar invitación"
              disabled={!emailValido || invitar.isPending}
              onPress={() => invitar.mutate()}
              className={`flex-1 items-center rounded-xl py-3 ${!emailValido || invitar.isPending ? 'bg-[#3F6E5B] opacity-60' : 'bg-primary'}`}
            >
              {invitar.isPending ? (
                <ActivityIndicator color="#F7F8F5" />
              ) : (
                <Text className="text-[15px] font-semibold text-[#F7F8F5]">Enviar</Text>
              )}
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
      <PickerModal<RolEspacio>
        visible={rolPicker}
        titulo="Rol en el espacio"
        opciones={[
          { valor: 'MIEMBRO', etiqueta: 'Miembro', detalle: 'Ve y trabaja en proyectos y tareas' },
          { valor: 'ADMINISTRADOR', etiqueta: 'Administrador', detalle: 'Invita, quita miembros y elimina proyectos' },
        ]}
        valor={rol}
        onSeleccionar={(v) => setRol(v ?? 'MIEMBRO')}
        onCerrar={() => setRolPicker(false)}
        mostrarLimpiar={false}
      />
    </Modal>
  );
}
