/**
 * Speech-to-text for typed fields (the find-a-dock destination). Live on-device recognition comes
 * from the `expo-speech-recognition` native module, which exists only in a development build; Expo
 * Go doesn't include it. The module is looked up with `requireOptionalNativeModule`, so Expo Go gets
 * `supported: false` instead of a crash, and screens fall back to the iOS keyboard's dictation mic.
 */
import { requireOptionalNativeModule } from 'expo';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import type { ExpoSpeechRecognitionModule } from 'expo-speech-recognition';

// Type-only: the library's JS (which requires the native module eagerly) is never loaded.
type Recognizer = typeof ExpoSpeechRecognitionModule;
type Subscription = { remove: () => void };

let cached: Recognizer | null | undefined;

/** The native recognizer, or null (Expo Go, web, or a device without speech recognition). */
export function getRecognizer(): Recognizer | null {
  if (cached !== undefined) return cached;
  if (Platform.OS === 'web') return (cached = null);
  const mod = requireOptionalNativeModule<Recognizer>('ExpoSpeechRecognition');
  try {
    cached = mod && mod.isRecognitionAvailable() ? mod : null;
  } catch {
    cached = null;
  }
  return cached;
}

/** Test helper. */
export function resetRecognizerForTests(next?: Recognizer | null): void {
  cached = next;
}

export type DictationError = 'permission' | 'no-speech' | 'unavailable' | 'failed';

export const DICTATION_COPY = {
  listening: 'Listening… say where you’re riding to',
  keyboardTip: 'Tap the microphone on your keyboard to say where you’re going.',
  permission: 'Allow microphone and speech recognition for Teal in Settings to use voice.',
  noSpeech: 'Didn’t catch that. Tap the mic and try again.',
  failed: 'Voice input stopped. Tap the mic to try again.',
} as const;

export function dictationErrorText(e: DictationError): string {
  return e === 'permission' ? DICTATION_COPY.permission : e === 'no-speech' ? DICTATION_COPY.noSpeech : DICTATION_COPY.failed;
}

/**
 * Live dictation into a text field. `onText` receives the running transcript (partial results
 * included); `onFinal` the final one. `contextualStrings` biases recognition toward known place
 * names (Bluebikes and T stations). Recognition stops on unmount.
 */
export function useDictation(o: { onText: (t: string) => void; onFinal?: (t: string) => void; contextualStrings?: readonly string[] }) {
  const recognizer = getRecognizer();
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<DictationError | null>(null);
  const subs = useRef<Subscription[]>([]);
  const handlers = useRef(o);
  useEffect(() => {
    handlers.current = o;
  });

  const detach = useCallback(() => {
    subs.current.forEach((s) => s.remove());
    subs.current = [];
  }, []);

  const stop = useCallback(() => {
    if (!recognizer) return;
    try {
      recognizer.stop();
    } catch {
      // already stopped
    }
  }, [recognizer]);

  const start = useCallback(async () => {
    if (!recognizer) {
      setError('unavailable');
      return;
    }
    setError(null);
    const perm = await recognizer.requestPermissionsAsync().catch(() => null);
    if (!perm?.granted) {
      setError('permission');
      return;
    }
    detach();
    const add = (event: string, cb: (payload: never) => void) => {
      // NativeModule is an EventEmitter in Expo SDK 52+.
      const emitter = recognizer as unknown as { addListener: (e: string, l: (p: never) => void) => Subscription };
      subs.current.push(emitter.addListener(event, cb));
    };
    add('start', () => setListening(true));
    add('end', () => {
      setListening(false);
      detach();
    });
    add('result', (e: { isFinal: boolean; results: { transcript: string }[] }) => {
      const text = e.results[0]?.transcript?.trim() ?? '';
      if (!text) return;
      handlers.current.onText(text);
      if (e.isFinal) handlers.current.onFinal?.(text);
    });
    add('error', (e: { error: string }) => {
      setListening(false);
      setError(e.error === 'not-allowed' ? 'permission' : e.error === 'no-speech' || e.error === 'speech-timeout' ? 'no-speech' : e.error === 'aborted' ? null : 'failed');
    });
    try {
      recognizer.start({
        lang: 'en-US',
        interimResults: true,
        continuous: false,
        contextualStrings: handlers.current.contextualStrings ? [...handlers.current.contextualStrings].slice(0, 100) : undefined,
        addsPunctuation: false,
      });
    } catch {
      detach();
      setError('failed');
    }
  }, [recognizer, detach]);

  useEffect(
    () => () => {
      detach();
      try {
        recognizer?.abort();
      } catch {
        // nothing running
      }
    },
    [recognizer, detach],
  );

  return { supported: recognizer !== null, listening, error, start, stop, clearError: () => setError(null) };
}
