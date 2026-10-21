/**
 * Territory map layer (spec G4). Fetches its own cells for `month` and the settled `region`
 * (debounced, cached), merges them into run-length rectangles per owner, and draws at most 600
 * polygons in the owner's color at 35 % fill. Zoomed out (latitudeDelta > 0.08) it draws 4×4
 * super-cells colored by the majority owner. The signed-in user's cells (or `highlightUserId`'s)
 * get an outline. Signed out, it draws the squares claimed by the runs on this phone instead.
 * Only grid squares are drawn, never a loop (Addendum D).
 */
import { memo, useEffect, useMemo } from 'react';
import { Polygon } from 'react-native-maps';

import { useAuth } from '@/backend/auth';
import { LOCAL_OWNER_ID, useLocalTerritory } from '@/territory/local';
import { layoutTerritory, rectKey, rectPolygon, SUPER_CELL_DELTA, type OwnerRect } from '@/territory/merge';
import { setTerritoryShown, useTerritory } from '@/territory/useTerritory';
import { usePalette } from '@/theme';

import { ownerColor, TERRITORY_FILL_ALPHA, withAlpha } from './ownerColor';

export type TerritoryRegion = { latitude: number; longitude: number; latitudeDelta: number; longitudeDelta: number };

export type TerritoryLayerProps = { month: string; region: TerritoryRegion | null; highlightUserId?: string | null };

export function TerritoryLayer({ month, region, highlightUserId }: TerritoryLayerProps) {
  const c = usePalette();
  const auth = useAuth();
  const signedIn = auth.status === 'signedIn';
  const outlinedOwner = highlightUserId ?? (signedIn ? auth.userId : LOCAL_OWNER_ID);
  const server = useTerritory(month, region, { enabled: signedIn });
  const local = useLocalTerritory(month, !signedIn);
  const view = signedIn ? server : { status: local.loading ? ('loading' as const) : ('ready' as const), cells: local.cells, truncated: false, error: null };
  const zoomedOut = (region?.latitudeDelta ?? 0) > SUPER_CELL_DELTA;

  const layout = useMemo(() => layoutTerritory(view.cells, { latitudeDelta: zoomedOut ? Infinity : 0 }), [view.cells, zoomedOut]);
  const colors = useMemo(() => {
    const m = new Map<string, string>();
    for (const cell of view.cells) if (!m.has(cell.ownerId)) m.set(cell.ownerId, ownerColor(cell.color, cell.ownerId));
    return m;
  }, [view.cells]);

  const loading = view.status === 'loading';
  const truncated = view.truncated || layout.capped;
  const error = view.status === 'error' ? view.error : null;
  useEffect(() => setTerritoryShown({ loading, truncated, error }), [loading, truncated, error]);
  useEffect(() => () => setTerritoryShown(null), []);

  return (
    <>
      {layout.rects.map((r) => (
        <TerritoryRect
          key={rectKey(r)}
          rect={r}
          color={colors.get(r.ownerId) ?? ownerColor(null, r.ownerId)}
          outline={r.ownerId === outlinedOwner ? c.text : null}
        />
      ))}
    </>
  );
}

const TerritoryRect = memo(function TerritoryRect({ rect, color, outline }: { rect: OwnerRect; color: string; outline: string | null }) {
  const coordinates = useMemo(() => rectPolygon(rect), [rect]);
  return (
    <Polygon
      testID="territory-rect"
      coordinates={coordinates}
      fillColor={withAlpha(color, TERRITORY_FILL_ALPHA)}
      strokeColor={outline ?? 'transparent'}
      strokeWidth={outline ? 1.5 : 0}
      tappable={false}
      zIndex={5}
    />
  );
});
