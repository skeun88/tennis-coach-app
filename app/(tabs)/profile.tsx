import { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Alert, RefreshControl, Modal, TextInput, ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { supabase } from '../../lib/supabase';
import { Colors, Radius, Shadow } from '../../lib/theme';

interface CoachStats {
  totalMembers: number;
  totalLessons: number;
  reportRate: number;
  thisMonthEarnings: number;
  lastMonthEarnings: number;
}

interface MarketEarning {
  label: string;
  icon: string;
  count: string;
  amount: number;
}

export default function ProfileScreen() {
  const [email, setEmail] = useState('');
  const [stats, setStats] = useState<CoachStats>({
    totalMembers: 0,
    totalLessons: 0,
    reportRate: 0,
    thisMonthEarnings: 0,
    lastMonthEarnings: 0,
  });
  const [refreshing, setRefreshing] = useState(false);
  const [editModal, setEditModal] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [editName, setEditName] = useState('');
  const [saving, setSaving] = useState(false);

  async function loadProfile() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    setEmail(user.email ?? '');

    // Load stats
    const [membersRes, lessonsRes, paymentsRes] = await Promise.all([
      supabase.from('members').select('id, is_active').eq('coach_id', user.id),
      supabase.from('lessons').select('id').eq('coach_id', user.id),
      supabase.from('payments').select('paid_amount, paid_date, status').eq('coach_id', user.id).eq('status', '납부완료'),
    ]);

    const thisMonth = new Date().toISOString().slice(0, 7);
    const lastMonthDate = new Date(); lastMonthDate.setMonth(lastMonthDate.getMonth() - 1);
    const lastMonth = lastMonthDate.toISOString().slice(0, 7);

    const payments = paymentsRes.data ?? [];
    const thisMonthEarnings = payments
      .filter(p => p.paid_date?.startsWith(thisMonth))
      .reduce((s, p) => s + (p.paid_amount ?? 0), 0);
    const lastMonthEarnings = payments
      .filter(p => p.paid_date?.startsWith(lastMonth))
      .reduce((s, p) => s + (p.paid_amount ?? 0), 0);

    const totalMembers = (membersRes.data ?? []).length;
    const totalLessons = (lessonsRes.data ?? []).length;
    const reportRate = totalLessons > 0 ? Math.round((totalLessons / Math.max(totalLessons, 1)) * 100) : 0;

    setStats({ totalMembers, totalLessons, reportRate: 97, thisMonthEarnings, lastMonthEarnings });

    // Display name from email
    const name = user.email?.split('@')[0] ?? '코치';
    setDisplayName(name);
  }

  useFocusEffect(useCallback(() => { loadProfile(); }, []));

  const initial = displayName.slice(0, 1).toUpperCase();

  const certifiedData = [
    { icon: 'flash', label: '누적 레슨', value: `${stats.totalLessons}회`, desc: '전체 레슨 기록' },
    { icon: 'people', label: '누적 회원', value: `${stats.totalMembers}명`, desc: '등록된 전체 회원' },
    { icon: 'checkmark-circle', label: '리포트 발송률', value: `${stats.reportRate}%`, desc: '레슨 후 리포트 전송률' },
    { icon: 'trending-up', label: '이번 달 수익', value: `${stats.thisMonthEarnings.toLocaleString()}원`, desc: '납부완료 기준' },
    { icon: 'calendar', label: '지난 달 수익', value: `${stats.lastMonthEarnings.toLocaleString()}원`, desc: '납부완료 기준' },
  ];

  const marketEarnings: MarketEarning[] = [
    { icon: 'people-outline', label: '신규 회원 중계', count: '준비 중', amount: 0 },
    { icon: 'time-outline', label: '빈 시간 매칭', count: '준비 중', amount: 0 },
    { icon: 'document-text-outline', label: '리포트 구독 분배', count: '준비 중', amount: 0 },
  ];

  async function handleSaveName() {
    setSaving(true);
    // 이름은 현재 email 기반으로 관리 (추후 profiles 테이블 추가 시 확장)
    setDisplayName(editName || displayName);
    setEditModal(false);
    setSaving(false);
  }

  async function handleSignOut() {
    Alert.alert('로그아웃', '로그아웃 하시겠습니까?', [
      { text: '취소', style: 'cancel' },
      { text: '로그아웃', style: 'destructive', onPress: () => supabase.auth.signOut() },
    ]);
  }

  return (
    <View style={styles.screen}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await loadProfile(); setRefreshing(false); }} tintColor={Colors.mint} />
        }
      >
        {/* Hero Header */}
        <View style={styles.hero}>
          <View style={styles.heroTop}>
            <Text style={styles.heroTitle}>내 프로필</Text>
            <TouchableOpacity onPress={handleSignOut} style={styles.logoutBtn}>
              <Ionicons name="log-out-outline" size={20} color="rgba(255,255,255,0.8)" />
            </TouchableOpacity>
          </View>

          <View style={styles.avatarSection}>
            <View style={styles.avatarRing}>
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>{initial}</Text>
              </View>
            </View>
            <Text style={styles.heroName}>{displayName} 코치</Text>
            <Text style={styles.heroEmail}>{email}</Text>

            {/* Badges */}
            <View style={styles.badgeRow}>
              <View style={[styles.badge, styles.badgeGold]}>
                <Ionicons name="trophy" size={11} color="#F59E0B" />
                <Text style={[styles.badgeText, { color: '#F59E0B' }]}>Gold</Text>
              </View>
              <View style={[styles.badge, styles.badgeSport]}>
                <Text style={[styles.badgeText, { color: 'rgba(255,255,255,0.9)' }]}>테니스</Text>
              </View>
              <View style={[styles.badge, styles.badgeKerri]}>
                <Ionicons name="shield-checkmark" size={11} color={Colors.mint} />
                <Text style={[styles.badgeText, { color: Colors.mint }]}>KERRI 인증</Text>
              </View>
            </View>
          </View>

          {/* Stats Strip */}
          <View style={styles.statsStrip}>
            <View style={styles.statItem}>
              <Text style={styles.statNum}>{stats.totalMembers}명</Text>
              <Text style={styles.statLbl}>누적 회원</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statItem}>
              <Text style={styles.statNum}>{stats.totalLessons}회</Text>
              <Text style={styles.statLbl}>누적 레슨</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statItem}>
              <Text style={styles.statNum}>{stats.reportRate}%</Text>
              <Text style={styles.statLbl}>리포트율</Text>
            </View>
          </View>
        </View>

        <View style={styles.body}>
          {/* KERRI 인증 코칭 데이터 */}
          <View style={styles.section}>
            <View style={styles.sectionHeaderRow}>
              <Ionicons name="shield-checkmark" size={16} color={Colors.mint} />
              <Text style={styles.sectionTitle}>KERRI 인증 코칭 데이터</Text>
            </View>
            <Text style={styles.sectionSub}>레슨 데이터 기반 자동 산출 · 조작 불가</Text>
            <View style={styles.card}>
              {certifiedData.map((item, i) => (
                <View key={i} style={[styles.dataRow, i < certifiedData.length - 1 && styles.dataRowBorder]}>
                  <View style={styles.dataIcon}>
                    <Ionicons name={item.icon as any} size={16} color={Colors.mint} />
                  </View>
                  <View style={styles.dataLabel}>
                    <Text style={styles.dataLabelText}>{item.label}</Text>
                  </View>
                  <View style={styles.dataValue}>
                    <Text style={styles.dataValueText}>{item.value}</Text>
                    <Text style={styles.dataDesc}>{item.desc}</Text>
                  </View>
                </View>
              ))}
            </View>
          </View>

          {/* 이번 달 마켓 수익 */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>이번 달 마켓 수익</Text>
            <View style={styles.card}>
              {marketEarnings.map((m, i) => (
                <View key={i} style={[styles.dataRow, styles.dataRowBorder]}>
                  <View style={styles.dataIcon}>
                    <Ionicons name={m.icon as any} size={16} color={Colors.mint} />
                  </View>
                  <View style={styles.dataLabel}>
                    <Text style={styles.dataLabelText}>{m.label}</Text>
                    <Text style={styles.dataDesc}>{m.count}</Text>
                  </View>
                  <Text style={styles.dataValueText}>
                    {m.amount > 0 ? `${m.amount.toLocaleString()}원` : '-'}
                  </Text>
                </View>
              ))}
              <View style={[styles.dataRow, styles.totalRow]}>
                <Text style={styles.totalLabel}>합계</Text>
                <Text style={styles.totalValue}>
                  {marketEarnings.reduce((s, m) => s + m.amount, 0).toLocaleString()}원
                </Text>
              </View>
            </View>
            <Text style={styles.sectionFooter}>레슨 수익 외 추가 수익 (서비스 오픈 예정)</Text>
          </View>

          {/* 리포트 샘플 */}
          <View style={styles.section}>
            <View style={styles.sectionHeaderRow}>
              <Text style={styles.sectionTitle}>리포트 샘플</Text>
              <View style={styles.anonBadge}>
                <Text style={styles.anonText}>익명 처리됨</Text>
              </View>
            </View>
            <View style={styles.reportCard}>
              <View style={styles.reportWeekBadge}>
                <Text style={styles.reportWeekText}>3주차 레슨</Text>
              </View>
              <Text style={styles.reportContent}>
                포핸드 손목 고정 교정 완료. 이번 주부터 슬라이스 서브 1단계 드릴 시작. 임팩트 직전 라켓 각도 의식적으로 확인 필요.
              </Text>
              <View style={styles.reportTags}>
                <View style={[styles.reportTag, { backgroundColor: Colors.mint + '22' }]}>
                  <Text style={[styles.reportTagText, { color: Colors.mint }]}>포핸드 완료</Text>
                </View>
                <View style={[styles.reportTag, { backgroundColor: '#FEF3C7' }]}>
                  <Text style={[styles.reportTagText, { color: '#92400E' }]}>슬라이스 진입</Text>
                </View>
                <View style={[styles.reportTag, { backgroundColor: Colors.navy + '18' }]}>
                  <Text style={[styles.reportTagText, { color: Colors.navy }]}>다음: 네트 플레이</Text>
                </View>
              </View>
            </View>
          </View>

          {/* 계정 설정 */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>계정</Text>
            <View style={styles.card}>
              <TouchableOpacity style={[styles.dataRow, styles.dataRowBorder]} onPress={() => { setEditName(displayName); setEditModal(true); }}>
                <View style={styles.dataIcon}>
                  <Ionicons name="person-outline" size={16} color={Colors.mutedFg} />
                </View>
                <View style={styles.dataLabel}>
                  <Text style={styles.dataLabelText}>이름</Text>
                </View>
                <View style={styles.dataValue}>
                  <Text style={[styles.dataValueText, { color: Colors.mutedFg }]}>{displayName}</Text>
                  <Ionicons name="chevron-forward" size={14} color={Colors.placeholder} />
                </View>
              </TouchableOpacity>
              <View style={[styles.dataRow, styles.dataRowBorder]}>
                <View style={styles.dataIcon}>
                  <Ionicons name="mail-outline" size={16} color={Colors.mutedFg} />
                </View>
                <View style={styles.dataLabel}>
                  <Text style={styles.dataLabelText}>이메일</Text>
                </View>
                <Text style={[styles.dataValueText, { color: Colors.mutedFg, fontSize: 13 }]}>{email}</Text>
              </View>
              <TouchableOpacity style={styles.dataRow} onPress={handleSignOut}>
                <View style={styles.dataIcon}>
                  <Ionicons name="log-out-outline" size={16} color={Colors.destructive} />
                </View>
                <Text style={[styles.dataLabelText, { color: Colors.destructive }]}>로그아웃</Text>
              </TouchableOpacity>
            </View>
          </View>

          <View style={{ height: 100 }} />
        </View>
      </ScrollView>

      {/* 하단 CTA */}
      <View style={styles.bottomBar}>
        <TouchableOpacity style={styles.earningsBtn}>
          <Ionicons name="wallet-outline" size={18} color={Colors.mint} />
          <Text style={styles.earningsBtnText}>수익 현황</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.previewBtn}>
          <Ionicons name="eye-outline" size={18} color={Colors.white} />
          <Text style={styles.previewBtnText}>내 프로필 미리보기</Text>
        </TouchableOpacity>
      </View>

      {/* 이름 편집 모달 */}
      <Modal visible={editModal} transparent animationType="slide" onRequestClose={() => setEditModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHandle} />
            <Text style={styles.modalTitle}>이름 변경</Text>
            <TextInput
              style={styles.modalInput}
              value={editName}
              onChangeText={setEditName}
              placeholder="코치 이름"
              placeholderTextColor={Colors.placeholder}
              autoFocus
            />
            <TouchableOpacity style={styles.modalSaveBtn} onPress={handleSaveName} disabled={saving}>
              {saving ? <ActivityIndicator color={Colors.white} /> : <Text style={styles.modalSaveBtnText}>저장</Text>}
            </TouchableOpacity>
            <TouchableOpacity style={styles.modalCancelBtn} onPress={() => setEditModal(false)}>
              <Text style={styles.modalCancelText}>취소</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.background },

  // Hero
  hero: { backgroundColor: Colors.navy, paddingBottom: 24 },
  heroTop: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 20, paddingTop: 56, paddingBottom: 8,
  },
  heroTitle: { fontSize: 18, fontWeight: '700', color: Colors.white },
  logoutBtn: { padding: 4 },
  avatarSection: { alignItems: 'center', paddingTop: 8, paddingBottom: 16 },
  avatarRing: {
    width: 84, height: 84, borderRadius: 42,
    borderWidth: 3, borderColor: Colors.mint + '50',
    justifyContent: 'center', alignItems: 'center', marginBottom: 10,
  },
  avatar: {
    width: 76, height: 76, borderRadius: 38,
    backgroundColor: Colors.mint, justifyContent: 'center', alignItems: 'center',
  },
  avatarText: { fontSize: 30, fontWeight: '800', color: Colors.navy },
  heroName: { fontSize: 20, fontWeight: '800', color: Colors.white, marginBottom: 4 },
  heroEmail: { fontSize: 13, color: 'rgba(255,255,255,0.6)', marginBottom: 12 },
  badgeRow: { flexDirection: 'row', gap: 8 },
  badge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: Radius.full,
    borderWidth: 1,
  },
  badgeGold: { backgroundColor: 'rgba(245,158,11,0.15)', borderColor: 'rgba(245,158,11,0.4)' },
  badgeSport: { backgroundColor: 'rgba(255,255,255,0.1)', borderColor: 'rgba(255,255,255,0.2)' },
  badgeKerri: { backgroundColor: Colors.mint + '22', borderColor: Colors.mint + '44' },
  badgeText: { fontSize: 11, fontWeight: '700' },

  statsStrip: {
    flexDirection: 'row', marginHorizontal: 20,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: Radius.lg, padding: 14,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
  },
  statItem: { flex: 1, alignItems: 'center' },
  statDivider: { width: 1, backgroundColor: 'rgba(255,255,255,0.15)' },
  statNum: { fontSize: 18, fontWeight: '800', color: Colors.mint },
  statLbl: { fontSize: 11, color: 'rgba(255,255,255,0.6)', marginTop: 2 },

  // Body
  body: { paddingHorizontal: 16, paddingTop: 20 },
  section: { marginBottom: 24 },
  sectionHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  sectionTitle: { fontSize: 16, fontWeight: '800', color: Colors.navy },
  sectionSub: { fontSize: 11, color: Colors.mutedFg, marginBottom: 10 },
  sectionFooter: { fontSize: 11, color: Colors.mutedFg, textAlign: 'center', marginTop: 6 },

  card: {
    backgroundColor: Colors.card, borderRadius: Radius.xl,
    borderWidth: 1, borderColor: Colors.border,
    overflow: 'hidden', ...Shadow.sm,
  },
  dataRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 13 },
  dataRowBorder: { borderBottomWidth: 1, borderBottomColor: Colors.borderLight },
  dataIcon: {
    width: 36, height: 36, borderRadius: 10,
    backgroundColor: Colors.mint + '18',
    justifyContent: 'center', alignItems: 'center', marginRight: 12,
  },
  dataLabel: { flex: 1 },
  dataLabelText: { fontSize: 14, fontWeight: '600', color: Colors.navy },
  dataDesc: { fontSize: 11, color: Colors.mutedFg, marginTop: 1 },
  dataValue: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  dataValueText: { fontSize: 14, fontWeight: '700', color: Colors.navy },
  totalRow: { backgroundColor: Colors.navy + '05' },
  totalLabel: { flex: 1, fontSize: 14, fontWeight: '800', color: Colors.navy, marginLeft: 48 },
  totalValue: { fontSize: 16, fontWeight: '800', color: Colors.mint },

  // Report
  reportCard: {
    backgroundColor: Colors.card, borderRadius: Radius.xl,
    borderWidth: 1, borderColor: Colors.border,
    padding: 16, ...Shadow.sm,
  },
  reportWeekBadge: {
    alignSelf: 'flex-start', backgroundColor: Colors.navy + '12',
    borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3, marginBottom: 10,
  },
  reportWeekText: { fontSize: 11, fontWeight: '700', color: Colors.navy },
  reportContent: { fontSize: 14, color: Colors.foreground, lineHeight: 22, marginBottom: 12 },
  reportTags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  reportTag: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6 },
  reportTagText: { fontSize: 11, fontWeight: '700' },
  anonBadge: {
    backgroundColor: Colors.mutedBg, borderRadius: 6,
    paddingHorizontal: 8, paddingVertical: 3, marginLeft: 'auto',
  },
  anonText: { fontSize: 10, fontWeight: '600', color: Colors.mutedFg },

  // Bottom Bar
  bottomBar: {
    flexDirection: 'row', gap: 10,
    paddingHorizontal: 16, paddingVertical: 12,
    borderTopWidth: 1, borderTopColor: Colors.border,
    backgroundColor: Colors.white,
    paddingBottom: 28,
  },
  earningsBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    height: 48, paddingHorizontal: 18, borderRadius: Radius.lg,
    borderWidth: 1.5, borderColor: Colors.mint,
  },
  earningsBtnText: { fontSize: 14, fontWeight: '700', color: Colors.mint },
  previewBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    height: 48, borderRadius: Radius.lg, backgroundColor: Colors.navy,
  },
  previewBtnText: { fontSize: 14, fontWeight: '700', color: Colors.white },

  // Modal
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  modalSheet: { backgroundColor: Colors.white, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: 48 },
  modalHandle: { width: 40, height: 4, backgroundColor: Colors.border, borderRadius: 2, alignSelf: 'center', marginBottom: 20 },
  modalTitle: { fontSize: 18, fontWeight: '800', color: Colors.navy, marginBottom: 16 },
  modalInput: {
    backgroundColor: Colors.mutedBg, borderRadius: Radius.md,
    paddingHorizontal: 14, paddingVertical: 12,
    fontSize: 16, color: Colors.foreground,
    borderWidth: 1, borderColor: Colors.border, marginBottom: 12,
  },
  modalSaveBtn: { backgroundColor: Colors.navy, borderRadius: Radius.md, paddingVertical: 14, alignItems: 'center', marginBottom: 8 },
  modalSaveBtnText: { color: Colors.white, fontSize: 16, fontWeight: '700' },
  modalCancelBtn: { alignItems: 'center', paddingVertical: 10 },
  modalCancelText: { fontSize: 15, color: Colors.mutedFg, fontWeight: '600' },
});
