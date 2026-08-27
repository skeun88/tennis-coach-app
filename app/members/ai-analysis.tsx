import { useEffect, useState, useRef } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Alert, ActivityIndicator, Platform, Animated, Modal, TextInput, KeyboardAvoidingView,
  AppState, AppStateStatus,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAudioRecorder, AudioModule, RecordingPresets, setAudioModeAsync, useAudioRecorderState } from 'expo-audio';
import * as FileSystem from 'expo-file-system/legacy';
import { supabase } from '../../lib/supabase';
import { notifyMemberReport } from '../../lib/notifications';
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

  const VOICE_PRESET = {
    ...RecordingPresets.HIGH_QUALITY,
    ios: { ...RecordingPresets.HIGH_QUALITY.ios, sampleRate: 16000, numberOfChannels: 1, bitRate: 32000 },
    android: { ...RecordingPresets.HIGH_QUALITY.android, sampleRate: 16000, numberOfChannels: 1, bitRate: 32000 },
    isMeteringEnabled: false,
  };
  const audioRecorder = useAudioRecorder(VOICE_PRESET);
  const recorderState = useAudioRecorderState(audioRecorder);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [enhancedMode, setEnhancedMode] = useState(false);
  const [analysisStep, setAnalysisStep] = useState(0); // 0 = 대기, 1~4 = 진행중
  const [plans, setPlans] = useState<LessonPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [memberReports, setMemberReports] = useState<Record<string, any>>({});
  const [manualReports, setManualReports] = useState<any[]>([]);
  const [expandedManual, setExpandedManual] = useState<string | null>(null);

  // 타이핑 레슨 기록 모달
  const [manualModalVisible, setManualModalVisible] = useState(false);
  const [manualContent, setManualContent] = useState('');
  const [polishing, setPolishing] = useState(false);
  const [sendingDirect, setSendingDirect] = useState(false);
  const [polishedReport, setPolishedReport] = useState<null | {
    summary: string;
    achievements: string[];
    improvement_points: string[];
    practice_plan: Array<{ title: string; description: string; duration?: string; frequency?: string }>;
  }>(null);
  const [savingReport, setSavingReport] = useState(false);

  const [usageSheetVisible, setUsageSheetVisible] = useState(false);
  const [hasSeenUsage, setHasSeenUsage] = useState(true); // true = no pulse (default until loaded)

  // 녹음 인터럽트 (전화/이어폰) 관련 상태
  const [isPaused, setIsPaused] = useState(false);
  const [showResumeBtn, setShowResumeBtn] = useState(false);
  const [interruptToast, setInterruptToast] = useState<string | null>(null);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const usagePulseAnim = useRef(new Animated.Value(1)).current;
  const abortControllerRef = useRef<AbortController | null>(null);
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);
  const backgroundTimeRef = useRef<number | null>(null);
  const isIntentionalStopRef = useRef(false); // true = 사용자가 직접 중지 중
  const recordingSegmentsRef = useRef<string[]>([]); // 여러 구간 녹음 파일 URI 목록
  const recordingDurationRef = useRef(0); // duration 누적 (timer 재시작 후에도 유지)

  useEffect(() => {
    AsyncStorage.getItem('ai_lesson_usage_seen').then(val => {
      const seen = val === '1';
      setHasSeenUsage(seen);
    });
  }, []);

  useEffect(() => {
    if (!hasSeenUsage) {
      const anim = Animated.loop(
        Animated.sequence([
          Animated.timing(usagePulseAnim, { toValue: 1.3, duration: 900, useNativeDriver: true }),
          Animated.timing(usagePulseAnim, { toValue: 1, duration: 900, useNativeDriver: true }),
          Animated.delay(400), // 1.5~2초 간격으로 자연스럽게
        ])
      );
      anim.start();
      return () => anim.stop();
    } else {
      usagePulseAnim.setValue(1);
    }
  }, [hasSeenUsage]);

  useEffect(() => {
    loadPlans();
    const sub = AppState.addEventListener('change', (nextState: AppStateStatus) => {
      const prevState = appStateRef.current;
      appStateRef.current = nextState;

      if (nextState === 'background' || nextState === 'inactive') {
        backgroundTimeRef.current = Date.now();
      } else if (nextState === 'active' && prevState !== 'active') {
        backgroundTimeRef.current = null;
        // 전화 통화 후 포그라운드 복귀 → 일시정지 상태면 자동 재개 시도
        if (isPausedRef.current) {
          setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true, allowsBackgroundRecording: true, shouldPlayInBackground: true })
            .then(() => { audioRecorder.record(); })
            .then(() => {
              setIsPaused(false);
              setShowResumeBtn(false);
              setInterruptToast(null);
              // 타이머 재개
              timerRef.current = setInterval(() => setRecordingDuration(d => d + 1), 1000);
            })
            .catch(() => {
              // 자동 재개 실패 → 수동 버튼 표시
              setShowResumeBtn(true);
            });
        }
      }
    });
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      sub.remove();
    };
  }, []);

  // isPaused를 ref로 추적해서 클로저 stale 방지
  const isPausedRef = useRef(false);
  useEffect(() => { isPausedRef.current = isPaused; }, [isPaused]);

  // recorderState.isRecording 변화 감지 → 시스템 인터럽트 (전화 수신) 처리
  useEffect(() => {
    if (!recorderState.isRecording && !isIntentionalStopRef.current && isRecording && !isPaused) {
      // 녹음 중이었는데 시스템이 중단시킨 경우 → 전화 수신으로 간주
      setIsPaused(true);
      setShowResumeBtn(false);
      setInterruptToast('전화 수신으로 녹음이 잠시 멈췄어요. 통화가 끝나면 자동으로 이어서 녹음합니다.');
      if (timerRef.current) clearInterval(timerRef.current);
    }
  }, [recorderState.isRecording]);

  // 이어폰 연결/해제 등 오디오 디바이스 변경 감지 → 구간 저장 후 새 녹음으로 이어서
  useEffect(() => {
    if (!isRecording || !recorderState.mediaServicesDidReset) return;

    const handleDeviceChange = async () => {
      try {
        // 현재 구간 저장
        isIntentionalStopRef.current = true;
        await audioRecorder.stop();
        isIntentionalStopRef.current = false;
        const segUri = audioRecorder.uri;
        if (segUri) recordingSegmentsRef.current.push(segUri);

        setInterruptToast('오디오 기기가 변경되어 녹음을 이어갑니다.');
        setTimeout(() => setInterruptToast(null), 3000);

        // 새 오디오 세션으로 재개
        await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true, allowsBackgroundRecording: true, shouldPlayInBackground: true });
        await audioRecorder.prepareToRecordAsync(VOICE_PRESET);
        audioRecorder.record();
      } catch (e: any) {
        setShowResumeBtn(true);
        setInterruptToast('오디오 기기 변경 중 오류가 발생했어요. 이어서 녹음 버튼을 눌러주세요.');
      }
    };

    handleDeviceChange();
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
    const MAX_ATTEMPTS = 120; // 약 6분 (3초 간격)
    let step = 2;
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      await new Promise(r => setTimeout(r, 3000));
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

    // 연결된 member_lesson_reports 로드 (lesson_plan_id 기준 매핑)
    if (data && data.length > 0) {
      const planIds = data.map((p: any) => p.id);
      const { data: reports } = await supabase
        .from('member_lesson_reports')
        .select('*')
        .in('lesson_plan_id', planIds);
      if (reports) {
        const map: Record<string, any> = {};
        reports.forEach((r: any) => { if (r.lesson_plan_id) map[r.lesson_plan_id] = r; });
        setMemberReports(map);
      }
    }

    // 수동 기록 로드 (lesson_plan_id 없는 member_lesson_reports)
    const { data: manualData } = await supabase
      .from('member_lesson_reports')
      .select('*')
      .eq('member_id', memberId)
      .is('lesson_plan_id', null)
      .order('created_at', { ascending: false })
      .limit(10);
    setManualReports(manualData ?? []);

    // 앱 복귀 시 진행 중인 분석 자동 재개
    const inProgress = (data ?? []).find((p: any) => p.status === 'pending' || p.status === 'processing');
    if (inProgress && !isAnalyzing) {
      setIsAnalyzing(true);
      setAnalysisStep(2);
      const resumedPlanId = inProgress.id;
      pollForPlan(resumedPlanId)
        .then(async () => { await loadPlans(); })
        .catch(async (e: any) => {
          if (e?.message === 'POLL_TIMEOUT') {
            // 무한 재폴링 방지: 타임아웃 시 failed로 마킹 후 재개 중단
            await supabase.from('lesson_plans')
              .update({ status: 'failed', error_message: '분석 시간이 초과됐습니다. 다시 시도해 주세요.' })
              .eq('id', resumedPlanId)
              .eq('status', 'processing');
            Alert.alert('분석 시간 초과', '분석에 오류가 발생했습니다. 다시 시도해 주세요.');
          }
          loadPlans();
        })
        .finally(() => { setIsAnalyzing(false); setAnalysisStep(0); });
    }
  }

  function getPlanTitle(plan: LessonPlan): string {
    if (plan.ai_title) return plan.ai_title;
    const s = shortSummary(plan.summary);
    return s || '분석 결과 확인하기';
  }

  function sectionLabel(section: string): string {
    if (section === 'summary') return '오늘 레슨 요약';
    if (section === 'achievements') return '오늘 잘한 점';
    if (section === 'improvement_points') return '개선 포인트';
    return '';
  }

  async function polishManualReport() {
    if (!manualContent.trim()) {
      Alert.alert('내용을 입력해주세요', '레슨 내용을 작성한 후 AI 생성을 눌러주세요.');
      return;
    }
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
            summary: manualContent,
            achievements: '',
            improvementPoints: '',
            practicePlan: '',
          },
        }),
      });
      const data = await res.json();
      if (data.success) {
        setPolishedReport(data.report);
      } else {
        Alert.alert('오류', data.error ?? 'AI 생성 실패');
      }
    } catch (e) {
      Alert.alert('오류', '네트워크 오류가 발생했습니다.');
    } finally {
      setPolishing(false);
    }
  }

  async function sendDirectReport() {
    if (!manualContent.trim()) {
      Alert.alert('내용을 입력해주세요', '전송할 레슨 내용을 작성해주세요.');
      return;
    }
    setSendingDirect(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('not authenticated');
      const { error } = await supabase.from('member_lesson_reports').insert({
        coach_id: user.id,
        member_id: memberId,
        lesson_date: new Date().toISOString().split('T')[0],
        summary: manualContent,
        achievements: [],
        improvement_points: [],
        practice_plan: [],
        source: 'manual',
      });
      if (error) throw error;
      try { await notifyMemberReport(memberId as string); } catch (e) { console.error('[PUSH] 리포트 알림 실패:', e); }
      Alert.alert('전송 완료', '레슨 기록이 회원에게 전송됐어요.');
      setManualModalVisible(false);
      setManualContent('');
      loadPlans();
    } catch (e) {
      Alert.alert('오류', '전송에 실패했습니다.');
    } finally {
      setSendingDirect(false);
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
      try { await notifyMemberReport(memberId as string); } catch (e) { console.error('[PUSH] 리포트 알림 실패:', e); }
      Alert.alert('저장 완료', '레포트가 저장되었습니다.');
      setManualModalVisible(false);
      setPolishedReport(null);
      setManualContent('');
      loadPlans();
    } catch (e) {
      Alert.alert('오류', '저장에 실패했습니다.');
    } finally {
      setSavingReport(false);
    }
  }

  async function sendReportToMember(plan: LessonPlan) {
    const report = memberReports[plan.id];
    if (!report) {
      Alert.alert('안내', '회원 리포트가 아직 생성 중입니다. 잠시 후 다시 시도해주세요.');
      return;
    }
    Alert.alert('회원에게 전송', '리포트를 회원 앱으로 전송할까요?', [
      { text: '취소', style: 'cancel' },
      {
        text: '전송',
        onPress: async () => {
          try {
            // 이미 member_lesson_reports에 저장된 상태이므로 회원이 앱에서 바로 볼 수 있음
            // is_read 초기화해서 NEW 표시
            await supabase.from('member_lesson_reports')
              .update({ is_read: false })
              .eq('id', report.id);
            try { await notifyMemberReport(plan.member_id); } catch (e) { console.error('[PUSH] 리포트 알림 실패:', e); }
            Alert.alert('전송 완료', '회원이 앱을 열면 리포트를 확인할 수 있어요.');
          } catch {
            Alert.alert('오류', '전송에 실패했습니다.');
          }
        },
      },
    ]);
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
        interruptionMode: 'doNotMix' as const,
      });
      await audioRecorder.prepareToRecordAsync(VOICE_PRESET);
      audioRecorder.record();
      recordingSegmentsRef.current = [];
      recordingDurationRef.current = 0;
      isIntentionalStopRef.current = false;
      setIsRecording(true);
      setIsPaused(false);
      setShowResumeBtn(false);
      setInterruptToast(null);
      setRecordingDuration(0);
      timerRef.current = setInterval(() => {
        setRecordingDuration(d => {
          recordingDurationRef.current = d + 1;
          return d + 1;
        });
      }, 1000);
    } catch (e: any) {
      Alert.alert('오류', `녹음을 시작할 수 없습니다.\n${e?.message ?? ''}`);
    }
  }

  async function resumeRecording() {
    try {
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true, allowsBackgroundRecording: true, shouldPlayInBackground: true });
      await audioRecorder.record();
      setIsPaused(false);
      setShowResumeBtn(false);
      setInterruptToast(null);
      timerRef.current = setInterval(() => {
        setRecordingDuration(d => {
          recordingDurationRef.current = d + 1;
          return d + 1;
        });
      }, 1000);
    } catch (e: any) {
      Alert.alert('재개 실패', `녹음을 다시 시작할 수 없습니다.\n${e?.message ?? ''}`);
    }
  }

  async function mergeAndGetUri(): Promise<string | null> {
    const segments = recordingSegmentsRef.current;
    const lastUri = audioRecorder.uri;
    if (lastUri) segments.push(lastUri);
    if (segments.length === 0) return null;
    if (segments.length === 1) return segments[0];

    // 여러 구간 → base64 단순 연결 (Whisper는 손상된 경계 허용)
    try {
      const parts = await Promise.all(
        segments.map(uri => FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 }))
      );
      const merged = parts.join('');
      const mergedUri = (FileSystem.cacheDirectory ?? '') + `merged_lesson_${Date.now()}.m4a`;
      await FileSystem.writeAsStringAsync(mergedUri, merged, { encoding: FileSystem.EncodingType.Base64 });
      return mergedUri;
    } catch {
      // 병합 실패 → 마지막 구간만 사용
      return segments[segments.length - 1];
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

        // 파일 크기 사전 검증 (file:// URI가 빈 blob이 되는 문제 방지)
        const fileInfo = await FileSystem.getInfoAsync(uri);
        if (!fileInfo.exists || ((fileInfo as any).size ?? 0) < 5000) {
          throw new Error('녹음 파일이 너무 짧거나 없습니다. 최소 10초 이상 레슨을 녹음한 후 분석을 시작하세요.');
        }

        storagePath = `${userId}/${Date.now()}_lesson.m4a`;
        const uploadUrl = `${SUPABASE_URL}/storage/v1/object/lesson-audio/${storagePath}`;
        const uploadResult = await FileSystem.uploadAsync(uploadUrl, uri, {
          httpMethod: 'POST',
          uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'audio/m4a',
            'x-upsert': 'false',
          },
        });
        if (uploadResult.status >= 400) {
          throw new Error(`오디오 업로드 실패: ${uploadResult.body}`);
        }
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

      // ── Step 2: Edge Function 트리거 (fire-and-forget, 단 400+ 시 failed 처리) ──
      const capturedPlanId = planId;
      fetch(`${SUPABASE_URL}/functions/v1/process-lesson`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({
          lesson_plan_id: capturedPlanId,
          audio_storage_path: storagePath,
          member_id: memberId,
          coach_id: userId,
          duration_seconds: duration,
          enhanced_mode: enhancedMode,
        }),
      }).then(async (res) => {
        if (res.status >= 400 && capturedPlanId) {
          const errBody = await res.json().catch(() => ({ error: '분석 요청 실패' }));
          await supabase.from('lesson_plans')
            .update({ status: 'failed', error_message: errBody.error ?? '분석 요청 실패' })
            .eq('id', capturedPlanId);
        }
      }).catch(() => {
        // 네트워크 오류 무시 — 서버에서 계속 처리됨
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

    if (recordingDurationRef.current < 10) {
      Alert.alert('녹음 시간 부족', '최소 10초 이상 녹음해야 분석이 가능합니다.\n현재: ' + recordingDurationRef.current + '초');
      return;
    }

    if (timerRef.current) clearInterval(timerRef.current);
    isIntentionalStopRef.current = true;
    setIsRecording(false);
    setIsPaused(false);
    setShowResumeBtn(false);
    setInterruptToast(null);

    try {
      await audioRecorder.stop();
      isIntentionalStopRef.current = false;
      const uri = await mergeAndGetUri();
      recordingSegmentsRef.current = [];
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
          <Text style={styles.drillName}>{drill.name}</Text>
          <View style={styles.editIconBtn}>
            <Ionicons name="pencil-outline" size={14} color={Colors.mutedFg} />
          </View>
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
          {/* 카드 헤더: 아이콘 + 제목 + 사용법 버튼 */}
          <View style={styles.recordTitleRow}>
            <View style={styles.recordTitleLeft}>
              {/* 마이크 + Sparkles 복합 아이콘 */}
              <View style={styles.recordIconWrap}>
                <Ionicons name="mic-outline" size={22} color={Colors.primary} />
                <View style={styles.recordSparklesBadge}>
                  <Ionicons name="sparkles" size={10} color={Colors.primary} />
                </View>
              </View>
              <Text style={styles.recordTitle}>AI 레슨 기록</Text>
            </View>
            {/* 사용법 ? 버튼 */}
            <TouchableOpacity
              onPress={async () => {
                setUsageSheetVisible(true);
                if (!hasSeenUsage) {
                  setHasSeenUsage(true);
                  await AsyncStorage.setItem('ai_lesson_usage_seen', '1');
                }
              }}
              activeOpacity={0.8}
            >
              <Animated.View style={[styles.usageHelpBtn, { transform: [{ scale: usagePulseAnim }] }]}>
                <Text style={styles.usageHelpText}>?</Text>
              </Animated.View>
            </TouchableOpacity>
          </View>
          <Text style={styles.recordDesc}>
            레슨을 기록하면 AI가 핵심 내용을 정리해{'\n'}회원별 맞춤 레슨 리포트를 만들어드려요.
          </Text>

          {/* 인식 향상 모드 토글 */}
          {!isRecording && !isPaused && !isAnalyzing && (
            <TouchableOpacity
              style={styles.enhancedModeRow}
              onPress={() => setEnhancedMode(v => !v)}
              activeOpacity={0.7}
            >
              <View style={styles.enhancedModeLeft}>
                <Ionicons name="sparkles-outline" size={16} color={enhancedMode ? Colors.primary : Colors.mutedFg} />
                <Text style={[styles.enhancedModeLabel, enhancedMode && styles.enhancedModeLabelOn]}>
                  인식 향상 모드
                </Text>
              </View>
              <View style={[styles.enhancedToggle, enhancedMode && styles.enhancedToggleOn]}>
                <View style={[styles.enhancedThumb, enhancedMode && styles.enhancedThumbOn]} />
              </View>
            </TouchableOpacity>
          )}

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

          {/* 인터럽트 토스트 */}
          {interruptToast && (
            <View style={styles.interruptToast}>
              <Ionicons name="information-circle-outline" size={16} color={Colors.primary} />
              <Text style={styles.interruptToastText}>{interruptToast}</Text>
            </View>
          )}

          {isAnalyzing ? (
            <AnalyzingView />
          ) : (
            <View style={styles.recordControls}>
              {(isRecording || isPaused) && (
                <View style={styles.durationBox}>
                  <View style={[styles.recordingDot, isPaused && styles.recordingDotPaused]} />
                  <Text style={styles.durationText}>{formatDuration(recordingDuration)}</Text>
                  {isPaused && <Text style={styles.pausedLabel}>일시정지</Text>}
                </View>
              )}

              <Animated.View style={{ transform: [{ scale: pulseAnim }] }}>
                <TouchableOpacity
                  style={[
                    styles.recordBtn,
                    (isRecording && !isPaused) && styles.recordBtnActive,
                    isPaused && styles.recordBtnPaused,
                  ]}
                  onPress={isRecording && !isPaused ? stopAndAnalyze : (!isRecording && !isPaused ? startRecording : undefined)}
                  disabled={isPaused}
                >
                  <Ionicons
                    name={isRecording && !isPaused ? 'stop' : isPaused ? 'pause' : 'mic'}
                    size={32}
                    color="#fff"
                  />
                  <Text style={styles.recordBtnText}>
                    {isRecording && !isPaused ? '분석 시작' : isPaused ? '일시정지' : '녹음 시작'}
                  </Text>
                </TouchableOpacity>
              </Animated.View>

              {/* 이어서 녹음 버튼 (자동 재개 실패 시) */}
              {showResumeBtn && (
                <TouchableOpacity style={styles.resumeBtn} onPress={resumeRecording}>
                  <Ionicons name="play-circle-outline" size={18} color="#fff" />
                  <Text style={styles.resumeBtnText}>이어서 녹음</Text>
                </TouchableOpacity>
              )}

              {/* 일시정지 중일 때 분석 시작 버튼 */}
              {isPaused && (
                <TouchableOpacity style={styles.stopAnalyzeBtn} onPress={stopAndAnalyze}>
                  <Ionicons name="stop-circle-outline" size={18} color={Colors.primary} />
                  <Text style={styles.stopAnalyzeBtnText}>녹음 종료 후 분석하기</Text>
                </TouchableOpacity>
              )}

              {isRecording && !isPaused && (
                <Text style={styles.recordHint}>버튼을 눌러 녹음을 멈추고 AI 분석을 시작하세요</Text>
              )}
            </View>
          )}
        </View>

        {/* 타이핑으로 레슨 기록 버튼 */}
        <TouchableOpacity
          style={styles.manualReportBtn}
          onPress={() => { setPolishedReport(null); setManualContent(''); setManualModalVisible(true); }}
          activeOpacity={0.85}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Ionicons name="pencil-outline" size={20} color={Colors.primary} />
            <View>
              <Text style={styles.manualReportBtnTitle}>타이핑으로 레슨 기록</Text>
              <Text style={styles.manualReportBtnSub}>녹음을 놓쳤다면 기억나는 내용을 직접 작성해보세요.</Text>
            </View>
          </View>
          <Ionicons name="chevron-forward" size={18} color={Colors.primary} />
        </TouchableOpacity>

        {/* 타이핑 레슨 기록 모달 */}
        <Modal visible={manualModalVisible} animationType="slide" transparent onRequestClose={() => setManualModalVisible(false)}>
          <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <View style={styles.manualOverlay}>
              <View style={styles.manualSheet}>
                <View style={styles.manualHeader}>
                  <Text style={styles.manualHeaderTitle}>타이핑으로 레슨 기록</Text>
                  <TouchableOpacity onPress={() => setManualModalVisible(false)}>
                    <Ionicons name="close" size={22} color={Colors.mutedFg} />
                  </TouchableOpacity>
                </View>

                {!polishedReport ? (
                  <>
                    <Text style={styles.manualFormHint}>오늘 레슨에서 기억나는 내용을 편하게 작성해주세요.</Text>
                    <TextInput
                      style={styles.manualFreeInput}
                      value={manualContent}
                      onChangeText={setManualContent}
                      placeholder="예) 포핸드 타점을 앞으로 잡는 연습을 했고, 백핸드는 몸이 먼저 열리는 부분을 교정했습니다."
                      placeholderTextColor={Colors.placeholder}
                      multiline
                      textAlignVertical="top"
                    />
                    <View style={styles.manualBtnRow}>
                      <TouchableOpacity
                        style={[styles.directSendBtn, (sendingDirect || polishing) && { opacity: 0.6 }]}
                        onPress={sendDirectReport}
                        disabled={sendingDirect || polishing}
                      >
                        {sendingDirect
                          ? <ActivityIndicator color={Colors.primary} size="small" />
                          : <Text style={styles.directSendBtnText}>전송하기</Text>
                        }
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.polishBtn, (polishing || sendingDirect) && { opacity: 0.6 }]}
                        onPress={polishManualReport}
                        disabled={polishing || sendingDirect}
                      >
                        {polishing
                          ? <ActivityIndicator color="#fff" size="small" />
                          : <><Ionicons name="sparkles" size={16} color="#fff" /><Text style={styles.polishBtnText}> AI 레슨 기록 생성</Text></>
                        }
                      </TouchableOpacity>
                    </View>
                  </>
                ) : (
                  <ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="handled">
                    <View style={styles.manualForm}>
                      <Text style={styles.polishedTitle}>AI가 정리한 레슨 기록</Text>

                      <View style={styles.polishedSection}>
                        <Text style={styles.polishedLabel}>레슨 요약</Text>
                        <Text style={styles.polishedText}>{polishedReport.summary}</Text>
                      </View>
                      <View style={styles.polishedSection}>
                        <Text style={styles.polishedLabel}>오늘의 성과</Text>
                        {polishedReport.achievements.map((a, i) => <Text key={i} style={styles.polishedText}>• {a}</Text>)}
                      </View>
                      <View style={styles.polishedSection}>
                        <Text style={styles.polishedLabel}>개선 포인트</Text>
                        {polishedReport.improvement_points.map((p, i) => <Text key={i} style={styles.polishedText}>• {p}</Text>)}
                      </View>
                      <View style={styles.polishedSection}>
                        <Text style={styles.polishedLabel}>연습 플랜</Text>
                        {polishedReport.practice_plan.map((p, i) => (
                          <View key={i} style={styles.practicePlanItem}>
                            <Text style={styles.practicePlanTitle}>{p.title}</Text>
                            <Text style={styles.polishedText}>{p.description}</Text>
                            {p.duration ? <Text style={styles.practicePlanMeta}>{p.duration}{p.frequency ? `  ${p.frequency}` : ''}</Text> : null}
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
                  </ScrollView>
                )}
              </View>
            </View>
          </KeyboardAvoidingView>
        </Modal>

        {/* 분석 기록 */}
        <View style={styles.section}>
          <View style={styles.sectionTitleRow}>
            <View style={styles.sectionIconWrap}>
              <Ionicons name="document-text-outline" size={20} color={Colors.foreground} />
              <View style={styles.sectionSparklesBadge}>
                <Ionicons name="sparkles" size={9} color={Colors.primary} />
              </View>
            </View>
            <Text style={styles.sectionTitle}>AI 분석 기록</Text>
          </View>

          {loading && <ActivityIndicator color={Colors.primary} style={{ marginTop: 20 }} />}

          {!loading && plans.length === 0 && manualReports.length === 0 && (
            <View style={styles.emptyBox}>
              <Ionicons name="analytics-outline" size={40} color={Colors.iconMuted} />
              <Text style={styles.emptyText}>아직 분석 기록이 없어요</Text>
              <Text style={styles.emptySubText}>위에서 레슨을 녹음하고 AI 분석을 받아보세요</Text>
            </View>
          )}

          {plans.map(plan => {
            const report = memberReports[plan.id];
            const isSent = !!report;
            return (
              <TouchableOpacity
                key={plan.id}
                style={styles.planCard}
                onPress={() => router.push({
                  pathname: '/members/plan-detail',
                  params: {
                    planId: plan.id,
                    memberId: memberId as string,
                    memberName: memberName as string,
                    memberLevel: memberLevel as string,
                  },
                } as any)}
                activeOpacity={0.8}
              >
                {/* 상단: 날짜 + 전송 상태 뱃지 */}
                <View style={styles.planTopRow}>
                  <View style={styles.planDateRow}>
                    <Text style={styles.planDate}>{formatDate(plan.created_at)}</Text>
                    {plan.duration_minutes ? (
                      <Text style={styles.planDuration}>· {plan.duration_minutes}분</Text>
                    ) : null}
                  </View>
                  <View style={[styles.sentBadge, isSent ? styles.sentBadgeGreen : styles.sentBadgeTerracotta]}>
                    <Text style={[styles.sentBadgeText, isSent ? styles.sentBadgeTextGreen : styles.sentBadgeTextTerracotta]}>
                      {isSent ? '전송 완료' : '전송 전'}
                    </Text>
                  </View>
                </View>

                {/* AI 핵심 제목 */}
                <View style={styles.planTitleRow}>
                  <Text style={styles.planTitleText} numberOfLines={2}>
                    {getPlanTitle(plan)}
                  </Text>
                  <Ionicons name="chevron-forward" size={18} color={Colors.mutedFg} />
                </View>
              </TouchableOpacity>
            );
          })}

          {/* 수동 기록 카드 (전송하기 / AI 저장 기록) */}
          {manualReports.map(report => (
            <TouchableOpacity
              key={report.id}
              style={styles.planCard}
              onPress={() => setExpandedManual(expandedManual === report.id ? null : report.id)}
              activeOpacity={0.8}
            >
              <View style={styles.planTopRow}>
                <View style={styles.planDateRow}>
                  <Text style={styles.planDate}>{formatDate(report.created_at)}</Text>
                </View>
                <View style={[styles.sentBadge, styles.manualBadge]}>
                  <Text style={[styles.sentBadgeText, styles.manualBadgeText]}>직접 작성</Text>
                </View>
              </View>
              <View style={styles.planTitleRow}>
                <Text style={styles.planTitleText} numberOfLines={2}>
                  {report.summary || '레슨 기록'}
                </Text>
                <Ionicons
                  name={expandedManual === report.id ? 'chevron-up' : 'chevron-down'}
                  size={18}
                  color={Colors.mutedFg}
                />
              </View>

              {expandedManual === report.id && (
                <View style={{ marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: Colors.border }}>
                  <Text style={styles.summaryBoxText}>{report.summary}</Text>
                  {Array.isArray(report.achievements) && report.achievements.length > 0 && (
                    <View style={{ marginTop: 12 }}>
                      <Text style={[styles.planSectionTitle, { fontSize: 14, marginBottom: 6 }]}>오늘 잘한 점</Text>
                      {report.achievements.map((a: string, i: number) => (
                        <Text key={i} style={[styles.bulletText, { marginBottom: 4 }]}>• {a}</Text>
                      ))}
                    </View>
                  )}
                  {Array.isArray(report.improvement_points) && report.improvement_points.length > 0 && (
                    <View style={{ marginTop: 12 }}>
                      <Text style={[styles.planSectionTitle, { fontSize: 14, marginBottom: 6 }]}>개선 포인트</Text>
                      {report.improvement_points.map((p: string, i: number) => (
                        <Text key={i} style={[styles.bulletText, { marginBottom: 4 }]}>• {p}</Text>
                      ))}
                    </View>
                  )}
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

      {/* AI 레슨 기록 사용법 바텀시트 */}
      <Modal visible={usageSheetVisible} animationType="slide" transparent onRequestClose={() => setUsageSheetVisible(false)}>
        <View style={styles.usageOverlay}>
          <View style={styles.usageSheet}>
            <View style={styles.usageSheetHandle} />
            <View style={styles.usageSheetHeader}>
              <Text style={styles.usageSheetTitle}>AI 레슨 기록 사용법</Text>
              <TouchableOpacity onPress={() => setUsageSheetVisible(false)}>
                <Ionicons name="close" size={22} color={Colors.mutedFg} />
              </TouchableOpacity>
            </View>
            <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 20, paddingBottom: 48 }}>
              {[
                {
                  num: '①',
                  title: '무선 핀마이크 사용',
                  recommended: true,
                  icon: 'mic' as const,
                  device: '옷깃에 고정하는 무선 핀마이크\n(휴대폰과 블루투스 연결)',
                  how: '무선 핀마이크를 착용한 후\nAI 레슨 기록을 시작하면\n레슨 내용을 자동으로 분석합니다.',
                },
                {
                  num: '②',
                  title: '휴대폰 녹음',
                  recommended: false,
                  icon: 'phone-portrait-outline' as const,
                  device: '별도 장비 없이 휴대폰 마이크',
                  how: '휴대폰을 가까운 곳에 두고\nAI 레슨 기록을 시작하면\n레슨 내용을 자동으로 분석합니다.',
                },
                {
                  num: '③',
                  title: '타이핑으로 기록',
                  recommended: false,
                  icon: 'pencil-outline' as const,
                  device: '장비 없이 텍스트 입력만으로',
                  how: '레슨이 끝난 후\n핵심 내용을 직접 입력하면\nAI가 레슨 리포트를 생성합니다.',
                },
                {
                  num: '④',
                  title: '무선 이어폰 마이크 사용',
                  recommended: false,
                  icon: 'headset-outline' as const,
                  device: 'AirPods, Galaxy Buds 등\n사용 중인 무선 이어폰',
                  how: 'AirPods, Galaxy Buds 등\n본인이 사용하는 무선 이어폰으로도\nAI 레슨 기록을 사용할 수 있습니다.',
                },
              ].map((item, i) => (
                <View key={i} style={[styles.usageCard, i < 3 && { marginBottom: 14 }]}>
                  {/* 카드 헤더 */}
                  <View style={styles.usageCardHeader}>
                    <View style={styles.usageCardHeaderLeft}>
                      <View style={styles.usageCardIconWrap}>
                        <Ionicons name={item.icon} size={18} color={Colors.primary} />
                      </View>
                      <Text style={styles.usageCardNum}>{item.num}</Text>
                      <Text style={styles.usageCardTitle}>{item.title}</Text>
                    </View>
                    {item.recommended && (
                      <View style={styles.usageRecommendBadge}>
                        <Text style={styles.usageRecommendText}>추천</Text>
                      </View>
                    )}
                  </View>

                  {/* 추천 장비 */}
                  <View style={styles.usageCardSection}>
                    <Text style={styles.usageCardLabel}>추천 장비</Text>
                    <Text style={styles.usageCardBody}>{item.device}</Text>
                  </View>

                  {/* 사용 방법 */}
                  <View style={styles.usageCardSection}>
                    <Text style={styles.usageCardLabel}>사용 방법</Text>
                    <Text style={styles.usageCardBody}>{item.how}</Text>
                  </View>
                </View>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>

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

  // 녹음 카드 헤더
  recordTitleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  recordTitleLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  recordIconWrap: { position: 'relative', width: 28, height: 24, justifyContent: 'center', alignItems: 'center' },
  recordSparklesBadge: { position: 'absolute', top: -2, right: -5 },
  usageHelpBtnWrap: {
    width: 36, height: 36, borderRadius: 18,
    justifyContent: 'center', alignItems: 'center',
  },
  usageHelpBtn: {
    width: 26, height: 26, borderRadius: 13,
    backgroundColor: Colors.primary,
    justifyContent: 'center', alignItems: 'center',
    shadowColor: Colors.primary, shadowOpacity: 0.45, shadowRadius: 8, shadowOffset: { width: 0, height: 0 },
    elevation: 4,
  },
  usageHelpText: { fontSize: 13, fontWeight: '800', color: '#fff', lineHeight: 16 },

  // 섹션 타이틀 with 아이콘
  sectionTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  sectionIconWrap: { position: 'relative', width: 26, height: 22, justifyContent: 'center', alignItems: 'center' },
  sectionSparklesBadge: { position: 'absolute', top: -2, right: -5 },

  // 사용법 바텀시트
  usageOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  usageSheet: { backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, height: '60%', maxHeight: '70%' },
  usageSheetHandle: { width: 36, height: 4, borderRadius: 2, backgroundColor: Colors.border, alignSelf: 'center', marginTop: 10, marginBottom: 4 },
  usageSheetHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  usageSheetTitle: { fontSize: 16, fontWeight: '700', color: Colors.foreground },
  usageStep: { flexDirection: 'row', gap: 14, marginBottom: 20 },
  usageStepIcon: {
    width: 40, height: 40, borderRadius: 12,
    backgroundColor: Colors.primaryLight,
    justifyContent: 'center', alignItems: 'center',
    flexShrink: 0,
  },
  usageStepTitle: { fontSize: 14, fontWeight: '700', color: Colors.foreground, marginBottom: 4 },
  usageStepDesc: { fontSize: 13, color: Colors.mutedFg, lineHeight: 20 },

  // 사용법 카드
  usageCard: {
    backgroundColor: '#fff',
    borderRadius: 14, borderWidth: 1, borderColor: Colors.border,
    padding: 16,
    shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 4, shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  usageCardHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14,
  },
  usageCardHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  usageCardIconWrap: {
    width: 34, height: 34, borderRadius: 10,
    backgroundColor: Colors.primaryLight,
    justifyContent: 'center', alignItems: 'center',
  },
  usageCardNum: { fontSize: 15, fontWeight: '800', color: Colors.primary },
  usageCardTitle: { fontSize: 14, fontWeight: '700', color: Colors.foreground },
  usageRecommendBadge: {
    backgroundColor: Colors.primary, borderRadius: 20,
    paddingHorizontal: 10, paddingVertical: 3,
  },
  usageRecommendText: { fontSize: 11, fontWeight: '700', color: '#fff' },
  usageCardSection: { marginBottom: 10 },
  usageCardLabel: { fontSize: 11, fontWeight: '700', color: Colors.mutedFg, marginBottom: 4, letterSpacing: 0.3 },
  usageCardBody: { fontSize: 13, color: Colors.foreground, lineHeight: 20 },

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
  recordTitle: { fontSize: 17, fontWeight: '800', color: Colors.foreground },
  recordDesc: { fontSize: 13, color: Colors.mutedFg, lineHeight: 20, marginBottom: 12 },
  enhancedModeRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 10, paddingHorizontal: 14,
    backgroundColor: Colors.card, borderRadius: 10,
    marginBottom: 16, borderWidth: 1, borderColor: Colors.border,
  },
  enhancedModeLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  enhancedModeLabel: { fontSize: 13, color: Colors.mutedFg, fontWeight: '500' },
  enhancedModeLabelOn: { color: Colors.primary, fontWeight: '600' },
  enhancedToggle: {
    width: 40, height: 22, borderRadius: 11,
    backgroundColor: Colors.border, justifyContent: 'center', paddingHorizontal: 2,
  },
  enhancedToggleOn: { backgroundColor: Colors.primary },
  enhancedThumb: {
    width: 18, height: 18, borderRadius: 9,
    backgroundColor: '#fff', alignSelf: 'flex-start',
  },
  enhancedThumbOn: { alignSelf: 'flex-end' },

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
  recordingDotPaused: { backgroundColor: Colors.mutedFg },
  durationText: { fontSize: 24, fontWeight: '800', color: Colors.foreground, letterSpacing: 2 },
  pausedLabel: { fontSize: 12, color: Colors.mutedFg, fontWeight: '600' },

  // 인터럽트 토스트
  interruptToast: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    backgroundColor: Colors.primaryLight, borderRadius: 10,
    padding: 12, marginBottom: 12, borderWidth: 1, borderColor: Colors.accentWarm,
  },
  interruptToastText: { fontSize: 13, color: Colors.navy, lineHeight: 18, flex: 1 },

  // 이어서 녹음 버튼
  resumeBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: Colors.primary, borderRadius: 12,
    paddingVertical: 10, paddingHorizontal: 20,
  },
  resumeBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },

  // 일시정지 중 분석 시작 버튼
  stopAnalyzeBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    borderWidth: 1.5, borderColor: Colors.primary, borderRadius: 12,
    paddingVertical: 10, paddingHorizontal: 20,
  },
  stopAnalyzeBtnText: { color: Colors.primary, fontWeight: '700', fontSize: 14 },
  recordBtn: {
    width: 100, height: 100, borderRadius: 50,
    backgroundColor: Colors.primary,
    justifyContent: 'center', alignItems: 'center',
    shadowColor: Colors.primary, shadowOpacity: 0.3, shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 }, elevation: 6, gap: 4,
  },
  recordBtnActive: { backgroundColor: Colors.destructive, shadowColor: Colors.destructive },
  recordBtnPaused: { backgroundColor: Colors.mutedFg, shadowColor: Colors.mutedFg },
  recordBtnText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  recordHint: { fontSize: 12, color: Colors.mutedFg, textAlign: 'center', maxWidth: 240 },

  // 분석 기록
  section: { paddingHorizontal: 16 },
  sectionTitle: { fontSize: 16, fontWeight: '800', color: Colors.foreground },

  // 수동 레포트
  manualReportBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginHorizontal: 16, marginBottom: 16, padding: 14,
    backgroundColor: Colors.primaryLight, borderRadius: 12, borderWidth: 1, borderColor: Colors.accentWarm,
  },
  manualReportBtnTitle: { fontSize: 14, fontWeight: '700', color: Colors.primary },
  manualReportBtnSub: { fontSize: 11, color: Colors.mutedFg, marginTop: 2 },
  manualOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  manualSheet: { backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, height: '88%', maxHeight: '92%', display: 'flex', flexDirection: 'column' },
  manualHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingVertical: 16,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  manualHeaderTitle: { fontSize: 16, fontWeight: '700', color: Colors.foreground },
  manualForm: { padding: 20, paddingBottom: 40 },
  manualFormHint: { fontSize: 13, color: Colors.mutedFg, paddingHorizontal: 20, paddingTop: 12, paddingBottom: 8, lineHeight: 20 },
  manualFreeInput: {
    flex: 1,
    marginHorizontal: 20,
    marginVertical: 8,
    borderWidth: 1, borderColor: Colors.border, borderRadius: 12,
    padding: 16, fontSize: 15, color: Colors.foreground,
    lineHeight: 24, textAlignVertical: 'top',
    minHeight: 200,
  },
  manualBtnRow: {
    flexDirection: 'row', gap: 10,
    paddingHorizontal: 20, paddingVertical: 16,
    borderTopWidth: 1, borderTopColor: Colors.border,
  },
  directSendBtn: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1.5, borderColor: Colors.primary, borderRadius: 12,
    paddingVertical: 14,
  },
  directSendBtnText: { fontSize: 15, fontWeight: '600', color: Colors.primary },
  polishBtn: {
    flex: 2, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: Colors.primary, borderRadius: 12, paddingVertical: 14,
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
    backgroundColor: '#fff',
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  planTopRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8,
  },
  planDateRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  planDate: { fontSize: 12, color: Colors.mutedFg },
  planDuration: { fontSize: 12, color: Colors.placeholder },
  sentBadge: {
    borderRadius: 20, paddingHorizontal: 8, paddingVertical: 3,
  },
  sentBadgeGreen: { backgroundColor: Colors.successLight },
  sentBadgeTerracotta: { backgroundColor: Colors.primaryLight },
  sentBadgeText: { fontSize: 11, fontWeight: '600' },
  sentBadgeTextGreen: { color: Colors.success },
  sentBadgeTextTerracotta: { color: Colors.primary },
  manualBadge: { backgroundColor: Colors.mutedBg, borderWidth: 1, borderColor: Colors.border, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  manualBadgeText: { fontSize: 11, fontWeight: '600', color: Colors.mutedFg },
  planTitleRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8,
  },
  planTitleText: { fontSize: 15, fontWeight: '700', color: Colors.foreground, flex: 1, lineHeight: 22 },
  planDetail: { marginTop: 4 },
  divider: { height: 1, backgroundColor: Colors.border, marginVertical: 16 },
  planSection: { marginBottom: 24 },
  planSectionTitle: { fontSize: 18, fontWeight: '600', color: Colors.foreground },
  planSectionContent: { fontSize: 16, color: Colors.foreground, lineHeight: 25.6 },

  // Bullet list
  bulletRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 6 },
  bulletIcon: { fontSize: 14, color: Colors.navy, marginTop: 3, width: 14 },
  bulletText: { fontSize: 14, color: Colors.foreground, lineHeight: 22, flex: 1 },

  // 드릴 카드
  drillCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
    padding: 24,
  },
  drillHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  drillName: { fontSize: 17, fontWeight: '600', color: Colors.foreground, flex: 1 },
  drillBody: { gap: 16 },
  drillRow: { flexDirection: 'column' },
  drillLabel: {
    fontSize: 13,
    fontWeight: '500',
    color: Colors.mutedFg,
  },
  drillValue: { fontSize: 16, color: Colors.foreground, lineHeight: 25.6, marginTop: 4 },

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

  // 인라인 편집
  sectionHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  summaryBox: {},
  summaryBoxText: { fontSize: 16, color: Colors.foreground, lineHeight: 25.6 },
  listRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginBottom: 12 },
  listNum: { fontSize: 13, fontWeight: '600', color: Colors.primary, width: 20, marginTop: 3 },
  listText: { fontSize: 16, color: Colors.foreground, lineHeight: 25.6, flex: 1 },
  editIconBtn: {
    width: 32,
    height: 32,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: '#fff',
    justifyContent: 'center',
    alignItems: 'center',
  },
  accordionBox: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: '#fff',
    overflow: 'hidden',
  },
  accordionHeader: {
    paddingHorizontal: 24,
    paddingVertical: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  accordionContent: {
    padding: 24,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  emptyFieldText: { fontSize: 14, color: Colors.placeholder, fontStyle: 'italic' },
  inlineInput: {
    borderWidth: 1, borderColor: Colors.primary, borderRadius: 8,
    padding: 10, fontSize: 14, color: Colors.foreground,
    minHeight: 80, textAlignVertical: 'top', lineHeight: 22,
    backgroundColor: '#fff',
  },
  inlineHint: { fontSize: 11, color: Colors.mutedFg, marginBottom: 4 },
  inlineBtnRow: { flexDirection: 'row', gap: 8, marginTop: 8 },
  inlineCancelBtn: {
    flex: 1, borderWidth: 1, borderColor: Colors.border, borderRadius: 8,
    paddingVertical: 8, alignItems: 'center',
  },
  inlineCancelText: { fontSize: 13, color: Colors.foreground },
  inlineSaveBtn: {
    flex: 1, backgroundColor: Colors.primary, borderRadius: 8,
    paddingVertical: 8, alignItems: 'center',
  },
  inlineSaveText: { fontSize: 13, fontWeight: '700', color: '#fff' },
  transcriptText: { fontSize: 16, color: Colors.foreground, lineHeight: 25.6 },

  // 편집 모달
  editModalSheet: {
    backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: 20, paddingBottom: 36, maxHeight: '70%',
  },
  editModalHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12,
  },
  editModalTitle: { fontSize: 15, fontWeight: '700', color: Colors.foreground },
  editModalInput: {
    borderWidth: 1, borderColor: Colors.primary, borderRadius: 10,
    padding: 12, fontSize: 14, color: Colors.foreground,
    minHeight: 120, textAlignVertical: 'top', lineHeight: 22,
    backgroundColor: '#fff', marginBottom: 12,
  },
  editModalBtnRow: { flexDirection: 'row', gap: 10 },
  editModalCancelBtn: {
    flex: 1, borderWidth: 1, borderColor: Colors.border, borderRadius: 10,
    paddingVertical: 12, alignItems: 'center',
  },
  editModalCancelText: { fontSize: 14, color: Colors.foreground },
  editModalSaveBtn: {
    flex: 2, backgroundColor: Colors.primary, borderRadius: 10,
    paddingVertical: 12, alignItems: 'center',
  },
  editModalSaveText: { fontSize: 14, fontWeight: '700', color: '#fff' },

  // 액션 버튼
  reportActions: { gap: 8, marginTop: 4 },
  sendBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: Colors.primary, borderRadius: 12, paddingVertical: 13,
  },
  sendBtnText: { fontSize: 15, fontWeight: '700', color: '#fff' },
  editReportBtn: {
    alignItems: 'center', borderWidth: 1, borderColor: Colors.border,
    borderRadius: 12, paddingVertical: 11,
  },
  editReportBtnText: { fontSize: 14, color: Colors.foreground, fontWeight: '600' },
});
