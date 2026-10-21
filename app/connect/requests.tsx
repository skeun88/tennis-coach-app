/**
 * 새 회원 요청 (코치) — member_connection_requests 조회/처리.
 * - 탭: 확인 필요(pending) / 처리 완료(그 외)
 * - 기존 회원과 전화 일치 → "기존 회원 확인"(process_existing)
 * - 일치 없음 → "새 회원으로 등록"(members/new 프리필 + fromRequestId 콜백)
 * - 더보기 메뉴에 "요청 거절"만. "취소" 액션은 코치 화면에 노출하지 않음.
 * - 처리 순서 안내: 회원 선택·등록 → 회원앱 초대 문자 → 회원 로그인 → 연결 완료
 */
import { useCallback, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Alert,
  ScrollView, Linking, Platform, RefreshControl,
} from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../lib/supabase';
import { Colors, Radius } from '../../lib/theme';
import SettingsHeader from '../../components/SettingsHeader';
import {
  fetchConnectionRequests, findMemberByPhone, processExisting, rejectRequest,
  type ConnectionRequest, type MemberLite,
} from '../../lib/sharedInvite';

const APP_STORE_URL = 'https://apps.apple.com/kr/app/kerri-member/id6783235236';
const PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=com.kerri.memberapp';

function formatPhone(req: ConnectionRequest): string {
  return req.phone_raw ?? req.phone_norm ?? '-';
}

/** 회원앱 초대 문자 작성 (기존 members/[id] 초대 패턴과 동일, 기존 기능은 수정하지 않음). */
async function sendInviteSms(member: MemberLite) {
  let code: string | null = null;
  const { data } = await supabase.from('members').select('invite_code').eq('id', member.id).maybeSingle();
  code = (data as any)?.invite_code ?? null;
  if (!code) {
    code = Math.random().toString(36).slice(2, 8).toUpperCase();
    await supabase.from('members').update({ invite_code: code }).eq('id', member.id);
  }
  const msg = `[KERRI 멤버 초대]\n\n${member.name} 님, 담당 코치가 KERRI 멤버로 초대했어요.\n앱에서 레슨 일정과 횟수, 레슨 기록을 확인해 보세요.\n\niPhone\n ${APP_STORE_URL}\n\nAndroid\n ${PLAY_STORE_URL}\n\n링크로 연결되지 않으면 앱을 다운로드한 후, 아래 초대 코드를 입력해 로그인해 주세요.\n\n초대 코드: ${code}`;
  const phone = (member.phone ?? '').replace(/[^0-9]/g, '');
  const smsUrl = `sms:${phone}${Platform.OS === 'ios' ? '&' : '?'}body=${encodeURIComponent(msg)}`;
  if (await Linking.canOpenURL(smsUrl)) await Linking.openURL(smsUrl);
  else Alert.alert('초대 링크', `🍎 ${APP_STORE_URL}\n🤖 ${PLAY_STORE_URL}\n초대 코드: ${code}`);
}

export default function ConnectionRequestsScreen() {
  const router = useRouter();
  const [tab, setTab] = useState<'pending' | 'done'>('pending');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [requests, setRequests] = useState<ConnectionRequest[]>([]);
  const [matches, setMatches] = useState<Record<string, MemberLite | null>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const reqs = await fetchConnectionRequests();
      setRequests(reqs);
      const m: Record<string, MemberLite | null> = {};
      await Promise.all(
        reqs.filter((r) => r.status === 'pending').map(async (r) => {
          try { m[r.id] = await findMemberByPhone(r.phone_norm); } catch { m[r.id] = null; }
        }),
      );
      setMatches(m);
    } catch {
      Alert.alert('오류', '연결 요청을 불러오지 못했어요.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const pending = requests.filter((r) => r.status === 'pending');
  const done = requests.filter((r) => r.status !== 'pending');
  const list = tab === 'pending' ? pending : done;

  async function handleConfirmExisting(req: ConnectionRequest, member: MemberLite) {
    setBusyId(req.id);
    try {
      await processExisting(req.id, member.id);
      await load();
      Alert.alert(
        '기존 회원 확인 완료',
        `${member.name} 회원과 연결했어요.\n이제 회원앱 초대 문자를 보내 주세요. 회원이 로그인하면 연결이 완료됩니다.`,
        [
          { text: '나중에', style: 'cancel' },
          { text: '초대 문자 보내기', onPress: () => sendInviteSms(member) },
        ],
      );
    } catch (e: any) {
      Alert.alert('처리 실패', e?.message ?? '요청 처리 중 오류가 발생했어요.');
    } finally {
      setBusyId(null);
    }
  }

  function handleRegisterNew(req: ConnectionRequest) {
    router.push({
      pathname: '/members/new',
      params: {
        prefillName: req.member_name,
        prefillPhone: req.phone_raw ?? req.phone_norm ?? '',
        fromRequestId: req.id,
      },
    } as any);
  }

  function handleMore(req: ConnectionRequest) {
    Alert.alert('요청 관리', `${req.member_name} 님의 요청`, [
      {
        text: '요청 거절',
        style: 'destructive',
        onPress: () => {
          setBusyId(req.id);
          rejectRequest(req.id)
            .then(load)
            .catch((e) => Alert.alert('거절 실패', e?.message ?? '오류가 발생했어요.'))
            .finally(() => setBusyId(null));
        },
      },
      { text: '닫기', style: 'cancel' },
    ]);
  }

  function renderPending(req: ConnectionRequest) {
    const match = matches[req.id];
    const isBusy = busyId === req.id;
    return (
      <View key={req.id} style={styles.card}>
        <View style={styles.cardTop}>
          <View style={{ flex: 1 }}>
            <Text style={styles.name}>{req.member_name}</Text>
            <Text style={styles.phone}>{formatPhone(req)}</Text>
          </View>
          <TouchableOpacity onPress={() => handleMore(req)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="ellipsis-horizontal" size={20} color={Colors.mutedFg} />
          </TouchableOpacity>
        </View>

        {match ? (
          <View style={styles.matchRow}>
            <Ionicons name="checkmark-circle" size={16} color={Colors.success} />
            <Text style={styles.matchTxt}>기존 회원과 일치 · {match.name}</Text>
          </View>
        ) : (
          <View style={styles.matchRow}>
            <Ionicons name="person-add-outline" size={16} color={Colors.primary} />
            <Text style={[styles.matchTxt, { color: Colors.primary }]}>새로운 회원</Text>
          </View>
        )}

        {isBusy ? (
          <ActivityIndicator color={Colors.primary} style={{ marginTop: 12 }} />
        ) : match ? (
          <TouchableOpacity style={styles.primaryBtn} onPress={() => handleConfirmExisting(req, match)}>
            <Text style={styles.primaryBtnTxt}>기존 회원 확인</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity style={styles.primaryBtn} onPress={() => handleRegisterNew(req)}>
            <Text style={styles.primaryBtnTxt}>새 회원으로 등록</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  }

  function renderDone(req: ConnectionRequest) {
    const statusLabel =
      req.status === 'processed'
        ? (req.process_type === 'existing_member' ? '기존 회원 연결' : '신규 회원 등록')
        : req.status === 'rejected' ? '거절됨' : '취소됨';
    return (
      <View key={req.id} style={[styles.card, { opacity: 0.9 }]}>
        <View style={styles.cardTop}>
          <View style={{ flex: 1 }}>
            <Text style={styles.name}>{req.member_name}</Text>
            <Text style={styles.phone}>{formatPhone(req)}</Text>
          </View>
          <View style={[styles.statusPill, req.status === 'processed' ? styles.pillOk : styles.pillMuted]}>
            <Text style={[styles.statusPillTxt, req.status === 'processed' && { color: Colors.success }]}>{statusLabel}</Text>
          </View>
        </View>
        {req.status === 'processed' && (
          <Text style={styles.doneHint}>회원앱 초대 문자 → 회원 로그인 시 연결 완료됩니다.</Text>
        )}
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <SettingsHeader title="새 회원 요청" />
      <View style={styles.tabs}>
        <TouchableOpacity style={[styles.tab, tab === 'pending' && styles.tabActive]} onPress={() => setTab('pending')}>
          <Text style={[styles.tabTxt, tab === 'pending' && styles.tabTxtActive]}>확인 필요 {pending.length}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.tab, tab === 'done' && styles.tabActive]} onPress={() => setTab('done')}>
          <Text style={[styles.tabTxt, tab === 'done' && styles.tabTxtActive]}>처리 완료</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <ActivityIndicator color={Colors.primary} style={{ marginTop: 48 }} />
      ) : (
        <ScrollView
          contentContainerStyle={styles.scroll}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={Colors.primary} />}
        >
          {list.length === 0 ? (
            <View style={styles.empty}>
              <Ionicons name="mail-open-outline" size={40} color={Colors.placeholder} />
              <Text style={styles.emptyTxt}>{tab === 'pending' ? '확인할 요청이 없어요.' : '처리한 요청이 없어요.'}</Text>
            </View>
          ) : (
            list.map((req) => (tab === 'pending' ? renderPending(req) : renderDone(req)))
          )}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  tabs: { flexDirection: 'row', backgroundColor: Colors.white, borderBottomWidth: 1, borderBottomColor: Colors.border },
  tab: { flex: 1, paddingVertical: 14, alignItems: 'center', borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabActive: { borderBottomColor: Colors.primary },
  tabTxt: { fontSize: 14, fontWeight: '600', color: Colors.mutedFg },
  tabTxtActive: { color: Colors.primary, fontWeight: '800' },
  scroll: { padding: 16 },
  card: {
    backgroundColor: Colors.white, borderRadius: Radius.lg, padding: 16, marginBottom: 12,
    borderWidth: 1, borderColor: Colors.border,
  },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start' },
  name: { fontSize: 16, fontWeight: '800', color: Colors.navy },
  phone: { fontSize: 13, color: Colors.mutedFg, marginTop: 2 },
  matchRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 12 },
  matchTxt: { fontSize: 13, fontWeight: '700', color: Colors.success },
  primaryBtn: { marginTop: 14, backgroundColor: Colors.primary, borderRadius: Radius.md, paddingVertical: 12, alignItems: 'center' },
  primaryBtnTxt: { fontSize: 14, fontWeight: '700', color: Colors.white },
  statusPill: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  pillOk: { backgroundColor: Colors.successLight },
  pillMuted: { backgroundColor: Colors.mutedBg },
  statusPillTxt: { fontSize: 12, fontWeight: '700', color: Colors.mutedFg },
  doneHint: { fontSize: 12, color: Colors.mutedFg, marginTop: 10, lineHeight: 17 },
  empty: { alignItems: 'center', marginTop: 64, gap: 12 },
  emptyTxt: { fontSize: 14, color: Colors.mutedFg },
});
