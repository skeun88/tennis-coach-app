import { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, SafeAreaView, Alert,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../lib/supabase';

const CREAM = '#F7F0E9';
const TERRA = '#C0755A';
const BROWN = '#3E2B22';
const WARM_GRAY = '#8B7355';

type Consultation = {
  id: string;
  guest_name: string | null;
  guest_phone: string | null;
  message: string | null;
  consultation_status: string;
  viewed_at: string | null;
  created_at: string;
  source: string;
  requested_date: string | null;
  start_time: string | null;
  package_id: string | null;
};

type PackageInfo = {
  title: string;
  duration_minutes: number | null;
  total_credits: number | null;
  price: number | null;
  days: number | null;
};

const STATUS_LABEL: Record<string, string> = {
  new_inquiry: '신규 문의',
  consulting: '상담 중',
  trial_scheduled: '체험 예정',
  registered: '등록 완료',
  closed: '종료',
};

const STATUS_COLOR: Record<string, { bg: string; text: string }> = {
  new_inquiry: { bg: '#FCE8E0', text: '#C0755A' },
  consulting: { bg: '#E8F0FE', text: '#4A6FA5' },
  trial_scheduled: { bg: '#E8F5E8', text: '#3A7D44' },
  registered: { bg: '#EDE0D4', text: '#6B4C3B' },
  closed: { bg: '#F0EEEC', text: '#9E9289' },
};

const STATUS_ACTIONS: { key: string; label: string; icon: string }[] = [
  { key: 'new_inquiry', label: '신규 문의', icon: 'mail-outline' },
  { key: 'consulting', label: '상담 중', icon: 'chatbubble-ellipses-outline' },
  { key: 'trial_scheduled', label: '체험 예정', icon: 'calendar-outline' },
  { key: 'registered', label: '등록 완료', icon: 'checkmark-circle-outline' },
  { key: 'closed', label: '종료', icon: 'close-circle-outline' },
];

function formatDateTime(date: string | null, time: string | null): string {
  if (!date) return '-';
  const d = new Date(date);
  const base = `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
  return time ? `${base} ${time.slice(0, 5)}` : base;
}

function formatCreatedAt(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export default function ConsultationDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [item, setItem] = useState<Consultation | null>(null);
  const [packageInfo, setPackageInfo] = useState<PackageInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);

  useEffect(() => {
    if (!id) return;
    load();
  }, [id]);

  async function load() {
    setLoading(true);
    const { data } = await supabase
      .from('lesson_requests')
      .select('id, guest_name, guest_phone, message, consultation_status, viewed_at, created_at, source, requested_date, start_time, package_id')
      .eq('id', id)
      .maybeSingle();

    if (data) {
      setItem(data);
      // Mark as viewed if not yet
      if (!data.viewed_at) {
        await supabase.from('lesson_requests')
          .update({ viewed_at: new Date().toISOString() })
          .eq('id', id);
      }
      // Fetch package info if available
      if (data.package_id) {
        const { data: pkg } = await supabase
          .from('lesson_packages')
          .select('title, duration_minutes, total_credits, price, days')
          .eq('id', data.package_id)
          .maybeSingle();
        setPackageInfo(pkg ?? null);
      }
    }
    setLoading(false);
  }

  async function changeStatus(newStatus: string) {
    if (!item) return;
    if (newStatus === item.consultation_status) return;

    setUpdating(true);
    const { error } = await supabase
      .from('lesson_requests')
      .update({ consultation_status: newStatus })
      .eq('id', item.id);

    if (error) {
      Alert.alert('오류', '상태 변경에 실패했습니다.');
    } else {
      setItem(prev => prev ? { ...prev, consultation_status: newStatus } : prev);
    }
    setUpdating(false);
  }

  if (loading) {
    return (
      <SafeAreaView style={[styles.safeArea, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator color={TERRA} />
      </SafeAreaView>
    );
  }

  if (!item) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <Ionicons name="chevron-back" size={24} color={BROWN} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>상담 상세</Text>
          <View style={{ width: 40 }} />
        </View>
        <View style={styles.center}>
          <Text style={styles.emptyText}>문의 정보를 찾을 수 없습니다.</Text>
        </View>
      </SafeAreaView>
    );
  }

  const statusStyle = STATUS_COLOR[item.consultation_status] ?? STATUS_COLOR.closed;

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={24} color={BROWN} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>상담 상세</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* 이름 + 현재 상태 */}
        <View style={styles.topCard}>
          <View style={styles.nameRow}>
            <Text style={styles.guestName}>{item.guest_name ?? '이름 없음'}</Text>
            <Text style={[styles.statusChip, { backgroundColor: statusStyle.bg, color: statusStyle.text }]}>
              {STATUS_LABEL[item.consultation_status] ?? item.consultation_status}
            </Text>
          </View>
          {item.guest_phone && (
            <Text style={styles.infoText}>
              <Ionicons name="call-outline" size={13} color={WARM_GRAY} /> {item.guest_phone}
            </Text>
          )}
          <Text style={styles.dateText}>접수: {formatCreatedAt(item.created_at)}</Text>
          {/* 웹 문의는 requested_date가 오늘 날짜 + start_time 00:00으로 자동 설정되므로 표시하지 않음 */}
          {item.source !== 'web' && item.requested_date && (
            <Text style={styles.dateText}>요청 날짜: {formatDateTime(item.requested_date, item.start_time)}</Text>
          )}
        </View>

        {/* 문의 내용 */}
        {item.message && (
          <View style={styles.sectionCard}>
            <Text style={styles.sectionLabel}>문의 내용</Text>
            <Text style={styles.messageText}>{item.message}</Text>
          </View>
        )}

        {/* 관심 패키지 */}
        <View style={styles.sectionCard}>
          <Text style={styles.sectionLabel}>관심 패키지</Text>
          {packageInfo ? (
            <View style={styles.packageBox}>
              <Text style={styles.packageTitle}>{packageInfo.title}</Text>
              <View style={styles.packageMetaRow}>
                {packageInfo.duration_minutes != null && (
                  <Text style={styles.packageMeta}>회당 {packageInfo.duration_minutes}분</Text>
                )}
                {packageInfo.total_credits != null && (
                  <Text style={styles.packageMeta}>총 {packageInfo.total_credits}회</Text>
                )}
                {packageInfo.days != null && (
                  <Text style={styles.packageMeta}>{packageInfo.days}일</Text>
                )}
              </View>
              {packageInfo.price != null && (
                <Text style={styles.packagePrice}>{packageInfo.price.toLocaleString()}원</Text>
              )}
            </View>
          ) : (
            <Text style={styles.packageNone}>선택 안 함</Text>
          )}
        </View>

        {/* 상태 변경 */}
        <View style={styles.sectionCard}>
          <Text style={styles.sectionLabel}>상담 단계</Text>
          {updating && (
            <ActivityIndicator color={TERRA} style={{ marginBottom: 8 }} />
          )}
          <View style={styles.statusGrid}>
            {STATUS_ACTIONS.map(action => {
              const isActive = item.consultation_status === action.key;
              return (
                <TouchableOpacity
                  key={action.key}
                  style={[styles.statusBtn, isActive && styles.statusBtnActive]}
                  onPress={() => changeStatus(action.key)}
                  disabled={updating}
                  activeOpacity={0.75}
                >
                  <Ionicons
                    name={action.icon as any}
                    size={16}
                    color={isActive ? '#fff' : WARM_GRAY}
                  />
                  <Text style={[styles.statusBtnText, isActive && styles.statusBtnTextActive]}>
                    {action.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: CREAM },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 8, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#EDE0D4',
  },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '700', color: BROWN },
  content: { padding: 16, gap: 12 },
  topCard: {
    backgroundColor: '#fff', borderRadius: 16, padding: 16,
    borderWidth: 1, borderColor: '#EDE0D4',
  },
  nameRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  guestName: { fontSize: 20, fontWeight: '700', color: BROWN },
  statusChip: {
    fontSize: 12, fontWeight: '600', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10,
  },
  infoText: { fontSize: 14, color: WARM_GRAY, marginBottom: 4 },
  dateText: { fontSize: 12, color: '#9E9289', marginTop: 2 },
  sectionCard: {
    backgroundColor: '#fff', borderRadius: 16, padding: 16,
    borderWidth: 1, borderColor: '#EDE0D4',
  },
  sectionLabel: { fontSize: 12, fontWeight: '600', color: WARM_GRAY, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 },
  messageText: { fontSize: 14, color: '#3E2B22', lineHeight: 22 },
  statusGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  statusBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10,
    backgroundColor: '#F7F0E9', borderWidth: 1, borderColor: '#EDE0D4',
  },
  statusBtnActive: { backgroundColor: TERRA, borderColor: TERRA },
  statusBtnText: { fontSize: 13, fontWeight: '600', color: WARM_GRAY },
  statusBtnTextActive: { color: '#fff' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyText: { fontSize: 14, color: WARM_GRAY },
  packageBox: {
    backgroundColor: '#F7F0E9', borderRadius: 10, padding: 12,
    borderWidth: 1, borderColor: '#EDE0D4',
  },
  packageTitle: { fontSize: 15, fontWeight: '700', color: BROWN, marginBottom: 6 },
  packageMetaRow: { flexDirection: 'row', gap: 8, marginBottom: 4, flexWrap: 'wrap' },
  packageMeta: {
    fontSize: 12, color: WARM_GRAY,
    backgroundColor: '#fff', paddingHorizontal: 8, paddingVertical: 3,
    borderRadius: 6, borderWidth: 1, borderColor: '#EDE0D4',
  },
  packagePrice: { fontSize: 14, fontWeight: '600', color: TERRA, marginTop: 4 },
  packageNone: { fontSize: 14, color: WARM_GRAY, fontStyle: 'italic' },
});
