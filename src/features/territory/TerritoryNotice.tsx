/**
 * The territory notice (review B1). Territory is on by default (Addendum D, O3), so every account
 * sees this once, before its first loop can be claimed: at nickname creation, or on the first run's
 * finish review, or on the territory page. The server claims no squares until the account has
 * acknowledged it (`territory_notice_seen`), and "Turn off" opts out right there.
 */
import { useState } from 'react';
import { StyleSheet, Text } from 'react-native';

import { updateMySettings } from '@/backend/auth';
import { Body, Button, Card, ErrorText } from '@/features/account/formUi';
import { fonts, usePalette } from '@/theme';

/** One accurate description of what territory shows, used by the notice, Account and the territory page. */
export const TERRITORY_EXPLANATION =
  'Territory is on by default. When a run ends within 75 m of where it started, the ~50 m squares inside your loop become yours for the month, shown on the map to signed-in Teal users under your nickname. Your squares outline the area you looped, so they show roughly where you ran (to about 50 m). Squares within 300 m of your start and finish are never claimed. Turning territory off removes your squares right away.';

export const TERRITORY_NOTICE_COPY = {
  title: 'Your loops show on the territory map',
  body: TERRITORY_EXPLANATION,
  keep: 'Keep territory on',
  turnOff: 'Turn off territory',
  /** On the finish review, saving counts as having seen it. */
  saveNote: 'Saving keeps territory on. You can turn it off any time in Account.',
} as const;

/**
 * The notice with its two actions. Both record the acknowledgement; "Turn off" also opts out (which
 * deletes any squares). `onDone` runs after a successful save.
 */
export function TerritoryNotice({ testID = 'territory-notice', note, onDone }: { testID?: string; note?: string; onDone?: () => void }) {
  const c = usePalette();
  const [busy, setBusy] = useState<'keep' | 'off' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const decide = async (keepOn: boolean) => {
    setBusy(keepOn ? 'keep' : 'off');
    setError(null);
    const r = await updateMySettings(keepOn ? { territoryNoticeSeen: true } : { territoryNoticeSeen: true, territoryOptIn: false });
    setBusy(null);
    if (!r.ok) setError(r.error.message);
    else onDone?.();
  };

  return (
    <Card testID={testID}>
      <Text style={[styles.title, { color: c.text }]}>{TERRITORY_NOTICE_COPY.title}</Text>
      <Body muted>{TERRITORY_NOTICE_COPY.body}</Body>
      {note ? <Body muted>{note}</Body> : null}
      <ErrorText>{error}</ErrorText>
      <Button testID={`${testID}-keep`} label={TERRITORY_NOTICE_COPY.keep} onPress={() => void decide(true)} busy={busy === 'keep'} disabled={busy !== null} />
      <Button
        testID={`${testID}-off`}
        kind="secondary"
        label={TERRITORY_NOTICE_COPY.turnOff}
        onPress={() => void decide(false)}
        busy={busy === 'off'}
        disabled={busy !== null}
      />
    </Card>
  );
}

const styles = StyleSheet.create({
  title: { fontFamily: fonts.bold, fontSize: 16 },
});
