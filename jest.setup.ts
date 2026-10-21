/* Jest setup: native-module mocks shared by every test (spec §6). */

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

require('react-native-gesture-handler/jestSetup');

jest.mock('react-native-reanimated', () => require('react-native-reanimated/mock'));

jest.mock('@gorhom/bottom-sheet', () => ({ __esModule: true, ...require('@gorhom/bottom-sheet/mock') }));

// react-native-maps resolves to __mocks__/react-native-maps.tsx automatically (root-level mock).
// expo-location, expo-haptics and global.fetch are mocked per test.
