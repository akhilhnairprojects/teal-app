import { nearestBikeStations, type StationInformation, type StationStatus } from '../bluebikes';

const origin = { latitude: 42.3564, longitude: -71.0624 };

const info: StationInformation = {
  data: {
    stations: [
      { station_id: 'far', name: 'Far Station', lat: 42.38, lon: -71.1, capacity: 15 },
      {
        station_id: 'near',
        name: ' Tremont St at West St ',
        lat: 42.3555,
        lon: -71.0625,
        capacity: 19,
        rental_uris: { ios: 'https://bos.lft.to/lastmile_qr_scan' },
      },
      { station_id: 'removed', name: 'Removed', lat: 42.3564, lon: -71.0624, capacity: 10 },
      { station_id: 'no-status', name: 'No Status', lat: 42.3564, lon: -71.0624, capacity: 10 },
    ],
  },
};

const status = (id: string, bikes: number, ebikes: number, docks: number, installed = 1, renting = 1) => ({
  station_id: id,
  num_bikes_available: bikes,
  num_ebikes_available: ebikes,
  num_docks_available: docks,
  is_installed: installed,
  is_renting: renting,
  is_returning: 1,
  last_reported: 1_792_367_637,
});

const statusFeed: StationStatus = {
  last_updated: 1_792_367_700,
  data: {
    stations: [status('far', 3, 0, 12), status('near', 11, 5, 0, 1, 0), status('removed', 0, 0, 0, 0, 0)],
  },
};

describe('nearestBikeStations', () => {
  const stations = nearestBikeStations(info, statusFeed, origin, 5);

  it('joins info with live status, nearest first, skipping uninstalled or unknown stations', () => {
    expect(stations.map((s) => s.id)).toEqual(['near', 'far']);
  });

  it('splits classic bikes from e-bikes and reports docks', () => {
    expect(stations[0]).toMatchObject({
      name: 'Tremont St at West St',
      classicBikes: 6,
      ebikes: 5,
      openDocks: 0,
      isRenting: false,
      rentalUrl: 'https://bos.lft.to/lastmile_qr_scan',
      reportedAt: 1_792_367_637_000,
    });
  });

  it('respects the limit', () => {
    expect(nearestBikeStations(info, statusFeed, origin, 1)).toHaveLength(1);
  });
});
