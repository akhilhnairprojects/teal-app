import { decodePolyline, encodePolyline } from '../polyline';

describe('polyline', () => {
  it('decodes the Google reference example', () => {
    // Example from the encoded-polyline algorithm description.
    expect(decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@')).toEqual([
      { latitude: 38.5, longitude: -120.2 },
      { latitude: 40.7, longitude: -120.95 },
      { latitude: 43.252, longitude: -126.453 },
    ]);
  });

  it('round-trips Boston coordinates', () => {
    const points = [
      { latitude: 42.35639, longitude: -71.0624 },
      { latitude: 42.35552, longitude: -71.06023 },
      { latitude: 42.36128, longitude: -71.0716 },
    ];
    expect(decodePolyline(encodePolyline(points))).toEqual(points);
  });

  it('ignores a truncated trailing point', () => {
    const encoded = encodePolyline([
      { latitude: 1, longitude: 2 },
      { latitude: 3, longitude: 4 },
    ]);
    expect(decodePolyline(encoded.slice(0, -1))).toEqual([{ latitude: 1, longitude: 2 }]);
    expect(decodePolyline('')).toEqual([]);
  });
});
