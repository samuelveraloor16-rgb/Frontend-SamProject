import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme/colors';

export type OpcionPicker<T extends string> = {
  valor: T;
  etiqueta: string;
  detalle?: string;
};

type PickerModalProps<T extends string> = {
  visible: boolean;
  titulo: string;
  opciones: OpcionPicker<T>[];
  /** Valor actual; undefined = sin filtro. */
  valor: T | undefined;
  onSeleccionar: (valor: T | undefined) => void;
  onCerrar: () => void;
  /** Texto de la opción "limpiar filtro". */
  limpiarEtiqueta?: string;
  /** false para selección obligatoria (sin fila "limpiar"). */
  mostrarLimpiar?: boolean;
};

/** Hoja inferior de selección simple (filtros y orden). */
export function PickerModal<T extends string>({
  visible,
  titulo,
  opciones,
  valor,
  onSeleccionar,
  onCerrar,
  limpiarEtiqueta = 'Todos',
  mostrarLimpiar = true,
}: PickerModalProps<T>) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onCerrar}>
      <Pressable className="flex-1 justify-end bg-black/40" onPress={onCerrar} accessibilityLabel="Cerrar">
        <Pressable
          className="max-h-[70%] rounded-t-3xl bg-background px-5 pb-8 pt-3"
          onPress={(e) => e.stopPropagation()}
        >
          <View className="mx-auto mb-3 h-1.5 w-12 rounded-full bg-secondary" />
          <Text style={{ fontFamily: 'Georgia' }} className="text-[18px] text-primary">
            {titulo}
          </Text>
          <ScrollView className="mt-3">
            {mostrarLimpiar ? (
              <Opcion
                etiqueta={limpiarEtiqueta}
                seleccionada={valor === undefined}
                onPress={() => {
                  onSeleccionar(undefined);
                  onCerrar();
                }}
              />
            ) : null}
            {opciones.map((op) => (
              <Opcion
                key={op.valor}
                etiqueta={op.etiqueta}
                detalle={op.detalle}
                seleccionada={valor === op.valor}
                onPress={() => {
                  onSeleccionar(op.valor);
                  onCerrar();
                }}
              />
            ))}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function Opcion({
  etiqueta,
  detalle,
  seleccionada,
  onPress,
}: {
  etiqueta: string;
  detalle?: string;
  seleccionada: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: seleccionada }}
      onPress={onPress}
      className="flex-row items-center justify-between border-b border-secondary py-3.5 active:bg-secondary"
    >
      <View className="flex-1 pr-3">
        <Text className="text-[15px] text-text">{etiqueta}</Text>
        {detalle ? <Text className="text-[12px] text-text opacity-60">{detalle}</Text> : null}
      </View>
      {seleccionada ? <Ionicons name="checkmark-circle" size={22} color={colors.primary} /> : null}
    </Pressable>
  );
}
