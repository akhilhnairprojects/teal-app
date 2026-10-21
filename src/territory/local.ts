/**
 * Territory without an account: the squares this month's loops on this phone claim, worked out with
 * the same rules as the server (`previewClaim`). Nothing is uploaded or shown to anyone else. Every
 * square has one owner (you), so the territory is the union of the loops' squares.
 */
import { useEffect, useState } from 'react';

import { periodStart } from '@/activity/periods';
import { getLocalPoints, listLocalActivities, subscribeActivities } from '@/activity/store';

import type { TerritoryCell } from './api';
import type { CellId } from './grid';
import { previewClaim } from './preview';

/** Owner id and color of the squares on this phone (outlined as "yours" by the map layer). */
export const LOCAL_OWNER_ID = 'me';
export const LOCAL_OWNER_COLOR = 0;

/** Claimed squares by activity; a saved track never changes. */
const claims = new Map<string, CellId[]>();

/** This month's squares from the runs saved on this phone, sorted by cell id. */
export async function localTerritoryCells(month: string): Promise<TerritoryCell[]> {
  const runs = (await listLocalActivities()).filter((a) => a.kind === 'run' && a.metrics.isLoop && periodStart('month', a.startedAt) === month);
  const ids = new Set<CellId>();
  for (const a of runs) {
    let cells = claims.get(a.localId);
    if (!cells) {
      const points = await getLocalPoints(a.localId);
      if (!points) continue; // the track was removed after upload; the server holds that claim
      cells = previewClaim(points).cellIds;
      claims.set(a.localId, cells);
    }
    for (const id of cells) ids.add(id);
  }
  return [...ids].sort((x, y) => x - y).map((cellId) => ({ cellId, ownerId: LOCAL_OWNER_ID, nickname: 'You', color: LOCAL_OWNER_COLOR }));
}

export type LocalTerritory = { loading: boolean; cells: TerritoryCell[] };

const NO_CELLS: TerritoryCell[] = [];

/** This month's squares on this phone, recomputed when activities change. */
export function useLocalTerritory(month: string, enabled: boolean): LocalTerritory {
  const [settled, setSettled] = useState<{ month: string; cells: TerritoryCell[] } | null>(null);
  const [version, setVersion] = useState(0);
  useEffect(() => (enabled ? subscribeActivities(() => setVersion((v) => v + 1)) : undefined), [enabled]);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    void localTerritoryCells(month).then((cells) => {
      if (live) setSettled({ month, cells });
    });
    return () => {
      live = false;
    };
  }, [month, enabled, version]);
  if (!enabled) return { loading: false, cells: NO_CELLS };
  return settled?.month === month ? { loading: false, cells: settled.cells } : { loading: true, cells: NO_CELLS };
}

/** Test helper. */
export function resetLocalTerritoryForTests(): void {
  claims.clear();
}
