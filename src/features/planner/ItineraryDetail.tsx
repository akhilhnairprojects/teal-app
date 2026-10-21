import Ionicons from '@expo/vector-icons/Ionicons';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';

import { LiveDot } from '@/components/LiveDot';
import type { GlobalData } from '@/mbta/global/globalData';
import { effectLabel } from '@/mbta/rules/alerts';
import { formatClock } from '@/mbta/time/eastern';
import type { BikeDock, BikeLeg, Itinerary, Leg, TransitLeg, WalkLeg } from '@/planner/types';
import { fonts, radius, usePalette, type Palette } from '@/theme';
import { CarCrowdingDiagram, RoutePill } from '@/ui';

import {
  departsIn,
  dockBikesText,
  dockParkingText,
  legTitle,
  minutesBetween,
  stationName,
  transitTimeText,
  uncertaintyText,
  walkText,
} from './format';

/** Opens the dock in the Bluebikes app; unlocking and payment happen there. */
function UnlockButton({ dock, c }: { dock: BikeDock; c: Palette }) {
  if (!dock.rentalUrl) return null;
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={`Open ${dock.name} in the Bluebikes app`}
      onPress={() => void Linking.openURL(dock.rentalUrl!)}
      style={({ pressed }) => [styles(c).unlock, pressed && { opacity: 0.7 }]}
    >
      <Text style={styles(c).unlockText}>Unlock</Text>
      <Ionicons name="open-outline" size={14} color={c.onBrand} />
    </Pressable>
  );
}

function DockRow({ dock, role, c }: { dock: BikeDock; role: 'start' | 'end'; c: Palette }) {
  const s = styles(c);
  const empty = role === 'start' ? dock.bikes === 0 : dock.docks === 0;
  return (
    <View style={s.dock}>
      <Ionicons name={role === 'start' ? 'bicycle' : 'log-in-outline'} size={16} color={empty ? c.warning : c.brand} />
      <View style={{ flex: 1 }}>
        <Text style={s.dockName} numberOfLines={1}>
          {dock.name}
        </Text>
        <Text style={[s.meta, empty && { color: c.warning }]}>{role === 'start' ? dockBikesText(dock) : dockParkingText(dock)}</Text>
      </View>
      {role === 'start' ? <UnlockButton dock={dock} c={c} /> : null}
    </View>
  );
}

function WalkStep({ leg, c }: { leg: WalkLeg; c: Palette }) {
  const s = styles(c);
  return (
    <View style={s.step}>
      <View style={s.rail}>
        <Ionicons name="walk" size={16} color={c.textMuted} />
        <View style={[s.line, s.dashed, { borderColor: c.textMuted }]} />
      </View>
      <View style={s.body}>
        <Text style={s.title}>{`Walk to ${leg.toName}`}</Text>
        <Text style={s.meta}>{`${walkText(leg.meters)} · ${formatClock(leg.startTime)}`}</Text>
      </View>
    </View>
  );
}

function BikeStep({ leg, c }: { leg: BikeLeg; c: Palette }) {
  const s = styles(c);
  return (
    <View style={s.step}>
      <View style={s.rail}>
        <Ionicons name="bicycle" size={16} color={c.brand} />
        <View style={[s.line, { backgroundColor: c.brand }]} />
      </View>
      <View style={s.body}>
        <Text style={s.title}>{legTitle(leg, null)}</Text>
        <Text style={s.meta}>{`About ${minutesBetween(leg.startTime, leg.endTime)} min including docking · ${formatClock(leg.startTime)} → ${formatClock(leg.endTime)}`}</Text>
        <DockRow dock={leg.fromDock} role="start" c={c} />
        <DockRow dock={leg.toDock} role="end" c={c} />
      </View>
    </View>
  );
}

function TransitStep({ leg, g, now, onAlertPress, c }: { leg: TransitLeg; g: GlobalData | null; now: number; onAlertPress(id: string): void; c: Palette }) {
  const s = styles(c);
  const route = g?.routes[leg.routeId];
  const color = route?.color ?? c.text;
  const uncertainty = uncertaintyText(leg.uncertaintySec);
  return (
    <View style={s.step}>
      <View style={s.rail}>
        {route ? <RoutePill route={route} size="small" /> : <Ionicons name="train" size={16} color={c.text} />}
        <View style={[s.line, { backgroundColor: color, width: 4 }]} />
      </View>
      <View style={s.body}>
        <Text style={s.title}>{legTitle(leg, g)}</Text>
        <View style={s.inline}>
          {leg.timeSource === 'realtime' ? <LiveDot color={c.live} size={7} /> : null}
          <Text style={s.depart}>{`Board at ${stationName(g, leg.fromStopId)} ${departsIn(leg.departTime, now)}`}</Text>
        </View>
        <Text style={s.meta}>
          {`${transitTimeText(leg)} · ${leg.stopCount} ${leg.stopCount === 1 ? 'stop' : 'stops'} · get off at ${stationName(g, leg.toStopId)}`}
        </Text>
        {leg.laterDepartures.length > 0 ? <Text style={s.meta}>{`Later: ${leg.laterDepartures.map(formatClock).join(', ')}`}</Text> : null}
        {uncertainty ? <Text style={s.meta}>{uncertainty}</Text> : null}
        {leg.carriages.length > 0 ? (
          <View style={s.cars}>
            <Text style={s.carsTitle}>{leg.car ? leg.car.label : 'Crowding by car'}</Text>
            <CarCrowdingDiagram carriages={leg.carriages} recommendation={leg.car} />
          </View>
        ) : null}
        {leg.alerts.map((a) => (
          <Pressable key={a.id} onPress={() => onAlertPress(a.id)} accessibilityRole="button" style={s.alert}>
            <Ionicons name="warning" size={14} color={c.warning} />
            <Text style={s.alertText} numberOfLines={3}>{`${effectLabel(a.effect)}: ${a.header}`}</Text>
            <Ionicons name="chevron-forward" size={14} color={c.textMuted} />
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function Step({ leg, g, now, onAlertPress, c }: { leg: Leg; g: GlobalData | null; now: number; onAlertPress(id: string): void; c: Palette }) {
  if (leg.mode === 'walk') return <WalkStep leg={leg} c={c} />;
  if (leg.mode === 'bike') return <BikeStep leg={leg} c={c} />;
  return <TransitStep leg={leg} g={g} now={now} onAlertPress={onAlertPress} c={c} />;
}

/** Leg-by-leg timeline of one itinerary, ending at the destination. */
export function ItineraryDetail({
  itinerary,
  global,
  now,
  destinationName,
  onAlertPress,
}: {
  itinerary: Itinerary;
  global: GlobalData | null;
  now: number;
  destinationName: string;
  onAlertPress(id: string): void;
}) {
  const c = usePalette();
  const s = styles(c);
  return (
    <View style={s.card} testID="itinerary-detail">
      {itinerary.legs.map((leg, i) => (
        <Step key={i} leg={leg} g={global} now={now} onAlertPress={onAlertPress} c={c} />
      ))}
      <View style={s.step}>
        <View style={s.rail}>
          <Ionicons name="flag" size={16} color={c.brandDeep} />
        </View>
        <View style={s.body}>
          <Text style={s.title}>{`Arrive at ${destinationName}`}</Text>
          <Text style={s.meta}>{formatClock(itinerary.arriveTime)}</Text>
        </View>
      </View>
      {itinerary.notices.map((n, i) => (
        <View key={`${n.kind}:${i}`} style={s.notice}>
          <Ionicons name={n.severity === 'warning' ? 'alert-circle' : 'information-circle'} size={14} color={n.severity === 'warning' ? c.warning : c.textMuted} />
          <Text style={[s.meta, { flex: 1 }]}>{n.text}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = (c: Palette) =>
  StyleSheet.create({
    card: {
      backgroundColor: c.surface,
      borderRadius: radius.lg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
      padding: 14,
      gap: 4,
    },
    step: { flexDirection: 'row', gap: 12 },
    rail: { width: 32, alignItems: 'center', gap: 4, paddingTop: 2 },
    line: { flex: 1, width: 2, minHeight: 18, borderRadius: 2 },
    dashed: { width: 0, borderLeftWidth: 2, borderStyle: 'dashed' },
    body: { flex: 1, gap: 3, paddingBottom: 14 },
    inline: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    title: { fontFamily: fonts.bold, fontSize: 15, color: c.text },
    depart: { fontFamily: fonts.semibold, fontSize: 14, color: c.text },
    meta: { fontFamily: fonts.medium, fontSize: 13, color: c.textMuted, fontVariant: ['tabular-nums'] },
    cars: { gap: 4, marginTop: 6 },
    carsTitle: { fontFamily: fonts.semibold, fontSize: 13, color: c.text },
    alert: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 },
    alertText: { flex: 1, fontFamily: fonts.medium, fontSize: 13, color: c.warning },
    dock: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 6, padding: 10, borderRadius: radius.md, backgroundColor: c.surfaceMuted },
    dockName: { fontFamily: fonts.semibold, fontSize: 14, color: c.text },
    unlock: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: c.brand, paddingHorizontal: 12, paddingVertical: 7, borderRadius: radius.pill },
    unlockText: { fontFamily: fonts.bold, fontSize: 13, color: c.onBrand },
    notice: { flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
  });
