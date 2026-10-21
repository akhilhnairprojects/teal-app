import Ionicons from '@expo/vector-icons/Ionicons';
import Constants from 'expo-constants';
import { useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';

import { goBack } from '@/features/shell/routes';
import { HAS_API_KEY } from '@/mbta/api/client';
import { POLL } from '@/mbta/live/usePolling';
import { fonts, radius, sheet, usePalette, type Palette } from '@/theme';
import { SheetPage, SheetScrollView } from '@/ui';

import { ATTRIBUTIONS, INDEPENDENCE_LINE, keyStatus, LINKS, MBTA_GO_NOTICE, type MoreLink } from './moreContent';

export function MoreScreen() {
  const c = usePalette();
  const s = styles(c);
  const [showLicense, setShowLicense] = useState(false);
  const status = keyStatus(HAS_API_KEY, POLL.stopPredictionsMs);
  const version = Constants.expoConfig?.version;

  return (
    <SheetPage title="More" onBack={goBack}>
      <SheetScrollView contentContainerStyle={s.content}>
        <View style={s.brand}>
          <Text style={s.wordmark}>
            teal<Text style={{ color: c.brand }}>.</Text>
          </Text>
          {version ? <Text style={s.muted}>Version {version}</Text> : null}
        </View>

        <View style={s.card}>
          <View style={s.statusRow}>
            <Ionicons name={HAS_API_KEY ? 'flash' : 'flash-outline'} size={18} color={HAS_API_KEY ? c.live : c.warning} />
            <Text style={s.cardTitle}>{status.label}</Text>
          </View>
          <Text style={s.body}>{status.detail}</Text>
        </View>

        <Text style={s.section}>Data</Text>
        <View style={s.card}>
          {ATTRIBUTIONS.map((a, i) => (
            <View key={a.id} style={[s.item, i > 0 && s.divider]}>
              <Text style={s.cardTitle}>{a.title}</Text>
              <Text style={s.body}>{a.body}</Text>
              {a.link ? <LinkText link={a.link} /> : null}
            </View>
          ))}
        </View>

        <Text style={s.section}>Open source</Text>
        <View style={s.card}>
          <Text style={s.cardTitle}>{MBTA_GO_NOTICE.title}</Text>
          <Text style={s.body}>{MBTA_GO_NOTICE.summary}</Text>
          <LinkText link={MBTA_GO_NOTICE.link} />
          <Pressable onPress={() => setShowLicense((v) => !v)} accessibilityRole="button" style={s.toggle}>
            <Text style={s.link}>{showLicense ? 'Hide license text' : 'Show license text'}</Text>
          </Pressable>
          {showLicense ? <Text style={s.license}>{MBTA_GO_NOTICE.license}</Text> : null}
        </View>

        <Text style={s.section}>Links</Text>
        <View style={s.card}>
          {LINKS.map((l, i) => (
            <View key={l.url} style={[s.item, i > 0 && s.divider]}>
              <LinkText link={l} />
            </View>
          ))}
        </View>

        <Text style={[s.muted, s.footer]}>{INDEPENDENCE_LINE}</Text>
      </SheetScrollView>
    </SheetPage>
  );
}

function LinkText({ link }: { link: MoreLink }) {
  const c = usePalette();
  const s = styles(c);
  return (
    <Pressable onPress={() => void Linking.openURL(link.url)} accessibilityRole="link" hitSlop={6} style={s.linkRow}>
      <Text style={s.link}>{link.label}</Text>
      <Ionicons name="open-outline" size={14} color={c.brand} />
    </Pressable>
  );
}

const styles = (c: Palette) =>
  StyleSheet.create({
    content: { paddingHorizontal: sheet.horizontalPadding, paddingBottom: 40, gap: 8 },
    brand: { alignItems: 'center', paddingVertical: 12, gap: 2 },
    wordmark: { fontFamily: fonts.extrabold, fontSize: 36, letterSpacing: -1.5, color: c.brandDeep },
    section: { fontFamily: fonts.bold, fontSize: 13, color: c.textMuted, marginTop: 12, textTransform: 'uppercase', letterSpacing: 0.4 },
    card: {
      backgroundColor: c.surface,
      borderRadius: radius.lg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
      padding: 14,
      gap: 6,
    },
    item: { gap: 4 },
    divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border, paddingTop: 12, marginTop: 6 },
    statusRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    cardTitle: { fontFamily: fonts.bold, fontSize: 15, color: c.text },
    body: { fontFamily: fonts.medium, fontSize: 14, lineHeight: 20, color: c.textMuted },
    linkRow: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start' },
    link: { fontFamily: fonts.bold, fontSize: 14, color: c.brand },
    toggle: { alignSelf: 'flex-start', marginTop: 4 },
    license: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 17, color: c.textMuted },
    muted: { fontFamily: fonts.medium, fontSize: 13, color: c.textMuted },
    footer: { textAlign: 'center', marginTop: 16 },
  });
