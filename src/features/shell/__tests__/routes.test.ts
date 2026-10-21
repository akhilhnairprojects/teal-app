import {
  accountPath,
  activitiesPath,
  activityPath,
  friendInvitePath,
  friendsPath,
  inboxPath,
  leaderboardsPath,
  movePath,
  nicknamePath,
  parkPath,
  parseActivityParams,
  parseFriendInviteParams,
  parseLeaderboardsParams,
  parseParkParams,
  parseRecordParams,
  parseSignInParams,
  parseTerritoryParams,
  recordPath,
  signInPath,
  territoryPath,
  alertPath,
  goBack,
  goToTab,
  isTopLevelPath,
  parsePlanParams,
  parseStopFilter,
  parseTripParams,
  pathHref,
  planPath,
  stopFilterParams,
  stopPath,
  tripPath,
} from '../routes';

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: jest.fn(), canDismiss: jest.fn(), dismissAll: jest.fn() },
}));

const { router } = jest.requireMock('expo-router') as {
  router: Record<'push' | 'replace' | 'back' | 'canGoBack' | 'canDismiss' | 'dismissAll', jest.Mock>;
};

/** The query of an href as a plain object (order-independent). */
const queryOf = (h: unknown) => Object.fromEntries(new URLSearchParams(String(h).split('?')[1] ?? ''));

beforeEach(() => Object.values(router).forEach((m) => m.mockReset()));

describe('stop paths', () => {
  it('builds stop hrefs with and without a filter', () => {
    expect(stopPath('place-pktrm')).toBe('/stop/place-pktrm');
    expect(stopPath('place-pktrm', null)).toBe('/stop/place-pktrm');
    expect(stopPath('place-pktrm', { routeId: 'line-Green', directionId: 0 })).toBe('/stop/place-pktrm?routeId=line-Green&directionId=0');
    expect(stopPath('a/b c')).toBe('/stop/a%2Fb%20c');
  });

  it('round-trips the filter through the built path and through setParams values', () => {
    for (const f of [
      { routeId: 'Red', directionId: 0 as const },
      { routeId: 'line-Green', directionId: 1 as const },
    ]) {
      expect(parseStopFilter(queryOf(stopPath('place-pktrm', f)))).toEqual(f);
      expect(parseStopFilter(stopFilterParams(f))).toEqual(f);
    }
    expect(stopFilterParams(null)).toEqual({ routeId: undefined, directionId: undefined });
    expect(parseStopFilter(stopFilterParams(null))).toBeNull();
  });

  it('rejects partial or malformed params and takes the first of repeated ones', () => {
    expect(parseStopFilter({ routeId: 'Red' })).toBeNull();
    expect(parseStopFilter({ directionId: '0' })).toBeNull();
    expect(parseStopFilter({ routeId: 'Red', directionId: '2' })).toBeNull();
    expect(parseStopFilter({ routeId: '  ', directionId: '1' })).toBeNull();
    expect(parseStopFilter({ routeId: ['Orange', 'Red'], directionId: ['1', '0'] })).toEqual({ routeId: 'Orange', directionId: 1 });
  });
});

describe('trip paths', () => {
  it('carries the stop, stop sequence and vehicle, and round-trips them', () => {
    const h = tripPath('trip/1', { stopId: 'place-pktrm-0', stopSequence: 30, vehicleId: 'R 1' });
    expect(h).toBe('/trip/trip%2F1?stopId=place-pktrm-0&stopSequence=30&vehicleId=R%201');
    expect(parseTripParams({ tripId: 'trip/1', ...queryOf(h) })).toEqual({ tripId: 'trip/1', stopId: 'place-pktrm-0', stopSequence: 30, vehicleId: 'R 1' });
  });

  it('omits missing params; stop sequence 0 is kept', () => {
    expect(tripPath('t')).toBe('/trip/t');
    expect(tripPath('t', { stopId: null, stopSequence: null, vehicleId: null })).toBe('/trip/t');
    expect(tripPath('t', { stopSequence: 0 })).toBe('/trip/t?stopSequence=0');
  });

  it('parses only numeric stop sequences and requires a trip id', () => {
    expect(parseTripParams({ tripId: 't', stopSequence: 'x1' })).toEqual({ tripId: 't', stopId: null, stopSequence: null, vehicleId: null });
    expect(parseTripParams({ tripId: '' })).toBeNull();
    expect(parseTripParams({})).toBeNull();
  });
});

describe('alert and plan paths', () => {
  it('builds the alert path', () => {
    expect(alertPath('123 a')).toBe('/alert/123%20a');
  });

  it('builds plan links with a trimmed query and destination params, and parses them back', () => {
    expect(planPath()).toBe('/plan');
    expect(planPath({ q: ' Fenway Park ' })).toBe('/plan?q=Fenway%20Park');
    expect(planPath({ q: '   ' })).toBe('/plan');
    const h = planPath({ toName: 'Park Street', toLat: '42.35', toLon: '-71.06', toStopId: 'place-pktrm' });
    expect(parsePlanParams(queryOf(h))).toEqual({ q: undefined, toName: 'Park Street', toLat: '42.35', toLon: '-71.06', toStopId: 'place-pktrm' });
    expect(parsePlanParams({ q: ['a', 'b'] }).q).toBe('a');
  });

  it('knows the top-level pages', () => {
    expect(['/', '', '/plan', '/favorites', '/move'].every(isTopLevelPath)).toBe(true);
    expect(['/search', '/more', '/stop/x'].some(isTopLevelPath)).toBe(false);
  });
});

describe('navigation', () => {
  it('switches tabs with replace when nothing is pushed', () => {
    router.canDismiss.mockReturnValue(false);
    goToTab(planPath({ q: 'park' }));
    expect(router.dismissAll).not.toHaveBeenCalled();
    expect(router.replace).toHaveBeenCalledWith('/plan?q=park');
  });

  it('dismisses pushed pages before replacing, so tab pages never stack', () => {
    router.canDismiss.mockReturnValue(true);
    goToTab(pathHref('/plan'));
    expect(router.dismissAll).toHaveBeenCalledTimes(1);
    expect(router.dismissAll.mock.invocationCallOrder[0]).toBeLessThan(router.replace.mock.invocationCallOrder[0]);
    expect(router.replace).toHaveBeenCalledWith('/plan');
    expect(router.push).not.toHaveBeenCalled();
  });

  it('goes back, or to Nearby when there is no history', () => {
    router.canGoBack.mockReturnValue(true);
    goBack();
    expect(router.back).toHaveBeenCalledTimes(1);
    router.canGoBack.mockReturnValue(false);
    goBack();
    expect(router.replace).toHaveBeenCalledWith('/');
  });
});

describe('gamification routes (spec §3.2)', () => {
  /** Route params as expo-router would give them: the dynamic segment plus the query. */
  const paramsOf = (h: unknown, segment?: [string, string]) => ({ ...queryOf(h), ...(segment ? { [segment[0]]: segment[1] } : {}) });
  const lastSegment = (h: unknown) => decodeURIComponent(String(h).split('?')[0].split('/').pop()!);

  it('builds the static pages', () => {
    expect([movePath(), accountPath(), nicknamePath(), activitiesPath(), friendsPath(), inboxPath()]).toEqual([
      '/move',
      '/account',
      '/account/nickname',
      '/activities',
      '/friends',
      '/inbox',
    ]);
  });

  it('round-trips sign-in and drops unsafe next targets', () => {
    expect(signInPath()).toBe('/account/sign-in');
    const h = signInPath({ next: '/leaderboards?board=run_5k' });
    expect(parseSignInParams(paramsOf(h))).toEqual({ next: '/leaderboards?board=run_5k' });
    expect(signInPath({ next: 'https://evil.example' })).toBe('/account/sign-in');
    expect(parseSignInParams({ next: '//evil.example' })).toEqual({ next: null });
  });

  it('round-trips record, activity and park params', () => {
    const r = recordPath({ kind: 'bike' });
    expect(r).toBe('/record?kind=bike');
    expect(parseRecordParams(paramsOf(r))).toEqual({ kind: 'bike' });
    expect(parseRecordParams({ kind: 'walk' })).toEqual({ kind: null });
    const a = activityPath('local/1');
    expect(parseActivityParams({ activityId: lastSegment(a) })).toBe('local/1');
    const p = parkPath({ toName: 'Fenway Park', toLat: 42.3467, toLon: -71.0972 });
    expect(parseParkParams(paramsOf(p))).toEqual({ toName: 'Fenway Park', toLat: 42.3467, toLon: -71.0972 });
    expect(parseParkParams({ toLat: '42', toLon: 'x' })).toEqual({ toName: null, toLat: null, toLon: null });
    expect(parkPath()).toBe('/park');
  });

  it('round-trips leaderboard params', () => {
    const h = leaderboardsPath({ board: 'run_5k', period: 'month', scope: 'friends' });
    expect(parseLeaderboardsParams(paramsOf(h))).toEqual({ board: 'run_5k', period: 'month', scope: 'friends' });
    expect(parseLeaderboardsParams({ board: 'fastest', period: 'year', scope: 'group' })).toEqual({ board: null, period: null, scope: null });
    expect(leaderboardsPath()).toBe('/leaderboards');
  });

  it('round-trips invite codes and territory months', () => {
    expect(friendInvitePath('ABCDEFGH')).toBe('/friend/ABCDEFGH');
    expect(parseFriendInviteParams({ code: lastSegment(friendInvitePath('abcdefgh')) })).toBe('ABCDEFGH');
    expect(parseFriendInviteParams({ code: 'ABC' })).toBeNull();
    expect(parseTerritoryParams(paramsOf(territoryPath({ month: '2026-10-01' })))).toEqual({ month: '2026-10-01' });
    expect(parseTerritoryParams({ month: '2026-10-15' })).toEqual({ month: null });
    expect(territoryPath()).toBe('/territory');
  });
});
