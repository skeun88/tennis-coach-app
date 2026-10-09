import { useState, useCallback, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Alert, ActivityIndicator, Platform, TextInput,
  KeyboardAvoidingView, SafeAreaView, BackHandler, Animated,
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
const INPUT_BG = '#FCF9F6';
const WARM_GRAY = '#9E9289';

type EditSection =
  | 'ai_title' | 'summary' | 'achievements'
  | 'improvement_points' | 'coach_next_goals' | 'drill_suggestions'
  | null;

export default function PlanDetailScreen() {
  const { planId, reportId, memberId, memberName, memberLevel } = useLocalSearchParams<{
    planId: string; reportId: string; memberId: string; memberName: string; memberLevel: string;
  }>();
  const router = useRouter();
  const isManual = !!reportId;

  const [plan, setPlan] = useState<LessonPlan | null>(null);
  const [report, setReport] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [expandedTranscript, setExpandedTranscript] = useState(false);
  const [sending, setSending] = useState(false);

  const [editingSection, setEditingSection] = useState<EditSection>(null);
  const [editingValue, setEditingValue] = useState('');
  const [originalValue, setOriginalValue] = useState('');
  const [editingDrills, setEditingDrills] = useState<DrillSuggestion[]>([]);
  const [originalDrillsJson, setOriginalDrillsJson] = useState('');
  const [savingSection, setSavingSection] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [inputFocused, setInputFocused] = useState(false);

  const fadeAnim = useRef(new Animated.Value(1)).current;

  function animateEditTransition(_toEditing: boolean, callback?: () => void) {
    Animated.timing(fadeAnim, { toValue: 0, duration: 120, useNativeDriver: true }).start(() => {
      callback?.();
      Animated.timing(fadeAnim, { toValue: 1, duration: 150, useNativeDriver: true }).start();
    });
  }

  const hasUnsavedChanges = editingSection === 'drill_suggestions'
    ? JSON.stringify(editingDrills) !== originalDrillsJson
    : editingValue !== originalValue;

  useFocusEffect(useCallback(() => { loadData(); }, [planId, reportId]));

  async function loadData() {
    setLoading(true);
    if (isManual) {
      const { data: rep } = await supabase
        .from('member_lesson_reports').select('*').eq('id', reportId).maybeSingle();
      setReport(rep ?? null);
      setPlan(rep ? (planFromManualReport(rep) as LessonPlan) : null);
    } else {
      const [planRes, reportRes] = await Promise.all([
        supabase.from('lesson_plans').select('*').eq('id', planId).single(),
        supabase.from('member_lesson_reports').select('*').eq('lesson_plan_id', planId).maybeSingle(),
      ]);
      setPlan(planRes.data ?? null);
      setReport(reportRes.data ?? null);
    }
    setLoading(false);
  }

  function planFromManualReport(rep: any): any {
    return {
      id: rep.id,
      member_id: rep.member_id,
      ai_title: '',
      summary: rep.summary ?? '',
      improvement_points: Array.isArray(rep.improvement_points)
        ? rep.improvement_points.join('\n')
        : (rep.improvement_points ?? ''),
      drill_suggestions: [],
      next_goals: [],
      coach_next_goals: [],
      next_goals_saved: false,
      lesson_comparison: [],
      transcript_summary: null,
      source: 'manual',
      created_at: rep.created_at,
      duration_minutes: null,
      status: 'completed',
    };
  }

  // Android back button guard
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const handler = BackHandler.addEventListener('hardwareBackPress', () => {
      if (editingSection && hasUnsavedChanges) {
        showDiscardAlert(() => router.back());
        return true;
      }
      return false;
    });
    return () => handler.remove();
  }, [editingSection, hasUnsavedChanges]);

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

  function showDiscardAlert(onDiscard: () => void) {
    Alert.alert('수정한 내용을 저장하지 않고 나갈까요?', '', [
      { text: '계속 수정', style: 'cancel' },
      { text: '나가기', onPress: onDiscard },
    ]);
  }

  function startEdit(section: EditSection, value: string) {
    setSaveError(false);
    if (editingSection !== null && hasUnsavedChanges) {
      showDiscardAlert(() => animateEditTransition(true, () => applyStartEdit(section, value)));
      return;
    }
    animateEditTransition(true, () => applyStartEdit(section, value));
  }

  function applyStartEdit(section: EditSection, value: string) {
    setInputFocused(false);
    setEditingSection(section);
    setEditingValue(value);
    setOriginalValue(value);
  }

  function startEditDrills() {
    setSaveError(false);
    const drills = (plan?.drill_suggestions ?? []).map(d => ({ ...d }));
    if (editingSection !== null && hasUnsavedChanges) {
      showDiscardAlert(() => animateEditTransition(true, () => applyStartEditDrills(drills)));
      return;
    }
    animateEditTransition(true, () => applyStartEditDrills(drills));
  }

  function applyStartEditDrills(drills: DrillSuggestion[]) {
    setInputFocused(false);
    setEditingSection('drill_suggestions');
    setEditingDrills(drills);
    setOriginalDrillsJson(JSON.stringify(drills));
  }

  function handleCancel() {
    if (hasUnsavedChanges) {
      showDiscardAlert(() => animateEditTransition(false, () => { setInputFocused(false); setEditingSection(null); }));
    } else {
      animateEditTransition(false, () => { setInputFocused(false); setEditingSection(null); });
    }
  }

  function handleBack() {
    if (editingSection && hasUnsavedChanges) {
      showDiscardAlert(() => router.back());
    } else {
      router.back();
    }
  }

  async function handleSave() {
    if (!plan || savingSection || !hasUnsavedChanges) return;
    setSavingSection(true);
    setSaveError(false);
    try {
      if (editingSection === 'ai_title') {
        const trimmed = editingValue.trim();
        if (!trimmed) {
          Alert.alert('제목을 입력해 주세요.');
          setSavingSection(false);
          return;
        }
        await supabase.from('lesson_plans').update({ ai_title: trimmed }).eq('id', plan.id);
        setPlan(prev => prev ? { ...prev, ai_title: trimmed } : prev);
      } else if (editingSection === 'achievements') {
        const lines = editingValue.split('\n').map(l => l.trim()).filter(Boolean);
        if (!report?.id) { setSavingSection(false); return; }
        await supabase.from('member_lesson_reports').update({ achievements: lines }).eq('id', report.id);
        setReport((prev: any) => prev ? { ...prev, achievements: lines } : prev);
      } else if (editingSection === 'coach_next_goals') {
        const lines = editingValue.split('\n').map(l => l.trim()).filter(Boolean);
        await supabase.from('lesson_plans').update({
          coach_next_goals: lines, next_goals_saved: true,
        }).eq('id', plan.id);
        setPlan(prev => prev ? { ...prev, coach_next_goals: lines, next_goals_saved: true } : prev);
      } else if (editingSection === 'drill_suggestions') {
        await supabase.from('lesson_plans').update({ drill_suggestions: editingDrills }).eq('id', plan.id);
        setPlan(prev => prev ? { ...prev, drill_suggestions: editingDrills } : prev);
      } else if (editingSection === 'summary') {
        if (isManual) {
          if (!report?.id) { setSavingSection(false); return; }
          await supabase.from('member_lesson_reports').update({ summary: editingValue }).eq('id', report.id);
          setReport((prev: any) => prev ? { ...prev, summary: editingValue } : prev);
          setPlan(prev => prev ? { ...prev, summary: editingValue } : prev);
        } else {
          await supabase.from('lesson_plans').update({ summary: editingValue }).eq('id', plan.id);
          setPlan(prev => prev ? { ...prev, summary: editingValue } : prev);
        }
      } else if (editingSection === 'improvement_points') {
        if (isManual) {
          if (!report?.id) { setSavingSection(false); return; }
          const lines = editingValue.split('\n').map(l => l.trim()).filter(Boolean);
          await supabase.from('member_lesson_reports').update({ improvement_points: lines }).eq('id', report.id);
          setReport((prev: any) => prev ? { ...prev, improvement_points: lines } : prev);
          setPlan(prev => prev ? { ...prev, improvement_points: lines.join('\n') } : prev);
        } else {
          await supabase.from('lesson_plans').update({ improvement_points: editingValue }).eq('id', plan.id);
          setPlan(prev => prev ? { ...prev, improvement_points: editingValue } : prev);
        }
      }
      setInputFocused(false);
      setEditingSection(null);
    } catch {
      setSaveError(true);
    } finally {
      setSavingSection(false);
    }
  }

  function updateDrill(idx: number, field: keyof DrillSuggestion, value: string) {
    setEditingDrills(prev => prev.map((d, i) => i === idx ? { ...d, [field]: value } : d));
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
      try { await notifyMemberReport(plan.member_id); } catch (e) { console.error('[PUSH]', e); }
      setReport((prev: any) => ({ ...prev, sent_to_member: true }));
      Alert.alert('전송 완료', '회원이 앱을 열면 리포트를 확인할 수 있어요.');
    } catch {
      Alert.alert('오류', '전송에 실패했습니다.');
    } finally {
      setSending(false);
    }
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

  const EditBadge = () => (
    <View style={s.editingBadge}>
      <Text style={s.editingBadgeText}>수정 중</Text>
    </View>
  );

  const PencilBtn = ({ onPress }: { onPress: () => void }) => (
    <TouchableOpacity
      style={s.pencilBtn}
      onPress={onPress}
      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
    >
      <Ionicons name="pencil-outline" size={14} color={Colors.mutedFg} />
    </TouchableOpacity>
  );

  return (
    <View style={s.container}>
      {/* Header */}
      <SafeAreaView style={s.safeHeader}>
        <View style={s.header}>
          <TouchableOpacity onPress={handleBack} style={s.backBtn}>
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

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <Animated.View style={{ flex: 1, opacity: fadeAnim }}>
        <ScrollView
          style={s.scroll}
          contentContainerStyle={s.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
        >
          {/* 레슨 기본 정보 카드 */}
          <View style={s.infoCard}>
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

            {/* 레슨 제목 — 인라인 편집 (음성 기록만) */}
            {isManual ? null : editingSection === 'ai_title' ? (
              <>
                <View style={s.inlineLabelRow}>
                  <Text style={s.inlineSectionLabel}>레슨 제목</Text>
                  <EditBadge />
                </View>
                <TextInput
                  style={[s.inlineInput, inputFocused && s.inlineInputFocused]}
                  value={editingValue}
                  onChangeText={setEditingValue}
                  onFocus={() => setInputFocused(true)}
                  onBlur={() => setInputFocused(false)}
                  multiline
                  autoFocus
                  textAlignVertical="top"
                  scrollEnabled={false}
                />
              </>
            ) : (
              <View style={s.titleRow}>
                <Text style={s.infoTitle}>{plan.ai_title || '(제목 없음)'}</Text>
                <TouchableOpacity
                  style={s.titleEditBtn}
                  onPress={() => startEdit('ai_title', plan.ai_title || '')}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Ionicons name="pencil-outline" size={13} color={TERRACOTTA} />
                  <Text style={s.titleEditBtnText}>제목 수정</Text>
                </TouchableOpacity>
              </View>
            )}

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

          {/* 1. 오늘 레슨 요약 */}
          <View style={s.card}>
            <View style={s.cardTitleRow}>
              <Ionicons name="document-text-outline" size={18} color={TERRACOTTA} />
              <Text style={s.cardTitle}>오늘 레슨 요약</Text>
              {editingSection === 'summary'
                ? <EditBadge />
                : <PencilBtn onPress={() => startEdit('summary', cleanSummary(plan.summary))} />}
            </View>
            {editingSection === 'summary' ? (
              <TextInput
                style={[s.inlineInput, inputFocused && s.inlineInputFocused]}
                value={editingValue}
                onChangeText={setEditingValue}
                onFocus={() => setInputFocused(true)}
                onBlur={() => setInputFocused(false)}
                multiline
                autoFocus
                textAlignVertical="top"
                scrollEnabled={false}
              />
            ) : (
              <Text style={s.summaryText}>{cleanSummary(plan.summary) || '-'}</Text>
            )}
          </View>

          {/* 1.5 이전 레슨 대비 변화 */}
          {Array.isArray(plan.lesson_comparison) && plan.lesson_comparison.length > 0 && (
            <View style={[s.card, s.cardComparison]}>
              <View style={s.cardTitleRow}>
                <Ionicons name="swap-vertical-outline" size={18} color="#0EA5E9" />
                <View style={{ flex: 1 }}>
                  <Text style={[s.cardTitle, { color: '#0369A1' }]}>이전 레슨 대비 변화</Text>
                  <Text style={s.compSubtitle}>지난 기록과 비교</Text>
                </View>
              </View>
              {plan.lesson_comparison.slice(0, 3).map((c: any, i: number) => {
                const isImproved = c.status === 'improved';
                const isRegressed = c.status === 'regressed';
                const badgeColor = isImproved ? '#16a34a' : isRegressed ? '#dc2626' : '#64748b';
                const badgeBg = isImproved ? '#dcfce7' : isRegressed ? '#fee2e2' : '#f1f5f9';
                const badgeLabel = isImproved ? '개선 중' : isRegressed ? '반복 확인' : '유지';
                return (
                  <View key={i} style={s.compRow}>
                    <View style={{ flex: 1 }}>
                      <View style={s.compTopRow}>
                        <Text style={s.compPoint}>{c.point}</Text>
                        <View style={[s.compBadge, { backgroundColor: badgeBg }]}>
                          <Text style={[s.compBadgeText, { color: badgeColor }]}>{badgeLabel}</Text>
                        </View>
                      </View>
                      <Text style={s.compReason}>{c.reason}</Text>
                    </View>
                  </View>
                );
              })}
            </View>
          )}

          {/* 2. 오늘 잘한 점 */}
          <View style={[s.card, s.cardSage]}>
            <View style={s.cardTitleRow}>
              <Ionicons name="checkmark-circle-outline" size={18} color={SAGE_TEXT} />
              <Text style={[s.cardTitle, { color: SAGE_TEXT }]}>오늘 잘한 점</Text>
              {hasReport && (
                editingSection === 'achievements'
                  ? <EditBadge />
                  : <PencilBtn onPress={() => startEdit('achievements', achievements.join('\n'))} />
              )}
            </View>
            {editingSection === 'achievements' ? (
              <TextInput
                style={[s.inlineInput, inputFocused && s.inlineInputFocused]}
                value={editingValue}
                onChangeText={setEditingValue}
                onFocus={() => setInputFocused(true)}
                onBlur={() => setInputFocused(false)}
                multiline
                autoFocus
                textAlignVertical="top"
                placeholder="각 항목을 줄바꿈으로 구분하세요"
                placeholderTextColor={WARM_GRAY}
                scrollEnabled={false}
              />
            ) : achievements.length > 0 ? (
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
                {hasReport ? '잘한 점이 없습니다'
                  : plan?.status === 'completed' ? 'AI 리포트 생성 중입니다. 잠시 후 다시 확인해 주세요.'
                  : '분석 완료 후 표시됩니다.'}
              </Text>
            )}
          </View>

          {/* 3. 주의 포인트 */}
          <View style={[s.card, s.cardWarm]}>
            <View style={s.cardTitleRow}>
              <Ionicons name="radio-button-on-outline" size={18} color={TERRACOTTA} />
              <Text style={[s.cardTitle, { color: TERRACOTTA }]}>주의 포인트</Text>
              {editingSection === 'improvement_points'
                ? <EditBadge />
                : <PencilBtn onPress={() => startEdit('improvement_points', improvementPoints.join('\n'))} />}
            </View>
            {editingSection === 'improvement_points' ? (
              <TextInput
                style={[s.inlineInput, inputFocused && s.inlineInputFocused]}
                value={editingValue}
                onChangeText={setEditingValue}
                onFocus={() => setInputFocused(true)}
                onBlur={() => setInputFocused(false)}
                multiline
                autoFocus
                textAlignVertical="top"
                placeholder="각 항목을 줄바꿈으로 구분하세요"
                placeholderTextColor={WARM_GRAY}
                scrollEnabled={false}
              />
            ) : improvementPoints.length > 0 ? (
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
              <View style={s.drillSectionHeader}>
                <Ionicons name="barbell-outline" size={18} color={TERRACOTTA} />
                <Text style={[s.cardTitle, { flex: 1 }]}>개인 맞춤 연습 플랜</Text>
                {editingSection === 'drill_suggestions'
                  ? <EditBadge />
                  : <PencilBtn onPress={startEditDrills} />}
              </View>
              {editingSection === 'drill_suggestions'
                ? editingDrills.map((drill, i) => (
                  <DrillEditCard key={i} drill={drill} onChange={(f, v) => updateDrill(i, f, v)} />
                ))
                : plan.drill_suggestions.map((drill, i) => (
                  <DrillCardComponent key={i} drill={drill} />
                ))
              }
            </View>
          )}

          {/* 5. 다음 레슨 목표 */}
          {(toStringArray(plan.next_goals).length > 0 || (plan.coach_next_goals && plan.coach_next_goals.length > 0)) && (
            <View style={[s.card, s.cardGoals]}>
              <View style={s.cardTitleRow}>
                <Ionicons name="flag-outline" size={18} color="#8B5CF6" />
                <Text style={[s.cardTitle, { color: '#8B5CF6' }]}>다음 레슨 목표</Text>
                {editingSection === 'coach_next_goals' ? <EditBadge /> : (
                  <PencilBtn onPress={() => {
                    const currentGoals = (plan.next_goals_saved && plan.coach_next_goals?.length)
                      ? plan.coach_next_goals
                      : toStringArray(plan.next_goals);
                    startEdit('coach_next_goals', currentGoals.join('\n'));
                  }} />
                )}
              </View>
              {editingSection === 'coach_next_goals' ? (
                <TextInput
                  style={[s.inlineInput, inputFocused && s.inlineInputFocused]}
                  value={editingValue}
                  onChangeText={setEditingValue}
                  onFocus={() => setInputFocused(true)}
                  onBlur={() => setInputFocused(false)}
                  multiline
                  autoFocus
                  textAlignVertical="top"
                  placeholder="각 목표를 줄바꿈으로 구분하세요"
                  placeholderTextColor={WARM_GRAY}
                  scrollEnabled={false}
                />
              ) : (
                <>
                  {plan.next_goals_saved ? (
                    <View style={s.goalsBadgeRow}>
                      <Ionicons name="checkmark-circle-outline" size={12} color="#22c55e" />
                      <Text style={s.goalsBadgeTextSaved}>코치 확정 목표</Text>
                    </View>
                  ) : (
                    <View style={s.goalsBadgeRow}>
                      <Ionicons name="sparkles-outline" size={12} color="#8B5CF6" />
                      <Text style={s.goalsBadgeTextDraft}>AI 초안 — 수정 버튼으로 확정하세요</Text>
                    </View>
                  )}
                  {(plan.next_goals_saved ? (plan.coach_next_goals ?? []) : toStringArray(plan.next_goals)).map((goal, i) => (
                    <View key={i} style={s.goalRow}>
                      <View style={s.goalIndex}>
                        <Text style={s.goalIndexText}>{i + 1}</Text>
                      </View>
                      <Text style={s.goalText}>{goal}</Text>
                    </View>
                  ))}
                </>
              )}
            </View>
          )}

          {/* 6. 레슨 전체 내용 보기 */}
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

          <View style={{ height: editingSection ? 20 : 100 }} />
        </ScrollView>
        </Animated.View>

        {/* 편집 중 키보드 위 액션바 */}
        {editingSection && (
          <View style={s.actionBar}>
            {saveError && (
              <Text style={s.saveErrorMsg}>저장하지 못했어요. 다시 시도해 주세요.</Text>
            )}
            <View style={s.actionBarButtons}>
              <TouchableOpacity
                style={s.cancelBtn}
                onPress={handleCancel}
                disabled={savingSection}
              >
                <Text style={s.cancelBtnText}>취소</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.saveBtn, (!hasUnsavedChanges || savingSection) && s.saveBtnDisabled]}
                onPress={handleSave}
                disabled={!hasUnsavedChanges || savingSection}
                activeOpacity={0.85}
              >
                {savingSection
                  ? <ActivityIndicator size="small" color="#fff" />
                  : <Text style={s.saveBtnText}>저장</Text>
                }
              </TouchableOpacity>
            </View>
          </View>
        )}
      </KeyboardAvoidingView>

      {/* 하단 전송 버튼 — 편집 중 숨김 */}
      {!editingSection && (
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
      )}
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

function DrillEditCard({
  drill, onChange,
}: { drill: DrillSuggestion; onChange: (field: keyof DrillSuggestion, value: string) => void }) {
  return (
    <View style={[s.drillCard, s.drillCardEditing]}>
      <TextInput
        style={[s.drillEditField, s.drillEditName]}
        value={drill.name}
        onChangeText={v => onChange('name', v)}
        placeholder="드릴 이름"
        placeholderTextColor={WARM_GRAY}
        scrollEnabled={false}
      />
      <View style={s.drillRow}>
        <Text style={s.drillLabel}>목적</Text>
        <TextInput
          style={[s.drillEditField, { flex: 1 }]}
          value={drill.purpose}
          onChangeText={v => onChange('purpose', v)}
          multiline
          textAlignVertical="top"
          placeholder="목적을 입력하세요"
          placeholderTextColor={WARM_GRAY}
          scrollEnabled={false}
        />
      </View>
      <View style={s.drillRow}>
        <Text style={s.drillLabel}>방법</Text>
        <TextInput
          style={[s.drillEditField, { flex: 1 }]}
          value={drill.method}
          onChangeText={v => onChange('method', v)}
          multiline
          textAlignVertical="top"
          placeholder="방법을 입력하세요"
          placeholderTextColor={WARM_GRAY}
          scrollEnabled={false}
        />
      </View>
      <View style={s.drillRow}>
        <Text style={s.drillLabel}>코트 위치</Text>
        <TextInput
          style={[s.drillEditField, { flex: 1 }]}
          value={drill.court_adaptation ?? ''}
          onChangeText={v => onChange('court_adaptation', v)}
          placeholder="코트 위치 (선택)"
          placeholderTextColor={WARM_GRAY}
          scrollEnabled={false}
        />
      </View>
      <View style={s.drillRow}>
        <Text style={s.drillLabel}>횟수/시간</Text>
        <TextInput
          style={[s.drillEditField, { flex: 1 }]}
          value={drill.reps}
          onChangeText={v => onChange('reps', v)}
          placeholder="횟수 또는 시간"
          placeholderTextColor={WARM_GRAY}
          scrollEnabled={false}
        />
      </View>
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

  statusBadge: { borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4, borderWidth: 1 },
  statusBadgeSent: { backgroundColor: Colors.successLight, borderColor: Colors.successBorder },
  statusBadgeUnsent: { backgroundColor: Colors.primaryLight, borderColor: '#E8C4B4' },
  statusBadgeText: { fontSize: 11, fontWeight: '700' },
  statusTextSent: { color: Colors.success },
  statusTextUnsent: { color: TERRACOTTA },

  scroll: { flex: 1 },
  scrollContent: { padding: 16, gap: 12 },

  // Info card
  infoCard: {
    backgroundColor: '#fff', borderRadius: 18, padding: 18, gap: 8,
    shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 }, elevation: 2,
  },
  infoMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  infoMetaText: { fontSize: 12, color: Colors.mutedFg },
  infoMetaDot: { fontSize: 12, color: Colors.placeholder, marginHorizontal: 2 },
  titleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  infoTitle: { fontSize: 17, fontWeight: '800', color: DARK_BROWN, lineHeight: 24, flex: 1 },
  titleEditBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: Colors.primaryLight, borderRadius: 16,
    paddingHorizontal: 10, paddingVertical: 5, marginTop: 2,
  },
  titleEditBtnText: { fontSize: 11, fontWeight: '700', color: TERRACOTTA },
  inlineLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  inlineSectionLabel: { fontSize: 12, fontWeight: '600', color: Colors.mutedFg },
  sourceRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  sourceText: { fontSize: 12, color: TERRACOTTA, fontWeight: '600' },

  // Editing badge
  editingBadge: {
    backgroundColor: Colors.primaryLight, borderRadius: 12,
    paddingHorizontal: 8, paddingVertical: 3,
  },
  editingBadgeText: { fontSize: 11, fontWeight: '700', color: TERRACOTTA },

  // Pencil button (44×44 effective touch area via hitSlop)
  pencilBtn: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: '#fff', borderWidth: 1, borderColor: Colors.border,
    justifyContent: 'center', alignItems: 'center',
  },

  // Inline text input
  inlineInput: {
    backgroundColor: INPUT_BG,
    borderWidth: 1, borderColor: '#D5CCC7',
    borderRadius: 14, padding: 14,
    fontSize: 16, color: DARK_BROWN, lineHeight: 24,
    textAlignVertical: 'top',
    minHeight: 80,
  },
  inlineInputFocused: {
    borderColor: TERRACOTTA,
  },

  card: {
    backgroundColor: '#fff', borderRadius: 20, padding: 20,
    shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 5,
    shadowOffset: { width: 0, height: 1 }, elevation: 1,
  },
  cardSage: { backgroundColor: SAGE_BG },
  cardWarm: { backgroundColor: WARM_BG },
  cardComparison: { backgroundColor: '#F0F9FF', borderLeftWidth: 3, borderLeftColor: '#0EA5E9' },
  compSubtitle: { fontSize: 11, color: '#64748b', marginTop: 1 },
  compRow: { marginBottom: 12 },
  compTopRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 4 },
  compPoint: { fontSize: 14, fontWeight: '700', color: DARK_BROWN, flex: 1 },
  compBadge: { borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2 },
  compBadgeText: { fontSize: 11, fontWeight: '700' },
  compReason: { fontSize: 13, color: '#64748b', lineHeight: 18 },
  cardGoals: { backgroundColor: '#F5F0FF', borderLeftWidth: 3, borderLeftColor: '#8B5CF6' },
  goalsBadgeRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 12 },
  goalsBadgeTextDraft: { fontSize: 11, color: '#8B5CF6', fontWeight: '600' },
  goalsBadgeTextSaved: { fontSize: 11, color: '#22c55e', fontWeight: '600' },
  goalRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 8 },
  goalIndex: {
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: '#8B5CF620', alignItems: 'center', justifyContent: 'center', marginTop: 1,
  },
  goalIndexText: { fontSize: 11, color: '#8B5CF6', fontWeight: '700' },
  goalText: { flex: 1, fontSize: 14, color: DARK_BROWN, lineHeight: 21 },

  cardTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 14 },
  cardTitle: { fontSize: 16, fontWeight: '800', color: DARK_BROWN, flex: 1 },

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
  drillSectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 4 },
  drillCard: {
    backgroundColor: '#fff', borderRadius: 18, padding: 18,
    shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 5,
    shadowOffset: { width: 0, height: 1 }, elevation: 1,
  },
  drillCardEditing: { borderWidth: 1, borderColor: TERRACOTTA },
  drillName: { fontSize: 16, fontWeight: '800', color: DARK_BROWN, marginBottom: 12 },
  drillEditName: { fontWeight: '800', marginBottom: 12 },
  drillEditField: {
    fontSize: 15, color: DARK_BROWN, lineHeight: 22,
    backgroundColor: INPUT_BG, borderRadius: 10, padding: 10,
    borderWidth: 0,
  },
  drillRow: { marginBottom: 10 },
  drillLabel: { fontSize: 12, fontWeight: '600', color: Colors.mutedFg, marginBottom: 4 },
  drillValue: { fontSize: 15, color: DARK_BROWN, lineHeight: 23 },
  drillMetaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 },
  drillMetaBadge: {
    backgroundColor: Colors.primaryLight, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4,
  },
  drillMetaText: { fontSize: 12, fontWeight: '700', color: TERRACOTTA },

  accordionHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 4,
  },
  accordionTitle: { fontSize: 16, fontWeight: '700', color: DARK_BROWN },
  accordionContent: {
    marginTop: 14, paddingTop: 14, borderTopWidth: 1, borderTopColor: Colors.border,
  },
  transcriptText: { fontSize: 15, color: DARK_BROWN, lineHeight: 25 },

  // Action bar (stays above keyboard via KeyboardAvoidingView)
  actionBar: {
    backgroundColor: '#fff',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.border,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 10,
  },
  saveErrorMsg: {
    fontSize: 13, color: '#dc2626', textAlign: 'center', marginBottom: 8,
  },
  actionBarButtons: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },
  cancelBtn: {
    paddingVertical: 14, paddingHorizontal: 16,
    justifyContent: 'center', alignItems: 'center',
    minHeight: 46,
  },
  cancelBtnText: { fontSize: 15, color: Colors.mutedFg, fontWeight: '600' },
  saveBtn: {
    width: 110, backgroundColor: TERRACOTTA, borderRadius: 12,
    paddingVertical: 14, alignItems: 'center', justifyContent: 'center',
    minHeight: 46,
  },
  saveBtnDisabled: { opacity: 0.4 },
  saveBtnText: { fontSize: 15, fontWeight: '800', color: '#fff' },

  // Bottom send bar (hidden during editing)
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
});
