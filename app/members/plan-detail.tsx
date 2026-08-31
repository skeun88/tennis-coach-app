import { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Alert, ActivityIndicator, Platform, Modal, TextInput, KeyboardAvoidingView,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../lib/supabase';
import { notifyMemberReport } from '../../lib/notifications';
import { LessonPlan, DrillSuggestion } from '../../types';
import { Colors } from '../../lib/theme';

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

  const [editModalVisible, setEditModalVisible] = useState(false);
  const [editingSection, setEditingSection] = useState<string>('');
  const [editingValue, setEditingValue] = useState('');
  const [editModalLabel, setEditModalLabel] = useState('');
  const [savingSection, setSavingSection] = useState(false);

  useEffect(() => {
    loadData();
  }, [planId]);

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
    Alert.alert('회원에게 전송', '리포트를 회원 앱으로 전송할까요?', [
      { text: '취소', style: 'cancel' },
      {
        text: '전송',
        onPress: async () => {
          try {
            await supabase.from('member_lesson_reports').update({ is_read: false }).eq('id', report.id);
            try { await notifyMemberReport(plan.member_id); } catch (e) { console.error('[PUSH] 리포트 알림 실패:', e); }
            Alert.alert('전송 완료', '회원이 앱을 열면 리포트를 확인할 수 있어요.');
          } catch {
            Alert.alert('오류', '전송에 실패했습니다.');
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

  function DrillCard({ drill }: { drill: DrillSuggestion }) {
    return (
      <View style={styles.drillCard}>
        <Text style={styles.drillName}>{drill.name}</Text>
        {[
          { label: '목적', value: drill.purpose },
          { label: '방법', value: drill.method },
          { label: '횟수', value: drill.reps },
          ...(drill.court_adaptation ? [{ label: '코트 변형', value: drill.court_adaptation }] : []),
        ].map(({ label, value }) => (
          <View key={label} style={styles.drillRow}>
            <Text style={styles.drillLabel}>{label}</Text>
            <Text style={styles.drillValue}>{value}</Text>
          </View>
        ))}
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
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <Ionicons name="chevron-back" size={24} color="#fff" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>분석 상세</Text>
        </View>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ color: Colors.mutedFg }}>데이터를 불러올 수 없습니다.</Text>
        </View>
      </View>
    );
  }

  const achievements: string[] = report?.achievements ?? [];
  const improvementPoints = toStringArray(plan.improvement_points);

  return (
    <View style={styles.container}>
      {/* 헤더 */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={24} color="#fff" />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>AI 분석 상세</Text>
          <Text style={styles.headerSub}>{memberName} · {memberLevel}</Text>
        </View>
        <View style={[styles.sentBadge, report ? styles.sentBadgeGreen : styles.sentBadgeTerracotta]}>
          <Text style={[styles.sentBadgeText, report ? styles.sentTextGreen : styles.sentTextTerracotta]}>
            {report ? '전송 완료' : '전송 전'}
          </Text>
        </View>
      </View>

      <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>

        {/* 날짜 / 시간 메타 */}
        <View style={styles.metaRow}>
          <Ionicons name="calendar-outline" size={14} color={Colors.mutedFg} />
          <Text style={styles.metaText}>{formatDate(plan.created_at)}</Text>
          {plan.duration_minutes ? (
            <>
              <Text style={styles.metaDot}>·</Text>
              <Ionicons name="time-outline" size={14} color={Colors.mutedFg} />
              <Text style={styles.metaText}>{plan.duration_minutes}분</Text>
            </>
          ) : null}
        </View>

        {/* AI 핵심 제목 */}
        {plan.ai_title ? (
          <View style={styles.titleBox}>
            <Text style={styles.aiTitle}>{plan.ai_title}</Text>
          </View>
        ) : null}

        {/* 1. 오늘 레슨 요약 */}
        <View style={styles.section}>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionTitle}>오늘 레슨 요약</Text>
            <TouchableOpacity
              style={styles.editBtn}
              onPress={() => openEdit('summary', '오늘 레슨 요약', cleanSummary(plan.summary))}
            >
              <Ionicons name="pencil-outline" size={14} color={Colors.mutedFg} />
            </TouchableOpacity>
          </View>
          <Text style={styles.bodyText}>{cleanSummary(plan.summary) || '-'}</Text>
        </View>

        {/* 2. 오늘 잘한 점 */}
        <View style={styles.section}>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionTitle}>오늘 잘한 점</Text>
            {report && (
              <TouchableOpacity
                style={styles.editBtn}
                onPress={() => openEdit('achievements', '오늘 잘한 점 (줄바꿈으로 항목 구분)', achievements.join('\n'))}
              >
                <Ionicons name="pencil-outline" size={14} color={Colors.mutedFg} />
              </TouchableOpacity>
            )}
          </View>
          {achievements.length > 0 ? (
            achievements.map((item, i) => (
              <View key={i} style={styles.listRow}>
                <Text style={styles.listNum}>{String(i + 1).padStart(2, '0')}</Text>
                <Text style={styles.listText}>{item}</Text>
              </View>
            ))
          ) : (
            <Text style={styles.emptyText}>{report ? '잘한 점이 없습니다' : '리포트 생성 후 표시됩니다'}</Text>
          )}
        </View>

        {/* 3. 개선 포인트 */}
        <View style={styles.section}>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionTitle}>개선 포인트</Text>
            <TouchableOpacity
              style={styles.editBtn}
              onPress={() => openEdit('improvement_points', '개선 포인트 (줄바꿈으로 항목 구분)', improvementPoints.join('\n'))}
            >
              <Ionicons name="pencil-outline" size={14} color={Colors.mutedFg} />
            </TouchableOpacity>
          </View>
          {improvementPoints.length > 0 ? (
            improvementPoints.map((item, i) => (
              <View key={i} style={styles.listRow}>
                <Text style={styles.listNum}>{String(i + 1).padStart(2, '0')}</Text>
                <Text style={styles.listText}>{item}</Text>
              </View>
            ))
          ) : (
            <Text style={styles.emptyText}>개선 포인트가 없습니다</Text>
          )}
        </View>

        {/* 4. 개인 맞춤 연습 플랜 */}
        {Array.isArray(plan.drill_suggestions) && plan.drill_suggestions.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>개인 맞춤 연습 플랜</Text>
            <View style={{ marginTop: 12 }}>
              {plan.drill_suggestions.map((drill, i) => (
                <DrillCard key={i} drill={drill} />
              ))}
            </View>
          </View>
        )}

        {/* 5. 레슨 전체 내용 보기 */}
        {plan.transcript_summary?.lesson_flow ? (
          <View style={styles.section}>
            <View style={styles.accordionBox}>
              <TouchableOpacity
                style={styles.accordionHeader}
                onPress={() => setExpandedTranscript(v => !v)}
                activeOpacity={0.7}
              >
                <Text style={styles.sectionTitle}>레슨 전체 내용 보기</Text>
                <Ionicons name={expandedTranscript ? 'chevron-up' : 'chevron-down'} size={18} color={Colors.mutedFg} />
              </TouchableOpacity>
              {expandedTranscript && (
                <View style={styles.accordionContent}>
                  <Text style={styles.transcriptText}>{plan.transcript_summary.lesson_flow}</Text>
                </View>
              )}
            </View>
          </View>
        ) : null}

        {/* 액션 버튼 */}
        <View style={styles.actions}>
          <TouchableOpacity style={styles.sendBtn} onPress={sendReportToMember}>
            <Ionicons name="paper-plane-outline" size={16} color="#fff" />
            <Text style={styles.sendBtnText}>회원에게 전송</Text>
          </TouchableOpacity>
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>

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
  header: {
    backgroundColor: Colors.primary,
    paddingTop: Platform.OS === 'ios' ? 56 : 20,
    paddingBottom: 16,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  backBtn: { padding: 4 },
  headerTitle: { fontSize: 18, fontWeight: '800', color: '#fff' },
  headerSub: { fontSize: 13, color: 'rgba(255,255,255,0.75)', marginTop: 2 },
  sentBadge: { borderRadius: 20, paddingHorizontal: 8, paddingVertical: 3 },
  sentBadgeGreen: { backgroundColor: 'rgba(255,255,255,0.25)' },
  sentBadgeTerracotta: { backgroundColor: 'rgba(255,255,255,0.15)' },
  sentBadgeText: { fontSize: 11, fontWeight: '600' },
  sentTextGreen: { color: '#fff' },
  sentTextTerracotta: { color: 'rgba(255,255,255,0.85)' },

  scroll: { flex: 1 },

  metaRow: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 20, paddingTop: 20, paddingBottom: 4,
  },
  metaText: { fontSize: 13, color: Colors.mutedFg },
  metaDot: { fontSize: 13, color: Colors.placeholder, marginHorizontal: 2 },

  titleBox: {
    paddingHorizontal: 20, paddingTop: 8, paddingBottom: 16,
  },
  aiTitle: { fontSize: 20, fontWeight: '800', color: Colors.foreground, lineHeight: 28 },

  section: {
    backgroundColor: '#fff',
    marginHorizontal: 16,
    marginBottom: 12,
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  sectionHeaderRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12,
  },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: Colors.foreground },
  bodyText: { fontSize: 15, color: Colors.foreground, lineHeight: 24 },
  listRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginBottom: 10 },
  listNum: { fontSize: 13, fontWeight: '600', color: Colors.primary, width: 20, marginTop: 2 },
  listText: { fontSize: 15, color: Colors.foreground, lineHeight: 24, flex: 1 },
  emptyText: { fontSize: 14, color: Colors.placeholder, fontStyle: 'italic' },
  editBtn: {
    width: 30, height: 30, borderRadius: 999,
    borderWidth: 1, borderColor: Colors.border,
    backgroundColor: '#fff', justifyContent: 'center', alignItems: 'center',
  },

  drillCard: {
    backgroundColor: Colors.mutedBg,
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
  },
  drillName: { fontSize: 14, fontWeight: '700', color: Colors.foreground, marginBottom: 10 },
  drillRow: { marginBottom: 8 },
  drillLabel: { fontSize: 12, fontWeight: '500', color: Colors.mutedFg, marginBottom: 2 },
  drillValue: { fontSize: 14, color: Colors.foreground, lineHeight: 21 },

  accordionBox: {
    borderRadius: 12, borderWidth: 1, borderColor: Colors.border, backgroundColor: '#fff', overflow: 'hidden',
  },
  accordionHeader: {
    paddingHorizontal: 16, paddingVertical: 14,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },
  accordionContent: { padding: 16, borderTopWidth: 1, borderTopColor: Colors.border },
  transcriptText: { fontSize: 14, color: Colors.foreground, lineHeight: 22 },

  actions: { marginHorizontal: 16, marginTop: 4, marginBottom: 8 },
  sendBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: Colors.primary, borderRadius: 12, paddingVertical: 14,
  },
  sendBtnText: { fontSize: 15, fontWeight: '700', color: '#fff' },

  editSheet: {
    backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: 20, paddingBottom: 36, maxHeight: '70%',
  },
  editHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12,
  },
  editTitle: { fontSize: 15, fontWeight: '700', color: Colors.foreground },
  editInput: {
    borderWidth: 1, borderColor: Colors.primary, borderRadius: 10,
    padding: 12, fontSize: 14, color: Colors.foreground,
    minHeight: 120, textAlignVertical: 'top', lineHeight: 22,
    backgroundColor: '#fff', marginBottom: 12,
  },
  editBtnRow: { flexDirection: 'row', gap: 10 },
  editCancelBtn: {
    flex: 1, borderWidth: 1, borderColor: Colors.border, borderRadius: 10,
    paddingVertical: 12, alignItems: 'center',
  },
  editCancelText: { fontSize: 14, color: Colors.foreground },
  editSaveBtn: {
    flex: 2, backgroundColor: Colors.primary, borderRadius: 10,
    paddingVertical: 12, alignItems: 'center',
  },
  editSaveText: { fontSize: 14, fontWeight: '700', color: '#fff' },
});
