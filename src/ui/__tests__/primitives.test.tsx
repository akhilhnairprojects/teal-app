import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Text } from 'react-native';

import { routeCardsForStopList } from '@/mbta/rules/routeCardData';
import { createBuilder } from '@/mbta/testing/builders';
import { redLine } from '@/mbta/testing/fixtures';

import { CarCrowdingDiagram, CrowdingBadge, DepartureText, EmptyState, RouteCardView, RoutePill, SheetPage, SheetScrollView, statusBannerText, StatusBanner } from '..';

// Icons load their font asynchronously; render them as plain placeholders in this smoke test.
jest.mock('@expo/vector-icons/Ionicons', () => {
  const { Text } = jest.requireActual('react-native');
  const Icon = () => <Text>{''}</Text>;
  return { __esModule: true, default: Object.assign(Icon, { glyphMap: {} }) };
});

const MIN = 60_000;

function textOf(r: ReactTestRenderer): string {
  return r.root
    .findAllByType(Text)
    .map((t) => (Array.isArray(t.props.children) ? t.props.children.join('') : String(t.props.children ?? '')))
    // Icon glyphs render as Text with private-use characters; keep readable text only.
    .filter((t) => /[A-Za-z0-9]/.test(t))
    .join(' | ');
}

const mounted: ReactTestRenderer[] = [];
function render(el: React.ReactElement): ReactTestRenderer {
  let r: ReactTestRenderer;
  act(() => {
    r = create(el);
  });
  mounted.push(r!);
  return r!;
}

afterEach(() => {
  act(() => mounted.splice(0).forEach((r) => r.unmount()));
});

describe('UI primitives (smoke)', () => {
  it('renders a Red Line route card from builder fixtures', () => {
    const b = createBuilder();
    const red = redLine(b);
    const now = Date.now();
    b.prediction({ trip: b.tripFor(red.ashmontSouth), stopId: red.jfk.south1.id, departureTime: now + 4 * MIN, arrivalTime: now + 4 * MIN });
    b.prediction({ trip: b.tripFor(red.braintreeSouth), stopId: red.jfk.south2.id, departureTime: now + 7 * MIN, arrivalTime: now + 7 * MIN });
    const g = b.global();
    const cards = routeCardsForStopList({
      stopIds: g.stops['place-jfk'].childStopIds,
      global: g,
      sortByDistanceFrom: null,
      schedules: { schedules: [], trips: {} },
      predictions: b.liveDepartures(),
      alerts: [],
      now,
      context: 'nearby',
    })!;
    expect(cards).toHaveLength(1);
    const onLeafPress = jest.fn();
    const r = render(<RouteCardView card={cards[0]} now={now} global={g} onLeafPress={onLeafPress} showStopHeaders />);
    const text = textOf(r);
    expect(text).toContain('Red Line');
    expect(text).toContain('JFK/UMass');
    expect(text).toContain('Ashmont');
    expect(text).toContain('Braintree');
    expect(text).toContain('4');
  });

  it('renders pills, departure text, crowding, banners and page chrome', () => {
    const b = createBuilder();
    const route = b.route({ id: 'Green-B', type: 0, shortName: 'B', color: '#00843D', textColor: '#FFFFFF' });
    expect(textOf(render(<RoutePill route={route} size="small" type="fixed" />))).toBe('B');
    expect(textOf(render(<DepartureText display={{ kind: 'minutes', minutes: 5, last: true }} />))).toContain('5');
    expect(textOf(render(<CrowdingBadge level={null} />))).toBe('Crowding not available');
    expect(textOf(render(<CrowdingBadge level="someCrowding" />))).toBe('Some crowding');
    const diagram = render(
      <CarCrowdingDiagram
        carriages={[
          { label: null, sequence: 1, occupancyStatus: 'FULL', occupancyPercentage: null },
          { label: null, sequence: 2, occupancyStatus: 'MANY_SEATS_AVAILABLE', occupancyPercentage: null },
        ]}
        recommendation={{ bestSequences: [2], carCount: 2, label: 'Board car 2 of 2', levels: ['crowded', 'notCrowded'], frontIsSequence1: true }}
      />,
    );
    expect(textOf(diagram)).toContain('Board car 2 of 2 · Car 1 = front');
    expect(textOf(render(<StatusBanner kind="stale" />))).toContain('may be out of date');
    expect(statusBannerText({ kind: 'rateLimited', resetAt: 10_000, hasApiKey: false }, 0)).toBe('Live times paused · retrying in 10s · add an API key for faster updates');
    expect(statusBannerText({ kind: 'fallbackLocation', placeName: 'Park Street', reason: 'Demo' }, 0)).toBe('Showing Park Street · Demo');
    expect(textOf(render(<EmptyState title="No rail nearby" message="Try Plan" />))).toContain('No rail nearby');
    const page = render(
      <SheetPage title="Park Street" onBack={() => {}}>
        <SheetScrollView>
          <Text>body</Text>
        </SheetScrollView>
      </SheetPage>,
    );
    expect(textOf(page)).toContain('Park Street');
    expect(textOf(page)).toContain('body');
  });
});
