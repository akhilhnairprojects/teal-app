/**
 * Supabase project configuration from `.env`. Expo inlines these literals at build time, so they must
 * be read exactly as `process.env.EXPO_PUBLIC_SUPABASE_URL` / `_PUBLISHABLE_KEY`. The publishable key is
 * meant to ship in the app; row-level security and RPC checks protect the data. Never log either value.
 */
import { Platform } from 'react-native';

const RAW_URL = process.env.EXPO_PUBLIC_SUPABASE_URL;
const RAW_KEY = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

export const SUPABASE_URL: string = RAW_URL?.trim() ?? '';
export const SUPABASE_PUBLISHABLE_KEY: string = RAW_KEY?.trim() ?? '';

/** Accounts and sync run only when both values are present, and never on web (decision O7). */
export const BACKEND_CONFIGURED: boolean = SUPABASE_URL !== '' && SUPABASE_PUBLISHABLE_KEY !== '' && Platform.OS !== 'web';
