/** Small building blocks shared by the social screens. */
import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';

import { OWNER_COLORS } from '@/territory/api';
import { fonts, radius, sheet, usePalette } from '@/theme';

export const socialStyles = StyleSheet.create({
  content: { paddingHorizontal: sheet.horizontalPadding, paddingBottom: 40, gap: 10 },
});

export function Card({ children, testID }: { children: ReactNode; testID?: string }) {
  const c = usePalette();
  return (
    <View testID={testID} style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }]}>
      {children}
    </View>
  );
}

export function SectionTitle({ children, right }: { children: string; right?: ReactNode }) {
  const c = usePalette();
  return (
    <View style={styles.sectionRow}>
      <Text style={[styles.section, { color: c.textMuted }]} accessibilityRole="header">
        {children}
      </Text>
      {right}
    </View>
  );
}

export function Body({ children, muted, testID }: { children: ReactNode; muted?: boolean; testID?: string }) {
  const c = usePalette();
  return (
    <Text testID={testID} style={[styles.body, { color: muted ? c.textMuted : c.text }]}>
      {children}
    </Text>
  );
}

export function Notice({ text, tone = 'error' }: { text: string | null; tone?: 'error' | 'ok' }) {
  const c = usePalette();
  if (!text) return null;
  return (
    <Text style={[styles.notice, { color: tone === 'error' ? c.danger : c.brandDeep }]} accessibilityRole={tone === 'error' ? 'alert' : 'text'}>
      {text}
    </Text>
  );
}

export function Field(props: TextInputProps & { label: string }) {
  const c = usePalette();
  const { label, style, ...rest } = props;
  return (
    <TextInput
      placeholderTextColor={c.textMuted}
      accessibilityLabel={label}
      placeholder={label}
      {...rest}
      style={[styles.input, { color: c.text, backgroundColor: c.background, borderColor: c.border }, style]}
    />
  );
}

export function Button({
  label,
  onPress,
  disabled,
  busy,
  kind = 'primary',
  small,
  testID,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  busy?: boolean;
  kind?: 'primary' | 'secondary' | 'danger';
  small?: boolean;
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
      style={({ pressed }) => [
        small ? styles.buttonSmall : styles.button,
        { backgroundColor: bg },
        (pressed || off) && { opacity: off ? 0.5 : 0.8 },
      ]}
    >
      {busy ? <ActivityIndicator color={fg} /> : <Text style={[small ? styles.buttonTextSmall : styles.buttonText, { color: fg }]}>{label}</Text>}
    </Pressable>
  );
}

export function ColorDot({ color, size = 12 }: { color: number; size?: number }) {
  const c = usePalette();
  return <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: OWNER_COLORS[color] ?? c.brand }} />;
}

/** A person (or group) row: color dot, name, optional detail, right-side slot. */
export function PersonRow({
  name,
  color,
  detail,
  right,
  onPress,
  highlight,
  divider,
  testID,
}: {
  name: string;
  color?: number;
  detail?: string | null;
  right?: ReactNode;
  onPress?: () => void;
  highlight?: boolean;
  divider?: boolean;
  testID?: string;
}) {
  const c = usePalette();
  const inner = (
    <>
      {color !== undefined ? <ColorDot color={color} /> : null}
      <View style={styles.personText}>
        <Text style={[styles.personName, { color: c.text }]} numberOfLines={1}>
          {name}
        </Text>
        {detail ? (
          <Text style={[styles.personDetail, { color: c.textMuted }]} numberOfLines={2}>
            {detail}
          </Text>
        ) : null}
      </View>
      {right}
    </>
  );
  const style = [styles.person, divider && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border }, highlight && { backgroundColor: c.brandSoft }];
  if (!onPress) {
    return (
      <View testID={testID} style={style}>
        {inner}
      </View>
    );
  }
  return (
    <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={name} onPress={onPress} style={({ pressed }) => [...style, pressed && { opacity: 0.7 }]}>
      {inner}
    </Pressable>
  );
}

export function TextLink({ label, onPress, testID }: { label: string; onPress: () => void; testID?: string }) {
  const c = usePalette();
  return (
    <Pressable testID={testID} accessibilityRole="link" onPress={onPress} hitSlop={8}>
      <Text style={[styles.link, { color: c.brand }]}>{label}</Text>
    </Pressable>
  );
}

export function Loading() {
  const c = usePalette();
  return (
    <View style={styles.loading}>
      <ActivityIndicator color={c.brand} />
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, padding: 14, gap: 10 },
  sectionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 12 },
  section: { fontFamily: fonts.bold, fontSize: 13, textTransform: 'uppercase', letterSpacing: 0.4 },
  body: { fontFamily: fonts.medium, fontSize: 14, lineHeight: 20 },
  notice: { fontFamily: fonts.semibold, fontSize: 14, lineHeight: 20 },
  input: {
    fontFamily: fonts.medium,
    fontSize: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  button: { borderRadius: radius.pill, paddingVertical: 11, paddingHorizontal: 18, alignItems: 'center', justifyContent: 'center', minHeight: 44 },
  buttonSmall: { borderRadius: radius.pill, paddingVertical: 6, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center', minHeight: 32 },
  buttonText: { fontFamily: fonts.bold, fontSize: 15 },
  buttonTextSmall: { fontFamily: fonts.bold, fontSize: 13 },
  person: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, paddingHorizontal: 4, borderRadius: radius.sm },
  personText: { flex: 1, gap: 2 },
  personName: { fontFamily: fonts.semibold, fontSize: 15 },
  personDetail: { fontFamily: fonts.medium, fontSize: 13, lineHeight: 18 },
  link: { fontFamily: fonts.bold, fontSize: 14 },
  loading: { paddingVertical: 24, alignItems: 'center' },
});
