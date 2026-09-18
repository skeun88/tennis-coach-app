import { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Alert, ActivityIndicator, Platform, Modal, TextInput,
  KeyboardAvoidingView, SafeAreaView,
} from 'react-native';
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../lib/supabase';
import { notifyMemberReport } from '../../lib/notifications';
import { LessonPlan, DrillSuggestion } from '../../types';
import { Colors } from '../../lib/theme';

const CREAM = '#F7F0E9';
const TERRACOTTA = '#C0755A';
const DARK_BROWN = '#3E2B22';
const SAGE_BG = '#EEF5EE';
const SAGE_TEXT = '#4A7A4A';
const WARM_BG = '#FDF3ED';

export default function PlanDetailScreen() {
  const { planId, memberId, memberName, memberLevel } = useLocalSearchParams<{
    planId: string;
    memberId: string;
    memberName: string;
    memberLevel: string;
  }>();
  const router = useRouter();

  const [plan, setPlan] = useState<LessonPlan | null>(null);
  const [report, setReport] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [expandedTranscript, setExpandedTranscript] = useState(false);
  const [sending, setSending] = useState(false);

  const [editModalVisible, setEditModalVisible] = useState(false);
  const [editingSection, setEditingSection] = useState<string>('');
  const [editingValue, setEditingValue] = useState('');
  const [editModalLabel, setEditModalLabel] = useState('');
  const [savingSection, setSavingSection] = useState(false);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [planId])
  );

  async function loadData() {
    setLoading(true);
    const [planRes, reportRes] = await Promise.all([
      supabase.from('lesson_plans').select('*').eq('id', planId).single(),
      supabase.from('member_lesson_reports').select('*').eq('lesson_plan_id', planId).maybeSingle(),
    ]);
    setPlan(planRes.data ?? null);
    setReport(reportRes.data ?? null);
    setLoading(false);
  }

  function formatDate(dateStr: string) {
    const d = new Date(dateStr);
    const days = ['일', '월', '화', '수', '목', '금', '토'];
    return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')} (${days[d.getDay()]})`;
  }

  function cleanSummary(val: unknown): string {
    if (!val) return '';
    const str = String(val).trim();
    if (str.startsWith('{')) {
      try {
        const parsed = JSON.parse(str);
        return parsed.summary || parsed.lesson_flow || parsed.content || str;
      } catch { /* fall through */ }
    }
    return str
      .replace(/```json[\s\S]*?```/g, '')
      .replace(/```[\s\S]*?```/g, '')
      .replace(/\{[\s\S]*?\}/g, (match) => {
        try { const p = JSON.parse(match); return p.summary || p.lesson_flow || ''; } catch { return ''; }
      })
      .trim() || str;
  }

  function toStringArray(val: unknown): string[] {
    if (Array.isArray(val)) return val.map(String).filter(Boolean);
    if (typeof val === 'string') {
      const trimmed = val.trim();
      if (trimmed.startsWith('[')) {
        try {
          const parsed = JSON.parse(trimmed);
          if (Array.isArray(parsed)) return parsed.map(String).filter(Boolean);
        } catch {}
      }
      return trimmed.replace(/\\n/g, '\n').split('\n')
        .map(l => l.replace(/^\s*\d+[\.\)]\s*/, '').trim()).filter(Boolean);
    }
    return [];
  }

  async function saveSectionEdit(section: string, value: string) {
    if (!plan) return;
    setSavingSection(true);
    try {
      if (section === 'achievements') {
        const lines = value.split('\n').map(l => l.trim()).filter(Boolean);
        await supabase.from('member_lesson_reports').update({ achievements: lines }).eq('lesson_plan_id', plan.id);
        setReport((prev: any) => ({ ...prev, achievements: lines }));
      } else {
        await supabase.from('lesson_plans').update({ [section]: value }).eq('id', plan.id);
        setPlan(prev => prev ? { ...prev, [section]: value } : prev);
      }
    } catch {
      Alert.alert('오류', '저장에 실패했습니다.');
    } finally {
      setSavingSection(false);
      setEditModalVisible(false);
    }
  }

  async function sendReportToMember() {
    if (!plan || !report) {
      Alert.alert('안내', '회원 리포트가 아직 생성 중입니다. 잠시 후 다시 시도해주세요.');
      return;
    }
    if (report.sent_to_member) {
      Alert.alert('이미 전송됨', '이미 회원에게 전송된 리포트입니다.');
      return;
    }
    setSending(true);
    try {
      await supabase.from('member_lesson_reports')
        .update({ sent_to_member: true, is_read: false })
        .eq('id', report.id);
      try { await notifyMemberReport(plan.member_id); } catch (e) { console.error('[PUSH] 리포트 알림 실패:', e); }
      setReport((prev: any) => ({ ...prev, sent_to_member: true }));
      Alert.alert('전송 완료', '회원이 앱을 열면 리포트를 확인할 수 있어요.');
    } catch {
      Alert.alert('오류', '전송에 실패했습니다.');
    } finally {
      setSending(false);
    }
  }

  function openEdit(section: string, label: string, value: string) {
    setEditingSection(section);
    setEditModalLabel(label);
    setEditingValue(value);
    setEditModalVisible(true);
  }

  if (loading) {
    return (
      <View style={[s.container, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator size="large" color={TERRACOTTA} />
      </View>
    );
  }

  if (!plan) {
    return (
      <View style={s.container}>
        <SafeAreaView style={s.safeHeader}>
          <View style={s.header}>
            <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
              <Ionicons name="chevron-back" size={24} color={DARK_BROWN} />
            </TouchableOpacity>
            <Text style={s.headerTitle}>AI 레슨 기록</Text>
          </View>
        </SafeAreaView>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ color: Colors.mutedFg }}>데이터를 불러올 수 없습니다.</Text>
        </View>
      </View>
    );
  }

  const achievements: string[] = report?.achievements ?? [];
  const improvementPoints = toStringArray(plan.improvement_points);
  const isSent = report?.sent_to_member === true;
  const hasReport = !!report;

  return (
    <View style={s.container}>
      {/* 헤더 */}
      <SafeAreaView style={s.safeHeader}>
        <View style={s.header}>
          <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
            <Ionicons name="chevron-back" size={24} color={DARK_BROWN} />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={s.headerTitle}>AI 레슨 기록</Text>
            <Text style={s.headerSub}>{memberName} · {memberLevel}</Text>
          </View>
          <View style={[s.statusBadge, isSent ? s.statusBadgeSent : s.statusBadgeUnsent]}>
            <Text style={[s.statusBadgeText, isSent ? s.statusTextSent : s.statusTextUnsent]}>
              {isSent ? '전송 완료' : '미전송'}
            </Text>
          </View>
        </View>
      </SafeAreaView>

      <ScrollView
        style={s.scroll}
        contentContainerStyle={s.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* 레슨 기본 정보 카드 */}
        <View style={s.infoCard}>
          <View style={s.infoCardTop}>
            <View style={{ flex: 1 }}>
              <View style={s.infoMetaRow}>
                <Ionicons name="calendar-outline" size={13} color={Colors.mutedFg} />
                <Text style={s.infoMetaText}>{formatDate(plan.created_at)}</Text>
                {plan.duration_minutes ? (
                  <>
                    <Text style={s.infoMetaDot}>·</Text>
                    <Ionicons name="time-outline" size={13} color={Colors.mutedFg} />
                    <Text style={s.infoMetaText}>{plan.duration_minutes}분</Text>
                  </>
                ) : null}
              </View>
              {plan.ai_title ? (
                <Text style={s.infoTitle}>{plan.ai_title}</Text>
              ) : null}
              <View style={s.sourceRow}>
                <Ionicons
                  name={(plan as any).source === 'manual' ? 'pencil-outline' : 'mic-outline'}
                  size={13}
                  color={TERRACOTTA}
                />
                <Text style={s.sourceText}>
                  {(plan as any).source === 'manual' ? '직접 작성' : '음성 기록'}
                </Text>
              </View>
            </View>
            <TouchableOpacity
              style={s.editRoundBtn}
              onPress={() => openEdit('summary', '레슨 요약 수정', cleanSummary(plan.summary))}
            >
              <Ionicons name="pencil-outline" size={15} color={TERRACOTTA} />
              <Text style={s.editRoundBtnText}>수정</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* 1. 오늘 레슨 요약 */}
        <View style={s.card}>
          <View style={s.cardTitleRow}>
            <Ionicons name="document-text-outline" size={18} color={TERRACOTTA} />
            <Text style={s.cardTitle}>오늘 레슨 요약</Text>
          </View>
          <Text style={s.summaryText}>{cleanSummary(plan.summary) || '-'}</Text>
        </View>

        {/* 2. 오늘 잘한 점 */}
        <View style={[s.card, s.cardSage]}>
          <View style={s.cardTitleRow}>
            <Ionicons name="checkmark-circle-outline" size={18} color={SAGE_TEXT} />
            <Text style={[s.cardTitle, { color: SAGE_TEXT }]}>오늘 잘한 점</Text>
            {hasReport && (
              <TouchableOpacity
                style={s.cardEditIcon}
                onPress={() => openEdit('achievements', '잘한 점 수정 (줄바꿈으로 구분)', achievements.join('\n'))}
              >
                <Ionicons name="pencil-outline" size={13} color={Colors.mutedFg} />
              </TouchableOpacity>
            )}
          </View>
          {achievements.length > 0 ? (
            achievements.map((item, i) => (
              <View key={i} style={s.checkRow}>
                <View style={s.checkIcon}>
                  <Ionicons name="checkmark" size={12} color={SAGE_TEXT} />
                </View>
                <Text style={s.checkText}>{item}</Text>
              </View>
            ))
          ) : (
            <Text style={s.emptyText}>
              {hasReport
                ? '잘한 점이 없습니다'
                : plan?.status === 'completed'
                ? 'AI 리포트 생성 중입니다. 잠시 후 다시 확인해 주세요.'
                : '분석 완료 후 표시됩니다.'}
            </Text>
          )}
        </View>

        {/* 3. 주의 포인트 (DB key: improvement_points) */}
        <View style={[s.card, s.cardWarm]}>
          <View style={s.cardTitleRow}>
            <Ionicons name="radio-button-on-outline" size={18} color={TERRACOTTA} />
            <Text style={[s.cardTitle, { color: TERRACOTTA }]}>주의 포인트</Text>
            <TouchableOpacity
              style={s.cardEditIcon}
              onPress={() => openEdit('improvement_points', '주의 포인트 수정 (줄바꿈으로 구분)', improvementPoints.join('\n'))}
            >
              <Ionicons name="pencil-outline" size={13} color={Colors.mutedFg} />
            </TouchableOpacity>
          </View>
          {improvementPoints.length > 0 ? (
            improvementPoints.map((item, i) => (
              <View key={i} style={s.targetRow}>
                <View style={s.targetIcon}>
                  <Ionicons name="navigate-circle-outline" size={16} color={TERRACOTTA} />
                </View>
                <Text style={s.targetText}>{item}</Text>
              </View>
            ))
          ) : (
            <Text style={s.emptyText}>주의 포인트가 없습니다</Text>
          )}
        </View>

        {/* 4. 개인 맞춤 연습 플랜 */}
        {Array.isArray(plan.drill_suggestions) && plan.drill_suggestions.length > 0 && (
          <View style={s.drillSection}>
            <View style={s.drillSectionTitle}>
              <Ionicons name="barbell-outline" size={18} color={TERRACOTTA} />
              <Text style={s.cardTitle}>개인 맞춤 연습 플랜</Text>
            </View>
            {plan.drill_suggestions.map((drill: DrillSuggestion, i: number) => (
              <DrillCardComponent key={i} drill={drill} />
            ))}
          </View>
        )}

        {/* 5. 레슨 전체 내용 보기 */}
        {plan.transcript_summary?.lesson_flow ? (
          <View style={s.card}>
            <TouchableOpacity
              style={s.accordionHeader}
              onPress={() => setExpandedTranscript(v => !v)}
              activeOpacity={0.7}
            >
              <Text style={s.accordionTitle}>레슨 전체 내용 보기</Text>
              <Ionicons
                name={expandedTranscript ? 'chevron-up' : 'chevron-down'}
                size={18}
                color={Colors.mutedFg}
              />
            </TouchableOpacity>
            {expandedTranscript && (
              <View style={s.accordionContent}>
                <Text style={s.transcriptText}>{plan.transcript_summary.lesson_flow}</Text>
              </View>
            )}
          </View>
        ) : null}

        <View style={{ height: 100 }} />
      </ScrollView>

      {/* 하단 고정 전송 버튼 */}
      <View style={s.bottomBar}>
        <SafeAreaView>
          {!hasReport ? (
            <View style={[s.sendBtn, s.sendBtnDisabled]}>
              <Text style={s.sendBtnTextDisabled}>리포트 생성 중...</Text>
            </View>
          ) : isSent ? (
            <View style={[s.sendBtn, s.sendBtnDone]}>
              <Ionicons name="checkmark-circle" size={18} color={Colors.success} />
              <Text style={[s.sendBtnText, { color: Colors.success }]}>전송 완료</Text>
            </View>
          ) : (
            <TouchableOpacity
              style={[s.sendBtn, sending && s.sendBtnLoading]}
              onPress={sendReportToMember}
              disabled={sending}
              activeOpacity={0.85}
            >
              {sending ? (
                <>
                  <ActivityIndicator size="small" color="#fff" />
                  <Text style={s.sendBtnText}>전송 중...</Text>
                </>
              ) : (
                <>
                  <Ionicons name="paper-plane-outline" size={18} color="#fff" />
                  <Text style={s.sendBtnText}>회원에게 전송</Text>
                </>
              )}
            </TouchableOpacity>
          )}
        </SafeAreaView>
      </View>

      {/* 섹션 편집 모달 */}
      <Modal
        visible={editModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setEditModalVisible(false)}
      >
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <TouchableOpacity
            style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)' }}
            activeOpacity={1}
            onPress={() => setEditModalVisible(false)}
          />
          <View style={s.editSheet}>
            <View style={s.editHeader}>
              <Text style={s.editTitle}>{editModalLabel}</Text>
              <TouchableOpacity onPress={() => setEditModalVisible(false)}>
                <Ionicons name="close" size={22} color={Colors.mutedFg} />
              </TouchableOpacity>
            </View>
            <TextInput
              style={s.editInput}
              value={editingValue}
              onChangeText={setEditingValue}
              multiline
              autoFocus
              textAlignVertical="top"
            />
            <View style={s.editBtnRow}>
              <TouchableOpacity style={s.editCancelBtn} onPress={() => setEditModalVisible(false)}>
                <Text style={s.editCancelText}>취소</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={s.editSaveBtn}
                onPress={() => saveSectionEdit(editingSection, editingValue)}
                disabled={savingSection}
              >
                <Text style={s.editSaveText}>{savingSection ? '저장 중...' : '저장'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

function DrillCardComponent({ drill }: { drill: DrillSuggestion }) {
  const d = drill as any;
  const hasMeta = drill.reps || d.duration || d.frequency;
  return (
    <View style={s.drillCard}>
      <Text style={s.drillName}>{drill.name}</Text>
      {drill.purpose ? (
        <View style={s.drillRow}>
          <Text style={s.drillLabel}>목적</Text>
          <Text style={s.drillValue}>{drill.purpose}</Text>
        </View>
      ) : null}
      {drill.method ? (
        <View style={s.drillRow}>
          <Text style={s.drillLabel}>방법</Text>
          <Text style={s.drillValue}>{drill.method}</Text>
        </View>
      ) : null}
      {drill.court_adaptation ? (
        <View style={s.drillRow}>
          <Text style={s.drillLabel}>코트 위치</Text>
          <Text style={s.drillValue}>{drill.court_adaptation}</Text>
        </View>
      ) : null}
      {hasMeta && (
        <View style={s.drillMetaRow}>
          {drill.reps ? <View style={s.drillMetaBadge}><Text style={s.drillMetaText}>{drill.reps}</Text></View> : null}
          {d.duration ? <View style={s.drillMetaBadge}><Text style={s.drillMetaText}>{d.duration}</Text></View> : null}
          {d.frequency ? <View style={s.drillMetaBadge}><Text style={s.drillMetaText}>{d.frequency}</Text></View> : null}
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: CREAM },
  safeHeader: { backgroundColor: CREAM },
  header: {
    backgroundColor: CREAM,
    paddingTop: Platform.OS === 'ios' ? 0 : 16,
    paddingBottom: 12,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  backBtn: { padding: 4 },
  headerTitle: { fontSize: 18, fontWeight: '800', color: DARK_BROWN },
  headerSub: { fontSize: 12, color: Colors.mutedFg, marginTop: 1 },

  statusBadge: {
    borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4,
    borderWidth: 1,
  },
  statusBadgeSent: { backgroundColor: Colors.successLight, borderColor: Colors.successBorder },
  statusBadgeUnsent: { backgroundColor: Colors.primaryLight, borderColor: '#E8C4B4' },
  statusBadgeText: { fontSize: 11, fontWeight: '700' },
  statusTextSent: { color: Colors.success },
  statusTextUnsent: { color: TERRACOTTA },

  scroll: { flex: 1 },
  scrollContent: { padding: 16, gap: 12 },

  infoCard: {
    backgroundColor: '#fff',
    borderRadius: 18,
    padding: 18,
    shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 }, elevation: 2,
  },
  infoCardTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  infoMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 6 },
  infoMetaText: { fontSize: 12, color: Colors.mutedFg },
  infoMetaDot: { fontSize: 12, color: Colors.placeholder, marginHorizontal: 2 },
  infoTitle: { fontSize: 17, fontWeight: '800', color: DARK_BROWN, lineHeight: 24, marginBottom: 8 },
  sourceRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  sourceText: { fontSize: 12, color: TERRACOTTA, fontWeight: '600' },
  editRoundBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: Colors.primaryLight, borderRadius: 20,
    paddingHorizontal: 12, paddingVertical: 6,
  },
  editRoundBtnText: { fontSize: 12, fontWeight: '700', color: TERRACOTTA },

  card: {
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 20,
    shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 5,
    shadowOffset: { width: 0, height: 1 }, elevation: 1,
  },
  cardSage: { backgroundColor: SAGE_BG },
  cardWarm: { backgroundColor: WARM_BG },
  cardTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 14 },
  cardTitle: { fontSize: 16, fontWeight: '800', color: DARK_BROWN, flex: 1 },
  cardEditIcon: {
    width: 26, height: 26, borderRadius: 13,
    backgroundColor: '#fff', borderWidth: 1, borderColor: Colors.border,
    justifyContent: 'center', alignItems: 'center',
  },

  summaryText: { fontSize: 16, color: DARK_BROWN, lineHeight: 26 },
  emptyText: { fontSize: 14, color: Colors.placeholder, fontStyle: 'italic' },

  checkRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 10 },
  checkIcon: {
    width: 20, height: 20, borderRadius: 10,
    backgroundColor: '#C8E8C8', justifyContent: 'center', alignItems: 'center',
    marginTop: 2, flexShrink: 0,
  },
  checkText: { fontSize: 16, color: DARK_BROWN, lineHeight: 26, flex: 1 },

  targetRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 10 },
  targetIcon: { marginTop: 2, flexShrink: 0 },
  targetText: { fontSize: 16, color: DARK_BROWN, lineHeight: 26, flex: 1 },

  drillSection: { gap: 10 },
  drillSectionTitle: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 4 },
  drillCard: {
    backgroundColor: '#fff',
    borderRadius: 18,
    padding: 18,
    shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 5,
    shadowOffset: { width: 0, height: 1 }, elevation: 1,
  },
  drillName: { fontSize: 16, fontWeight: '800', color: DARK_BROWN, marginBottom: 12 },
  drillRow: { marginBottom: 10 },
  drillLabel: { fontSize: 12, fontWeight: '600', color: Colors.mutedFg, marginBottom: 3 },
  drillValue: { fontSize: 15, color: DARK_BROWN, lineHeight: 23 },
  drillMetaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 },
  drillMetaBadge: {
    backgroundColor: Colors.primaryLight, borderRadius: 20,
    paddingHorizontal: 10, paddingVertical: 4,
  },
  drillMetaText: { fontSize: 12, fontWeight: '700', color: TERRACOTTA },

  accordionHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 4,
  },
  accordionTitle: { fontSize: 16, fontWeight: '700', color: DARK_BROWN },
  accordionContent: {
    marginTop: 14, paddingTop: 14,
    borderTopWidth: 1, borderTopColor: Colors.border,
  },
  transcriptText: { fontSize: 15, color: DARK_BROWN, lineHeight: 25 },

  bottomBar: {
    backgroundColor: '#fff',
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: Platform.OS === 'ios' ? 4 : 12,
  },
  sendBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: TERRACOTTA, borderRadius: 14, paddingVertical: 16,
    marginBottom: Platform.OS === 'ios' ? 8 : 0,
  },
  sendBtnLoading: { opacity: 0.75 },
  sendBtnDisabled: { backgroundColor: Colors.border },
  sendBtnDone: { backgroundColor: Colors.successLight, borderWidth: 1, borderColor: Colors.successBorder },
  sendBtnText: { fontSize: 16, fontWeight: '800', color: '#fff' },
  sendBtnTextDisabled: { fontSize: 15, fontWeight: '600', color: Colors.mutedFg },

  editSheet: {
    backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: 20, paddingBottom: 36, maxHeight: '70%',
  },
  editHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12,
  },
  editTitle: { fontSize: 15, fontWeight: '700', color: DARK_BROWN },
  editInput: {
    borderWidth: 1, borderColor: TERRACOTTA, borderRadius: 10,
    padding: 12, fontSize: 15, color: DARK_BROWN,
    minHeight: 120, textAlignVertical: 'top', lineHeight: 22,
    backgroundColor: '#fff', marginBottom: 12,
  },
  editBtnRow: { flexDirection: 'row', gap: 10 },
  editCancelBtn: {
    flex: 1, borderWidth: 1, borderColor: Colors.border, borderRadius: 10,
    paddingVertical: 12, alignItems: 'center',
  },
  editCancelText: { fontSize: 14, color: DARK_BROWN },
  editSaveBtn: {
    flex: 2, backgroundColor: TERRACOTTA, borderRadius: 10,
    paddingVertical: 12, alignItems: 'center',
  },
  editSaveText: { fontSize: 14, fontWeight: '700', color: '#fff' },
});
