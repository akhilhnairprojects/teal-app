// Logic ported from mbta/mobile_app shared/src/commonMain/kotlin/com/mbta/tid/mbta_app/model/UpcomingFormat.kt @8c49ac5 (MIT). See THIRD_PARTY_NOTICES.md.
import type { Alert, RouteType } from '@/mbta/model/types';
import { easternParts } from '@/mbta/time/eastern';

import type { TripInstantDisplay } from './tripInstantDisplay';
import { isCancelled, upcomingTime, type UpcomingTrip } from './upcomingTrip';

export type WarningAlert = { iconName: string; alertId: string };

export type FormattedTrip = {
  id: string;
  trip: UpcomingTrip;
  routeType: RouteType;
  format: TripInstantDisplay;
  lastTrip: boolean;
  alert: Alert | null;
};

export type NoTripsFormat =
  | { kind: 'subwayEarlyMorning'; scheduledTime: number }
  | { kind: 'noSchedulesToday' }
  | { kind: 'serviceEndedToday' }
  | { kind: 'predictionsUnavailable' };

export type UpcomingFormat =
  | { kind: 'loading' }
  | { kind: 'some'; trips: FormattedTrip[]; secondaryAlert: WarningAlert | null }
  | { kind: 'noTrips'; noTrips: NoTripsFormat; secondaryAlert: WarningAlert | null }
  | { kind: 'disruption'; alert: Alert; iconName: string };

/**
 * Why a leaf shows no trips: before the first subway train (after 03:30), no schedules today,
 * future trips we can't show (subway without predictions), or service ended.
 */
export function noTripsFormatFrom(
  upcomingTrips: UpcomingTrip[],
  hasSchedulesToday: boolean,
  now: number,
  subwayServiceStartTime: number | null,
): NoTripsFormat {
  const hasUpcomingTrips = upcomingTrips.some((t) => {
    const time = upcomingTime(t);
    return time !== null && time > now && !isCancelled(t);
  });
  const { h, mi } = easternParts(now);
  const afterThreeThirty = h * 60 + mi >= 3 * 60 + 30;
  if (subwayServiceStartTime !== null && afterThreeThirty && now <= subwayServiceStartTime) {
    return { kind: 'subwayEarlyMorning', scheduledTime: subwayServiceStartTime };
  }
  if (!hasSchedulesToday) return { kind: 'noSchedulesToday' };
  if (hasUpcomingTrips) return { kind: 'predictionsUnavailable' };
  return { kind: 'serviceEndedToday' };
}

/** User-facing text for a no-trips state. */
export function noTripsText(n: NoTripsFormat, formatClock: (ms: number) => string): string {
  switch (n.kind) {
    case 'subwayEarlyMorning':
      return `First ${formatClock(n.scheduledTime)}`;
    case 'noSchedulesToday':
      return 'No service today';
    case 'predictionsUnavailable':
      return 'Predictions unavailable';
    case 'serviceEndedToday':
      return 'Service ended';
  }
}
