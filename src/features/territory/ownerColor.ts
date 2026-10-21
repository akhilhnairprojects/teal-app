import { OWNER_COLORS } from '@/territory/api';

/** Territory fill opacity (spec G4: 35 %). */
export const TERRITORY_FILL_ALPHA = 0.35;

function hash(s: string): number {
  let h = 0;
  for (let k = 0; k < s.length; k++) h = (h * 31 + s.charCodeAt(k)) | 0;
  return Math.abs(h);
}

/**
 * The owner's color: `OWNER_COLORS[color]`, or, for a color outside 0–11 (none set), a stable pick
 * from the owner id so neighbours still differ.
 */
export function ownerColor(color: number | null | undefined, ownerId: string): string {
  if (typeof color === 'number' && Number.isInteger(color) && color >= 0 && color < OWNER_COLORS.length) return OWNER_COLORS[color];
  return OWNER_COLORS[hash(ownerId) % OWNER_COLORS.length];
}

/** '#RRGGBB' → 'rgba(r, g, b, alpha)'. Other strings are returned unchanged. */
export function withAlpha(hex: string, alpha: number): string {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return hex;
  return `rgba(${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)}, ${alpha})`;
}
