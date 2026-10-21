import { memo } from 'react';
import { Polyline } from 'react-native-maps';

import { DIMMED_OPACITY, SHAPE_WIDTH, withAlpha, type ShapeLine } from '../mapModel';

/** Route-colored rail lines; routes outside the overlay's emphasis fade to 30%. */
export const RailShapesLayer = memo(function RailShapesLayer({ lines }: { lines: ShapeLine[] }) {
  return (
    <>
      {lines.map((l) => (
        <Polyline
          key={`${l.key}:${l.dimmed ? 'd' : 'n'}`}
          coordinates={l.coordinates}
          strokeColor={l.dimmed ? withAlpha(l.color, DIMMED_OPACITY) : l.color}
          strokeWidth={SHAPE_WIDTH}
          lineCap="round"
          lineJoin="round"
          zIndex={l.dimmed ? 1 : 2}
        />
      ))}
    </>
  );
});
