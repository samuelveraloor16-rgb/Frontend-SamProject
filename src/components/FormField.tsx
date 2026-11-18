import { forwardRef, useState, type ComponentRef } from 'react';
import { TextInput, Text, View, type TextInputProps } from 'react-native';
import { colors } from '../theme/colors';

type FormFieldProps = TextInputProps & {
  label: string;
  error?: string | null;
};

/**
 * Campo de formulario institucional: etiqueta sentence case,
 * borde secondary que pasa a primary en foco, error inline.
 */
export const FormField = forwardRef<ComponentRef<typeof TextInput>, FormFieldProps>(function FormField(
  { label, error, style, onFocus, onBlur, ...inputProps },
  ref,
) {
  const [focused, setFocused] = useState(false);

  return (
    <View className="mb-4 w-full">
      <Text className="mb-1.5 text-[13px] font-semibold text-text">{label}</Text>
      <TextInput
        ref={ref}
        placeholderTextColor="#8A968E"
        onFocus={(e) => {
          setFocused(true);
          onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          onBlur?.(e);
        }}
        style={[
          {
            minHeight: 52,
            borderRadius: 12,
            borderWidth: 1.5,
            borderColor: error ? '#B3261E' : focused ? colors.primary : '#D5DFD8',
            backgroundColor: '#FFFFFF',
            paddingHorizontal: 16,
            paddingVertical: 12,
            fontSize: 16,
            color: colors.text,
          },
          style,
        ]}
        {...inputProps}
      />
      {error ? (
        <Text className="mt-1.5 text-[13px] leading-5 text-[#B3261E]">{error}</Text>
      ) : null}
    </View>
  );
});
