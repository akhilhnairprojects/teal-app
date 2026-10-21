import { router, useFocusEffect, type Href } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { SignInGate } from '@/features/account/SignInGate';
import { goBack, PATHS } from '@/features/shell/routes';
import { useNow } from '@/mbta/live/usePolling';
import { notificationHref } from '@/notifications';
import { fetchInbox, markInboxRead, type InboxItem } from '@/social/inbox';
import { usePalette } from '@/theme';
import { EmptyState, SheetPage, SheetScrollView } from '@/ui';

import { notificationContent } from '../../../supabase/functions/send-push/messages';
import { dayLabel } from './socialModel';
import { Card, Loading, Notice, PersonRow, socialStyles } from './ui';

export function InboxScreen() {
  return (
    <SheetPage title="Inbox" onBack={goBack}>
      <SignInGate next={PATHS.inbox}>
        <InboxBody />
      </SignInGate>
    </SheetPage>
  );
}

/** The row's text and where tapping it goes (overtakes and friend rows open Friends). */
export function inboxRow(item: InboxItem): { title: string; body: string; href: Href | null } {
  const content = notificationContent(item.kind, item.payload);
  if (!content) return { title: 'Teal', body: '', href: null };
  return { title: content.title, body: content.body, href: notificationHref(content.url) };
}

function InboxBody() {
  const c = usePalette();
  const [items, setItems] = useState<InboxItem[] | null>(null);
  /** Rows that were unread when this visit loaded them (they keep their dot until the next visit). */
  const [fresh, setFresh] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const now = useNow(60_000);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      void (async () => {
        const r = await fetchInbox(50);
        if (cancelled) return;
        if (!r.ok) {
          setError(r.error.message);
          return;
        }
        setError(null);
        setItems(r.value);
        const unread = r.value.filter((i) => i.readAt === null).map((i) => i.id);
        setFresh(new Set(unread));
        if (unread.length > 0) void markInboxRead(unread);
      })();
      return () => {
        cancelled = true;
      };
    }, []),
  );

  if (!items) return error ? <Notice text={error} /> : <Loading />;
  if (items.length === 0) {
    return <EmptyState icon="mail-outline" title="Nothing here yet" message="Friend requests and friends passing you show up here." />;
  }
  return (
    <SheetScrollView contentContainerStyle={socialStyles.content}>
      <Notice text={error} />
      <Card testID="inbox-list">
        {items.map((item, i) => {
          const row = inboxRow(item);
          const href = row.href;
          return (
            <PersonRow
              key={item.id}
              name={row.title}
              detail={`${row.body}${row.body ? ' · ' : ''}${dayLabel(item.createdAt, now)}`}
              divider={i > 0}
              onPress={href ? () => router.push(href) : undefined}
              testID={`inbox-${item.id}`}
              right={fresh.has(item.id) ? <View style={[styles.dot, { backgroundColor: c.brand }]} accessibilityLabel="Unread" /> : null}
            />
          );
        })}
      </Card>
    </SheetScrollView>
  );
}

const styles = StyleSheet.create({ dot: { width: 8, height: 8, borderRadius: 4 } });
