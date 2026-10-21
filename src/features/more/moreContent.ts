/**
 * Text for the More page: data attributions, licenses, links and API-key status (spec §5).
 * Kept as data so the required attribution lines are unit-tested.
 */
import { PROJECT_URL } from '@/mbta/api/config';

export type MoreLink = { label: string; url: string };
export type Attribution = { id: string; title: string; body: string; link?: MoreLink };

export const NON_ENDORSEMENT = 'Transit data: MBTA/MassDOT. Not affiliated with or endorsed by the MBTA.';

export const ATTRIBUTIONS: readonly Attribution[] = [
  {
    id: 'mbta',
    title: 'Transit data',
    body: `${NON_ENDORSEMENT} Live times, schedules and alerts come from the MBTA V3 API, used under the MassDOT Developers License Agreement.`,
    link: { label: 'MBTA developer portal', url: 'https://www.mbta.com/developers' },
  },
  {
    id: 'bluebikes',
    title: 'Bike availability',
    body: 'Bluebikes system data (GBFS), provided by Lyft Bikes and Scooters, LLC under the Bluebikes Data License Agreement. Teal is not affiliated with, approved or endorsed by Bluebikes or its municipalities.',
    link: { label: 'Bluebikes data license', url: 'https://bluebikes.com/data-license-agreement' },
  },
  {
    id: 'nws',
    title: 'Weather',
    body: 'Weather: National Weather Service (api.weather.gov).',
    link: { label: 'weather.gov', url: 'https://www.weather.gov' },
  },
  {
    id: 'osm',
    title: 'Place search',
    body: 'Geocoding © OpenStreetMap contributors (Photon / Nominatim).',
    link: { label: 'OpenStreetMap copyright', url: 'https://www.openstreetmap.org/copyright' },
  },
  {
    id: 'maps',
    title: 'Map',
    body: 'Apple Maps shows its own legal notice on the map.',
  },
];

export const MBTA_GO_NOTICE = {
  title: 'MBTA Go (mbta/mobile_app)',
  summary:
    'Teal’s departure, route-card, direction, alert and crowding rules are ported to TypeScript from MBTA Go’s open-source shared module (commit 8c49ac5), under the MIT License.',
  link: { label: 'github.com/mbta/mobile_app', url: 'https://github.com/mbta/mobile_app' } as MoreLink,
  license: `MIT License

Copyright (c) 2023 Massachusetts Bay Transportation Authority

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.`,
};

export const LINKS: readonly MoreLink[] = [
  { label: 'About Teal', url: PROJECT_URL },
  { label: 'Get an MBTA API key', url: 'https://api-v3.mbta.com/' },
];

export const INDEPENDENCE_LINE =
  'Teal is an independent project and is not affiliated with the MBTA, MassDOT or Bluebikes. Unlock and pay in the Bluebikes app.';

/** "Live updates" status line for the API-key state. */
export function keyStatus(hasApiKey: boolean, refreshMs: number): { label: string; detail: string } {
  const every = `Times refresh every ${Math.round(refreshMs / 1000)} seconds.`;
  return hasApiKey
    ? { label: 'Live updates: standard', detail: `Using an MBTA API key. ${every}` }
    : {
        label: 'Live updates: limited (no API key)',
        detail: `Without a key the MBTA allows 20 requests a minute. ${every} Add EXPO_PUBLIC_MBTA_API_KEY to .env for faster updates.`,
      };
}
