import Ionicons from '@expo/vector-icons/Ionicons';
import { BottomSheetTextInput, useBottomSheetInternal } from '@gorhom/bottom-sheet';
import { forwardRef } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';

import type { Place } from '@/planner/types';
import { fonts, radius, usePalette, type Palette } from '@/theme';

/** A text input that cooperates with the bottom sheet's keyboard handling when inside it. */
const SheetTextInput = forwardRef<TextInput, TextInputProps>(function SheetTextInput(props, ref) {
  const inSheet = useBottomSheetInternal(true) !== null;
  const Component = (inSheet ? BottomSheetTextInput : TextInput) as typeof TextInput;
  return <Component ref={ref} {...props} />;
});

export type PlaceField = 'origin' | 'destination';

/**
 * The "From" and "To" rows. The row being edited becomes a text field; the other shows the
 * chosen place and can be tapped to edit. A swap button exchanges the two.
 */
export function PlaceFields({
  origin,
  destination,
  editing,
  text,
  onEdit,
  onChangeText,
  onSubmit,
  onCancel,
  onSwap,
}: {
  origin: Place | null;
  destination: Place | null;
  editing: PlaceField | null;
  text: string;
  onEdit(field: PlaceField): void;
  onChangeText(t: string): void;
  onSubmit(): void;
  onCancel(): void;
  onSwap(): void;
}) {
  const c = usePalette();
  const s = styles(c);
  const row = (field: PlaceField) => {
    const place = field === 'origin' ? origin : destination;
    const icon = field === 'origin' ? 'radio-button-on' : 'flag';
    const label = field === 'origin' ? 'From' : 'To';
    if (editing === field) {
      return (
        <View style={[s.row, s.rowEditing]}>
          <Ionicons name={icon} size={16} color={c.brand} />
          <SheetTextInput
            testID={`plan-${field}-input`}
            autoFocus
            value={text}
            onChangeText={onChangeText}
            onSubmitEditing={onSubmit}
            returnKeyType="search"
            autoCorrect={false}
            placeholder={field === 'origin' ? 'Start: station, address or place' : 'Where to? Station, address or place'}
            placeholderTextColor={c.textMuted}
            accessibilityLabel={field === 'origin' ? 'Start' : 'Destination'}
            style={s.input}
          />
          <Pressable onPress={onCancel} hitSlop={10} accessibilityRole="button" accessibilityLabel="Cancel">
            <Ionicons name="close-circle" size={18} color={c.textMuted} />
          </Pressable>
        </View>
      );
    }
    return (
      <Pressable
        testID={`plan-${field}-row`}
        onPress={() => onEdit(field)}
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${place?.name ?? 'not set'}. Double tap to change.`}
        style={({ pressed }) => [s.row, pressed && { opacity: 0.7 }]}
      >
        <Ionicons name={icon} size={16} color={field === 'origin' ? c.textMuted : c.brandDeep} />
        <View style={{ flex: 1 }}>
          <Text style={s.label}>{label}</Text>
          <Text style={[s.value, !place && { color: c.textMuted }]} numberOfLines={1}>
            {place?.name ?? (field === 'origin' ? 'Finding you…' : 'Choose a destination')}
          </Text>
        </View>
      </Pressable>
    );
  };
  return (
    <View style={s.box}>
      <View style={{ flex: 1 }}>
        {row('origin')}
        <View style={s.divider} />
        {row('destination')}
      </View>
      <Pressable
        onPress={onSwap}
        disabled={!origin || !destination}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel="Swap start and destination"
        style={({ pressed }) => [s.swap, (!origin || !destination) && { opacity: 0.4 }, pressed && { opacity: 0.6 }]}
      >
        <Ionicons name="swap-vertical" size={18} color={c.text} />
      </Pressable>
    </View>
  );
}

const styles = (c: Palette) =>
  StyleSheet.create({
    box: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      backgroundColor: c.surface,
      borderRadius: radius.lg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
      paddingHorizontal: 12,
      paddingVertical: 4,
    },
    row: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 48, paddingVertical: 6 },
    rowEditing: { minHeight: 48 },
    divider: { height: StyleSheet.hairlineWidth, backgroundColor: c.border, marginLeft: 26 },
    label: { fontFamily: fonts.medium, fontSize: 12, color: c.textMuted },
    value: { fontFamily: fonts.semibold, fontSize: 16, color: c.text },
    input: { flex: 1, fontFamily: fonts.medium, fontSize: 16, color: c.text, paddingVertical: 8 },
    swap: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: c.surfaceMuted },
  });
