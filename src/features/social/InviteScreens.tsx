/** Landing pages for invite links: /friend/[code] (add a friend) and /join/[code] (join a group). */
import { router } from 'expo-router';
import { useState } from 'react';

import type { MyProfile } from '@/backend/auth';
import { SignInGate } from '@/features/account/SignInGate';
import { friendInvitePath, friendsPath, goBack, groupPath, joinGroupPath } from '@/features/shell/routes';
import { sendFriendRequest } from '@/social/friends';
import { joinGroup } from '@/social/groups';
import { EmptyState, SheetPage, SheetScrollView } from '@/ui';

import { ADD_FRIEND_COPY } from './socialModel';
import { Body, Button, Card, Notice, socialStyles } from './ui';

const INVALID_LINK = { title: 'This invite link isn’t valid', message: 'Ask for the 8-character code and enter it in Friends & groups.' };

export function FriendInviteScreen({ code }: { code: string | null }) {
  return (
    <SheetPage title="Add friend" onBack={goBack}>
      {code ? (
        <SignInGate next={String(friendInvitePath(code))}>{(profile) => <FriendInviteBody code={code} profile={profile} />}</SignInGate>
      ) : (
        <EmptyState icon="person-add-outline" title={INVALID_LINK.title} message={INVALID_LINK.message} />
      )}
    </SheetPage>
  );
}

function FriendInviteBody({ code, profile }: { code: string; profile: MyProfile }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  if (code === profile.inviteCode.toUpperCase()) {
    return <EmptyState icon="person-outline" title="This is your own invite" message={ADD_FRIEND_COPY.self} />;
  }
  const add = async () => {
    setBusy(true);
    const r = await sendFriendRequest({ code });
    setBusy(false);
    if (!r.ok) return setMsg(r.error.code === 'not_found' ? 'This invite has expired or isn’t valid.' : r.error.message);
    router.replace(friendsPath());
  };
  return (
    <SheetScrollView contentContainerStyle={socialStyles.content}>
      <Card testID="friend-invite">
        <Body>{`Add the Teal user with invite code ${code} as a friend? You’ll see each other’s weekly running distance.`}</Body>
        <Button label="Add friend" onPress={() => void add()} busy={busy} testID="friend-invite-accept" />
        <Notice text={msg} />
      </Card>
    </SheetScrollView>
  );
}

export function JoinGroupScreen({ code }: { code: string | null }) {
  return (
    <SheetPage title="Join group" onBack={goBack}>
      {code ? (
        <SignInGate next={String(joinGroupPath(code))}>
          <JoinGroupBody code={code} />
        </SignInGate>
      ) : (
        <EmptyState icon="people-outline" title={INVALID_LINK.title} message={INVALID_LINK.message} />
      )}
    </SheetPage>
  );
}

function JoinGroupBody({ code }: { code: string }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const join = async () => {
    setBusy(true);
    const r = await joinGroup(code);
    setBusy(false);
    if (!r.ok) return setMsg(r.error.code === 'not_found' ? 'This group code has changed or isn’t valid.' : r.error.message);
    router.replace(groupPath(r.value));
  };
  return (
    <SheetScrollView contentContainerStyle={socialStyles.content}>
      <Card testID="join-group">
        <Body>{`Join the Teal group with code ${code}? Members see your nickname, the group leaderboard and session results.`}</Body>
        <Button label="Join group" onPress={() => void join()} busy={busy} testID="join-group-accept" />
        <Notice text={msg} />
      </Card>
    </SheetScrollView>
  );
}
