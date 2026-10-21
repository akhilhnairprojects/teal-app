/**
 * Cycling handoff to the system maps app (spec G1). Teal does not do turn-by-turn; Apple Maps does.
 * The unified `maps.apple.com/directions` URL with `mode=cycling` is tried first [ext, unverified on
 * device]; the legacy `daddr` URL (walking) is the fallback. Android, which Teal does not target,
 * gets Google Maps' public directions URL so the button still does something sensible.
 */
import * as Linking from 'expo-linking';
import { Platform } from 'react-native';

import type { LatLng } from '@/lib/geo';

const coord = (p: LatLng) => `${p.latitude.toFixed(6)},${p.longitude.toFixed(6)}`;

export function appleMapsCyclingUrl(to: LatLng): string {
  return `https://maps.apple.com/directions?destination=${coord(to)}&mode=cycling`;
}

export function appleMapsLegacyUrl(to: LatLng): string {
  return `http://maps.apple.com/?daddr=${coord(to)}&dirflg=w`;
}

export function googleMapsCyclingUrl(to: LatLng): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${coord(to)}&travelmode=bicycling`;
}

/** Button label for the handoff on this platform. */
export const MAPS_HANDOFF_LABEL = Platform.OS === 'ios' ? 'Open in Apple Maps' : 'Open in Maps';

async function tryOpen(url: string): Promise<boolean> {
  try {
    if (!(await Linking.canOpenURL(url))) return false;
    await Linking.openURL(url);
    return true;
  } catch {
    return false;
  }
}

/** Open cycling directions to `to`. Resolves false when no URL could be opened. */
export async function openCyclingDirections(to: LatLng): Promise<boolean> {
  const urls = Platform.OS === 'ios' ? [appleMapsCyclingUrl(to), appleMapsLegacyUrl(to)] : [googleMapsCyclingUrl(to)];
  for (const url of urls) if (await tryOpen(url)) return true;
  return false;
}
