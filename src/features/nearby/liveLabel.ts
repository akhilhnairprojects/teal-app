/** "Live · Ns ago" badge text for the last successful prediction update. */
export function liveLabel(updatedAt: number | null, now: number): string {
  if (updatedAt === null) return 'Connecting…';
  const seconds = Math.max(0, Math.round((now - updatedAt) / 1000));
  if (seconds < 10) return 'Live · just now';
  return `Live · ${seconds < 60 ? `${seconds}s` : `${Math.round(seconds / 60)}m`} ago`;
}
