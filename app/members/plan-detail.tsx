import { useEffect, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Alert, ActivityIndicator, Platform, Modal, TextInput, KeyboardAvoidingView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../lib/supabase';
import { notifyMemberReport } from '../../lib/notifications';
import { LessonPlan, DrillSuggestion } from '../../types';
import { Colors } from '../../lib/theme';

const SAGE = '#E8F0E5';
const SAGE_TEXT = '#3A6B35';
const WARM_YELLOW = '#FFF3E0';
const WARM_YELLOW_BORDER = '#FFD59E';

export default function PlanDetailScreen() {
  const { planId, memberId, memberName, memberLevel } = useLocalSearchParams<{
    planId: string;
    memberId: string;
    memberName: string;
    memberLevel: string;
  }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [plan, setPlan] = useState<LessonPlan | null>(null);
  const [report, setReport] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [expandedTranscript, setExpandedTranscript] = useState(false);

  const [editModalVisible, setEditModalVisible] = useState(false);
  const [editingSection, setEditingSection] = useState<string>('');
  const [editingValue, setEditingValue] = useState('');
  const [editModalLabel, setEditModalLabel] = useState('');
  const [savingSection, setSavingSection] = useState(false);

  const [isSending, setIsSending] = useState(false);
  const [hasSent, setHasSent] = useState(false);
  const [hasEditedAfterSend, setHasEditedAfterSend] = useState(false);

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
    return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
  }

  function formatTime(dateStr: string) {
    const d = new Date(dateStr);
    const h = d.getHours();
    const m = d.getMinutes();
    const ampm = h < 12 ? '오전' : '오후';
    return `${ampm} ${h % 12 || 12}:${String(m).padStart(2, '0')}`;
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
      if (hasSent) setHasEditedAfterSend(true);
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
    const label = hasEditedAfterSend ? '수정 내용을 다시 전송할까요?' : '리포트를 회원 앱으로 전송할까요?';
    Alert.alert('회원에게 전송', label, [
      { text: '취소', style: 'cancel' },
      {
        text: '전송',
        onPress: async () => {
          setIsSending(true);
          try {
            await supabase.from('member_lesson_reports').update({ is_read: false }).eq('id', report.id);
            try { await notifyMemberReport(plan.member_id); } catch (e) { console.error('[PUSH] 리포트 알림 실패:', e); }
            setHasSent(true);
            setHasEditedAfterSend(false);
            Alert.alert('전송 완료', '회원이 앱을 열면 리포트를 확인할 수 있어요.');
          } catch {
            Alert.alert('오류', '전송에 실패했습니다.');
          } finally {
            setIsSending(false);
          }
        },
      },
    ]);
  }

  function openEdit(section: string, label: string, value: string) {
    setEditingSection(section);
    setEditModalLabel(label);
    setEditingValue(value);
    setEditModalVisible(true);
  }

  function openEditPicker() {
    const achievements: string[] = report?.achievements ?? [];
    const improvementPoints = toStringArray(plan?.improvement_points);
    Alert.alert('수정할 항목 선택', '', [
      { text: '오늘 레슨 요약', onPress: () => openEdit('summary', '오늘 레슨 요약', cleanSummary(plan?.summary)) },
      ...(report ? [{ text: '오늘 잘한 점', onPress: () => openEdit('achievements', '오늘 잘한 점 (줄바꿈으로 항목 구분)', achievements.join('\n')) }] : []),
      { text: '주의 포인트', onPress: () => openEdit('improvement_points', '주의 포인트 (줄바꿈으로 항목 구분)', improvementPoints.join('\n')) },
      { text: '취소', style: 'cancel' },
    ]);
  }

  function DrillCard({ drill }: { drill: DrillSuggestion }) {
    return (
      <View style={styles.drillCard}>
        <Text style={styles.drillName}>{drill.name}</Text>
        {drill.purpose ? (
          <View style={styles.drillRow}>
            <Text style={styles.drillLabel}>목적</Text>
            <Text style={styles.drillValue}>{drill.purpose}</Text>
          </View>
        ) : null}
        {drill.method ? (
          <View style={styles.drillRow}>
            <Text style={styles.drillLabel}>연습 방법</Text>
            <Text style={styles.drillValue}>{drill.method}</Text>
          </View>
        ) : null}
        {drill.court_adaptation ? (
          <View style={styles.drillRow}>
            <Text style={styles.drillLabel}>코트 위치</Text>
            <Text style={styles.drillValue}>{drill.court_adaptation}</Text>
          </View>
        ) : null}
        {drill.reps ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
            {drill.reps.split(/[,·]/).map(r => r.trim()).filter(Boolean).map((r, i) => (
              <View key={i} style={styles.repsBadge}>
                <Text style={styles.repsBadgeText}>{r}</Text>
              </View>
            ))}
          </View>
        ) : null}
      </View>
    );
  }

  if (loading) {
    return (
      <View style={[styles.container, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator size="large" color={Colors.primary} />
      </View>
    );
  }

  if (!plan) {
    return (
      <View style={styles.container}>
        <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <Ionicons name="chevron-back" size={24} color={Colors.foreground} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>AI 레슨 기록</Text>
        </View>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ color: Colors.mutedFg }}>데이터를 불러올 수 없습니다.</Text>
        </View>
      </View>
    );
  }

  const achievements: string[] = report?.achievements ?? [];
  const improvementPoints = toStringArray(plan.improvement_points);
  const isSent = hasSent;
  const sendBtnLabel = isSending ? '전송 중...' : hasEditedAfterSend ? '수정 내용 다시 전송' : isSent ? '전송 완료' : '회원에게 전송';
  const isVoiceRecord = !!plan.audio_storage_path;

  return (
    <View style={styles.container}>
      {/* 헤더 */}
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={24} color={Colors.foreground} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>AI 레슨 기록</Text>
          {(memberName || memberLevel) ? (
            <Text style={styles.headerSub}>{[memberName, memberLevel].filter(Boolean).join(' · ')}</Text>
          ) : null}
        </View>
        <View style={[styles.sentBadge, isSent ? styles.sentBadgeGreen : styles.sentBadgeMuted]}>
          <Text style={[styles.sentBadgeText, isSent ? styles.sentTextGreen : styles.sentTextMuted]}>
            {isSent ? '전송 완료' : '미전송'}
          </Text>
        </View>
      </View>

      <ScrollView
        style={styles.scroll}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 100 + insets.bottom }}
      >
        {/* 레슨 기본 정보 카드 */}
        <View style={[styles.card, { marginTop: 16 }]}>
          <View style={styles.infoRow}>
            <View style={{ flex: 1, gap: 6 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Ionicons name="calendar-outline" size={13} color={Colors.mutedFg} />
                <Text style={styles.metaText}>{formatDate(plan.created_at)}</Text>
                <Text style={styles.metaDot}>·</Text>
                <Ionicons name="time-outline" size={13} color={Colors.mutedFg} />
                <Text style={styles.metaText}>{formatTime(plan.created_at)}</Text>
                {plan.duration_minutes ? (
                  <>
                    <Text style={styles.metaDot}>·</Text>
                    <Text style={styles.metaText}>{plan.duration_minutes}분</Text>
                  </>
                ) : null}
              </View>
              {plan.ai_title ? (
                <Text style={styles.aiTitle}>{plan.ai_title}</Text>
              ) : null}
              <View style={styles.recordTypeBadge}>
                <Ionicons name={isVoiceRecord ? 'mic-outline' : 'pencil-outline'} size={11} color={Colors.mutedFg} />
                <Text style={styles.recordTypeText}>{isVoiceRecord ? '음성 기록' : '직접 작성'}</Text>
              </View>
            </View>
            <TouchableOpacity style={styles.editTopBtn} onPress={openEditPicker}>
              <Text style={styles.editTopBtnText}>수정</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* 1. 오늘 레슨 요약 */}
        <View style={styles.card}>
          <View style={styles.sectionHeaderRow}>
            <Ionicons name="document-text-outline" size={18} color={Colors.primary} />
            <Text style={styles.cardTitle}>오늘 레슨 요약</Text>
          </View>
          <Text style={styles.bodyText}>{cleanSummary(plan.summary) || '-'}</Text>
        </View>

        {/* 2. 오늘 잘한 점 */}
        <View style={[styles.card, styles.cardSage]}>
          <View style={styles.sectionHeaderRow}>
            <Ionicons name="checkmark-circle-outline" size={18} color={SAGE_TEXT} />
            <Text style={[styles.cardTitle, { color: SAGE_TEXT }]}>오늘 잘한 점</Text>
          </View>
          {achievements.length > 0 ? (
            achievements.map((item, i) => (
              <View key={i} style={[styles.checkRow, i > 0 && { marginTop: 12 }]}>
                <View style={styles.checkIcon}>
                  <Ionicons name="checkmark" size={13} color={SAGE_TEXT} />
                </View>
                <Text style={[styles.listText, { color: Colors.foreground }]}>{item}</Text>
              </View>
            ))
          ) : (
            <Text style={styles.emptyText}>
              {report ? '잘한 점이 없습니다' : plan?.status === 'completed' ? 'AI 리포트 생성 중입니다. 잠시 후 화면을 나갔다 다시 확인해 주세요.' : '분석 완료 후 표시됩니다.'}
            </Text>
          )}
        </View>

        {/* 3. 주의 포인트 */}
        <View style={[styles.card, styles.cardWarm]}>
          <View style={styles.sectionHeaderRow}>
            <Ionicons name="alert-circle-outline" size={18} color={Colors.primary} />
            <Text style={[styles.cardTitle, { color: Colors.primary }]}>주의 포인트</Text>
          </View>
          {improvementPoints.length > 0 ? (
            improvementPoints.map((item, i) => {
              const parts = item.split(/\n/).filter(Boolean);
              return (
                <View key={i} style={[styles.improvementItem, i > 0 && { marginTop: 12 }]}>
                  <Text style={styles.improvementText}>{parts[0]}</Text>
                  {parts[1] ? (
                    <View style={styles.improvementNext}>
                      <Ionicons name="arrow-forward" size={12} color={Colors.primary} />
                      <Text style={styles.improvementNextText}>{parts[1]}</Text>
                    </View>
                  ) : null}
                </View>
              );
            })
          ) : (
            <Text style={styles.emptyText}>주의 포인트가 없습니다</Text>
          )}
        </View>

        {/* 4. 개인 맞춤 연습 플랜 */}
        {Array.isArray(plan.drill_suggestions) && plan.drill_suggestions.length > 0 && (
          <View style={styles.card}>
            <View style={styles.sectionHeaderRow}>
              <Ionicons name="barbell-outline" size={18} color={Colors.primary} />
              <Text style={styles.cardTitle}>개인 맞춤 연습 플랜</Text>
            </View>
            <View style={{ marginTop: 4, gap: 10 }}>
              {plan.drill_suggestions.map((drill, i) => (
                <DrillCard key={i} drill={drill} />
              ))}
            </View>
          </View>
        )}

        {/* 5. 레슨 전체 내용 보기 */}
        {plan.transcript_summary?.lesson_flow ? (
          <View style={styles.card}>
            <TouchableOpacity
              style={styles.accordionHeader}
              onPress={() => setExpandedTranscript(v => !v)}
              activeOpacity={0.7}
            >
              <View style={styles.sectionHeaderRow}>
                <Ionicons name="list-outline" size={18} color={Colors.mutedFg} />
                <Text style={[styles.cardTitle, { color: Colors.foreground }]}>레슨 전체 내용 보기</Text>
              </View>
              <Ionicons name={expandedTranscript ? 'chevron-up' : 'chevron-down'} size={18} color={Colors.mutedFg} />
            </TouchableOpacity>
            {expandedTranscript && (
              <View style={styles.accordionContent}>
                <Text style={styles.transcriptText}>{plan.transcript_summary.lesson_flow}</Text>
              </View>
            )}
          </View>
        ) : null}
      </ScrollView>

      {/* 하단 고정 전송 버튼 */}
      <View style={[styles.bottomBar, { paddingBottom: insets.bottom + 12 }]}>
        <TouchableOpacity
          style={[
            styles.sendBtn,
            (isSent && !hasEditedAfterSend) && styles.sendBtnSent,
            isSending && styles.sendBtnDisabled,
          ]}
          onPress={sendReportToMember}
          disabled={isSending || (isSent && !hasEditedAfterSend)}
          activeOpacity={0.85}
        >
          {isSending ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Ionicons
              name={isSent && !hasEditedAfterSend ? 'checkmark-circle-outline' : 'paper-plane-outline'}
              size={17}
              color="#fff"
            />
          )}
          <Text style={styles.sendBtnText}>{sendBtnLabel}</Text>
        </TouchableOpacity>
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
          <View style={styles.editSheet}>
            <View style={styles.editHeader}>
              <Text style={styles.editTitle}>{editModalLabel}</Text>
              <TouchableOpacity onPress={() => setEditModalVisible(false)}>
                <Ionicons name="close" size={22} color={Colors.mutedFg} />
              </TouchableOpacity>
            </View>
            <TextInput
              style={styles.editInput}
              value={editingValue}
              onChangeText={setEditingValue}
              multiline
              autoFocus
              textAlignVertical="top"
            />
            <View style={styles.editBtnRow}>
              <TouchableOpacity style={styles.editCancelBtn} onPress={() => setEditModalVisible(false)}>
                <Text style={styles.editCancelText}>취소</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.editSaveBtn}
                onPress={() => saveSectionEdit(editingSection, editingValue)}
                disabled={savingSection}
              >
                <Text style={styles.editSaveText}>{savingSection ? '저장 중...' : '저장'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },

  // 헤더
  header: {
    backgroundColor: Colors.background,
    paddingBottom: 12,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  backBtn: { padding: 4 },
  headerTitle: { fontSize: 17, fontWeight: '800', color: Colors.foreground },
  headerSub: { fontSize: 12, color: Colors.mutedFg, marginTop: 2 },
  sentBadge: { borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4 },
  sentBadgeGreen: { backgroundColor: '#DFF5E0' },
  sentBadgeMuted: { backgroundColor: Colors.border },
  sentBadgeText: { fontSize: 11, fontWeight: '700' },
  sentTextGreen: { color: '#2E7D32' },
  sentTextMuted: { color: Colors.mutedFg },

  scroll: { flex: 1 },

  // 카드
  card: {
    backgroundColor: '#fff',
    marginHorizontal: 16,
    marginBottom: 12,
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
  },
  cardSage: {
    backgroundColor: SAGE,
    borderColor: '#C8DFC3',
  },
  cardWarm: {
    backgroundColor: WARM_YELLOW,
    borderColor: WARM_YELLOW_BORDER,
  },

  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 14,
  },
  cardTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: Colors.foreground,
  },

  // 기본 정보 카드
  infoRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  metaText: { fontSize: 13, color: Colors.mutedFg },
  metaDot: { fontSize: 13, color: Colors.placeholder },
  aiTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.foreground,
    lineHeight: 24,
    marginTop: 2,
  },
  recordTypeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
    backgroundColor: Colors.mutedBg,
    borderRadius: 20,
    paddingHorizontal: 8,
    paddingVertical: 3,
    marginTop: 4,
  },
  recordTypeText: { fontSize: 11, color: Colors.mutedFg },
  editTopBtn: {
    borderWidth: 1,
    borderColor: Colors.primary,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  editTopBtnText: { fontSize: 13, fontWeight: '600', color: Colors.primary },

  // 본문
  bodyText: { fontSize: 16, color: Colors.foreground, lineHeight: 26 },

  // 잘한 점
  checkRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  checkIcon: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#B5D4B0',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  listText: { fontSize: 16, lineHeight: 26, flex: 1 },

  // 주의 포인트
  improvementItem: {},
  improvementText: { fontSize: 16, color: Colors.foreground, lineHeight: 25 },
  improvementNext: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    marginTop: 5,
    paddingLeft: 2,
  },
  improvementNextText: { fontSize: 14, color: Colors.primary, lineHeight: 22, flex: 1 },

  emptyText: { fontSize: 14, color: Colors.placeholder, fontStyle: 'italic' },

  // 드릴 카드
  drillCard: {
    backgroundColor: Colors.background,
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },
  drillName: { fontSize: 15, fontWeight: '700', color: Colors.foreground, marginBottom: 10 },
  drillRow: { marginBottom: 8 },
  drillLabel: { fontSize: 11, fontWeight: '600', color: Colors.mutedFg, marginBottom: 2, textTransform: 'uppercase', letterSpacing: 0.5 },
  drillValue: { fontSize: 15, color: Colors.foreground, lineHeight: 23 },
  repsBadge: {
    backgroundColor: Colors.primaryLight,
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  repsBadgeText: { fontSize: 12, fontWeight: '600', color: Colors.primary },

  // 아코디언
  accordionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  accordionContent: { marginTop: 14, paddingTop: 14, borderTopWidth: 1, borderTopColor: Colors.borderLight },
  transcriptText: { fontSize: 15, color: Colors.foreground, lineHeight: 24 },

  // 하단 버튼
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 16,
    paddingTop: 12,
    backgroundColor: Colors.background,
    borderTopWidth: 1,
    borderTopColor: Colors.borderLight,
  },
  sendBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: Colors.primary,
    borderRadius: 14,
    paddingVertical: 15,
  },
  sendBtnSent: { backgroundColor: '#8AB88A' },
  sendBtnDisabled: { opacity: 0.7 },
  sendBtnText: { fontSize: 16, fontWeight: '700', color: '#fff' },

  // 편집 모달
  editSheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    paddingBottom: 36,
    maxHeight: '70%',
  },
  editHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  editTitle: { fontSize: 15, fontWeight: '700', color: Colors.foreground },
  editInput: {
    borderWidth: 1,
    borderColor: Colors.primary,
    borderRadius: 10,
    padding: 12,
    fontSize: 14,
    color: Colors.foreground,
    minHeight: 120,
    textAlignVertical: 'top',
    lineHeight: 22,
    backgroundColor: '#fff',
    marginBottom: 12,
  },
  editBtnRow: { flexDirection: 'row', gap: 10 },
  editCancelBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  editCancelText: { fontSize: 14, color: Colors.foreground },
  editSaveBtn: {
    flex: 2,
    backgroundColor: Colors.primary,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  editSaveText: { fontSize: 14, fontWeight: '700', color: '#fff' },
});
