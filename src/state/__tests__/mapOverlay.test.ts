import { clearMapOverlay, getActiveMapOverlay, resetMapOverlays, setMapOverlay } from '../mapOverlay';
import { requestSheetDetent } from '../sheet';

beforeEach(() => resetMapOverlays());

describe('map overlay store', () => {
  it('shows the most recently set owner and falls back on clear', () => {
    setMapOverlay('stop', { routeIds: ['Red'], directionId: 0, showVehicles: true });
    setMapOverlay('plan', { itinerary: { legs: [], markers: [] } });
    expect(getActiveMapOverlay()).toEqual({ itinerary: { legs: [], markers: [] } });
    clearMapOverlay('plan');
    expect(getActiveMapOverlay()).toEqual({ routeIds: ['Red'], directionId: 0, showVehicles: true });
    clearMapOverlay('stop');
    expect(getActiveMapOverlay()).toBeNull();
  });

  it('keeps identity when the same owner re-sets an equal overlay', () => {
    setMapOverlay('stop', { routeIds: ['Red'] });
    const first = getActiveMapOverlay();
    setMapOverlay('stop', { routeIds: ['Red'] });
    expect(getActiveMapOverlay()).toBe(first);
  });

  it('sheet detent requests are fire-and-forget without listeners', () => {
    expect(() => requestSheetDetent('half')).not.toThrow();
  });
});
