// Guards the jest.setup.ts mocks (reanimated needs the react-native-worklets jest resolver) and __mocks__/react-native-maps.tsx.
import Animated from 'react-native-reanimated';
import BottomSheet from '@gorhom/bottom-sheet';
import MapView, { Marker, PROVIDER_DEFAULT } from 'react-native-maps';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { act, create } from 'react-test-renderer';
it('mocks load', () => {
  expect(Animated).toBeDefined();
  expect(BottomSheet).toBeDefined();
  expect(PROVIDER_DEFAULT).toBeUndefined();
  let r!: ReturnType<typeof create>;
  act(() => { r = create(<GestureHandlerRootView><MapView testID="m"><Marker coordinate={{ latitude: 42.35, longitude: -71.06 }} /></MapView></GestureHandlerRootView>); });
  expect(r.root.findByProps({ testID: 'map-marker' })).toBeTruthy();
  act(() => r.unmount());
});
