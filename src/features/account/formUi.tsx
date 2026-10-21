/** Small form pieces shared by the account screens. */
import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Switch, Text, TextInput, View, type TextInputProps } from 'react-native';

import { fonts, radius, sheet, usePalette } from '@/theme';

export function Card({ children, testID }: { children: ReactNode; testID?: string }) {
  const c = usePalette();
  return (
    <View testID={testID} style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }]}>
      {children}
    </View>
  );
}

export function SectionTitle({ children }: { children: string }) {
  const c = usePalette();
  return <Text style={[styles.section, { color: c.textMuted }]}>{children}</Text>;
}

export function Body({ children, muted }: { children: ReactNode; muted?: boolean }) {
  const c = usePalette();
  return <Text style={[styles.body, { color: muted ? c.textMuted : c.text }]}>{children}</Text>;
}

export function ErrorText({ children }: { children: string | null }) {
  const c = usePalette();
  if (!children) return null;
  return (
    <Text style={[styles.error, { color: c.danger }]} accessibilityRole="alert">
      {children}
    </Text>
  );
}

export function Field(props: TextInputProps & { label: string }) {
  const c = usePalette();
  const { label, style, ...rest } = props;
  return (
    <View style={styles.field}>
      <Text style={[styles.label, { color: c.textMuted }]}>{label}</Text>
      <TextInput
        placeholderTextColor={c.textMuted}
        accessibilityLabel={label}
        {...rest}
        style={[styles.input, { color: c.text, backgroundColor: c.surface, borderColor: c.border }, style]}
      />
    </View>
  );
}

export function Button({
  label,
  onPress,
  disabled,
  busy,
  kind = 'primary',
  testID,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  busy?: boolean;
  kind?: 'primary' | 'secondary' | 'danger';
  testID?: string;
}) {
  const c = usePalette();
  const bg = kind === 'primary' ? c.brand : kind === 'danger' ? c.danger : c.surfaceMuted;
  const fg = kind === 'secondary' ? c.text : c.onBrand;
  const off = disabled || busy;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!off, busy: !!busy }}
      disabled={off}
      onPress={onPress}
      style={({ pressed }) => [styles.button, { backgroundColor: bg }, (pressed || off) && { opacity: off ? 0.5 : 0.8 }]}
    >
      {busy ? <ActivityIndicator color={fg} /> : <Text style={[styles.buttonText, { color: fg }]}>{label}</Text>}
    </Pressable>
  );
}

export function ToggleRow({
  label,
  detail,
  value,
  onChange,
  disabled,
  testID,
}: {
  label: string;
  detail?: string;
  value: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  testID?: string;
}) {
  const c = usePalette();
  return (
    <View style={styles.toggleRow}>
      <View style={styles.toggleText}>
        <Text style={[styles.toggleLabel, { color: c.text }]}>{label}</Text>
        {detail ? <Text style={[styles.toggleDetail, { color: c.textMuted }]}>{detail}</Text> : null}
      </View>
      <Switch testID={testID} accessibilityLabel={label} value={value} onValueChange={onChange} disabled={disabled} trackColor={{ true: c.brand }} />
    </View>
  );
}

export const formStyles = StyleSheet.create({
  content: { paddingHorizontal: sheet.horizontalPadding, paddingBottom: 40, gap: 10 },
});

const styles = StyleSheet.create({
  card: { borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, padding: 14, gap: 10 },
  section: { fontFamily: fonts.bold, fontSize: 13, marginTop: 12, textTransform: 'uppercase', letterSpacing: 0.4 },
  body: { fontFamily: fonts.medium, fontSize: 14, lineHeight: 20 },
  error: { fontFamily: fonts.semibold, fontSize: 14, lineHeight: 20 },
  field: { gap: 6 },
  label: { fontFamily: fonts.semibold, fontSize: 13 },
  input: {
    fontFamily: fonts.medium,
    fontSize: 17,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    paddingVertical: 11,
  },
  button: { borderRadius: radius.pill, paddingVertical: 12, paddingHorizontal: 18, alignItems: 'center', justifyContent: 'center', minHeight: 46 },
  buttonText: { fontFamily: fonts.bold, fontSize: 15 },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  toggleText: { flex: 1, gap: 2 },
  toggleLabel: { fontFamily: fonts.semibold, fontSize: 15 },
  toggleDetail: { fontFamily: fonts.medium, fontSize: 13, lineHeight: 18 },
});
