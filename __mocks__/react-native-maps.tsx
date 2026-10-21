/* Jest mock for react-native-maps: plain Views that forward children and testID. */
import { forwardRef, useImperativeHandle, type ReactNode } from 'react';
import { View, type ViewProps } from 'react-native';

// Only these props are read; extra props from callers are ignored at runtime.
type Props = ViewProps & { children?: ReactNode };

const MapView = forwardRef<unknown, Props>(function MapView({ children, testID, style }, ref) {
  useImperativeHandle(ref, () => ({
    animateToRegion: jest.fn(),
    animateCamera: jest.fn(),
    fitToCoordinates: jest.fn(),
    getCamera: jest.fn(async () => ({ center: { latitude: 0, longitude: 0 }, zoom: 15, heading: 0, pitch: 0 })),
  }));
  return (
    <View testID={testID ?? 'map-view'} style={style}>
      {children}
    </View>
  );
});

function passthrough(name: string) {
  function Component({ children, testID }: Props) {
    return <View testID={testID ?? name}>{children}</View>;
  }
  Component.displayName = name;
  return Component;
}

export const Marker = passthrough('map-marker');
export const Polyline = passthrough('map-polyline');
export const Circle = passthrough('map-circle');
export const Polygon = passthrough('map-polygon');
export const Callout = passthrough('map-callout');
export const PROVIDER_DEFAULT = undefined;
export const PROVIDER_GOOGLE = 'google';

export default MapView;
