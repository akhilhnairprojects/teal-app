/**
 * Ranking [spec WP3]: score = arrival + weather penalty (bike legs only) + 1 min per transfer.
 * Bad weather pushes bike options down but never removes them.
 */
import { MAX_ITINERARIES, TRANSFER_SCORE_MIN, WEATHER_PENALTY_MIN } from './constants';
import type { Itinerary, ItineraryKind, PlanNotice, WeatherSnapshot } from './types';

const MIN = 60_000;

export const hasBikeLeg = (i: Itinerary): boolean => i.legs.some((l) => l.mode === 'bike');
const hasTransit = (i: Itinerary): boolean => i.legs.some((l) => l.mode === 'transit');

export function weatherPenaltyMin(i: Itinerary, w: WeatherSnapshot | null): number {
  if (!w || !hasBikeLeg(i) || w.bikeAdvisory === 'ok') return 0;
  return WEATHER_PENALTY_MIN[w.bikeAdvisory];
}

export function scoreOf(i: Itinerary, w: WeatherSnapshot | null): number {
  return i.arriveTime + weatherPenaltyMin(i, w) * MIN + i.transfers * TRANSFER_SCORE_MIN * MIN;
}

/** Same mode sequence, trips and docks: only the better one is kept. */
function signature(i: Itinerary): string {
  return [
    i.kind,
    ...i.legs.map((l) => (l.mode === 'transit' ? `t:${l.tripId ?? `${l.fromStopId}-${l.toStopId}`}` : l.mode === 'bike' ? `b:${l.fromDock.stationId}-${l.toDock.stationId}` : '')),
  ].join('|');
}

function withWeather(i: Itinerary, w: WeatherSnapshot | null): Itinerary {
  if (!w || !hasBikeLeg(i) || w.bikeAdvisory === 'ok') return i;
  const reason = w.reason ?? w.shortForecast;
  const notice: PlanNotice =
    w.bikeAdvisory === 'avoid'
      ? { kind: 'weather', severity: 'warning', text: `Biking not recommended: ${reason}.` }
      : { kind: 'weather', severity: 'info', text: `${reason}: ride with care.` };
  const tags = w.bikeAdvisory === 'avoid' && !i.tags.includes('weatherRisk') ? [...i.tags, 'weatherRisk' as const] : i.tags;
  return { ...i, tags, notices: [...i.notices, notice] };
}

/**
 * Score, dedupe, keep the best of each kind (so walking and biking always stay visible), fill up
 * to `MAX_ITINERARIES` by score, and tag fastest / least walking / no transfers.
 */
export function rankItineraries(itineraries: Itinerary[], w: WeatherSnapshot | null): Itinerary[] {
  const scored = itineraries
    .map((i) => withWeather(i, w))
    .map((i) => ({ ...i, score: scoreOf(i, w) }))
    .sort((a, b) => a.score - b.score || a.arriveTime - b.arriveTime || a.walkMeters - b.walkMeters || a.id.localeCompare(b.id));

  const unique: Itinerary[] = [];
  const seen = new Set<string>();
  for (const i of scored) {
    const sig = signature(i);
    if (seen.has(sig)) continue;
    seen.add(sig);
    unique.push(i);
  }

  const keep = new Set<Itinerary>();
  const kindsSeen = new Set<ItineraryKind>();
  for (const i of unique) {
    if (!kindsSeen.has(i.kind)) {
      kindsSeen.add(i.kind);
      keep.add(i);
    }
  }
  for (const i of unique) if (keep.size < MAX_ITINERARIES) keep.add(i);
  const ranked = unique.filter((i) => keep.has(i)).map((i) => ({ ...i, tags: i.tags.filter((t) => t !== 'fastest' && t !== 'leastWalking' && t !== 'noTransfers') }));
  if (ranked.length === 0) return ranked;

  const tag = (i: Itinerary, t: Itinerary['tags'][number]) => {
    if (!i.tags.includes(t)) i.tags.push(t);
  };
  const fastest = ranked.reduce((best, i) => (i.arriveTime < best.arriveTime ? i : best));
  tag(fastest, 'fastest');
  if (ranked.length > 1) {
    const leastWalking = ranked.reduce((best, i) => (i.walkMeters < best.walkMeters ? i : best));
    tag(leastWalking, 'leastWalking');
  }
  if (ranked.some((i) => i.transfers > 0)) for (const i of ranked) if (hasTransit(i) && i.transfers === 0) tag(i, 'noTransfers');
  return ranked;
}
