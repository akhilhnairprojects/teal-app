import Ionicons from '@expo/vector-icons/Ionicons';
import { BottomSheetTextInput, useBottomSheetInternal } from '@gorhom/bottom-sheet';
import { forwardRef, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Keyboard, Platform, Pressable, StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';

import { Button, Card } from '@/features/account/formUi';
import { useUserLocation } from '@/features/map/mapCenter';
import { Suggestions } from '@/features/planner/Suggestions';
import { goBack } from '@/features/shell/routes';
import { resolveTypedPlace, useGeocodeSuggestions } from '@/geocode';
import { formatDistance } from '@/lib/geo';
import { useGlobalData } from '@/mbta/global/globalData';
import { useNow } from '@/mbta/live/usePolling';
import { MAPS_HANDOFF_LABEL, openCyclingDirections } from '@/parking/appleMaps';
import { dockCountsText } from '@/parking/engine';
import { endParking, PARKING_COPY, refreshParking, simulateTargetFull, startParking, useParking, type ParkingSnapshot } from '@/parking/session';
import { PARKING, type DockCandidate } from '@/parking/types';
import type { Place } from '@/planner/types';
import { useMapOverlay } from '@/state/mapOverlay';
import { requestSheetDetent } from '@/state/sheet';
import { fonts, radius, sheet, usePalette, type Palette } from '@/theme';
import { EmptyState, SheetPage, SheetScrollView } from '@/ui';
import { DICTATION_COPY, dictationErrorText, useDictation } from '@/voice/dictation';
import { useSpokenUpdates } from '@/voice/speak';

import { checkedAgoText, dockDistanceText, etaText, walkMinutesText } from './format';
import { parkingOverlay } from './overlay';

export type ParkParams = { toName: string | null; toLat: number | null; toLon: number | null };

/** A text input that cooperates with the bottom sheet's keyboard handling when inside it. */
const SheetTextInput = forwardRef<TextInput, TextInputProps>(function SheetTextInput(props, ref) {
  const inSheet = useBottomSheetInternal(true) !== null;
  const Component = (inSheet ? BottomSheetTextInput : TextInput) as typeof TextInput;
  return <Component ref={ref} {...props} />;
});

const RISK_TEXT: Record<DockCandidate['risk'], string | null> = { ok: null, low: 'Filling up', critical: 'Almost full' };

/**
 * Bike parking mode: pick a destination while riding a Bluebike, and Teal points you to the best
 * open dock near it, re-checking live docks and re-routing if the dock fills. Unlocking, docking and
 * payment stay in the Bluebikes app; turn-by-turn directions are handed to Apple Maps.
 */
export function ParkingScreen({ params }: { params: ParkParams }) {
  if (Platform.OS === 'web') {
    return (
      <SheetPage title="Find a dock" onBack={goBack}>
        <EmptyState icon="phone-portrait-outline" title="In the iPhone app" message={PARKING_COPY.unavailable} />
      </SheetPage>
    );
  }
  return <ParkingNative params={params} />;
}

function ParkingNative({ params }: { params: ParkParams }) {
  const c = usePalette();
  const s = styles(c);
  const snap = useParking();
  const { phase } = snap.state;
  const colors = useMemo(() => ({ walk: c.textMuted, bike: c.brand }), [c.textMuted, c.brand]);
  // The overlay rounds the rider to ~10 m, so rebuild it only when that rounded position changes.
  const hereKey = snap.here ? `${snap.here.latitude.toFixed(4)},${snap.here.longitude.toFixed(4)}` : null;
  const overlay = useMemo(
    () => parkingOverlay(snap.state, snap.here, colors),
    // Only what the overlay draws; the store compares by JSON anyway.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [snap.state.phase, snap.state.destination, snap.state.target?.station.id, hereKey, colors],
  );
  useMapOverlay('parking', overlay);

  return (
    <SheetPage title="Find a dock" onBack={goBack}>
      <SheetScrollView contentContainerStyle={s.content}>
        {phase === 'navigating' ? (
          <Navigating snap={snap} />
        ) : phase === 'arrived' ? (
          <Arrived snap={snap} />
        ) : (
          <Choose params={params} />
        )}
      </SheetScrollView>
    </SheetPage>
  );
}

function paramPlace(p: ParkParams): Place | null {
  if (p.toLat === null || p.toLon === null) return null;
  return { name: p.toName || 'Dropped pin', latLng: { latitude: p.toLat, longitude: p.toLon }, source: 'map' };
}

function Choose({ params }: { params: ParkParams }) {
  const c = usePalette();
  const s = styles(c);
  const g = useGlobalData().data;
  const location = useUserLocation();
  const bias = location.status === 'ready' ? location.coords : null;
  const [text, setText] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [offered, setOffered] = useState<Place | null>(() => paramPlace(params));
  const suggestions = useGeocodeSuggestions(text, g, bias);
  const inputRef = useRef<TextInput>(null);
  const [keyboardTip, setKeyboardTip] = useState(false);
  // Bias recognition toward T station names (Bluebikes station names follow streets the recognizer knows).
  const placeNames = useMemo(
    () => (g ? Object.values(g.stops).filter((st) => st.locationType === 1).map((st) => st.name) : []),
    [g],
  );
  const dictation = useDictation({ onText: setText, contextualStrings: placeNames });
  const onMic = () => {
    setMessage(null);
    if (dictation.supported) {
      if (dictation.listening) dictation.stop();
      else void dictation.start();
      return;
    }
    // Expo Go has no speech recognizer: open the keyboard, whose dictation mic does the same job.
    setKeyboardTip(true);
    inputRef.current?.focus();
  };

  const start = async (p: Place) => {
    Keyboard.dismiss();
    setBusy(true);
    setMessage(null);
    try {
      const r = await startParking(p);
      if (!r.ok) setMessage(r.reason === 'outsideArea' ? PARKING_COPY.outsideArea : PARKING_COPY.unavailable);
      else requestSheetDetent('half');
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    if (!text.trim()) return;
    setBusy(true);
    try {
      const p = await resolveTypedPlace(text, g, { bias, suggestions });
      if (p) await start(p);
      else setMessage(`Couldn’t find “${text.trim()}”. Try a station name or a street address.`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {offered ? (
        <Card testID="park-offer">
          <Text style={s.title}>Park near {offered.name}?</Text>
          <Text style={s.body}>Teal finds the open dock closest to where you’re going and re-routes you if it fills.</Text>
          <View style={s.actions}>
            <Button label="Start" busy={busy} onPress={() => void start(offered)} testID="park-offer-start" />
            <Button label="Pick another place" kind="secondary" onPress={() => setOffered(null)} />
          </View>
        </Card>
      ) : null}
      <View style={s.searchBox}>
        <Ionicons name="flag" size={16} color={c.brandDeep} />
        <SheetTextInput
          ref={inputRef}
          testID="park-destination-input"
          value={text}
          onChangeText={setText}
          onSubmitEditing={() => void submit()}
          returnKeyType="search"
          autoCorrect={false}
          placeholder={dictation.listening ? DICTATION_COPY.listening : 'Where are you riding to?'}
          placeholderTextColor={c.textMuted}
          accessibilityLabel="Destination"
          style={s.input}
        />
        {busy ? <ActivityIndicator color={c.brand} /> : null}
        <Pressable
          testID="park-mic"
          onPress={onMic}
          accessibilityRole="button"
          accessibilityLabel={dictation.listening ? 'Stop listening' : 'Say your destination'}
          accessibilityState={{ selected: dictation.listening }}
          hitSlop={8}
          style={[s.mic, dictation.listening && { backgroundColor: c.brand }]}
        >
          <Ionicons name={dictation.listening ? 'mic' : 'mic-outline'} size={18} color={dictation.listening ? c.onBrand : c.brandDeep} />
        </Pressable>
      </View>
      {dictation.listening ? (
        <Text style={s.small} testID="park-listening">{DICTATION_COPY.listening}</Text>
      ) : keyboardTip && !dictation.supported ? (
        <View style={s.message} testID="park-keyboard-tip">
          <Ionicons name="mic-outline" size={15} color={c.brandDeep} />
          <Text style={[s.messageText, { color: c.text }]}>{DICTATION_COPY.keyboardTip}</Text>
        </View>
      ) : null}
      {dictation.error && dictation.error !== 'unavailable' ? (
        <View style={s.message}>
          <Ionicons name="alert-circle" size={15} color={c.warning} />
          <Text style={s.messageText}>{dictationErrorText(dictation.error)}</Text>
        </View>
      ) : null}
      {message ? (
        <View style={s.message}>
          <Ionicons name="alert-circle" size={15} color={c.warning} />
          <Text style={s.messageText}>{message}</Text>
        </View>
      ) : null}
      {text.trim() ? (
        <Suggestions data={suggestions} query={text} current={null} onPick={(p) => void start(p)} onSubmit={() => void submit()} />
      ) : (
        <EmptyState
          icon="bicycle-outline"
          title="Riding a Bluebike?"
          message="Tell Teal where you’re going. It picks the best open dock nearby, re-checks live docks and re-routes you if it fills."
        />
      )}
      <Text style={s.small}>{PARKING_COPY.pollNote}</Text>
      <Text style={s.small}>Unlocking, docking and payment happen in the Bluebikes app.</Text>
    </>
  );
}

function Navigating({ snap }: { snap: ParkingSnapshot }) {
  const c = usePalette();
  const s = styles(c);
  const now = useNow(5_000);
  const { state, here } = snap;
  const target = state.target;
  const [mapsFailed, setMapsFailed] = useState(false);
  const [spoken, setSpoken] = useSpokenUpdates();

  const banners: { key: string; icon: keyof typeof Ionicons.glyphMap; text: string; tone: string }[] = [];
  if (snap.notice) banners.push({ key: 'notice', icon: snap.notice.kind === 'rerouted' ? 'swap-horizontal' : 'alert-circle', text: snap.notice.text, tone: c.warning });
  if (snap.fetchFailed) banners.push({ key: 'fetch', icon: 'cloud-offline-outline', text: PARKING_COPY.fetchFailed, tone: c.warning });
  if (snap.staleMs !== null) banners.push({ key: 'stale', icon: 'time-outline', text: `Dock data is ${Math.round(snap.staleMs / 60_000)} min old.`, tone: c.warning });
  if (state.radiusM > PARKING.searchRadiusM && target)
    banners.push({ key: 'wide', icon: 'resize-outline', text: `No open docks within ${formatDistance(PARKING.searchRadiusM)}, so Teal looked farther out.`, tone: c.textMuted });
  if (snap.locationError)
    banners.push({ key: 'loc', icon: 'location-outline', text: 'Location is off, so docks are ranked by distance to your destination.', tone: c.textMuted });

  const openMaps = async () => {
    if (!target) return;
    setMapsFailed(!(await openCyclingDirections(target.station.location)));
  };

  return (
    <>
      <View style={s.destRow}>
        <Ionicons name="flag" size={15} color={c.brandDeep} />
        <Text style={s.destText} numberOfLines={1}>
          To {state.destination?.name}
        </Text>
      </View>
      {banners.map((b) => (
        <View key={b.key} style={s.banner} accessibilityRole="alert" testID={`park-banner-${b.key}`}>
          <Ionicons name={b.icon} size={16} color={b.tone} />
          <Text style={s.bannerText}>{b.text}</Text>
        </View>
      ))}
      {target ? (
        <Card testID="park-target">
          <Text style={s.label}>Head to</Text>
          <Text style={s.dockName}>{target.station.name}</Text>
          <Text style={s.body}>
            {dockCountsText(target.station)}
            {RISK_TEXT[target.risk] ? ` · ${RISK_TEXT[target.risk]}` : ''}
          </Text>
          <Text style={s.body}>{[dockDistanceText(here, target.station.location), etaText(target, here)].filter(Boolean).join(' · ')}</Text>
          {state.backup ? (
            <Text style={s.muted} testID="park-backup">
              Backup: {state.backup.station.name} · {dockCountsText(state.backup.station)}
            </Text>
          ) : null}
          <View style={s.actions}>
            <Button label={MAPS_HANDOFF_LABEL} onPress={() => void openMaps()} testID="park-open-maps" />
          </View>
          {mapsFailed ? <Text style={s.muted}>Couldn’t open Maps on this device.</Text> : null}
        </Card>
      ) : state.lastCheckAt === null && !snap.fetchFailed ? (
        <View style={s.loading}>
          <ActivityIndicator color={c.brand} />
          <Text style={s.muted}>Finding open docks…</Text>
        </View>
      ) : null}
      <Pressable
        testID="park-spoken"
        onPress={() => setSpoken(!spoken)}
        accessibilityRole="switch"
        accessibilityState={{ checked: spoken }}
        style={s.spokenRow}
      >
        <Ionicons name={spoken ? 'volume-high' : 'volume-mute'} size={16} color={spoken ? c.brand : c.textMuted} />
        <Text style={s.spokenText}>{spoken ? 'Spoken updates on' : 'Spoken updates off'}</Text>
      </Pressable>
      <View style={s.footerRow}>
        <Text style={s.small}>{checkedAgoText(state.lastCheckAt, now)}</Text>
        <Pressable onPress={() => void refreshParking()} accessibilityRole="button" hitSlop={8}>
          <Text style={[s.small, { color: c.brand }]}>Check now</Text>
        </Pressable>
      </View>
      <Button label="End parking" kind="secondary" onPress={endParking} testID="park-end" />
      {__DEV__ && target ? <Button label="Simulate target full" kind="danger" onPress={simulateTargetFull} testID="park-simulate-full" /> : null}
      <Text style={s.small}>{PARKING_COPY.pollNote} Keep Teal open while you ride; the screen stays on.</Text>
      <Text style={s.small}>Unlocking, docking and payment happen in the Bluebikes app.</Text>
    </>
  );
}

function Arrived({ snap }: { snap: ParkingSnapshot }) {
  const c = usePalette();
  const s = styles(c);
  const target = snap.state.target;
  return (
    <Card testID="park-arrived">
      <Ionicons name="checkmark-circle" size={24} color={c.brand} />
      <Text style={s.title}>You’re at {target?.station.name ?? 'the dock'}</Text>
      <Text style={s.body}>
        Dock your bike and check the Bluebikes app to make sure the ride ended.
        {target && snap.state.destination ? ` Then it’s about ${walkMinutesText(target)} to ${snap.state.destination.name}.` : ''}
      </Text>
      <Button label="Done" onPress={endParking} testID="park-done" />
    </Card>
  );
}

const styles = (c: Palette) =>
  StyleSheet.create({
    content: { paddingHorizontal: sheet.horizontalPadding, paddingTop: 4, paddingBottom: 48, gap: 10 },
    title: { fontFamily: fonts.bold, fontSize: 17, color: c.text },
    label: { fontFamily: fonts.semibold, fontSize: 12, color: c.textMuted, textTransform: 'uppercase', letterSpacing: 0.4 },
    dockName: { fontFamily: fonts.bold, fontSize: 20, color: c.text },
    body: { fontFamily: fonts.medium, fontSize: 15, lineHeight: 21, color: c.text },
    muted: { fontFamily: fonts.medium, fontSize: 14, color: c.textMuted },
    small: { fontFamily: fonts.medium, fontSize: 12, color: c.textMuted },
    actions: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
    searchBox: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      backgroundColor: c.surface,
      borderRadius: radius.lg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
      paddingHorizontal: 12,
      minHeight: 50,
    },
    input: { flex: 1, fontFamily: fonts.medium, fontSize: 16, color: c.text, paddingVertical: 10 },
    message: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 4 },
    messageText: { flex: 1, fontFamily: fonts.medium, fontSize: 13, color: c.warning },
    destRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 4 },
    destText: { flex: 1, fontFamily: fonts.semibold, fontSize: 15, color: c.text },
    banner: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      borderRadius: radius.md,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
      backgroundColor: c.surface,
      paddingHorizontal: 12,
      paddingVertical: 10,
    },
    bannerText: { flex: 1, fontFamily: fonts.medium, fontSize: 13, color: c.text },
    loading: { alignItems: 'center', gap: 8, paddingVertical: 24 },
    footerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 4 },
    mic: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: c.brandSoft },
    spokenRow: { flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start', paddingHorizontal: 4, paddingVertical: 4 },
    spokenText: { fontFamily: fonts.semibold, fontSize: 13, color: c.text },
  });
