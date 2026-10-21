import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Share, StyleSheet, Text, View } from 'react-native';

import { formatDistanceM, useUnits } from '@/activity/format';
import type { MyProfile } from '@/backend/auth';
import { SignInGate } from '@/features/account/SignInGate';
import { goBack, groupPath, INVITE_CODE_PATTERN, leaderboardsPath, PATHS } from '@/features/shell/routes';
import {
  blockUser,
  friendInviteLink,
  listFriends,
  parseInviteInput,
  removeFriend,
  respondFriendRequest,
  rotateInviteCode,
  sendFriendRequest,
  type Friend,
} from '@/social/friends';
import { createGroup, joinGroup, listMyGroups, type Group } from '@/social/groups';
import { fonts, usePalette } from '@/theme';
import { SheetPage, SheetScrollView } from '@/ui';

import { ADD_FRIEND_COPY, friendSections, inviteShareMessage, isSelfInvite } from './socialModel';
import { Body, Button, Card, Field, Loading, Notice, PersonRow, SectionTitle, socialStyles, TextLink } from './ui';

export function FriendsScreen() {
  return (
    <SheetPage title="Friends & groups" onBack={goBack}>
      <SignInGate next={PATHS.friends}>{(profile) => <FriendsBody profile={profile} />}</SignInGate>
    </SheetPage>
  );
}

type Msg = { text: string; tone: 'error' | 'ok' } | null;

function FriendsBody({ profile }: { profile: MyProfile }) {
  const c = usePalette();
  const [units] = useUnits();
  const [friends, setFriends] = useState<Friend[] | null>(null);
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [code, setCode] = useState(profile.inviteCode);
  const [addInput, setAddInput] = useState('');
  const [addMsg, setAddMsg] = useState<Msg>(null);
  const [groupName, setGroupName] = useState('');
  const [groupCode, setGroupCode] = useState('');
  const [groupMsg, setGroupMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [f, g] = await Promise.all([listFriends(), listMyGroups()]);
    if (f.ok) setFriends(f.value);
    if (g.ok) setGroups(g.value);
    setLoadError(!f.ok ? f.error.message : !g.ok ? g.error.message : null);
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const act = async (key: string, f: () => Promise<void>) => {
    setBusy(key);
    try {
      await f();
    } finally {
      setBusy(null);
    }
  };

  const add = () =>
    act('add', async () => {
      const target = parseInviteInput(addInput);
      if (!target) return setAddMsg({ text: ADD_FRIEND_COPY.invalid, tone: 'error' });
      if (isSelfInvite(target, { inviteCode: code, nickname: profile.nickname })) return setAddMsg({ text: ADD_FRIEND_COPY.self, tone: 'error' });
      let r = await sendFriendRequest(target);
      // A code typed in lower case parses as a nickname; when no such nickname exists, try it as a code.
      const asCode = 'nickname' in target ? target.nickname.toUpperCase() : null;
      if (!r.ok && r.error.code === 'not_found' && asCode && INVITE_CODE_PATTERN.test(asCode) && asCode !== code.toUpperCase()) {
        r = await sendFriendRequest({ code: asCode });
      }
      if (!r.ok) return setAddMsg({ text: r.error.code === 'not_found' ? ADD_FRIEND_COPY.notFound : r.error.message, tone: 'error' });
      setAddMsg({ text: r.value === 'accepted' ? ADD_FRIEND_COPY.accepted : ADD_FRIEND_COPY.requested, tone: 'ok' });
      setAddInput('');
      await load();
    });

  const share = () => {
    void Share.share({ message: inviteShareMessage(code, friendInviteLink(code)) }).catch(() => {});
  };

  const newCode = () =>
    Alert.alert('Get a new code?', 'Your current code and links stop working. Friends you already have stay friends.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'New code',
        onPress: () =>
          void act('code', async () => {
            const r = await rotateInviteCode();
            if (r.ok) setCode(r.value);
            else setAddMsg({ text: r.error.message, tone: 'error' });
          }),
      },
    ]);

  const respond = (f: Friend, accept: boolean) =>
    act(`respond:${f.userId}`, async () => {
      const r = await respondFriendRequest(f.userId, accept);
      if (!r.ok) setAddMsg({ text: r.error.message, tone: 'error' });
      await load();
    });

  const manage = (f: Friend) =>
    Alert.alert(f.nickname, undefined, [
      {
        text: f.status === 'outgoing' ? 'Cancel request' : 'Remove friend',
        onPress: () =>
          void act(`remove:${f.userId}`, async () => {
            const r = await removeFriend(f.userId);
            if (!r.ok) setAddMsg({ text: r.error.message, tone: 'error' });
            await load();
          }),
      },
      {
        text: 'Block',
        style: 'destructive',
        onPress: () =>
          void act(`block:${f.userId}`, async () => {
            const r = await blockUser(f.userId);
            if (!r.ok) setAddMsg({ text: r.error.message, tone: 'error' });
            await load();
          }),
      },
      { text: 'Close', style: 'cancel' },
    ]);

  const create = () =>
    act('create', async () => {
      const name = groupName.trim();
      if (!name) return setGroupMsg({ text: 'Give the group a name.', tone: 'error' });
      const r = await createGroup(name);
      if (!r.ok) return setGroupMsg({ text: r.error.message, tone: 'error' });
      setGroupName('');
      setGroupMsg(null);
      router.push(groupPath(r.value));
    });

  const join = () =>
    act('join', async () => {
      const r = await joinGroup(groupCode);
      if (!r.ok) return setGroupMsg({ text: r.error.code === 'not_found' ? 'No group found with that code.' : r.error.message, tone: 'error' });
      setGroupCode('');
      setGroupMsg(null);
      router.push(groupPath(r.value));
    });

  const sections = friends ? friendSections(friends) : null;

  return (
    <SheetScrollView contentContainerStyle={socialStyles.content}>
      <Card testID="friends-invite">
        <Body muted>Your invite code</Body>
        <Text selectable style={[styles.code, { color: c.text }]} testID="friends-invite-code" accessibilityLabel={`Invite code ${code.split('').join(' ')}`}>
          {code}
        </Text>
        <Body muted>Friends who enter this code are added right away.</Body>
        <View style={styles.actions}>
          <Button label="Share code" onPress={share} small testID="friends-share" />
          <Button label="New code" kind="secondary" onPress={newCode} busy={busy === 'code'} small />
        </View>
      </Card>

      <Card testID="friends-add">
        <Field
          label="Invite code, link or nickname"
          value={addInput}
          onChangeText={(t) => {
            setAddInput(t);
            setAddMsg(null);
          }}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="send"
          onSubmitEditing={() => void add()}
          testID="friends-add-input"
        />
        <Button label="Add friend" onPress={() => void add()} busy={busy === 'add'} disabled={!addInput.trim()} testID="friends-add-button" />
        <Notice text={addMsg?.text ?? null} tone={addMsg?.tone} />
      </Card>

      <Notice text={loadError} />

      {sections && sections.incoming.length > 0 ? (
        <>
          <SectionTitle>Requests</SectionTitle>
          <Card>
            {sections.incoming.map((f, i) => (
              <PersonRow
                key={f.userId}
                name={f.nickname}
                color={f.color}
                divider={i > 0}
                testID={`friend-incoming-${f.nickname}`}
                right={
                  <View style={styles.actions}>
                    <Button label="Accept" small onPress={() => void respond(f, true)} disabled={busy !== null} />
                    <Button label="Decline" small kind="secondary" onPress={() => void respond(f, false)} disabled={busy !== null} />
                  </View>
                }
              />
            ))}
          </Card>
        </>
      ) : null}

      <SectionTitle right={<TextLink label="Leaderboard" onPress={() => router.push(leaderboardsPath({ board: 'run_distance', period: 'week', scope: 'friends' }))} />}>
        Friends · running this week
      </SectionTitle>
      <Card testID="friends-list">
        {!sections ? (
          loadError ? null : <Loading />
        ) : sections.friends.length === 0 ? (
          <Body muted>No friends yet. Share your code, or add a friend by their code.</Body>
        ) : (
          sections.friends.map((f, i) => (
            <PersonRow
              key={f.userId}
              name={f.nickname}
              color={f.color}
              divider={i > 0}
              onPress={() => manage(f)}
              testID={`friend-${f.nickname}`}
              right={<Text style={[styles.value, { color: c.text }]}>{formatDistanceM(f.weekRunM ?? 0, units)}</Text>}
            />
          ))
        )}
      </Card>

      {sections && sections.outgoing.length > 0 ? (
        <>
          <SectionTitle>Sent requests</SectionTitle>
          <Card>
            {sections.outgoing.map((f, i) => (
              <PersonRow key={f.userId} name={f.nickname} color={f.color} detail="Waiting for them to accept" divider={i > 0} onPress={() => manage(f)} />
            ))}
          </Card>
        </>
      ) : null}

      <SectionTitle>Groups</SectionTitle>
      <Card testID="groups-list">
        {!groups ? (
          loadError ? null : <Loading />
        ) : groups.length === 0 ? (
          <Body muted>Groups have their own leaderboard and run-together sessions.</Body>
        ) : (
          groups.map((g, i) => (
            <PersonRow
              key={g.id}
              name={g.name}
              detail={`${g.memberCount} ${g.memberCount === 1 ? 'member' : 'members'}${g.role === 'owner' ? ' · owner' : ''}`}
              divider={i > 0}
              onPress={() => router.push(groupPath(g.id))}
              testID={`group-${g.id}`}
              right={<Ionicons name="chevron-forward" size={16} color={c.textMuted} />}
            />
          ))
        )}
      </Card>
      <Card testID="groups-create">
        <View style={styles.inline}>
          <View style={styles.flex}>
            <Field label="New group name" value={groupName} onChangeText={setGroupName} maxLength={40} testID="groups-create-input" />
          </View>
          <Button label="Create" small onPress={() => void create()} busy={busy === 'create'} disabled={!groupName.trim()} />
        </View>
        <View style={styles.inline}>
          <View style={styles.flex}>
            <Field
              label="Group code"
              value={groupCode}
              onChangeText={setGroupCode}
              autoCapitalize="characters"
              autoCorrect={false}
              maxLength={8}
              testID="groups-join-input"
            />
          </View>
          <Button label="Join" small onPress={() => void join()} busy={busy === 'join'} disabled={groupCode.trim().length !== 8} />
        </View>
        <Notice text={groupMsg?.text ?? null} tone={groupMsg?.tone} />
      </Card>
    </SheetScrollView>
  );
}

const styles = StyleSheet.create({
  code: { fontFamily: fonts.extrabold, fontSize: 30, letterSpacing: 4 },
  actions: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  value: { fontFamily: fonts.bold, fontSize: 15, fontVariant: ['tabular-nums'] },
  inline: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  flex: { flex: 1 },
});
