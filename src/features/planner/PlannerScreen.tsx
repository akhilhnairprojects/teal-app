import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Keyboard, Pressable, StyleSheet, Text, View } from 'react-native';

import { useUserLocation } from '@/features/map/mapCenter';
import { alertPath, type PlanParams } from '@/features/shell/routes';
import { resolveTypedPlace, stationPlaces, useGeocodeSuggestions } from '@/geocode';
import { isInBostonArea } from '@/lib/geo';
import { HAS_API_KEY, useRateLimitState } from '@/mbta/api/client';
import { useGlobalData, useRailShapes } from '@/mbta/global/globalData';
import { useNow } from '@/mbta/live/usePolling';
import { OUTSIDE_AREA_TEXT } from '@/planner/engine';
import { itineraryOverlay, plannerMapOverlay } from '@/planner/geometry';
import type { Place } from '@/planner/types';
import { useMapOverlay } from '@/state/mapOverlay';
import { requestSheetDetent } from '@/state/sheet';
import { fonts, radius, sheet, usePalette, type Palette } from '@/theme';
import { EmptyState, SheetPage, SheetScrollView, StatusBanner } from '@/ui';

import { ItineraryCard } from './ItineraryCard';
import { ItineraryDetail } from './ItineraryDetail';
import { PlaceFields, type PlaceField } from './PlaceFields';
import { NoticeList, WeatherRow } from './PlanStatus';
import { Suggestions } from './Suggestions';
import { usePlan, type PlanPlaces } from './usePlan';

const openAlert = (id: string) => router.push(alertPath(id));

/** A destination from route params: coordinates win, else a station id (once global data is loaded). */
function placeFromParams(p: PlanParams, stationLookup: (id: string) => Place | null): Place | null {
  const lat = Number(p.toLat);
  const lon = Number(p.toLon);
  if (p.toLat && p.toLon && Number.isFinite(lat) && Number.isFinite(lon)) {
    return { name: p.toName || 'Dropped pin', latLng: { latitude: lat, longitude: lon }, source: p.toStopId ? 'station' : 'map', stopId: p.toStopId };
  }
  return p.toStopId ? stationLookup(p.toStopId) : null;
}

/**
 * "T or bike?": pick a destination (and optionally a start), then compare the T, a Bluebike,
 * bike + T and walking right now, with live predictions, alerts, weather and dock availability.
 * The default start is the shell's user location (shared with Nearby and the map), so the demo
 * link and the Park Street fallback give the same origin everywhere.
 */
export function PlannerScreen({ params }: { params: PlanParams }) {
  const c = usePalette();
  const s = styles(c);
  const global = useGlobalData();
  const g = global.data;
  const shapes = useRailShapes();
  const location = useUserLocation();
  const rate = useRateLimitState();
  const now = useNow(15_000);

  const stationLookup = (id: string): Place | null => {
    const stop = g?.stops[id];
    if (!stop) return null;
    return stationPlaces(g, stop.name, 8).find((p) => p.stopId === id) ?? { name: stop.name, latLng: { latitude: stop.latitude, longitude: stop.longitude }, source: 'station', stopId: id };
  };

  const [origin, setOrigin] = useState<Place | null>(null); // null = current location
  const [chosenDestination, setDestination] = useState<Place | null>(() => placeFromParams(params, () => null));
  // A station id in the link resolves once station data has loaded.
  const destination = chosenDestination ?? (params.toStopId ? placeFromParams(params, stationLookup) : null);
  const [editing, setEditing] = useState<PlaceField | null>(() => (chosenDestination || params.toStopId ? null : 'destination'));
  const [text, setText] = useState(params.q ?? '');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [resolving, setResolving] = useState(false);

  const current: Place | null =
    location.status === 'ready'
      ? {
          name: location.source === 'device' ? 'Current location' : 'Park Street',
          latLng: location.coords,
          source: 'current',
          subtitle: location.source === 'device' ? undefined : location.reason,
        }
      : null;
  const start = origin ?? current;
  const bias = start?.latLng ?? null;
  const suggestions = useGeocodeSuggestions(editing ? text : '', g, bias);

  const request = useMemo<PlanPlaces | null>(
    () => (start && destination ? { origin: start, destination } : null),
    // Re-plan only when the places change, not on every location re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [start?.latLng.latitude, start?.latLng.longitude, start?.name, destination?.name, destination?.latLng.latitude, destination?.latLng.longitude],
  );
  // Keeps planning while a field is edited, so cancelling an edit does not start over.
  const plan = usePlan(request);
  const result = plan.data;
  const selected = result?.itineraries.find((i) => i.id === selectedId) ?? null;
  const shown = selected ?? result?.itineraries[0] ?? null;

  const overlay = useMemo(
    () =>
      shown && g && request
        ? plannerMapOverlay(
            itineraryOverlay(shown, g, shapes, { walk: c.textMuted, bike: c.brand }, {
              origin: request.origin.latLng,
              destination: request.destination.latLng,
              originName: request.origin.name,
              destinationName: request.destination.name,
            }),
          )
        : null,
    [shown, g, shapes, request, c.textMuted, c.brand],
  );
  useMapOverlay('planner', overlay);

  const choose = (p: Place) => {
    if (!isInBostonArea(p.latLng)) {
      setMessage(OUTSIDE_AREA_TEXT);
      return;
    }
    setMessage(null);
    if (editing === 'origin') setOrigin(p.source === 'current' ? null : p);
    else setDestination(p);
    setEditing(null);
    setSelectedId(null);
    Keyboard.dismiss();
  };

  const submit = async () => {
    if (!text.trim()) return;
    setResolving(true);
    try {
      const p = await resolveTypedPlace(text, g, { bias, suggestions });
      if (p) choose(p);
      else setMessage(`Couldn’t find “${text.trim()}”. Try a station name or a street address.`);
    } finally {
      setResolving(false);
    }
  };

  const edit = (field: PlaceField) => {
    setEditing(field);
    setMessage(null);
    const place = field === 'origin' ? origin : destination;
    setText(place && place.source !== 'current' ? place.name : '');
  };

  const swap = () => {
    if (!start || !destination) return;
    setOrigin(destination);
    setDestination(start);
    setSelectedId(null);
  };

  const select = (id: string) => {
    setSelectedId(id === selectedId ? null : id);
    requestSheetDetent('half');
  };

  return (
    <SheetPage>
      <SheetScrollView contentContainerStyle={s.content}>
        <PlaceFields
          origin={start}
          destination={destination}
          editing={editing}
          text={text}
          onEdit={edit}
          onChangeText={setText}
          onSubmit={() => void submit()}
          onCancel={() => {
            setEditing(null);
            setMessage(null);
            Keyboard.dismiss();
          }}
          onSwap={swap}
        />
        {message ? (
          <View style={s.message}>
            <Ionicons name="alert-circle" size={15} color={c.warning} />
            <Text style={s.messageText}>{message}</Text>
          </View>
        ) : null}

        {editing ? (
          <>
            <Suggestions
              data={suggestions}
              query={text}
              current={editing === 'origin' && current ? current : null}
              onPick={choose}
              onSubmit={() => void submit()}
            />
            {resolving ? <ActivityIndicator color={c.brand} /> : null}
          </>
        ) : !destination ? (
          <EmptyState icon="navigate-outline" title="Where to?" message="Compare the T, Bluebikes and walking, with live times, alerts and weather." />
        ) : !plan.ready || (!result && !plan.error) ? (
          <View style={s.loading}>
            <ActivityIndicator color={c.brand} />
            <Text style={s.muted}>Comparing the T, Bluebikes and walking…</Text>
          </View>
        ) : !result ? (
          <EmptyState icon="cloud-offline-outline" title="Couldn’t plan this trip" message="Check your connection and try again." action={{ label: 'Try again', onPress: () => void plan.refresh() }} />
        ) : (
          <>
            {rate.limited ? <StatusBanner kind="rateLimited" resetAt={rate.resetAt} hasApiKey={HAS_API_KEY} /> : plan.stale ? <StatusBanner kind="stale" onRetry={() => void plan.refresh()} /> : null}
            {result.weather ? <WeatherRow weather={result.weather} /> : null}
            <NoticeList notices={result.notices} onAlertPress={openAlert} />
            {selected ? (
              <>
                <Pressable onPress={() => setSelectedId(null)} accessibilityRole="button" style={s.back}>
                  <Ionicons name="chevron-back" size={16} color={c.brand} />
                  <Text style={[s.muted, { color: c.brand }]}>All options</Text>
                </Pressable>
                <ItineraryCard itinerary={selected} global={g} now={now} selected onPress={() => setSelectedId(null)} />
                <ItineraryDetail itinerary={selected} global={g} now={now} destinationName={result.request.destination.name} onAlertPress={openAlert} />
              </>
            ) : (
              result.itineraries.map((i) => <ItineraryCard key={i.id} itinerary={i} global={g} now={now} selected={false} onPress={() => select(i.id)} />)
            )}
            <View style={s.footer}>
              <Text style={s.small}>
                {plan.refreshing ? 'Updating…' : `Updated ${Math.max(0, Math.round((now - result.generatedAt) / 60_000))} min ago`}
              </Text>
              <Text style={s.small}>Bluebikes unlock and payment happen in the Bluebikes app.</Text>
              <Text style={s.small}>Weather: National Weather Service. Times are estimates; check station signs.</Text>
            </View>
          </>
        )}
      </SheetScrollView>
    </SheetPage>
  );
}

const styles = (c: Palette) =>
  StyleSheet.create({
    content: { paddingHorizontal: sheet.horizontalPadding, paddingTop: 4, paddingBottom: 48, gap: 10 },
    message: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 4 },
    messageText: { flex: 1, fontFamily: fonts.medium, fontSize: 13, color: c.warning },
    loading: { alignItems: 'center', gap: 8, paddingVertical: 24 },
    muted: { fontFamily: fonts.medium, fontSize: 14, color: c.textMuted },
    back: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', paddingVertical: 4, borderRadius: radius.pill },
    footer: { gap: 2, paddingTop: 6 },
    small: { fontFamily: fonts.medium, fontSize: 11, color: c.textMuted },
  });
