// Logic ported from mbta/mobile_app shared/src/commonMain/kotlin/com/mbta/tid/mbta_app/model/LeafFormat.kt @8c49ac5 (MIT). See THIRD_PARTY_NOTICES.md.
import type { Route } from '@/mbta/model/types';

import type { NoTripsFormat, UpcomingFormat, WarningAlert } from './upcomingFormat';

/**
 * A route-card leaf ready to display. `single`: one destination in this direction (`route` is set
 * only for grouped lines). `branched`: one row per upcoming trip/disruption across branches.
 */
export type LeafFormat =
  | { kind: 'single'; route: Route | null; headsign: string | null; format: UpcomingFormat }
  | {
      kind: 'branched';
      rows: { id: string; route: Route | null; headsign: string; format: UpcomingFormat }[];
      secondaryAlert: WarningAlert | null;
    };

/** Regular service shows up to 2 departures per leaf; branching non-bus service up to 3 rows. */
export const TYPICAL_LEAF_ROWS = 2,
  BRANCHING_LEAF_ROWS = 3;

export const isAllServiceDisrupted = (f: LeafFormat): boolean => f.kind === 'single' && f.format.kind === 'disruption';

/** The no-trips reason when nothing is shown, or null if any row has trips. */
export function noPredictionsStatus(f: LeafFormat): NoTripsFormat | null {
  if (f.kind === 'single') return f.format.kind === 'noTrips' ? f.format.noTrips : null;
  let result: NoTripsFormat | null = null;
  for (const row of f.rows) {
    if (row.format.kind === 'some') return null;
    if (row.format.kind === 'noTrips' && result === null) result = row.format.noTrips;
  }
  return result;
}
