import type { Href } from 'expo-router';

import { uuidv4 } from '@/lib/id';

import { clearActiveMode, getActiveModes, resetActiveModes, setActiveMode } from '../activeModes';
import { getActiveMapOverlay, resetMapOverlays, setMapOverlay } from '../mapOverlay';

jest.mock('expo-router', () => ({ useFocusEffect: jest.fn() }));

beforeEach(() => {
  resetActiveModes();
  resetMapOverlays();
});

describe('active modes', () => {
  it('adds, replaces and clears modes by id without churning on equal values', () => {
    const rec = { id: 'recording' as const, label: '● Recording · 1.00 mi', href: '/record?kind=run' as Href };
    setActiveMode(rec);
    const first = getActiveModes();
    setActiveMode({ ...rec });
    expect(getActiveModes()).toBe(first);
    setActiveMode({ ...rec, label: '● Recording · 1.10 mi' });
    setActiveMode({ id: 'parking', label: 'Parking → Main St', href: '/park' as Href });
    expect(getActiveModes().map((m) => m.label)).toEqual(['● Recording · 1.10 mi', 'Parking → Main St']);
    clearActiveMode('recording');
    expect(getActiveModes().map((m) => m.id)).toEqual(['parking']);
  });
});

describe('map overlay additions', () => {
  it('carries tracks, territory and followUser', () => {
    const overlay = {
      tracks: [{ id: 'live', coordinates: [{ latitude: 42.3, longitude: -71.1 }], color: '#0D9488' }],
      territory: { month: '2026-10-01', highlightUserId: null },
      followUser: true,
    };
    setMapOverlay('record', overlay);
    expect(getActiveMapOverlay()).toEqual(overlay);
  });
});

describe('uuidv4', () => {
  it('produces RFC 4122 version-4 ids', () => {
    const ids = new Set(Array.from({ length: 200 }, () => uuidv4()));
    expect(ids.size).toBe(200);
    for (const id of ids) expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(uuidv4(() => 0)).toBe('00000000-0000-4000-8000-000000000000');
  });
});
