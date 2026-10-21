/** MBTA V3 API configuration. */

export const MBTA_BASE_URL = 'https://api-v3.mbta.com';

/**
 * Optional key from `.env` (`EXPO_PUBLIC_MBTA_API_KEY=`). Expo inlines this literal at build time,
 * so it must be read exactly as `process.env.EXPO_PUBLIC_MBTA_API_KEY`. It ships in the bundle and
 * is not a secret; lock it to allowed domains in the MBTA portal for the web build.
 */
const RAW_KEY = process.env.EXPO_PUBLIC_MBTA_API_KEY;
export const MBTA_API_KEY: string | null = RAW_KEY && RAW_KEY.trim() ? RAW_KEY.trim() : null;

/** Rate-limit window and default limits [AR §2]: 20/min per IP without a key, 1000/min with one. */
export const RATE_WINDOW_MS = 60_000;
export const KEYLESS_LIMIT = 20;
export const KEYED_LIMIT = 1000;
/** Below this many remaining requests only foreground work runs until the window resets. */
export const RESERVE_REQUESTS = 3;
/** Max concurrent MBTA requests. */
export const MAX_CONCURRENT = 4;

/** Teal's global data is scoped to light and heavy rail (decision 7.1). */
export const RAIL_ROUTE_TYPES = [0, 1] as const;

/** Public project page, used wherever a contact/identifying URL is required (never an email). */
export const PROJECT_URL = 'https://teal-demo-three.vercel.app';
