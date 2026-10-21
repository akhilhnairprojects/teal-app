export type MbtaErrorDetail =
  | { kind: 'rateLimited'; resetAt: number }
  | { kind: 'http'; status: number }
  | { kind: 'network'; message: string }
  | { kind: 'aborted' }
  | { kind: 'parse'; message: string };

function describe(d: MbtaErrorDetail): string {
  switch (d.kind) {
    case 'rateLimited':
      return 'MBTA rate limit reached';
    case 'http':
      return `MBTA request failed (${d.status})`;
    case 'network':
      return `Network error: ${d.message}`;
    case 'aborted':
      return 'Request aborted';
    case 'parse':
      return `Unexpected MBTA response: ${d.message}`;
  }
}

export class MbtaApiError extends Error {
  readonly detail: MbtaErrorDetail;

  constructor(detail: MbtaErrorDetail) {
    super(describe(detail));
    this.name = 'MbtaApiError';
    this.detail = detail;
  }
}

/** Normalise anything thrown by a fetcher into an error detail. */
export function toErrorDetail(e: unknown): MbtaErrorDetail {
  if (e instanceof MbtaApiError) return e.detail;
  if (e instanceof Error && e.name === 'AbortError') return { kind: 'aborted' };
  return { kind: 'network', message: e instanceof Error ? e.message : String(e) };
}
