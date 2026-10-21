/**
 * Screen-test helpers. Each test owns its renderer (no module-level renderer that an `afterEach`
 * could unmount under a still-running test) and waits for a condition instead of a fixed number
 * of ticks. Waiting only flushes promise work, so it works with `jest.useFakeTimers()`, which keeps
 * polling and countdown intervals from running (or keeping a worker alive).
 */
import { Text } from 'react-native';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';

/** Visible text of a tree, one entry per `Text`, joined with ' | '. */
export function textOf(node: ReactTestRenderer | ReactTestInstance | { root: ReactTestInstance }): string {
  const root = 'root' in node ? node.root : node;
  return root
    .findAllByType(Text)
    .map((t) => (Array.isArray(t.props.children) ? t.props.children.join('') : String(t.props.children ?? '')))
    .filter((t) => /[A-Za-z0-9]/.test(t))
    .join(' | ');
}

/** Flush pending promise work (fetch mocks, AsyncStorage, effects) inside `act`. */
export async function flush(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  });
}

/**
 * Flush until `ready()` holds. Fails with `describe()` (e.g. the screen text) after `maxTurns`
 * flushes; the bound counts turns, not wall time, so a loaded machine cannot make it flaky.
 */
export async function waitUntil(ready: () => boolean, describe: () => string = () => '', maxTurns = 200): Promise<void> {
  for (let i = 0; i < maxTurns; i++) {
    if (ready()) return;
    await flush();
  }
  if (!ready()) throw new Error(`waitUntil: condition not met after ${maxTurns} turns. ${describe()}`);
}

/** Mount `el`, run `body` with the renderer, and always unmount it afterwards. */
export async function withScreen(el: React.ReactElement, body: (r: ReactTestRenderer) => Promise<void>): Promise<void> {
  let r!: ReactTestRenderer;
  await act(async () => {
    r = create(el);
  });
  try {
    await body(r);
  } finally {
    act(() => r.unmount());
  }
}

/** Wait until the screen text contains every one of `parts`. */
export const waitForText = (r: ReactTestRenderer, ...parts: string[]): Promise<void> =>
  waitUntil(
    () => {
      const text = textOf(r);
      return parts.every((p) => text.includes(p));
    },
    () => `Text: ${textOf(r)}`,
  );
