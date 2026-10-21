import { ATTRIBUTIONS, INDEPENDENCE_LINE, keyStatus, MBTA_GO_NOTICE, NON_ENDORSEMENT } from '../moreContent';

describe('More page content', () => {
  it('credits every data source with the non-endorsement line', () => {
    const text = ATTRIBUTIONS.map((a) => a.body).join('\n');
    expect(NON_ENDORSEMENT).toBe('Transit data: MBTA/MassDOT. Not affiliated with or endorsed by the MBTA.');
    expect(text).toContain(NON_ENDORSEMENT);
    expect(text).toContain('Bluebikes');
    expect(text).toContain('Weather: National Weather Service');
    expect(text).toContain('Geocoding © OpenStreetMap contributors (Photon / Nominatim)');
    expect(INDEPENDENCE_LINE).toMatch(/not affiliated with the MBTA/);
  });

  it('carries the MBTA Go MIT notice', () => {
    expect(MBTA_GO_NOTICE.license).toContain('Copyright (c) 2023 Massachusetts Bay Transportation Authority');
    expect(MBTA_GO_NOTICE.license).toContain('Permission is hereby granted');
    expect(MBTA_GO_NOTICE.summary).toContain('8c49ac5');
  });

  it('describes the API key state', () => {
    expect(keyStatus(true, 10_000).label).toBe('Live updates: standard');
    expect(keyStatus(false, 30_000)).toEqual({
      label: 'Live updates: limited (no API key)',
      detail: expect.stringContaining('every 30 seconds'),
    });
  });
});
