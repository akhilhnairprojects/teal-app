import { Polyline } from 'react-native-maps';

import type { TrackOverlay } from '@/state/mapOverlay';

/** Activity tracks: the live recording, an activity's route, or a featured run's shared route. */
export function TrackLayer({ tracks }: { tracks: readonly TrackOverlay[] }) {
  return (
    <>
      {tracks.map((t) =>
        t.coordinates.length < 2 ? null : (
          <Polyline
            key={`track:${t.id}`}
            coordinates={t.coordinates}
            strokeColor={t.color}
            strokeWidth={t.width ?? 5}
            lineDashPattern={t.dashed ? [4, 8] : undefined}
            lineCap="round"
            lineJoin="round"
            zIndex={55}
          />
        ),
      )}
    </>
  );
}
