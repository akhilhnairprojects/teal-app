// Logic ported from mbta/mobile_app shared/src/commonMain/kotlin/com/mbta/tid/mbta_app/model/RoutePillSpec.kt @8c49ac5 (MIT). See THIRD_PARTY_NOTICES.md.
// Kotlin's Width.Circle (Green branches) is expressed here as shape 'circle'.
import type { Line, Route } from '@/mbta/model/types';

import { isShuttleRoute, type LineOrRoute } from './lineOrRoute';

export type RoutePillSpec = {
  text: string | null;
  icon: 'bus' | 'ferry' | null;
  shape: 'rectangle' | 'capsule' | 'circle';
  width: 'fixed' | 'flex';
  color: string;
  textColor: string;
};

type PillType = 'fixed' | 'flex';
type Content = { text: string | null; icon: 'bus' | 'ferry' | null };

const text = (t: string): Content => ({ text: t, icon: null });
const icon = (i: 'bus' | 'ferry'): Content => ({ text: null, icon: i });

function lineContent(line: Line): Content {
  return line.id === 'line-Green' ? text('GL') : text(line.longName);
}

function routeContent(route: Route, type: PillType, context: 'searchStation' | 'default'): Content {
  switch (route.type) {
    case 0:
      if (route.id.startsWith('Green-')) return text(route.shortName);
      if (route.id === 'Mattapan') return text('M');
      return text(route.longName);
    case 1:
      // Initials of the long name: "Red Line" -> "RL".
      return text(
        route.longName
          .split(' ')
          .filter(Boolean)
          .map((w) => w[0])
          .join(''),
      );
    case 2:
      return type === 'fixed' ? text('CR') : text(route.longName.replace(/ Line$/, ''));
    case 3:
      return (isShuttleRoute(route) && type !== 'flex') || context === 'searchStation' ? icon('bus') : text(route.shortName);
    case 4:
      return type === 'fixed' ? icon('ferry') : text(route.longName);
  }
}

function isRoute(x: LineOrRoute | Route): x is Route {
  return !('kind' in x);
}

/** How to draw a route or line pill. Colors are '#RRGGBB' from the API. */
export function routePillSpec(lr: LineOrRoute | Route, o: { type: PillType; context?: 'searchStation' | 'default' }): RoutePillSpec {
  const context = o.context ?? 'default';
  const route = isRoute(lr) ? lr : lr.kind === 'route' ? lr.route : null;
  const line = !isRoute(lr) && lr.kind === 'line' ? lr.line : null;
  const content: Content = route ? routeContent(route, o.type, context) : line ? lineContent(line) : { text: null, icon: null };
  const shape: RoutePillSpec['shape'] = route?.id.startsWith('Green-')
    ? 'circle'
    : route?.type === 3 && !isShuttleRoute(route)
      ? 'rectangle'
      : 'capsule';
  return {
    ...content,
    shape,
    width: o.type,
    color: route?.color ?? line?.color ?? '#000000',
    textColor: route?.textColor ?? line?.textColor ?? '#FFFFFF',
  };
}
