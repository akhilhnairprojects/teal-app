import { Pressable, Text } from 'react-native';
import { act } from 'react-test-renderer';

import { textOf, waitUntil, withScreen } from '@/mbta/testing/render';

import { DICTATION_COPY, getRecognizer, resetRecognizerForTests, useDictation } from '../dictation';
import { resetSpokenUpdatesForTests, setSpokenUpdates, speakUpdate } from '../speak';

jest.mock('expo-speech', () => ({ speak: jest.fn(), stop: jest.fn(async () => {}) }));
jest.mock('expo', () => ({ requireOptionalNativeModule: jest.fn(() => null) }));

const Speech = jest.requireMock('expo-speech') as { speak: jest.Mock; stop: jest.Mock };

/** A fake native recognizer that records listeners and lets the test emit events. */
function fakeRecognizer(o: { granted?: boolean } = {}) {
  const listeners = new Map<string, ((p: unknown) => void)[]>();
  return {
    emit: (e: string, p: unknown = null) => listeners.get(e)?.forEach((l) => l(p)),
    isRecognitionAvailable: () => true,
    requestPermissionsAsync: jest.fn(async () => ({ granted: o.granted ?? true })),
    start: jest.fn(),
    stop: jest.fn(),
    abort: jest.fn(),
    addListener: (e: string, l: (p: unknown) => void) => {
      listeners.set(e, [...(listeners.get(e) ?? []), l]);
      return { remove: () => listeners.set(e, (listeners.get(e) ?? []).filter((x) => x !== l)) };
    },
  };
}

function Probe({ onFinal }: { onFinal?: (t: string) => void }) {
  const [text, setText] = [globalThis.__probeText ?? '', (t: string) => (globalThis.__probeText = t)];
  const d = useDictation({ onText: setText, onFinal, contextualStrings: ['Park Street', 'Kendall/MIT'] });
  return (
    <>
      <Text>{`supported:${d.supported} listening:${d.listening} error:${d.error ?? 'none'} text:${text}`}</Text>
      <Pressable testID="go" onPress={() => void d.start()} />
    </>
  );
}

declare global {
  var __probeText: string | undefined;
}

beforeEach(() => {
  globalThis.__probeText = '';
  Speech.speak.mockClear();
});

describe('dictation', () => {
  it('reports unsupported in Expo Go (no native recognizer) without crashing', async () => {
    resetRecognizerForTests(undefined);
    expect(getRecognizer()).toBeNull();
    await withScreen(<Probe />, async (r) => expect(textOf(r)).toContain('supported:false'));
  });

  it('streams partial and final transcripts from the native recognizer', async () => {
    const rec = fakeRecognizer();
    resetRecognizerForTests(rec as never);
    const onFinal = jest.fn();
    await withScreen(<Probe onFinal={onFinal} />, async (r) => {
      await act(async () => r.root.findByProps({ testID: 'go' }).props.onPress());
      await waitUntil(() => rec.start.mock.calls.length > 0);
      expect(rec.start).toHaveBeenCalledWith(expect.objectContaining({ lang: 'en-US', interimResults: true, contextualStrings: ['Park Street', 'Kendall/MIT'] }));
      act(() => rec.emit('start'));
      act(() => rec.emit('result', { isFinal: false, results: [{ transcript: 'kendall' }] }));
      expect(globalThis.__probeText).toBe('kendall');
      act(() => rec.emit('result', { isFinal: true, results: [{ transcript: 'Kendall MIT' }] }));
      expect(onFinal).toHaveBeenCalledWith('Kendall MIT');
      act(() => rec.emit('end'));
    });
  });

  it('explains a denied microphone permission', async () => {
    const rec = fakeRecognizer({ granted: false });
    resetRecognizerForTests(rec as never);
    await withScreen(<Probe />, async (r) => {
      await act(async () => r.root.findByProps({ testID: 'go' }).props.onPress());
      await waitUntil(() => textOf(r).includes('error:permission'));
      expect(rec.start).not.toHaveBeenCalled();
    });
    expect(DICTATION_COPY.permission).toMatch(/Settings/);
  });
});

describe('spoken updates', () => {
  it('speaks when on and stays silent when off', () => {
    resetSpokenUpdatesForTests(true);
    speakUpdate('Head to Kendall Square. 4 open docks.');
    expect(Speech.speak).toHaveBeenCalledWith('Head to Kendall Square. 4 open docks.', expect.objectContaining({ language: 'en-US' }));
    setSpokenUpdates(false);
    speakUpdate('Dock changed');
    expect(Speech.speak).toHaveBeenCalledTimes(1);
  });
});
