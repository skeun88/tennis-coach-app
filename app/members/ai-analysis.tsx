import { useEffect, useState, useRef } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Alert, ActivityIndicator, Platform, Animated, Modal, TextInput, KeyboardAvoidingView,
  AppState, AppStateStatus,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAudioRecorder, AudioModule, RecordingPresets, setAudioModeAsync, useAudioRecorderState } from 'expo-audio';
import { supabase } from '../../lib/supabase';
import { LessonPlan, DrillSuggestion } from '../../types';
import { Colors } from '../../lib/theme';
import { useSubscription } from '../../hooks/useSubscription';
import { checkAiAnalysisLimit, incrementAiAnalysisUsage } from '../../lib/subscription';
import PlanUpsellModal, { UpsellContext } from '../../components/PlanUpsellModal';
import ReportQuotaBar from '../../components/ReportQuotaBar';
import ReportTopupModal from '../../components/ReportTopupModal';

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;

const ANALYSIS_STEPS = [
  { step: 0, icon: '⬆️', label: '오디오 업로드 중...' },
  { step: 1, icon: '🎙', label: '음성 변환 중...' },
  { step: 2, icon: '📝', label: '레슨 내용 요약 중...' },
  { step: 3, icon: '🔍', label: '관련 교육 자료 검색 중...' },
  { step: 4, icon: '🧠', label: 'AI 레슨 분석 중...' },
  { step: 5, icon: '💾', label: '분석 결과 저장 중...' },
];

export default function AIAnalysisScreen() {
  const { memberId, memberName, memberLevel } = useLocalSearchParams<{
    memberId: string;
    memberName: string;
    memberLevel: string;
  }>();
  const router = useRouter();
  const { canUse, subscription, loading: subLoading } = useSubscription();

  useEffect(() => {
    if (subscription) loadUsageInfo();
  }, [subscription]);
  const [upsellContext, setUpsellContext] = useState<UpsellContext | null>(null);
  const [usageInfo, setUsageInfo] = useState<{ used: number; limit: number } | undefined>(undefined);
  const [topupModalVisible, setTopupModalVisible] = useState(false);
  const [pendingAnalysis, setPendingAnalysis] = useState<{
    uri: string; userId: string; duration: number;
    storagePath?: string; planId?: string;
  } | null>(null);
  const [authToken, setAuthToken] = useState<string>('');

  const audioRecorder = useAudioRecorder({
    ...RecordingPresets.HIGH_QUALITY,
    isMeteringEnabled: false,
  });
  const recorderState = useAudioRecorderState(audioRecorder);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisStep, setAnalysisStep] = useState(0); // 0 = 대기, 1~4 = 진행중
  const [plans, setPlans] = useState<LessonPlan[]>([]);
  const [expandedPlan, setExpandedPlan] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // 수동 레포트 모달
  const [manualModalVisible, setManualModalVisible] = useState(false);
  const [manualSummary, setManualSummary] = useState('');
  const [manualAchievements, setManualAchievements] = useState('');
  const [manualImprovement, setManualImprovement] = useState('');
  const [manualPracticePlan, setManualPracticePlan] = useState('');
  const [polishing, setPolishing] = useState(false);
  const [polishedReport, setPolishedReport] = useState<null | {
    summary: string;
    achievements: string[];
    improvement_points: string[];
    practice_plan: Array<{ title: string; description: string; duration?: string; frequency?: string }>;
  }>(null);
  const [savingReport, setSavingReport] = useState(false);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const abortControllerRef = useRef<AbortController | null>(null);
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);
  const backgroundTimeRef = useRef<number | null>(null); // 백그라운드 진입 시간

  useEffect(() => {
    loadPlans();
    // AppState 감지: 백그라운드 진입 시 진행 중인 분석은 abort하지 않고 계속 유지
    // iOS는 백그라운드에서도 URLSession 작업이 유지되지만 fetch가 끊길 수 있으므로
    // 타임아웃을 5분으로 연장하고 AbortController를 상태에서 관리
    const sub = AppState.addEventListener('change', (nextState: AppStateStatus) => {
      const prevState = appStateRef.current;
      appStateRef.current = nextState;

      if (nextState === 'background' || nextState === 'inactive') {
        // 백그라운드 진입 시간 기록
        backgroundTimeRef.current = Date.now();
        // fetch는 abort하지 않음 — iOS URLSession은 백그라운드에서도 지속됨
        // AbortController를 abort하지 않으면 요청이 유지됨
      } else if (nextState === 'active' && prevState !== 'active') {
        // 포그라운드 복귀
        const bgMs = backgroundTimeRef.current ? Date.now() - backgroundTimeRef.current : 0;
        backgroundTimeRef.current = null;
        // 3분 이상 백그라운드에 있었으면 fetch가 이미 끝났을 가능성 높음
        // 분석 진행 중이면 사용자에게 알림
        if (bgMs > 3 * 60 * 1000 && abortControllerRef.current) {
          // 해당 가능성이 있지만 일단 유지 시도 — 구체적 abort는 하지 않음
          // 타임아웃 5분 내라면 이미 완료/실패 에러로 처리됨
        }
      }
    });
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      sub.remove();
    };
  }, []);

  // 충전 연결/해제 등 시스템 오디오 인터럽트 감지 → 자동 재개
  useEffect(() => {
    if (!isRecording) return;
    if (recorderState.mediaServicesDidReset) {
      // 오디오 세션이 리셋됨 (충전 연결 등) → 오디오 모드 재설정 후 재개
      setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true, allowsBackgroundRecording: true, shouldPlayInBackground: true })
        .then(() => audioRecorder.prepareToRecordAsync(RecordingPresets.HIGH_QUALITY))
        .then(() => { audioRecorder.record(); })
        .catch((e: any) => {
          Alert.alert('녹음 재개 실패', `충전 연결로 인해 녹음이 중단됐어요.\n다시 시작해주세요.\n${e?.message ?? ''}`);
          if (timerRef.current) clearInterval(timerRef.current);
          setIsRecording(false);
        });
    }
  }, [recorderState.mediaServicesDidReset, isRecording]);

  // 녹음 중 pulse 애니메이션
  useEffect(() => {
    if (isRecording) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.15, duration: 600, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1, duration: 600, useNativeDriver: true }),
        ])
      ).start();
    } else {
      pulseAnim.setValue(1);
    }
  }, [isRecording]);

  async function loadUsageInfo() {
    if (!subscription) return;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const result = await checkAiAnalysisLimit(user.id, subscription);
    setUsageInfo({ used: result.used, limit: result.limit });
  }

  async function pollForPlan(planId: string): Promise<any> {
    const MAX_ATTEMPTS = 70; // 약 6분 (5초 간격)
    let step = 2;
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      await new Promise(r => setTimeout(r, 5000));
      // 화면잠금·백그라운드 전환 시 네트워크 에러가 발생해도 폴링을 계속 유지
      let pollData: any = null;
      try {
        const { data, error } = await supabase
          .from('lesson_plans')
          .select('id, status, error_message')
          .eq('id', planId)
          .single();
        if (!error) pollData = data;
      } catch { /* 네트워크 에러 — 다음 폴링으로 넘어감 */ }
      if (!pollData) continue;
      if (pollData.status === 'processing') {
        step = Math.min(step + 1, ANALYSIS_STEPS.length - 1);
        setAnalysisStep(step);
      }
      if (pollData.status === 'completed') return pollData;
      if (pollData.status === 'failed') throw new Error(pollData.error_message || '분석 실패');
    }
    throw new Error('POLL_TIMEOUT');
  }

  async function loadPlans() {
    const { data } = await supabase
      .from('lesson_plans')
      .select('*')
      .eq('member_id', memberId)
      .order('created_at', { ascending: false })
      .limit(10);
    setPlans(data ?? []);
    setLoading(false);

    // 앱 복귀 시 진행 중인 분석 자동 재개
    const inProgress = (data ?? []).find((p: any) => p.status === 'pending' || p.status === 'processing');
    if (inProgress && !isAnalyzing) {
      setIsAnalyzing(true);
      setAnalysisStep(2);
      pollForPlan(inProgress.id)
        .then(async () => { await loadPlans(); })
        .catch(() => { loadPlans(); })
        .finally(() => { setIsAnalyzing(false); setAnalysisStep(0); });
    }
  }

  async function polishManualReport() {
    setPolishing(true);
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/polish-manual-report`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` },
        body: JSON.stringify({
          memberName,
          memberLevel,
          lessonDate: new Date().toISOString().split('T')[0],
          raw: {
            summary: manualSummary,
            achievements: manualAchievements,
            improvementPoints: manualImprovement,
            practicePlan: manualPracticePlan,
          },
        }),
      });
      const data = await res.json();
      if (data.success) {
        setPolishedReport(data.report);
      } else {
        Alert.alert('오류', data.error ?? 'AI 다듬기 실패');
      }
    } catch (e) {
      Alert.alert('오류', '네트워크 오류가 발생했습니다.');
    } finally {
      setPolishing(false);
    }
  }

  async function saveManualReport() {
    if (!polishedReport) return;
    setSavingReport(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('not authenticated');
      const { error } = await supabase.from('member_lesson_reports').insert({
        coach_id: user.id,
        member_id: memberId,
        lesson_date: new Date().toISOString().split('T')[0],
        summary: polishedReport.summary,
        achievements: polishedReport.achievements,
        improvement_points: polishedReport.improvement_points,
        practice_plan: polishedReport.practice_plan,
        source: 'manual',
      });
      if (error) throw error;
      Alert.alert('저장 완료', '레포트가 저장되었습니다.');
      setManualModalVisible(false);
      setPolishedReport(null);
      setManualSummary(''); setManualAchievements(''); setManualImprovement(''); setManualPracticePlan('');
    } catch (e) {
      Alert.alert('오류', '저장에 실패했습니다.');
    } finally {
      setSavingReport(false);
    }
  }

  async function startRecording() {
    try {
      const status = await AudioModule.requestRecordingPermissionsAsync();
      if (!status.granted) {
        Alert.alert('권한 필요', '마이크 권한이 필요합니다.');
        return;
      }
      await setAudioModeAsync({
        allowsRecording: true,
        playsInSilentMode: true,
        allowsBackgroundRecording: true,
        shouldPlayInBackground: true,
        interruptionMode: 'doNotMix' as const, // 전화 수신 시 일시정지 후 재개
      });
      await audioRecorder.prepareToRecordAsync(RecordingPresets.HIGH_QUALITY);
      audioRecorder.record();
      setIsRecording(true);
      setRecordingDuration(0);
      timerRef.current = setInterval(() => setRecordingDuration(d => d + 1), 1000);
    } catch (e: any) {
      Alert.alert('오류', `녹음을 시작할 수 없습니다.\n${e?.message ?? ''}`);
    }
  }

  async function runAnalysis(
    uri: string, userId: string, duration: number, token: string,
    skipMonthlyIncrement = false,
    reuseStoragePath?: string, reusePlanId?: string,
  ) {
    setIsAnalyzing(true);

    try {
      let storagePath = reuseStoragePath;
      let planId = reusePlanId;

      // ── Step 0: 오디오 업로드 (재시도가 아닐 때만) ──
      if (!storagePath) {
        setAnalysisStep(0);
        storagePath = `${userId}/${Date.now()}_lesson.m4a`;
        const fileRes = await fetch(uri);
        const blob = await fileRes.blob();
        const { error: uploadError } = await supabase.storage
          .from('lesson-audio')
          .upload(storagePath, blob, { contentType: 'audio/m4a', upsert: false });
        if (uploadError) throw new Error(`오디오 업로드 실패: ${uploadError.message}`);
      }

      // ── Step 1: lesson_plans 행 생성 (재시도가 아닐 때만) ──
      if (!planId) {
        setAnalysisStep(1);
        const { data: pending, error: planError } = await supabase
          .from('lesson_plans')
          .insert({ coach_id: userId, member_id: memberId, status: 'pending', audio_storage_path: storagePath })
          .select('id')
          .single();
        if (planError || !pending) throw new Error('분석 초기화 실패');
        planId = pending.id;
      }

      // ── Step 2: Edge Function 트리거 (fire-and-forget) ──
      // 앱이 백그라운드로 전환돼도 서버에서 분석 계속 진행
      fetch(`${SUPABASE_URL}/functions/v1/process-lesson`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({
          lesson_plan_id: planId,
          audio_storage_path: storagePath,
          member_id: memberId,
          coach_id: userId,
          duration_seconds: duration,
        }),
      }).catch(() => {
        // 연결 끊겨도 서버에서 계속 처리됨
      });

      setAnalysisStep(2);

      // ── Step 3: 완료까지 폴링 ──
      const completed = await pollForPlan(planId!);

      // quota 초과 시 충전 모달
      if (completed.error_message?.includes('REPORT_QUOTA_EXCEEDED') ||
          completed.error_message?.includes('할당량')) {
        setIsAnalyzing(false);
        setAnalysisStep(0);
        setPendingAnalysis({ uri, userId, duration, storagePath, planId });
        setAuthToken(token);
        setTopupModalVisible(true);
        return;
      }

      if (!skipMonthlyIncrement) await incrementAiAnalysisUsage(userId);
      await loadPlans();
      setExpandedPlan(completed.id);
      Alert.alert('완료', 'AI 레슨 분석이 완료됐습니다! 🎾');

    } catch (e: any) {
      if (e?.message === 'POLL_TIMEOUT') {
        Alert.alert(
          '분석 진행 중',
          '분석이 서버에서 계속 진행 중입니다.\n잠시 후 이 화면으로 돌아오면 결과를 확인할 수 있습니다.',
        );
      } else {
        Alert.alert('오류', e.message || '분석 중 오류가 발생했습니다.');
      }
    } finally {
      setIsAnalyzing(false);
      setAnalysisStep(0);
    }
  }

  async function stopAndAnalyze() {
    if (!isRecording) return;

    if (recordingDuration < 10) {
      Alert.alert('녹음 시간 부족', '최소 10초 이상 녹음해야 분석이 가능합니다.\n현재: ' + recordingDuration + '초');
      return;
    }

    if (timerRef.current) clearInterval(timerRef.current);
    setIsRecording(false);

    try {
      await audioRecorder.stop();
      const uri = audioRecorder.uri;
      if (!uri) throw new Error('녹음 파일을 찾을 수 없습니다.');

      const { data: { user }, error: userError } = await supabase.auth.getUser();
      if (userError || !user) throw new Error('로그인이 필요합니다.');

      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token ?? SUPABASE_ANON_KEY;

      // ── 월별 한도 체크 (로컬 사전 체크 — extra credit 없을 때만 모달 즉시 표시) ──
      const limitCheck = await checkAiAnalysisLimit(user.id, subscription);
      if (!limitCheck.allowed && !limitCheck.needsExtraCredit) {
        // 구독 자체 차단
        setUsageInfo({ used: limitCheck.used, limit: limitCheck.limit });
        setUpsellContext(limitCheck.planId === 'basic' ? 'ai_analysis_limit' : 'ai_analysis_free');
        return;
      }

      if (!limitCheck.allowed && limitCheck.needsExtraCredit && limitCheck.extraCredits === 0) {
        // 월 한도 초과 + 추가 크레딧 없음 → 즉시 충전 모달
        setUsageInfo({ used: limitCheck.used, limit: limitCheck.limit });
        setPendingAnalysis({ uri, userId: user.id, duration: recordingDuration });
        setAuthToken(token);
        setTopupModalVisible(true);
        return;
      }

      // 정상 진행 (월 한도 내 or 추가 크레딧 있음 — 서버가 처리)
      const usingExtraCredit = limitCheck.needsExtraCredit && limitCheck.extraCredits > 0;
      await runAnalysis(uri, user.id, recordingDuration, token, usingExtraCredit);

    } catch (e: any) {
      Alert.alert('오류', e.message || '분석 시작 중 오류가 발생했습니다.');
    }
  }

  async function handleTopupSuccess(newBalance: number) {
    setTopupModalVisible(false);
    if (!pendingAnalysis) return;
    const { uri, userId, duration, storagePath, planId } = pendingAnalysis;
    setPendingAnalysis(null);
    // 충전 완료 후 재시도 — 기존 업로드된 파일 재사용, 새 plan 행 생성
    await runAnalysis(uri, userId, duration, authToken, true, storagePath, undefined);
  }

  // ── 유틸 ──
  function formatDuration(seconds: number) {
    const m = Math.floor(seconds / 60).toString().padStart(2, '0');
    const s = (seconds % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  }

  function formatDate(dateStr: string) {
    const d = new Date(dateStr);
    return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
  }

  /**
   * improvement_points / next_goals:
   * DB에 배열로 저장된 경우도, 텍스트 줄바꿈 형식도 모두 처리
   */
  /**
   * summary에서 JSON이 섞여있으면 파싱해서 텍스트만 추출
   */
  function cleanSummary(val: unknown): string {
    if (!val) return '';
    const str = String(val).trim();

    // JSON 블록이 포함된 경우 — 전체가 JSON이거나 일부에 섞인 경우 모두 처리
    // 1) 전체가 JSON 객체인 경우
    if (str.startsWith('{')) {
      try {
        const parsed = JSON.parse(str);
        return parsed.summary || parsed.lesson_flow || parsed.content || str;
      } catch { /* 파싱 실패 시 아래로 */ }
    }

    // 2) 텍스트 안에 JSON 블록이 섞인 경우 (```json ... ``` 또는 { ... } 패턴)
    // JSON 블록 제거 후 순수 텍스트만 반환
    let cleaned = str
      .replace(/```json[\s\S]*?```/g, '')   // 코드블록 제거
      .replace(/```[\s\S]*?```/g, '')        // 일반 코드블록 제거
      .replace(/\{[\s\S]*?\}/g, (match) => {  // JSON 객체 — summary 추출 시도
        try {
          const p = JSON.parse(match);
          return p.summary || p.lesson_flow || '';
        } catch { return ''; }
      })
      .trim();

    return cleaned || str;
  }

  /**
   * summary에서 키워드 위주 2줄 짧은 요약 생성
   */
  function shortSummary(val: unknown): string {
    const full = cleanSummary(val);
    if (!full) return '';
    // 첫 두 문장만 (마침표/느낌표/줄바꿈 기준)
    const sentences = full.split(/(?<=[.!?\n])/).map(s => s.trim()).filter(Boolean);
    return sentences.slice(0, 2).join(' ');
  }

  function toStringArray(val: unknown): string[] {
    if (Array.isArray(val)) return val.map(String).filter(Boolean);
    if (typeof val === 'string') {
      // escaped \n 또는 실제 줄바꿈 모두 처리
      return val
        .replace(/\\n/g, '\n')
        .split('\n')
        .map(l => l.replace(/^\s*\d+[\.\)]\s*/, '').trim())
        .filter(Boolean);
    }
    return [];
  }

  // ── 컴포넌트 ──

  function BulletList({ value, icon = '▸' }: { value: unknown; icon?: string }) {
    const lines = toStringArray(value);
    if (lines.length === 0) return null;
    return (
      <>
        {lines.map((line, i) => (
          <View key={i} style={styles.bulletRow}>
            <Text style={styles.bulletIcon}>{icon}</Text>
            <Text style={styles.bulletText}>{line}</Text>
          </View>
        ))}
      </>
    );
  }

  function DrillCard({ drill, index }: { drill: DrillSuggestion; index: number }) {
    return (
      <View style={styles.drillCard}>
        <View style={styles.drillHeader}>
          <View style={styles.drillIndex}>
            <Text style={styles.drillIndexText}>{index + 1}</Text>
          </View>
          <Text style={styles.drillName}>{drill.name}</Text>
        </View>
        <View style={styles.drillBody}>
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
      </View>
    );
  }

  function AnalyzingView() {
    const current = ANALYSIS_STEPS.find(s => s.step === analysisStep);
    return (
      <View style={styles.analyzingBox}>
        <ActivityIndicator size="large" color={Colors.primary} />
        <Text style={styles.analyzingText}>
          {current ? `${current.icon} ${current.label}` : 'AI 분석 중...'}
        </Text>
        {/* 단계 도트 */}
        <View style={styles.stepDots}>
          {ANALYSIS_STEPS.map(s => (
            <View
              key={s.step}
              style={[
                styles.stepDot,
                analysisStep >= s.step && styles.stepDotActive,
                analysisStep === s.step && styles.stepDotCurrent,
              ]}
            />
          ))}
        </View>
        <Text style={styles.analyzingSubText}>{analysisStep} / {ANALYSIS_STEPS.length} 단계</Text>
      </View>
    );
  }

  // ── 구독 권한 체크 ──
  if (!subLoading && !canUse('ai_analysis')) {
    const ctx: UpsellContext =
      subscription?.plan_id === 'free' || !subscription
        ? 'ai_analysis_free'
        : 'generic_pro';
    return (
      <PlanUpsellModal
        visible={true}
        onClose={() => router.back()}
        context={ctx}
        currentPlanId={subscription?.plan_id ?? 'free'}
      />
    );
  }

  // ── 렌더 ──
  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={24} color="#fff" />
        </TouchableOpacity>
        <View>
          <Text style={styles.headerTitle}>AI 레슨 분석</Text>
          <Text style={styles.headerSub}>{memberName} · {memberLevel}</Text>
        </View>
      </View>

      <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>

        {/* 녹음 카드 */}
        <View style={styles.recordCard}>
          <Text style={styles.recordTitle}>🎙 레슨 녹음</Text>
          <Text style={styles.recordDesc}>
            레슨 중 코치 음성을 녹음하면{'\n'}AI가 자동으로 분석하고 다음 레슨 계획을 만들어드려요
          </Text>

          {/* 사용량 표시 */}
          {usageInfo && (
            <View style={{ marginBottom: 12 }}>
              <ReportQuotaBar
                used={usageInfo.used}
                limit={usageInfo.limit}
                extraCredits={subscription?.extra_report_credits ?? 0}
                onTopupPress={() => setTopupModalVisible(true)}
              />
            </View>
          )}

          {isAnalyzing ? (
            <AnalyzingView />
          ) : (
            <View style={styles.recordControls}>
              {isRecording && (
                <View style={styles.durationBox}>
                  <View style={styles.recordingDot} />
                  <Text style={styles.durationText}>{formatDuration(recordingDuration)}</Text>
                </View>
              )}

              <Animated.View style={{ transform: [{ scale: pulseAnim }] }}>
                <TouchableOpacity
                  style={[styles.recordBtn, isRecording && styles.recordBtnActive]}
                  onPress={isRecording ? stopAndAnalyze : startRecording}
                >
                  <Ionicons name={isRecording ? 'stop' : 'mic'} size={32} color="#fff" />
                  <Text style={styles.recordBtnText}>
                    {isRecording ? '분석 시작' : '녹음 시작'}
                  </Text>
                </TouchableOpacity>
              </Animated.View>

              {isRecording && (
                <Text style={styles.recordHint}>버튼을 눌러 녹음을 멈추고 AI 분석을 시작하세요</Text>
              )}
            </View>
          )}
        </View>

        {/* 수동 레포트 작성 버튼 */}
        <TouchableOpacity
          style={styles.manualReportBtn}
          onPress={() => { setPolishedReport(null); setManualModalVisible(true); }}
          activeOpacity={0.85}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Ionicons name="create-outline" size={20} color="#7C3AED" />
            <View>
              <Text style={styles.manualReportBtnTitle}>수동 레포트 작성</Text>
              <Text style={styles.manualReportBtnSub}>녹음을 놓쳤을 때 메모로 작성 → AI가 다듬어 리포트로</Text>
            </View>
          </View>
          <Ionicons name="chevron-forward" size={18} color="#7C3AED" />
        </TouchableOpacity>

        {/* 수동 레포트 모달 */}
        <Modal visible={manualModalVisible} animationType="slide" transparent onRequestClose={() => setManualModalVisible(false)}>
          <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <View style={styles.manualOverlay}>
              <View style={styles.manualSheet}>
                <View style={styles.manualHeader}>
                  <Text style={styles.manualHeaderTitle}>✏️ 수동 레포트 작성</Text>
                  <TouchableOpacity onPress={() => setManualModalVisible(false)}>
                    <Ionicons name="close" size={22} color={Colors.mutedFg} />
                  </TouchableOpacity>
                </View>

                <ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="handled">
                  {!polishedReport ? (
                    <View style={styles.manualForm}>
                      <Text style={styles.manualFormHint}>각 항목에 간단히 메모하면 AI가 회원용 리포트로 다듬어드려요.</Text>

                      {[
                        { label: 'a. 오늘 레슨 요약', value: manualSummary, onChange: setManualSummary, placeholder: '예) 포핸드 스윙 교정 집중, 토스 연습...' },
                        { label: 'b. 오늘의 중요 성과', value: manualAchievements, onChange: setManualAchievements, placeholder: '예) 백핸드 안정성 향상, 서브 속도 개선...' },
                        { label: 'c. 개선 및 보완 포인트', value: manualImprovement, onChange: setManualImprovement, placeholder: '예) 풋워크 더 빠르게, 라켓 그립 조정...' },
                        { label: 'd. 맞춤 개인 연습 플랜', value: manualPracticePlan, onChange: setManualPracticePlan, placeholder: '예) 벽 치기 30분/일, 그립 교정 반복...' },
                      ].map(({ label, value, onChange, placeholder }) => (
                        <View key={label} style={styles.manualFieldWrap}>
                          <Text style={styles.manualFieldLabel}>{label}</Text>
                          <TextInput
                            style={styles.manualInput}
                            value={value}
                            onChangeText={onChange}
                            placeholder={placeholder}
                            placeholderTextColor={Colors.placeholder}
                            multiline
                            numberOfLines={3}
                          />
                        </View>
                      ))}

                      <TouchableOpacity
                        style={[styles.polishBtn, polishing && { opacity: 0.6 }]}
                        onPress={polishManualReport}
                        disabled={polishing}
                      >
                        {polishing
                          ? <ActivityIndicator color="#fff" size="small" />
                          : <><Ionicons name="sparkles" size={16} color="#fff" /><Text style={styles.polishBtnText}>  AI로 다듬기</Text></>
                        }
                      </TouchableOpacity>
                    </View>
                  ) : (
                    <View style={styles.manualForm}>
                      <Text style={styles.polishedTitle}>✨ AI가 다듬은 리포트</Text>

                      <View style={styles.polishedSection}>
                        <Text style={styles.polishedLabel}>📝 레슨 요약</Text>
                        <Text style={styles.polishedText}>{polishedReport.summary}</Text>
                      </View>
                      <View style={styles.polishedSection}>
                        <Text style={styles.polishedLabel}>🏆 오늘의 성과</Text>
                        {polishedReport.achievements.map((a, i) => <Text key={i} style={styles.polishedText}>• {a}</Text>)}
                      </View>
                      <View style={styles.polishedSection}>
                        <Text style={styles.polishedLabel}>🔧 개선 포인트</Text>
                        {polishedReport.improvement_points.map((p, i) => <Text key={i} style={styles.polishedText}>• {p}</Text>)}
                      </View>
                      <View style={styles.polishedSection}>
                        <Text style={styles.polishedLabel}>🎯 연습 플랜</Text>
                        {polishedReport.practice_plan.map((p, i) => (
                          <View key={i} style={styles.practicePlanItem}>
                            <Text style={styles.practicePlanTitle}>{p.title}</Text>
                            <Text style={styles.polishedText}>{p.description}</Text>
                            {p.duration ? <Text style={styles.practicePlanMeta}>⏱ {p.duration}{p.frequency ? `  🔁 ${p.frequency}` : ''}</Text> : null}
                          </View>
                        ))}
                      </View>

                      <View style={{ flexDirection: 'row', gap: 10, marginTop: 16 }}>
                        <TouchableOpacity style={styles.retryBtn} onPress={() => setPolishedReport(null)}>
                          <Text style={styles.retryBtnText}>다시 작성</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={[styles.saveBtn, savingReport && { opacity: 0.6 }]}
                          onPress={saveManualReport}
                          disabled={savingReport}
                        >
                          {savingReport
                            ? <ActivityIndicator color="#fff" size="small" />
                            : <Text style={styles.saveBtnText}>저장하기</Text>
                          }
                        </TouchableOpacity>
                      </View>
                    </View>
                  )}
                </ScrollView>
              </View>
            </View>
          </KeyboardAvoidingView>
        </Modal>

        {/* 분석 기록 */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>📋 AI 분석 기록</Text>

          {loading && <ActivityIndicator color={Colors.primary} style={{ marginTop: 20 }} />}

          {!loading && plans.length === 0 && (
            <View style={styles.emptyBox}>
              <Ionicons name="analytics-outline" size={40} color={Colors.iconMuted} />
              <Text style={styles.emptyText}>아직 분석 기록이 없어요</Text>
              <Text style={styles.emptySubText}>위에서 레슨을 녹음하고 AI 분석을 받아보세요</Text>
            </View>
          )}

          {plans.map(plan => (
            <TouchableOpacity
              key={plan.id}
              style={styles.planCard}
              onPress={() => setExpandedPlan(expandedPlan === plan.id ? null : plan.id)}
              activeOpacity={0.8}
            >
              {/* 카드 헤더 */}
              <View style={styles.planHeader}>
                <View style={{ flex: 1 }}>
                  <View style={styles.planMeta}>
                    <Text style={styles.planDate}>{formatDate(plan.created_at)}</Text>
                    {plan.court_type ? (
                      <View style={styles.courtBadge}>
                        <Text style={styles.courtBadgeText}>{plan.court_type}</Text>
                      </View>
                    ) : null}
                    {plan.duration_minutes ? (
                      <Text style={styles.planDuration}>{plan.duration_minutes}분</Text>
                    ) : null}
                  </View>
                  <Text style={styles.planPreview} numberOfLines={2}>
                    {shortSummary(plan.summary) || '분석 결과를 확인하세요'}
                  </Text>
                </View>
                <Ionicons
                  name={expandedPlan === plan.id ? 'chevron-up' : 'chevron-down'}
                  size={20}
                  color={Colors.mutedFg}
                />
              </View>

              {/* 확장 상세 */}
              {expandedPlan === plan.id && (
                <View style={styles.planDetail}>
                  <View style={styles.divider} />

                  {plan.summary ? (
                    <View style={styles.planSection}>
                      <View style={styles.summaryKeywordBox}>
                        <Text style={styles.summaryKeywordText}>{shortSummary(plan.summary)}</Text>
                      </View>
                      <Text style={styles.planSectionContent}>{cleanSummary(plan.summary)}</Text>
                    </View>
                  ) : null}

                  {Array.isArray(plan.drill_suggestions) && plan.drill_suggestions.length > 0 ? (
                    <View style={styles.planSection}>
                      <Text style={styles.planSectionTitle}>🎾 추천 드릴</Text>
                      {plan.drill_suggestions.map((drill, i) => (
                        <DrillCard key={i} drill={drill} index={i} />
                      ))}
                    </View>
                  ) : null}
                </View>
              )}
            </TouchableOpacity>
          ))}
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>

      {/* 플랜 업셀 모달 (구독 차단 / 권한 없음) */}
      {upsellContext && (
        <PlanUpsellModal
          visible={true}
          onClose={() => setUpsellContext(null)}
          context={upsellContext}
          currentPlanId={subscription?.plan_id ?? 'free'}
          usageInfo={usageInfo}
        />
      )}

      {/* AI 리포트 추가 충전 모달 (월 할당량 소진 시) */}
      {topupModalVisible && authToken && (
        <ReportTopupModal
          visible={topupModalVisible}
          onClose={() => {
            setTopupModalVisible(false);
            setPendingAnalysis(null);
          }}
          onTopupSuccess={handleTopupSuccess}
          onUpgradePress={() => {
            setTopupModalVisible(false);
            router.push('/subscription/upgrade' as any);
          }}
          currentPlanId={subscription?.plan_id ?? 'free'}
          authToken={authToken}
        />
      )}
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
  scroll: { flex: 1 },

  // 녹음 카드
  recordCard: {
    backgroundColor: '#fff',
    margin: 16,
    borderRadius: 16,
    padding: 20,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  recordTitle: { fontSize: 17, fontWeight: '800', color: Colors.foreground, marginBottom: 8 },
  recordDesc: { fontSize: 13, color: Colors.mutedFg, lineHeight: 20, marginBottom: 20 },

  // 분석 진행 상태
  analyzingBox: { alignItems: 'center', paddingVertical: 20, gap: 10 },
  analyzingText: { fontSize: 16, fontWeight: '700', color: Colors.navy },
  analyzingSubText: { fontSize: 12, color: Colors.placeholder },
  stepDots: { flexDirection: 'row', gap: 8, marginTop: 4 },
  stepDot: {
    width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.border,
  },
  stepDotActive: { backgroundColor: '#a8d5b5' },
  stepDotCurrent: { backgroundColor: Colors.primary, width: 20, borderRadius: 4 },

  // 녹음 컨트롤
  recordControls: { alignItems: 'center', gap: 12 },
  durationBox: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  recordingDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: Colors.destructive },
  durationText: { fontSize: 24, fontWeight: '800', color: Colors.foreground, letterSpacing: 2 },
  recordBtn: {
    width: 100, height: 100, borderRadius: 50,
    backgroundColor: Colors.primary,
    justifyContent: 'center', alignItems: 'center',
    shadowColor: Colors.primary, shadowOpacity: 0.3, shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 }, elevation: 6, gap: 4,
  },
  recordBtnActive: { backgroundColor: Colors.destructive, shadowColor: Colors.destructive },
  recordBtnText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  recordHint: { fontSize: 12, color: Colors.mutedFg, textAlign: 'center', maxWidth: 240 },

  // 분석 기록
  section: { paddingHorizontal: 16 },
  sectionTitle: { fontSize: 16, fontWeight: '800', color: Colors.foreground, marginBottom: 12 },

  // 수동 레포트
  manualReportBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginHorizontal: 16, marginBottom: 16, padding: 14,
    backgroundColor: '#F5F3FF', borderRadius: 12, borderWidth: 1, borderColor: '#DDD6FE',
  },
  manualReportBtnTitle: { fontSize: 14, fontWeight: '700', color: '#5B21B6' },
  manualReportBtnSub: { fontSize: 11, color: '#7C3AED', marginTop: 2 },
  manualOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  manualSheet: { backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, height: '85%', maxHeight: '92%' },
  manualHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingVertical: 16,
    borderBottomWidth: 1, borderBottomColor: '#F3F4F6',
  },
  manualHeaderTitle: { fontSize: 16, fontWeight: '700', color: Colors.foreground },
  manualForm: { padding: 20, paddingBottom: 40 },
  manualFormHint: { fontSize: 12, color: Colors.mutedFg, marginBottom: 16, lineHeight: 18 },
  manualFieldWrap: { marginBottom: 14 },
  manualFieldLabel: { fontSize: 13, fontWeight: '600', color: Colors.foreground, marginBottom: 6 },
  manualInput: {
    borderWidth: 1, borderColor: Colors.border, borderRadius: 8,
    padding: 10, fontSize: 13, color: Colors.foreground,
    minHeight: 72, textAlignVertical: 'top', lineHeight: 20,
  },
  polishBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#7C3AED', borderRadius: 10, paddingVertical: 13, marginTop: 8,
  },
  polishBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  polishedTitle: { fontSize: 15, fontWeight: '800', color: Colors.foreground, marginBottom: 16 },
  polishedSection: { marginBottom: 16 },
  polishedLabel: { fontSize: 13, fontWeight: '700', color: Colors.primary, marginBottom: 6 },
  polishedText: { fontSize: 13, color: Colors.foreground, lineHeight: 20 },
  practicePlanItem: { backgroundColor: Colors.mutedBg, borderRadius: 8, padding: 10, marginBottom: 8 },
  practicePlanTitle: { fontSize: 13, fontWeight: '700', color: Colors.foreground, marginBottom: 4 },
  practicePlanMeta: { fontSize: 11, color: Colors.mutedFg, marginTop: 4 },
  retryBtn: {
    flex: 1, borderWidth: 1, borderColor: Colors.border, borderRadius: 10,
    paddingVertical: 12, alignItems: 'center',
  },
  retryBtnText: { fontSize: 14, color: Colors.foreground, fontWeight: '600' },
  saveBtn: {
    flex: 2, backgroundColor: Colors.primary, borderRadius: 10,
    paddingVertical: 12, alignItems: 'center',
  },
  saveBtnText: { fontSize: 14, color: '#fff', fontWeight: '700' },
  emptyBox: { alignItems: 'center', paddingVertical: 32, gap: 8 },
  emptyText: { fontSize: 15, color: Colors.placeholder, fontWeight: '600' },
  emptySubText: { fontSize: 13, color: Colors.placeholder, textAlign: 'center' },

  // 플랜 카드
  planCard: {
    backgroundColor: '#fff', borderRadius: 12, padding: 16, marginBottom: 10,
    shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 }, elevation: 2,
  },
  planHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 },
  planMeta: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' },
  planDate: { fontSize: 12, color: Colors.mutedFg },
  planDuration: { fontSize: 12, color: Colors.placeholder },
  courtBadge: {
    backgroundColor: Colors.primaryLight, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2,
  },
  courtBadgeText: { fontSize: 11, color: Colors.navy, fontWeight: '700' },
  planPreview: { fontSize: 14, color: Colors.foreground, lineHeight: 20 },
  planDetail: { marginTop: 4 },
  divider: { height: 1, backgroundColor: Colors.mutedBg, marginVertical: 12 },
  planSection: { marginBottom: 16 },
  planSectionTitle: { fontSize: 13, fontWeight: '800', color: Colors.foreground, marginBottom: 8 },
  planSectionContent: { fontSize: 14, color: Colors.foreground, lineHeight: 22 },

  // Bullet list
  bulletRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 6 },
  bulletIcon: { fontSize: 14, color: Colors.navy, marginTop: 3, width: 14 },
  bulletText: { fontSize: 14, color: Colors.foreground, lineHeight: 22, flex: 1 },

  // 드릴 카드
  drillCard: {
    backgroundColor: '#f8fdf9',
    borderRadius: 10,
    marginBottom: 10,
    overflow: 'hidden',
  },
  drillHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 12, paddingTop: 12, paddingBottom: 8,
  },
  drillIndex: {
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: Colors.primary, justifyContent: 'center', alignItems: 'center',
  },
  drillIndexText: { fontSize: 11, fontWeight: '800', color: '#fff' },
  drillName: { fontSize: 14, fontWeight: '800', color: Colors.foreground, flex: 1 },
  drillBody: { paddingHorizontal: 12, paddingBottom: 12, gap: 4 },
  drillRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  drillLabel: {
    fontSize: 12, fontWeight: '700', color: Colors.navy,
    width: 60, marginTop: 2, flexShrink: 0,
  },
  drillValue: { fontSize: 13, color: Colors.foreground, lineHeight: 20, flex: 1 },

  // 상단 키워드 요약
  summaryKeywordBox: {
    backgroundColor: Colors.primaryLight,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 10,
  },
  summaryKeywordText: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.navy,
    lineHeight: 20,
  },
});
