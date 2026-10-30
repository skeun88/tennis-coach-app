import { useEffect, useState, useRef, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Alert, ActivityIndicator, Platform, Animated, Modal, TextInput, KeyboardAvoidingView,
  AppState, AppStateStatus, SafeAreaView, Keyboard, StatusBar, Dimensions,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import ReanimatedAnimated, { runOnJS, useSharedValue, useAnimatedStyle, withTiming, withSpring } from 'react-native-reanimated';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAudioRecorder, AudioModule, RecordingPresets, setAudioModeAsync, useAudioRecorderState } from 'expo-audio';
import * as FileSystem from 'expo-file-system/legacy';
import { supabase } from '../../lib/supabase';
import * as Haptics from 'expo-haptics';
import { notifyMemberReport } from '../../lib/notifications';
import { LessonPlan, DrillSuggestion } from '../../types';
import { Colors } from '../../lib/theme';
import TerracottaRefreshControl from '../../components/TerracottaRefreshControl';
import { useSubscription } from '../../hooks/useSubscription';
import { checkAiAnalysisLimit, incrementAiAnalysisUsage } from '../../lib/subscription';
import PlanUpsellModal, { UpsellContext } from '../../components/PlanUpsellModal';
import ReportQuotaBar from '../../components/ReportQuotaBar';
import ReportTopupModal from '../../components/ReportTopupModal';
import CoachConsentModal, { AI_CONSENT_VERSION, COACH_CONSENT_STORAGE_KEY_PREFIX } from '../../components/CoachConsentModal';
import MemberConsentRequestModal from '../../components/MemberConsentRequestModal';
import MemberVerbalConsentSheet from '../../components/MemberVerbalConsentSheet';
import SkeletonBox from '../../components/SkeletonBox';

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;

const ANALYSIS_STEPS = [
  { step: 0, label: '오디오 업로드 중...' },
  { step: 1, label: '음성 변환 중...' },
  { step: 2, label: '레슨 내용 요약 중...' },
  { step: 3, label: '관련 교육 자료 검색 중...' },
  { step: 4, label: 'AI 레슨 기록 중...' },
  { step: 5, label: '분석 결과 저장 중...' },
];

export default function AIAnalysisScreen() {
  const { memberId, memberName, memberLevel, lessonId } = useLocalSearchParams<{
    memberId: string;
    memberName: string;
    memberLevel: string;
    lessonId?: string;
  }>();
  const router = useRouter();
  const { canUse, subscription, loading: subLoading } = useSubscription();

  useEffect(() => {
    if (subscription) loadUsageInfo();
  }, [subscription]);
  const [upsellContext, setUpsellContext] = useState<UpsellContext | null>(null);
  const [usageInfo, setUsageInfo] = useState<{ used: number; limit: number } | undefined>(undefined);
  const [topupModalVisible, setTopupModalVisible] = useState(false);
  const [coachConsentVisible, setCoachConsentVisible] = useState(false);
  const [memberConsentVisible, setMemberConsentVisible] = useState(false);
  const [verbalConsentVisible, setVerbalConsentVisible] = useState(false);
  const [consentCheckDone, setConsentCheckDone] = useState(false);
  const [memberConsentOk, setMemberConsentOk] = useState(false);
  const [isMinorMember, setIsMinorMember] = useState(false);
  const [currentCoachId, setCurrentCoachId] = useState<string>('');
  const [pendingAnalysis, setPendingAnalysis] = useState<{
    uri: string; userId: string; duration: number;
    storagePath?: string; planId?: string;
  } | null>(null);
  const [authToken, setAuthToken] = useState<string>('');

  const VOICE_PRESET = {
    ...RecordingPresets.HIGH_QUALITY,
    ios: { ...RecordingPresets.HIGH_QUALITY.ios, sampleRate: 16000, numberOfChannels: 1, bitRate: 32000 },
    android: { ...RecordingPresets.HIGH_QUALITY.android, sampleRate: 16000, numberOfChannels: 1, bitRate: 32000 },
    isMeteringEnabled: true,
  };
  const audioRecorder = useAudioRecorder(VOICE_PRESET);
  const recorderState = useAudioRecorderState(audioRecorder);

  // 음파 웨이브 롤링 버퍼 (28개 바)
  const WAVE_BARS = 28;
  const [waveformBars, setWaveformBars] = useState<number[]>(Array(WAVE_BARS).fill(0.05));
  const waveSimRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const meteringRef = useRef<number>(-60);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [enhancedMode, setEnhancedMode] = useState(false);
  const [analysisStep, setAnalysisStep] = useState(0); // 0 = 대기, 1~4 = 진행중
  const [uploadPct, setUploadPct] = useState(0);
  const [plans, setPlans] = useState<LessonPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [memberReports, setMemberReports] = useState<Record<string, any>>({});
  const [manualReports, setManualReports] = useState<any[]>([]);
  const [recordFilter, setRecordFilter] = useState<'all' | 'unsent' | 'sent'>('all');

  // 타이핑 레슨 기록 모달
  const [manualModalVisible, setManualModalVisible] = useState(false);
  const [manualContent, setManualContent] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitMode, setSubmitMode] = useState<'direct' | 'ai' | null>(null);
  const [selectedKeywords, setSelectedKeywords] = useState<string[]>([]);
  const [inputFocused, setInputFocused] = useState(false);
  const [cursorPos, setCursorPos] = useState({ start: 0, end: 0 });
  const inputRef = useRef<TextInput>(null);
  const modalScrollRef = useRef<ScrollView>(null);

  // 레슨 기록 모달 — 좌측 엣지 스와이프 슬라이드 닫기 (iOS + Android)
  const closeManualModalRef = useRef<() => void>(() => {});
  const swipeTranslateX = useSharedValue(0);
  const swipeAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: swipeTranslateX.value }],
  }));
  const SCREEN_WIDTH = Dimensions.get('window').width;

  const swipeBackGesture = Gesture.Pan()
    .activeOffsetX([10, Infinity])
    .failOffsetY([-30, 30])
    .onChange((e) => {
      if (e.translationX >= 0) swipeTranslateX.value = e.translationX;
    })
    .onEnd((e) => {
      if (e.translationX > SCREEN_WIDTH * 0.3 || e.velocityX > 600) {
        swipeTranslateX.value = withTiming(SCREEN_WIDTH, { duration: 220 }, () => {
          runOnJS(closeManualModalRef.current)();
        });
      } else {
        swipeTranslateX.value = withSpring(0, { damping: 20, stiffness: 300 });
      }
    });

  // 키워드 데이터 구조
  const TENNIS_TECHNIQUES = ['포핸드', '백핸드', '서브', '발리', '리턴', '풋워크', '스매시', '슬라이스'] as const;
  const CORRECTION_BY_TECH: Record<string, string[]> = {
    '포핸드': ['타점', '테이크백', '스윙 궤도', '팔로스루', '라켓면', '체중 이동', '무릎 사용', '상체 회전', '준비 자세', '타이밍'],
    '백핸드': ['타점', '테이크백', '스윙 궤도', '팔로스루', '라켓면', '체중 이동', '하체 회전', '준비 자세', '타이밍'],
    '서브': ['토스', '임팩트', '회전', '리듬', '테이크백', '팔로스루', '무릎 사용', '타이밍'],
    '발리': ['타점', '라켓면', '준비 자세', '스텝', '거리 조절', '체중 이동'],
    '리턴': ['타점', '준비 자세', '스텝', '타이밍', '라켓면'],
    '풋워크': ['스플릿 스텝', '첫발', '복귀', '균형', '스텝', '준비 자세'],
    '스매시': ['타점', '토스', '임팩트', '팔로스루', '준비 자세'],
    '슬라이스': ['타점', '라켓면', '스윙 궤도', '팔로스루', '체중 이동'],
  };
  const DEFAULT_CORRECTIONS = ['타점', '스윙 궤도', '준비 자세', '체중 이동', '타이밍', '라켓면'];
  const GOAL_BY_TECH: Record<string, string[]> = {
    '포핸드': ['타점 앞당기기', '준비 동작 줄이기', '스윙 궤도 안정화', '체중 이동 연결'],
    '백핸드': ['상체 회전 강화', '타점 앞당기기', '라켓면 안정화', '스윙 궤도 정리'],
    '서브': ['토스 높이 일정하게', '타점 높이기', '무릎 사용 연결', '리듬 유지'],
    '발리': ['준비 자세 유지', '라켓면 고정', '첫발 빠르게', '복귀 동작 연결'],
    '리턴': ['준비 자세 앞당기기', '타점 확보', '스텝 빠르게', '스윙 간결하게'],
    '풋워크': ['스플릿 스텝 습관화', '첫발 방향 정확히', '복귀 빠르게', '균형 유지'],
    '스매시': ['토스 안정화', '타점 높이기', '팔로스루 완성', '준비 자세 유지'],
    '슬라이스': ['라켓면 고정', '타점 앞당기기', '팔로스루 길게', '체중 이동 연결'],
  };
  const DEFAULT_GOALS = ['자세 유지', '반복 연습', '정확도 향상', '일관성 유지'];
  const STATUS_KEYWORDS = ['늦음', '빠름', '불안정', '부족', '과도함', '흔들림', '좋아짐', '개선 중', '안정적', '반복 필요'] as const;

  // 현재 선택 중인 항목
  const [selTech, setSelTech] = useState<string | null>(null);
  const [selPoints, setSelPoints] = useState<string[]>([]);
  const [selStatus, setSelStatus] = useState<string | null>(null);
  const [selGoal, setSelGoal] = useState<string | null>(null);

  // 추가된 메모 항목들
  type MemoItem = { tech?: string; points?: string[]; status?: string; goal?: string };
  const [memoItems, setMemoItems] = useState<MemoItem[]>([]);

  // 최근 사용 조합 (AsyncStorage, 코치별, max 5)
  const [recentCombos, setRecentCombos] = useState<MemoItem[]>([]);
  const [memoExpanded, setMemoExpanded] = useState(false);
  const [goalExpanded, setGoalExpanded] = useState(false);

  // 코치별 사용자 정의 키워드
  type CustomKwStore = {
    techniques: string[];
    corrections: Record<string, string[]>; // tech key → custom items ('__all__' = global)
    statuses: string[];
    goals: Record<string, string[]>;
  };
  const [customKw, setCustomKw] = useState<CustomKwStore>({ techniques: [], corrections: {}, statuses: [], goals: {} });
  const [addingCategory, setAddingCategory] = useState<'tech' | 'correction' | 'status' | 'goal' | null>(null);
  const [addingInput, setAddingInput] = useState('');
  const addingInputRef = useRef<TextInput>(null);
  const [memoKeyboardHeight, setMemoKeyboardHeight] = useState(0);

  const [usageSheetVisible, setUsageSheetVisible] = useState(false);
  const [hasSeenUsage, setHasSeenUsage] = useState(true); // true = no pulse (default until loaded)

  // (READY 상태 제거 — 녹음 종료 즉시 자동 분석)

  // 녹음 인터럽트 (전화/이어폰) 관련 상태
  const [isPaused, setIsPaused] = useState(false);
  const [showResumeBtn, setShowResumeBtn] = useState(false);
  const [interruptToast, setInterruptToast] = useState<string | null>(null);

  // recorderState.metering(dB) → meteringRef 동기화
  useEffect(() => {
    if (recorderState.metering != null) {
      meteringRef.current = recorderState.metering;
    }
  }, [recorderState.metering]);

  // 실시간 마이크 입력(dB)으로 웨이브폼 구동
  useEffect(() => {
    if (isRecording && !isPaused) {
      waveSimRef.current = setInterval(() => {
        if (!isMountedRef.current) return;
        // dB 범위 -60~0 → 0.05~1 정규화
        const db = meteringRef.current ?? -60;
        const normalized = Math.max(0.05, Math.min(1, (db + 60) / 60));
        setWaveformBars(prev => [...prev.slice(1), normalized]);
      }, 100);
    } else {
      if (waveSimRef.current) { clearInterval(waveSimRef.current); waveSimRef.current = null; }
    }
    return () => { if (waveSimRef.current) { clearInterval(waveSimRef.current); waveSimRef.current = null; } };
  }, [isRecording, isPaused]);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const usagePulseAnim = useRef(new Animated.Value(1)).current;
  const abortControllerRef = useRef<AbortController | null>(null);
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);
  const backgroundTimeRef = useRef<number | null>(null);
  const isIntentionalStopRef = useRef(false); // true = 사용자가 직접 중지 중
  const recordingSegmentsRef = useRef<string[]>([]); // 여러 구간 녹음 파일 URI 목록
  const recordingDurationRef = useRef(0); // duration 누적 (timer 재시작 후에도 유지)
  const isMountedRef = useRef(true);

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

  // plan-detail에서 돌아올 때 목록 새로고침 (제목 변경 반영)
  useFocusEffect(useCallback(() => { loadPlans(); }, []));

  // 화면 진입 시 동의 체크 (1회)
  useEffect(() => {
    checkConsents();
  }, []);

  async function checkConsents() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    setCurrentCoachId(user.id);

    // 회원 동의 캐시 먼저 적용 → 화면 진입 즉시 배지 표시 (UX 개선)
    const cachedMemberConsent = await AsyncStorage.getItem(`kerri_member_verbal_consent_v1_${memberId}`);
    if (cachedMemberConsent === '1') {
      setMemberConsentOk(true);
      setConsentCheckDone(true);
    }

    // 1. 로컬 캐시 우선 확인 — 동의 후 DB 조회 실패해도 모달 재표시 방지
    const localConsent = await AsyncStorage.getItem(`${COACH_CONSENT_STORAGE_KEY_PREFIX}${user.id}`);
    if (localConsent !== '1') {
      // 로컬에 없으면 DB 확인 (coach_voice_ai 또는 레거시 'coach' 타입)
      const { data: coachConsent } = await supabase
        .from('ai_consents')
        .select('id')
        .eq('coach_id', user.id)
        .in('consent_type', ['coach_voice_ai', 'coach'])
        .eq('consent_status', 'agreed')
        .maybeSingle();

      if (!coachConsent) {
        setCoachConsentVisible(true);
        return;
      }
      // DB에는 있지만 로컬에 없는 경우 — 동기화
      await AsyncStorage.setItem(`${COACH_CONSENT_STORAGE_KEY_PREFIX}${user.id}`, '1');
    }

    // 2. 회원 미성년 여부 확인
    await checkMinorStatus();

    // 3. 회원 구두 동의 여부 확인 (배지 표시용)
    await checkMemberConsent();
    setConsentCheckDone(true);
  }

  async function checkMinorStatus() {
    if (!memberId) return;
    const { data } = await supabase
      .from('members')
      .select('birth_date')
      .eq('id', memberId)
      .maybeSingle();
    if (!data?.birth_date) return;
    const age = new Date().getFullYear() - new Date(data.birth_date).getFullYear();
    setIsMinorMember(age < 14);
  }

  const MEMBER_VERBAL_CONSENT_KEY = `kerri_member_verbal_consent_v1_${memberId}`;

  async function checkMemberConsent() {
    // 항상 DB 기준으로 확인 (이전 버그로 AsyncStorage만 저장되고 DB는 없는 경우 처리)
    const { data: voiceConsent } = await supabase
      .from('ai_consents')
      .select('id')
      .eq('member_id', memberId)
      .in('consent_type', ['member_voice_ai', 'member', 'guardian'])
      .eq('consent_status', 'agreed')
      .maybeSingle();
    if (voiceConsent) {
      await AsyncStorage.setItem(MEMBER_VERBAL_CONSENT_KEY, '1');
      setMemberConsentOk(true);
    } else {
      // DB에 없으면 캐시도 무효화
      await AsyncStorage.removeItem(MEMBER_VERBAL_CONSENT_KEY);
      setMemberConsentOk(false);
    }
  }

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
            .then(() => audioRecorder.prepareToRecordAsync(VOICE_PRESET))
            .then(() => { audioRecorder.record(); })
            .then(() => {
              if (!isMountedRef.current) return;
              setIsPaused(false);
              setShowResumeBtn(false);
              setInterruptToast(null);
              // 타이머 재개 — 기존 interval 먼저 정리
              if (timerRef.current) clearInterval(timerRef.current);
              timerRef.current = setInterval(() => {
                if (!isMountedRef.current) { clearInterval(timerRef.current!); return; }
                setRecordingDuration(d => { recordingDurationRef.current = d + 1; return d + 1; });
              }, 1000);
            })
            .catch(() => {
              // 자동 재개 실패 → 수동 버튼 표시
              if (isMountedRef.current) setShowResumeBtn(true);
            });
        }
      }
    });
    return () => {
      isMountedRef.current = false;
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
      console.log('[REC][C] recorderState.isRecording=false → setIsPaused. AppState:', appStateRef.current);
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
      console.log('[REC][D] mediaServicesDidReset: 오디오 기기 변경 → 구간저장 후 재개');
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
    const { data, error } = await supabase
      .from('lesson_plans')
      .select('*')
      .eq('member_id', memberId)
      .order('created_at', { ascending: false })
      .limit(10);
    if (error) { console.error('[AI 레슨 기록] 조회 실패:', error); setLoading(false); return false; }
    setPlans(data ?? []);
    setLoading(false);

    // 연결된 member_lesson_reports 로드 (lesson_plan_id 기준 매핑)
    if (data && data.length > 0) {
      const planIds = data.map((p: any) => p.id);
      const { data: reports } = await supabase
        .from('member_lesson_reports')
        .select('id, lesson_plan_id, sent_to_member, is_read')
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
      .select('id, member_id, lesson_plan_id, summary, achievements, improvement_points, created_at, sent_to_member, source')
      .eq('member_id', memberId)
      .is('lesson_plan_id', null)
      .order('created_at', { ascending: false })
      .limit(10);
    setManualReports(manualData ?? []);

    // 앱 복귀 시 진행 중인 분석 자동 재개
    const inProgress = (data ?? []).find((p: any) => p.status === 'pending' || p.status === 'processing');
    if (inProgress && !isAnalyzing) {
      console.log('[ANA][3] loadPlans 자동재개: planId=', inProgress.id, 'status=', inProgress.status, 'created=', inProgress.created_at);
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

  const memoKey = `memo_draft_${memberId as string}_${(lessonId as string) || 'no-lesson'}`;

  // 자동 임시저장
  useEffect(() => {
    if (!manualModalVisible) return;
    AsyncStorage.setItem(memoKey, manualContent);
  }, [manualContent, manualModalVisible]);

  // 모달 열릴 때 임시저장 복원 + 최근 조합 로드
  useEffect(() => {
    if (!manualModalVisible) return;
    AsyncStorage.getItem(memoKey).then(saved => {
      if (saved) setManualContent(saved);
    });
    setSelectedKeywords([]);
    setSelTech(null);
    setSelPoints([]);
    setSelStatus(null);
    setSelGoal(null);
    setMemoItems([]);
    setMemoExpanded(false);
    setInputFocused(false);
    // 최근 조합 로드
    if (currentCoachId) {
      AsyncStorage.getItem(`kerri_recent_combos_${currentCoachId}`).then(raw => {
        if (raw) {
          try { setRecentCombos(JSON.parse(raw)); } catch { /* ignore */ }
        }
      });
      AsyncStorage.getItem(`kerri_custom_kw_${currentCoachId}`).then(raw => {
        if (raw) {
          try { setCustomKw(JSON.parse(raw)); } catch { /* ignore */ }
        }
      });
    }
  }, [manualModalVisible]);

  // 모달 열릴 때 슬라이드 위치 초기화 (닫힐 때 하면 translateX=0 깜빡임 발생)
  useEffect(() => {
    if (manualModalVisible) swipeTranslateX.value = 0;
  }, [manualModalVisible]);

  // 모달 키보드 높이 추적 — contentPadding 동적 조정에 사용
  useEffect(() => {
    if (!manualModalVisible) { setMemoKeyboardHeight(0); return; }
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSub = Keyboard.addListener(showEvent, (e) => setMemoKeyboardHeight(e.endCoordinates.height));
    const hideSub = Keyboard.addListener(hideEvent, () => setMemoKeyboardHeight(0));
    return () => { showSub.remove(); hideSub.remove(); };
  }, [manualModalVisible]);

  // closeManualModalRef 항상 최신 함수 유지 (Gesture worklet 클로저 stale 방지)
  closeManualModalRef.current = handleCloseManualModal;

  function handleCloseManualModal() {
    const hasAny = manualContent.trim() || memoItems.length > 0 ||
      selTech || selPoints.length > 0 || selStatus || selGoal;
    if (hasAny) {
      Alert.alert(
        '작성 중인 내용이 있어요',
        '내용을 저장하고 나갈까요?',
        [
          {
            text: '삭제하고 닫기',
            style: 'destructive',
            onPress: () => {
              AsyncStorage.removeItem(memoKey);
              setManualContent('');
              setSelectedKeywords([]);
              setSelTech(null); setSelPoints([]); setSelStatus(null); setSelGoal(null);
              setMemoItems([]);
              setManualModalVisible(false);
            },
          },
          { text: '저장하고 닫기', onPress: () => setManualModalVisible(false) },
        ]
      );
    } else {
      setManualModalVisible(false);
    }
  }

  function addMemoItem() {
    if (!selTech && selPoints.length === 0 && !selStatus && !selGoal) return;
    const newItem: MemoItem = {
      tech: selTech ?? undefined,
      points: selPoints.length > 0 ? [...selPoints] : undefined,
      status: selStatus ?? undefined,
      goal: selGoal ?? undefined,
    };
    // 중복 방지
    const isDuplicate = memoItems.some(item =>
      item.tech === newItem.tech &&
      JSON.stringify(item.points ?? []) === JSON.stringify(newItem.points ?? []) &&
      item.status === newItem.status &&
      item.goal === newItem.goal
    );
    if (isDuplicate) return;

    setMemoItems(prev => [...prev, newItem]);
    // 최근 조합 저장 (max 5, FIFO)
    if (currentCoachId) {
      const updated = [newItem, ...recentCombos.filter(c =>
        !(c.tech === newItem.tech &&
          JSON.stringify(c.points ?? []) === JSON.stringify(newItem.points ?? []) &&
          c.status === newItem.status && c.goal === newItem.goal)
      )].slice(0, 5);
      setRecentCombos(updated);
      AsyncStorage.setItem(`kerri_recent_combos_${currentCoachId}`, JSON.stringify(updated)).catch(() => {});
    }
    // 햅틱 피드백
    try { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); } catch { /* ignore */ }
    setSelTech(null); setSelPoints([]); setSelStatus(null); setSelGoal(null);
  }

  function removeMemoItem(idx: number) {
    setMemoItems(prev => prev.filter((_, i) => i !== idx));
  }

  function memoItemLabel(item: MemoItem): string {
    const parts: string[] = [];
    if (item.tech) parts.push(item.tech);
    if (item.points?.length) parts.push(item.points.join(', '));
    if (item.status) parts.push(item.status);
    if (item.goal) parts.push(item.goal);
    return parts.join(' · ');
  }

  function buildMemoContent(): string {
    const parts: string[] = [];
    if (memoItems.length > 0) {
      const lines = memoItems.map((item, i) => `${i + 1}. ${memoItemLabel(item)}`);
      parts.push('[레슨 키워드]\n' + lines.join('\n'));
    }
    if (manualContent.trim()) {
      parts.push('[추가 메모]\n' + manualContent.trim());
    }
    return parts.join('\n\n');
  }

  function toggleKeyword(kw: string) {
    setSelectedKeywords(prev =>
      prev.includes(kw) ? prev.filter(k => k !== kw) : [...prev, kw]
    );
  }

  function togglePoint(pt: string) {
    setSelPoints(prev => prev.includes(pt) ? prev.filter(p => p !== pt) : [...prev, pt]);
  }

  function saveCustomKwStore(updated: CustomKwStore) {
    setCustomKw(updated);
    if (currentCoachId) {
      AsyncStorage.setItem(`kerri_custom_kw_${currentCoachId}`, JSON.stringify(updated)).catch(() => {});
    }
  }

  function confirmAddKeyword() {
    const val = addingInput.trim();
    if (!val || val.length > 20) return;
    const updated: CustomKwStore = {
      techniques: [...customKw.techniques],
      corrections: { ...customKw.corrections },
      statuses: [...customKw.statuses],
      goals: { ...customKw.goals },
    };

    if (addingCategory === 'tech') {
      const all = [...(TENNIS_TECHNIQUES as readonly string[]), ...customKw.techniques];
      if (all.includes(val)) { setAddingInput(''); setAddingCategory(null); return; }
      updated.techniques = [...customKw.techniques, val];
      saveCustomKwStore(updated);
      setSelTech(val); setSelPoints([]); setSelGoal(null);
    } else if (addingCategory === 'correction') {
      const techKey = selTech ?? '__all__';
      const baseList = selTech ? (CORRECTION_BY_TECH[selTech] ?? DEFAULT_CORRECTIONS) : DEFAULT_CORRECTIONS;
      const existing = [...baseList, ...(customKw.corrections[techKey] ?? []), ...(selTech ? (customKw.corrections['__all__'] ?? []) : [])];
      if (existing.includes(val)) { setAddingInput(''); setAddingCategory(null); return; }
      updated.corrections = { ...customKw.corrections, [techKey]: [...(customKw.corrections[techKey] ?? []), val] };
      saveCustomKwStore(updated);
      setSelPoints(prev => [...prev, val]);
    } else if (addingCategory === 'status') {
      const all = [...(STATUS_KEYWORDS as readonly string[]), ...customKw.statuses];
      if (all.includes(val)) { setAddingInput(''); setAddingCategory(null); return; }
      updated.statuses = [...customKw.statuses, val];
      saveCustomKwStore(updated);
      setSelStatus(val);
    } else if (addingCategory === 'goal') {
      const techKey = selTech ?? '__all__';
      const baseList = selTech ? (GOAL_BY_TECH[selTech] ?? DEFAULT_GOALS) : DEFAULT_GOALS;
      const existing = [...baseList, ...(customKw.goals[techKey] ?? []), ...(selTech ? (customKw.goals['__all__'] ?? []) : [])];
      if (existing.includes(val)) { setAddingInput(''); setAddingCategory(null); return; }
      updated.goals = { ...customKw.goals, [techKey]: [...(customKw.goals[techKey] ?? []), val] };
      saveCustomKwStore(updated);
      setSelGoal(val);
    }
    setAddingInput('');
    setAddingCategory(null);
  }

  function deleteCustomKeyword(category: 'tech' | 'correction' | 'status' | 'goal', techKey: string | null, val: string) {
    const updated: CustomKwStore = {
      techniques: [...customKw.techniques],
      corrections: { ...customKw.corrections },
      statuses: [...customKw.statuses],
      goals: { ...customKw.goals },
    };
    if (category === 'tech') {
      updated.techniques = customKw.techniques.filter(k => k !== val);
      if (selTech === val) { setSelTech(null); setSelPoints([]); setSelGoal(null); }
    } else if (category === 'correction') {
      const key = techKey ?? '__all__';
      updated.corrections = { ...customKw.corrections, [key]: (customKw.corrections[key] ?? []).filter(k => k !== val) };
      setSelPoints(prev => prev.filter(p => p !== val));
    } else if (category === 'status') {
      updated.statuses = customKw.statuses.filter(k => k !== val);
      if (selStatus === val) setSelStatus(null);
    } else if (category === 'goal') {
      const key = techKey ?? '__all__';
      updated.goals = { ...customKw.goals, [key]: (customKw.goals[key] ?? []).filter(k => k !== val) };
      if (selGoal === val) setSelGoal(null);
    }
    saveCustomKwStore(updated);
  }

  const customCorrKey = selTech ?? '__all__';
  const currentCorrections = [
    ...(selTech ? (CORRECTION_BY_TECH[selTech] ?? DEFAULT_CORRECTIONS) : DEFAULT_CORRECTIONS),
    ...(customKw.corrections[customCorrKey] ?? []),
    ...(selTech ? (customKw.corrections['__all__'] ?? []) : []),
  ];

  const customGoalKey = selTech ?? '__all__';
  const currentGoals = [
    ...(selTech ? (GOAL_BY_TECH[selTech] ?? DEFAULT_GOALS) : DEFAULT_GOALS),
    ...(customKw.goals[customGoalKey] ?? []),
    ...(selTech ? (customKw.goals['__all__'] ?? []) : []),
  ];

  const hasCurrentSel = !!(selTech || selPoints.length > 0 || selStatus || selGoal);

  const currentPreview = (() => {
    const parts: string[] = [];
    if (selTech) parts.push(selTech);
    if (selPoints.length > 0) parts.push(selPoints.join(', '));
    if (selStatus) parts.push(selStatus);
    if (selGoal) parts.push(`→ ${selGoal}`);
    return parts.join(' · ');
  })();

  async function handleDirect() {
    const content = buildMemoContent();
    if (!content || isSubmitting) return;
    setIsSubmitting(true);
    setSubmitMode('direct');
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('not authenticated');
      const { data: saved, error } = await supabase.from('member_lesson_reports').insert({
        coach_id: user.id,
        member_id: memberId,
        lesson_date: new Date().toISOString().split('T')[0],
        summary: content,
        achievements: [],
        improvement_points: [],
        practice_plan: [],
        source: 'manual',
        sent_to_member: false,
      }).select().single();
      if (error) throw error;
      await AsyncStorage.removeItem(memoKey);
      setManualContent('');
      setSelectedKeywords([]);
      setMemoItems([]);
      setSelTech(null); setSelPoints([]); setSelStatus(null); setSelGoal(null);
      setManualModalVisible(false);
      loadPlans();
      router.push({
        pathname: '/members/plan-detail',
        params: { reportId: saved.id, memberId, memberName, memberLevel },
      } as any);
    } catch {
      Alert.alert('저장 실패', '잠시 후 다시 시도해주세요.');
    } finally {
      setIsSubmitting(false);
      setSubmitMode(null);
    }
  }

  async function handleAI() {
    const content = buildMemoContent();
    if (!content || isSubmitting) return;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const limitResult = await checkAiAnalysisLimit(user.id, subscription);
    if (!limitResult.allowed) {
      if (subscription && subscription.plan_id !== 'free') {
        const token = (await supabase.auth.getSession()).data.session?.access_token ?? '';
        setAuthToken(token);
        setTopupModalVisible(true);
      } else {
        setUpsellContext('ai_analysis_free');
      }
      return;
    }

    setIsSubmitting(true);
    setSubmitMode('ai');
    try {
      // 이전 레슨 기록 조회 (lesson_comparison 생성 및 홈 브리핑 연동용)
      const { data: previousLessons } = await supabase
        .from('lesson_plans')
        .select('summary, improvement_points, next_goals, coach_next_goals, created_at')
        .eq('member_id', memberId)
        .eq('status', 'completed')
        .order('created_at', { ascending: false })
        .limit(3);

      const res = await fetch(`${SUPABASE_URL}/functions/v1/polish-manual-report`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` },
        body: JSON.stringify({
          memberName,
          memberLevel,
          lessonDate: new Date().toISOString().split('T')[0],
          raw: { summary: content },
          previousLessons: previousLessons ?? [],
        }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error ?? 'AI 생성 실패');

      const aiPlan = data.plan;
      const aiReport = data.report;

      // lesson_plans에 저장 (음성 AI와 동일한 구조, raw_response에 원본 메모 보존)
      const { data: savedPlan, error: planError } = await supabase.from('lesson_plans').insert({
        coach_id: user.id,
        member_id: memberId as string,
        lesson_id: lessonId ?? null,
        ai_title: aiPlan.ai_title ?? '',
        summary: aiPlan.summary ?? '',
        session_goals: aiPlan.session_goals ?? '',
        improvement_points: aiPlan.improvement_points ?? [],
        next_goals: aiPlan.next_goals ?? [],
        drill_suggestions: aiPlan.drill_suggestions ?? [],
        lesson_comparison: Array.isArray(aiPlan.lesson_comparison) && aiPlan.lesson_comparison.length > 0
          ? aiPlan.lesson_comparison
          : null,
        status: 'completed',
        raw_response: content,
      }).select().single();
      if (planError || !savedPlan) throw planError ?? new Error('레슨 기록 저장 실패');

      // member_lesson_reports에 저장 (lesson_plan_id 연결)
      await supabase.from('member_lesson_reports').insert({
        coach_id: user.id,
        member_id: memberId as string,
        lesson_plan_id: savedPlan.id,
        lesson_date: new Date().toISOString().split('T')[0],
        summary: aiReport.summary ?? aiPlan.summary ?? '',
        achievements: aiReport.achievements ?? [],
        improvement_points: aiReport.improvement_points ?? aiPlan.improvement_points ?? [],
        practice_plan: aiReport.practice_plan ?? [],
        source: 'manual',
        sent_to_member: false,
      });

      await incrementAiAnalysisUsage(user.id, subscription?.current_period_end);
      await AsyncStorage.removeItem(memoKey);
      setManualContent('');
      setSelectedKeywords([]);
      setMemoItems([]);
      setSelTech(null); setSelPoints([]); setSelStatus(null); setSelGoal(null);
      setManualModalVisible(false);
      loadPlans();
      router.push({
        pathname: '/members/plan-detail',
        params: { planId: savedPlan.id, memberId, memberName, memberLevel },
      } as any);
    } catch {
      Alert.alert('AI 정리 실패', '잠시 후 다시 시도해주세요.\n작성한 내용은 그대로 유지됩니다.');
    } finally {
      setIsSubmitting(false);
      setSubmitMode(null);
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

  async function checkGuardianConsent(): Promise<boolean> {
    if (!memberId) return true;
    if (isMinorMember) {
      setVerbalConsentVisible(true);
      return false;
    }
    return true;
  }

  async function startRecording(consentOverride = false) {
    // 미성년 회원 차단 (보호자 동의 기능 미구현)
    if (isMinorMember) {
      setVerbalConsentVisible(true);
      return;
    }
    // 회원 구두 동의 최초 확인 (첫 녹음 시에만)
    if (consentCheckDone && !memberConsentOk && !consentOverride) {
      setVerbalConsentVisible(true);
      return;
    }
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
      const msg: string = e?.message ?? '';
      if (msg.includes('Session activation failed') || msg.includes('configure audio session')) {
        Alert.alert('녹음 시작 불가', '통화 중에는 녹음을 시작할 수 없습니다.\n통화가 끝난 후 다시 시도해주세요.');
      } else {
        Alert.alert('오류', `녹음을 시작할 수 없습니다.\n${msg}`);
      }
    }
  }

  // 사용자 수동 일시정지
  async function pauseRecording() {
    if (!isRecording || isPaused) return;
    try {
      if (timerRef.current) clearInterval(timerRef.current);
      audioRecorder.pause();
      setIsPaused(true);
    } catch (e: any) {
      Alert.alert('오류', `일시정지할 수 없습니다.\n${e?.message ?? ''}`);
    }
  }

  async function resumeRecording() {
    try {
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true, allowsBackgroundRecording: true, shouldPlayInBackground: true });
      await audioRecorder.record();
      setIsPaused(false);
      setShowResumeBtn(false);
      setInterruptToast(null);
      // 기존 interval 먼저 정리 후 새로 시작
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = setInterval(() => {
        if (!isMountedRef.current) { clearInterval(timerRef.current!); return; }
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

    // 여러 구간 → 가장 큰 파일(주 녹음 구간)만 사용
    // base64 in-memory 병합은 대용량 녹음 시 OOM 크래시 유발 — 안전한 단일 파일 방식 사용
    try {
      let largestUri = segments[0];
      let largestSize = 0;
      for (const uri of segments) {
        const info = await FileSystem.getInfoAsync(uri);
        const size = (info as any).size ?? 0;
        if (size > largestSize) { largestSize = size; largestUri = uri; }
      }
      return largestUri;
    } catch {
      return segments[segments.length - 1];
    }
  }

  async function runAnalysis(
    uri: string, userId: string, duration: number, token: string,
    skipMonthlyIncrement = false,
    reuseStoragePath?: string, reusePlanId?: string,
  ) {
    console.log('[ANA][1] runAnalysis 시작: duration=', duration, 'reuse=', !!reusePlanId);
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
        const fileSize = (fileInfo as any).size as number ?? 0;
        const uploadStart = Date.now();
        setUploadPct(0);
        // 전화/알림 중단 시 재시도 (최대 3회)
        let uploadResult: FileSystem.FileSystemUploadResult | null = null;
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            const uploadTask = FileSystem.createUploadTask(
              uploadUrl, uri,
              {
                httpMethod: 'POST',
                uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
                headers: {
                  'Authorization': `Bearer ${token}`,
                  'Content-Type': 'audio/m4a',
                  'x-upsert': attempt > 0 ? 'true' : 'false',
                },
              },
              (p) => {
                if (p.totalBytesExpectedToSend > 0) {
                  setUploadPct(Math.round(p.totalBytesSent / p.totalBytesExpectedToSend * 100));
                }
              },
            );
            uploadResult = (await uploadTask.uploadAsync()) ?? null;
            if (uploadResult && uploadResult.status < 400) break;
            if (attempt < 2) await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
          } catch (uploadErr: any) {
            console.log(`[UPLOAD] attempt ${attempt + 1} failed:`, uploadErr?.message);
            if (attempt === 2) throw uploadErr;
            await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
          }
        }
        const uploadMs = Date.now() - uploadStart;
        const throughput = uploadMs > 0 ? Math.round(fileSize / uploadMs) : 0;
        console.log(`[UPLOAD] size=${fileSize}B duration=${uploadMs}ms throughput=${throughput}KB/s`);
        if (!uploadResult || uploadResult.status >= 400) {
          throw new Error(`오디오 업로드 실패: ${uploadResult?.body ?? '응답 없음'}`);
        }
      }

      // ── Step 1: lesson_plans 행 생성 (재시도가 아닐 때만) ──
      if (!planId) {
        setAnalysisStep(1);
        const { data: pending, error: planError } = await supabase
          .from('lesson_plans')
          .insert({ coach_id: userId, member_id: memberId, status: 'pending', audio_storage_path: storagePath, lesson_id: lessonId ?? null })
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
          lesson_id: lessonId ?? null,
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

      if (!skipMonthlyIncrement) await incrementAiAnalysisUsage(userId, subscription?.current_period_end);
      await loadPlans();
      Alert.alert('완료', 'AI 레슨 기록이 완료됐습니다! 🎾');

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

  // 녹음 종료 → 즉시 AI 분석 시작
  async function stopRecording() {
    if (!isRecording && !isPaused) return;

    if (recordingDurationRef.current < 10) {
      Alert.alert('녹음 시간 부족', '최소 10초 이상 녹음해야 분석이 가능합니다.\n현재: ' + recordingDurationRef.current + '초');
      return;
    }

    console.log('[REC][STOP] stopRecording | 녹음시간:', recordingDurationRef.current + '초');

    if (timerRef.current) clearInterval(timerRef.current);
    isIntentionalStopRef.current = true;

    try {
      await audioRecorder.stop();
      isIntentionalStopRef.current = false;
      // 오디오 세션 해제 — 업로드 중 전화/알림 수신 시 충돌 방지
      try { await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: false }); } catch {}
      const uri = await mergeAndGetUri();
      recordingSegmentsRef.current = [];
      if (!uri) throw new Error('녹음 파일을 찾을 수 없습니다.');

      const duration = recordingDurationRef.current;
      // isAnalyzing을 먼저 true로 → isRecording/isPaused false 전환 시 IDLE 플래시 방지
      setIsAnalyzing(true);
      setIsRecording(false);
      setIsPaused(false);
      setShowResumeBtn(false);
      setInterruptToast(null);

      // 자동 AI 분석 시작
      await startAnalysisWithUri(uri, duration);
    } catch (e: any) {
      isIntentionalStopRef.current = false;
      Alert.alert('오류', e.message || '녹음 종료 중 오류가 발생했습니다.');
    }
  }

  // 녹음 완료 후 AI 분석 파이프라인 시작 (중복 탭 방지)
  const isAnalyzingStartRef = useRef(false);
  async function startAnalysisWithUri(uri: string, duration: number) {
    if (isAnalyzing || isAnalyzingStartRef.current) return;
    isAnalyzingStartRef.current = true;

    try {
      const { data: { user }, error: userError } = await supabase.auth.getUser();
      if (userError || !user) throw new Error('로그인이 필요합니다.');

      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token ?? SUPABASE_ANON_KEY;

      const limitCheck = await checkAiAnalysisLimit(user.id, subscription);
      if (!limitCheck.allowed && !limitCheck.needsExtraCredit) {
        setUsageInfo({ used: limitCheck.used, limit: limitCheck.limit });
        setUpsellContext(limitCheck.planId === 'basic' ? 'ai_analysis_limit' : 'ai_analysis_free');
        setIsAnalyzing(false);
        return;
      }

      if (!limitCheck.allowed && limitCheck.needsExtraCredit && limitCheck.extraCredits === 0) {
        setUsageInfo({ used: limitCheck.used, limit: limitCheck.limit });
        setPendingAnalysis({ uri, userId: user.id, duration });
        setAuthToken(token);
        setTopupModalVisible(true);
        setIsAnalyzing(false);
        return;
      }

      const usingExtraCredit = limitCheck.needsExtraCredit && limitCheck.extraCredits > 0;
      await runAnalysis(uri, user.id, duration, token, usingExtraCredit);
    } catch (e: any) {
      console.log('[REC][ERR] startAnalysisWithUri 에러:', e?.message);
      setIsAnalyzing(false);
      setAnalysisStep(0);
      Alert.alert('오류', e.message || '분석 시작 중 오류가 발생했습니다.');
    } finally {
      isAnalyzingStartRef.current = false;
    }
  }

  async function handleTopupSuccess(newBalance: number) {
    console.log('[ANA][2] handleTopupSuccess → runAnalysis 재시도');
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

  function formatDurationFull(seconds: number) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60).toString().padStart(2, '0');
    const s = (seconds % 60).toString().padStart(2, '0');
    return h > 0 ? `${h}:${m}:${s}` : `${m}:${s}`;
  }

  function WaveformBars({ bars, active }: { bars: number[]; active: boolean }) {
    return (
      <View style={styles.waveContainer}>
        {bars.map((v, i) => (
          <View
            key={i}
            style={[
              styles.waveBar,
              {
                height: Math.max(4, v * 48),
                backgroundColor: active ? Colors.primary : '#D9D0C8',
                opacity: active ? 0.7 + v * 0.3 : 0.4,
              },
            ]}
          />
        ))}
      </View>
    );
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
          {current ? current.label : 'AI 분석 중...'}
          {analysisStep === 0 && uploadPct > 0 ? ` (${uploadPct}%)` : ''}
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
          <Ionicons name="chevron-back" size={24} color={Colors.foreground} />
        </TouchableOpacity>
        <View style={styles.headerTextWrap}>
          <Text style={styles.headerTitle}>AI 레슨 기록</Text>
          <Text style={styles.headerSub}>{memberName} · {memberLevel}</Text>
        </View>
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

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <TerracottaRefreshControl
            refreshing={refreshing}
            onRefresh={async () => {
              setRefreshing(true);
              try {
                const ok = await loadPlans();
                if (ok === false) Alert.alert('새로고침 실패', '네트워크 상태를 확인하고 다시 시도해 주세요.');
              } catch (e) { console.error('[AI 레슨 기록] 새로고침 실패:', e); Alert.alert('새로고침 실패', '네트워크 상태를 확인하고 다시 시도해 주세요.'); }
              finally { setRefreshing(false); }
            }}
          />
        }
      >

        {/* 녹음 시작 카드 */}
        <View style={styles.recordCard}>
          {/* 회원 동의 상태 배지 */}
          {consentCheckDone && (
            <View style={[styles.consentBadge, memberConsentOk ? styles.consentBadgeOk : styles.consentBadgeWarn]}>
              <Ionicons
                name={memberConsentOk ? 'checkmark-circle' : 'alert-circle-outline'}
                size={14}
                color={memberConsentOk ? '#22C55E' : Colors.primary}
              />
              <Text style={[styles.consentBadgeText, memberConsentOk ? styles.consentBadgeTextOk : styles.consentBadgeTextWarn]}>
                {memberConsentOk ? '✓ 회원 동의 확인됨' : '회원 동의 필요'}
              </Text>
            </View>
          )}
          {/* 1. 상태별 제목 */}
          <Text style={styles.recordPrompt}>
            {isAnalyzing ? 'AI가 레슨 내용을 정리하고 있어요'
              : isPaused ? '녹음이 일시정지되었어요'
              : isRecording ? '레슨을 기록하고 있어요'
              : '오늘 레슨을 기록해 볼까요?'}
          </Text>
          {/* 2. 설명 (idle 상태에서만) */}
          {!isRecording && !isPaused && !isAnalyzing && (
            <Text style={styles.recordDesc}>녹음하면 AI가 핵심 내용을 정리해요</Text>
          )}

          {/* 인터럽트 토스트 */}
          {interruptToast && (
            <View style={styles.interruptToast}>
              <Ionicons name="information-circle-outline" size={16} color={Colors.primary} />
              <Text style={styles.interruptToastText}>{interruptToast}</Text>
            </View>
          )}

          {/* 3. 버튼 영역 */}
          {isAnalyzing ? (
            <AnalyzingView />
          ) : (isRecording || isPaused) ? (
            /* ── RECORDING / PAUSED: 풀스크린 녹음 UI ── */
            <View style={styles.recordActiveContent}>
              <Text style={styles.recordMemberName}>{memberName}</Text>
              <Text style={styles.recordStatusLabel}>
                {isPaused ? '일시정지됨' : '레슨 기록 중'}
              </Text>
              <Text style={styles.recordTimerLarge}>{formatDurationFull(recordingDuration)}</Text>
              <WaveformBars bars={waveformBars} active={isRecording && !isPaused} />
              <View style={styles.recordBottomBtns}>
                <TouchableOpacity style={styles.stopBtnPrimary} onPress={stopRecording} activeOpacity={0.85}>
                  <Ionicons name="stop-circle" size={22} color="#fff" />
                  <Text style={styles.stopBtnPrimaryText}>녹음 종료</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.pauseResumeBtn}
                  onPress={isPaused ? resumeRecording : pauseRecording}
                  activeOpacity={0.75}
                >
                  <Ionicons name={isPaused ? 'play' : 'pause'} size={18} color={Colors.foreground} />
                  <Text style={styles.pauseResumeBtnText}>{isPaused ? '이어서 녹음' : '일시정지'}</Text>
                </TouchableOpacity>
              </View>
              {showResumeBtn && (
                <TouchableOpacity style={styles.resumeBtn} onPress={resumeRecording}>
                  <Ionicons name="play-circle-outline" size={18} color="#fff" />
                  <Text style={styles.resumeBtnText}>이어서 녹음</Text>
                </TouchableOpacity>
              )}
            </View>
          ) : (
            /* ── IDLE: 녹음 시작 버튼 ── */
            <View style={styles.recordControls}>
              <Animated.View style={{ transform: [{ scale: pulseAnim }] }}>
                <TouchableOpacity style={styles.recordBtn} onPress={() => startRecording()} activeOpacity={0.7}>
                  <Ionicons name="mic" size={32} color="#fff" />
                  <Text style={styles.recordBtnText}>녹음 시작</Text>
                </TouchableOpacity>
              </Animated.View>
            </View>
          )}

          {/* 4. 인식 향상 모드 — idle 상태에서만 표시 */}
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

          {/* 5. 프로그레스 바 */}
          <View style={styles.usageBarTrack}>
            {usageInfo ? (
              <View
                style={[
                  styles.usageBarFill,
                  { width: `${Math.min(usageInfo.used / Math.max(usageInfo.limit, 1) * 100, 100)}%` as any },
                ]}
              />
            ) : null}
          </View>

          {/* 6. 사용량 한 줄 */}
          <View style={styles.usageSummaryRow}>
            {usageInfo ? (
              <>
              <TouchableOpacity onPress={() => setTopupModalVisible(true)} activeOpacity={0.7}>
                <Text style={styles.usageSummaryRemaining}>
                  AI 기록 {Math.max(0, usageInfo.limit - usageInfo.used)}회 남음
                </Text>
              </TouchableOpacity>
              {(subscription?.extra_report_credits ?? 0) > 0 && (
                <View style={styles.extraCreditBadge}>
                  <Text style={styles.extraCreditText}>추가 {subscription!.extra_report_credits}회</Text>
                </View>
              )}
              </>
            ) : (
              <SkeletonBox width={110} height={13} borderRadius={4} />
            )}
          </View>
        </View>

        {/* 직접 작성 - 얇은 액션 카드 */}
        <TouchableOpacity
          style={styles.manualReportBtn}
          onPress={() => { setManualModalVisible(true); }}
          activeOpacity={0.85}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <View style={styles.manualReportIconWrap}>
              <Ionicons name="pencil-outline" size={18} color={Colors.primary} />
            </View>
            <View>
              <Text style={styles.manualReportBtnTitle}>타이핑으로 기록</Text>
              <Text style={styles.manualReportBtnSub}>녹음 없이 레슨 내용을 직접 작성해요</Text>
            </View>
          </View>
          <Ionicons name="chevron-forward" size={16} color={Colors.mutedFg} />
        </TouchableOpacity>

        {/* 레슨 메모 입력 모달 */}
        <Modal visible={manualModalVisible} animationType="none" transparent statusBarTranslucent onRequestClose={handleCloseManualModal}>
          <GestureDetector gesture={swipeBackGesture}>
            <ReanimatedAnimated.View style={[styles.manualSlidePanel, swipeAnimatedStyle]}>
              <SafeAreaView style={styles.manualSafeArea}>
                <StatusBar barStyle="dark-content" backgroundColor="#FFFFFF" />
                <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
              <View style={styles.manualContainer}>
                {/* 헤더 */}
                <View style={styles.manualHeader}>
                  <View style={styles.manualHeaderSide}>
                    <TouchableOpacity
                      onPress={handleCloseManualModal}
                      style={styles.manualBackCapsule}
                      activeOpacity={0.7}
                      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                    >
                      <Ionicons name="chevron-back" size={18} color="#3E2B22" />
                      <Text style={styles.manualBackText}>뒤로</Text>
                    </TouchableOpacity>
                  </View>
                  <Text style={styles.manualHeaderTitle}>레슨 기록</Text>
                  <View style={[styles.manualHeaderSide, { alignItems: 'flex-end' }]} />
                </View>

                <ScrollView
                  ref={modalScrollRef}
                  style={{ flex: 1 }}
                  showsVerticalScrollIndicator={false}
                  keyboardShouldPersistTaps="handled"
                  contentContainerStyle={{ paddingBottom: 16 }}
                >
                  {/* 인트로 문구 */}
                  <View style={styles.manualIntroBlock}>
                    <Text style={styles.manualIntroTitle}>오늘 어떤 내용을 지도했나요?</Text>
                    <Text style={styles.manualIntroSub}>키워드를 선택하거나 직접 입력해 주세요.</Text>
                  </View>

                  {/* 최근 사용 조합 */}
                  {recentCombos.length > 0 && (
                    <View style={{ paddingHorizontal: 16, paddingTop: 4, paddingBottom: 2 }}>
                      <Text style={styles.kwCategoryLabel}>최근 기록</Text>
                      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingBottom: 4 }}>
                        {recentCombos.map((combo, idx) => (
                          <TouchableOpacity
                            key={idx}
                            style={styles.recentComboChip}
                            onPress={() => {
                              setSelTech(combo.tech ?? null);
                              setSelPoints(combo.points ? [...combo.points] : []);
                              setSelStatus(combo.status ?? null);
                              setSelGoal(combo.goal ?? null);
                              if (combo.goal) setGoalExpanded(true);
                            }}
                            activeOpacity={0.75}
                          >
                            <Text style={styles.recentComboTech} numberOfLines={1}>
                              {combo.tech ?? '일반'}
                            </Text>
                            {(combo.points?.length || combo.status || combo.goal) ? (
                              <Text style={styles.recentComboDetail} numberOfLines={1}>
                                {[combo.points?.join(', '), combo.status, combo.goal ? `→ ${combo.goal}` : null].filter(Boolean).join(' · ')}
                              </Text>
                            ) : null}
                          </TouchableOpacity>
                        ))}
                      </ScrollView>
                    </View>
                  )}

                  {/* 추가된 기록 항목 */}
                  {memoItems.length > 0 && (
                    <View style={{ paddingHorizontal: 16, paddingTop: 14 }}>
                      <Text style={styles.kwCategoryLabel}>오늘의 레슨 기록 ({memoItems.length})</Text>
                      {memoItems.map((item, idx) => (
                        <View key={idx} style={styles.memoItemRow}>
                          <View style={{ flex: 1 }}>
                            <Text style={styles.memoItemText} numberOfLines={2}>{memoItemLabel(item)}</Text>
                            {item.goal && (
                              <Text style={styles.memoItemGoalText}>→ {item.goal}</Text>
                            )}
                          </View>
                          <TouchableOpacity onPress={() => removeMemoItem(idx)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                            <Ionicons name="close-circle" size={18} color={Colors.mutedFg} />
                          </TouchableOpacity>
                        </View>
                      ))}
                    </View>
                  )}

                  {/* 구분선 */}
                  {memoItems.length > 0 && (
                    <View style={{ height: 1, backgroundColor: Colors.borderLight, marginHorizontal: 16, marginTop: 14, marginBottom: 2 }} />
                  )}

                  {/* 기술 */}
                  <View style={styles.stepCard}>
                    <View style={styles.stepLabelRow}>
                      <Text style={styles.stepTitle}>기술{selTech ? ` · ${selTech}` : ''}</Text>
                    </View>
                    <View style={styles.kwChipsRow}>
                      {(TENNIS_TECHNIQUES as readonly string[]).map(tech => {
                        const selected = selTech === tech;
                        return (
                          <TouchableOpacity
                            key={tech}
                            style={[styles.kwChip, selected && styles.kwChipSelected]}
                            onPress={() => {
                              const next = selTech === tech ? null : tech;
                              setSelTech(next);
                              setSelPoints([]);
                              if (!next) setSelGoal(null);
                            }}
                            activeOpacity={0.7}
                          >
                            {selected && <Ionicons name="checkmark" size={11} color="#fff" style={{ marginRight: 3 }} />}
                            <Text style={[styles.kwChipText, selected && styles.kwChipTextSelected]}>{tech}</Text>
                          </TouchableOpacity>
                        );
                      })}
                      {customKw.techniques.map(tech => {
                        const selected = selTech === tech;
                        return (
                          <TouchableOpacity
                            key={`c_${tech}`}
                            style={[styles.kwChip, styles.kwChipCustom, selected && styles.kwChipSelected]}
                            onPress={() => { const next = selTech === tech ? null : tech; setSelTech(next); setSelPoints([]); if (!next) setSelGoal(null); }}
                            onLongPress={() => Alert.alert('키워드 삭제', `"${tech}"를 삭제할까요?`, [{ text: '취소', style: 'cancel' }, { text: '삭제', style: 'destructive', onPress: () => deleteCustomKeyword('tech', null, tech) }])}
                            activeOpacity={0.7}
                          >
                            {selected && <Ionicons name="checkmark" size={11} color="#fff" style={{ marginRight: 3 }} />}
                            <Text style={[styles.kwChipText, selected && styles.kwChipTextSelected]}>{tech}</Text>
                          </TouchableOpacity>
                        );
                      })}
                      {addingCategory === 'tech' ? (
                        <View style={styles.kwAddInputRow}>
                          <TextInput ref={addingInputRef} style={styles.kwAddInput} value={addingInput} onChangeText={v => setAddingInput(v.slice(0, 20))} placeholder="직접 입력" placeholderTextColor={Colors.placeholder} autoFocus returnKeyType="done" onSubmitEditing={confirmAddKeyword} onBlur={() => { if (!addingInput.trim()) { setAddingCategory(null); setAddingInput(''); } }} />
                          <TouchableOpacity style={[styles.kwAddConfirmBtn, !addingInput.trim() && { opacity: 0.4 }]} onPress={confirmAddKeyword}><Text style={styles.kwAddConfirmText}>추가</Text></TouchableOpacity>
                          <TouchableOpacity style={styles.kwAddCancelBtn} onPress={() => { setAddingCategory(null); setAddingInput(''); }}><Ionicons name="close" size={14} color={Colors.mutedFg} /></TouchableOpacity>
                        </View>
                      ) : (
                        <TouchableOpacity style={styles.kwAddBtn} onPress={() => setAddingCategory('tech')} activeOpacity={0.7}>
                          <Ionicons name="add" size={13} color={Colors.mutedFg} /><Text style={styles.kwAddBtnText}>추가</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  </View>

                  {/* 교정 포인트 */}
                  <View style={styles.stepCard}>
                    <View style={styles.stepLabelRow}>
                      <Text style={styles.stepTitle}>교정 포인트{selPoints.length > 0 ? ` · ${selPoints.join(', ')}` : ''}</Text>
                    </View>
                    <View style={styles.kwChipsRow}>
                      {currentCorrections.map(pt => {
                        const selected = selPoints.includes(pt);
                        const isCustom = !((selTech ? (CORRECTION_BY_TECH[selTech] ?? DEFAULT_CORRECTIONS) : DEFAULT_CORRECTIONS).includes(pt));
                        return (
                          <TouchableOpacity
                            key={pt}
                            style={[styles.kwChip, isCustom && styles.kwChipCustom, selected && styles.kwChipSelected]}
                            onPress={() => togglePoint(pt)}
                            onLongPress={isCustom ? () => {
                              const techKey = selTech ?? '__all__';
                              Alert.alert('키워드 삭제', `"${pt}"를 삭제할까요?`, [{ text: '취소', style: 'cancel' }, { text: '삭제', style: 'destructive', onPress: () => deleteCustomKeyword('correction', techKey, pt) }]);
                            } : undefined}
                            activeOpacity={0.7}
                          >
                            {selected && <Ionicons name="checkmark" size={11} color="#fff" style={{ marginRight: 3 }} />}
                            <Text style={[styles.kwChipText, selected && styles.kwChipTextSelected]}>{pt}</Text>
                          </TouchableOpacity>
                        );
                      })}
                      {addingCategory === 'correction' ? (
                        <View style={styles.kwAddInputRow}>
                          <TextInput ref={addingInputRef} style={styles.kwAddInput} value={addingInput} onChangeText={v => setAddingInput(v.slice(0, 20))} placeholder="직접 입력" placeholderTextColor={Colors.placeholder} autoFocus returnKeyType="done" onSubmitEditing={confirmAddKeyword} onBlur={() => { if (!addingInput.trim()) { setAddingCategory(null); setAddingInput(''); } }} />
                          <TouchableOpacity style={[styles.kwAddConfirmBtn, !addingInput.trim() && { opacity: 0.4 }]} onPress={confirmAddKeyword}><Text style={styles.kwAddConfirmText}>추가</Text></TouchableOpacity>
                          <TouchableOpacity style={styles.kwAddCancelBtn} onPress={() => { setAddingCategory(null); setAddingInput(''); }}><Ionicons name="close" size={14} color={Colors.mutedFg} /></TouchableOpacity>
                        </View>
                      ) : (
                        <TouchableOpacity style={styles.kwAddBtn} onPress={() => setAddingCategory('correction')} activeOpacity={0.7}>
                          <Ionicons name="add" size={13} color={Colors.mutedFg} /><Text style={styles.kwAddBtnText}>추가</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  </View>

                  {/* 현재 상태 */}
                  <View style={styles.stepCard}>
                    <View style={styles.stepLabelRow}>
                      <Text style={styles.stepTitle}>현재 상태{selStatus ? ` · ${selStatus}` : ''}</Text>
                    </View>
                    <View style={styles.kwChipsRow}>
                      {[...(STATUS_KEYWORDS as readonly string[]), ...customKw.statuses].map(st => {
                        const selected = selStatus === st;
                        const isCustom = !(STATUS_KEYWORDS as readonly string[]).includes(st);
                        return (
                          <TouchableOpacity
                            key={st}
                            style={[styles.kwChip, isCustom && styles.kwChipCustom, selected && styles.kwChipSelected]}
                            onPress={() => setSelStatus(prev => prev === st ? null : st)}
                            onLongPress={isCustom ? () => Alert.alert('키워드 삭제', `"${st}"를 삭제할까요?`, [{ text: '취소', style: 'cancel' }, { text: '삭제', style: 'destructive', onPress: () => deleteCustomKeyword('status', null, st) }]) : undefined}
                            activeOpacity={0.7}
                          >
                            {selected && <Ionicons name="checkmark" size={11} color="#fff" style={{ marginRight: 3 }} />}
                            <Text style={[styles.kwChipText, selected && styles.kwChipTextSelected]}>{st}</Text>
                          </TouchableOpacity>
                        );
                      })}
                      {addingCategory === 'status' ? (
                        <View style={styles.kwAddInputRow}>
                          <TextInput ref={addingInputRef} style={styles.kwAddInput} value={addingInput} onChangeText={v => setAddingInput(v.slice(0, 20))} placeholder="직접 입력" placeholderTextColor={Colors.placeholder} autoFocus returnKeyType="done" onSubmitEditing={confirmAddKeyword} onBlur={() => { if (!addingInput.trim()) { setAddingCategory(null); setAddingInput(''); } }} />
                          <TouchableOpacity style={[styles.kwAddConfirmBtn, !addingInput.trim() && { opacity: 0.4 }]} onPress={confirmAddKeyword}><Text style={styles.kwAddConfirmText}>추가</Text></TouchableOpacity>
                          <TouchableOpacity style={styles.kwAddCancelBtn} onPress={() => { setAddingCategory(null); setAddingInput(''); }}><Ionicons name="close" size={14} color={Colors.mutedFg} /></TouchableOpacity>
                        </View>
                      ) : (
                        <TouchableOpacity style={styles.kwAddBtn} onPress={() => setAddingCategory('status')} activeOpacity={0.7}>
                          <Ionicons name="add" size={13} color={Colors.mutedFg} /><Text style={styles.kwAddBtnText}>추가</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  </View>

                  {/* 다음 목표 (선택 사항, 접기/펼치기) */}
                  <View style={styles.stepCard}>
                    <TouchableOpacity
                      style={[styles.stepLabelRow, { marginBottom: 0 }]}
                      onPress={() => setGoalExpanded(v => !v)}
                      activeOpacity={0.7}
                    >
                      <Text style={styles.stepTitle}>
                        다음 목표{selGoal ? ` · ${selGoal}` : ''}
                      </Text>
                      <Text style={styles.stepOptional}>선택</Text>
                      <Ionicons name={goalExpanded ? 'chevron-up' : 'chevron-down'} size={14} color={Colors.mutedFg} />
                    </TouchableOpacity>
                    {goalExpanded && (
                      <View style={[styles.kwChipsRow, { marginTop: 8 }]}>
                        {currentGoals.map(goal => {
                          const selected = selGoal === goal;
                          const baseGoals = selTech ? (GOAL_BY_TECH[selTech] ?? DEFAULT_GOALS) : DEFAULT_GOALS;
                          const isCustom = !baseGoals.includes(goal);
                          return (
                            <TouchableOpacity
                              key={goal}
                              style={[styles.kwChip, isCustom && styles.kwChipCustom, selected && styles.kwChipSelected]}
                              onPress={() => setSelGoal(prev => prev === goal ? null : goal)}
                              onLongPress={isCustom ? () => {
                                const techKey = selTech ?? '__all__';
                                Alert.alert('키워드 삭제', `"${goal}"를 삭제할까요?`, [{ text: '취소', style: 'cancel' }, { text: '삭제', style: 'destructive', onPress: () => deleteCustomKeyword('goal', techKey, goal) }]);
                              } : undefined}
                              activeOpacity={0.7}
                            >
                              {selected && <Ionicons name="checkmark" size={11} color="#fff" style={{ marginRight: 3 }} />}
                              <Text style={[styles.kwChipText, selected && styles.kwChipTextSelected]}>{goal}</Text>
                            </TouchableOpacity>
                          );
                        })}
                        {addingCategory === 'goal' ? (
                          <View style={styles.kwAddInputRow}>
                            <TextInput ref={addingInputRef} style={styles.kwAddInput} value={addingInput} onChangeText={v => setAddingInput(v.slice(0, 20))} placeholder="직접 입력" placeholderTextColor={Colors.placeholder} autoFocus returnKeyType="done" onSubmitEditing={confirmAddKeyword} onBlur={() => { if (!addingInput.trim()) { setAddingCategory(null); setAddingInput(''); } }} />
                            <TouchableOpacity style={[styles.kwAddConfirmBtn, !addingInput.trim() && { opacity: 0.4 }]} onPress={confirmAddKeyword}><Text style={styles.kwAddConfirmText}>추가</Text></TouchableOpacity>
                            <TouchableOpacity style={styles.kwAddCancelBtn} onPress={() => { setAddingCategory(null); setAddingInput(''); }}><Ionicons name="close" size={14} color={Colors.mutedFg} /></TouchableOpacity>
                          </View>
                        ) : (
                          <TouchableOpacity style={styles.kwAddBtn} onPress={() => setAddingCategory('goal')} activeOpacity={0.7}>
                            <Ionicons name="add" size={13} color={Colors.mutedFg} /><Text style={styles.kwAddBtnText}>추가</Text>
                          </TouchableOpacity>
                        )}
                      </View>
                    )}
                  </View>

                  {/* 선택 미리보기 + 기록 추가 */}
                  {hasCurrentSel && (
                    <View style={styles.previewAddRow}>
                      <View style={styles.previewBox}>
                        <Text style={styles.previewText} numberOfLines={2}>{currentPreview}</Text>
                      </View>
                      <TouchableOpacity style={styles.addItemBtn} onPress={addMemoItem} activeOpacity={0.75}>
                        <Ionicons name="add" size={16} color="#fff" />
                        <Text style={styles.addItemBtnText}>기록 추가</Text>
                      </TouchableOpacity>
                    </View>
                  )}

                  {/* 직접 레슨 기록하기 (접기/펼치기) */}
                  <View style={{ paddingHorizontal: 16, paddingTop: 6, paddingBottom: 8 }}>
                    <TouchableOpacity
                      style={styles.memoToggleRow}
                      onPress={() => {
                        const next = !memoExpanded;
                        setMemoExpanded(next);
                        if (next) {
                          // 펼칠 때 스크롤 끝으로 이동 (키보드 등장 전)
                          setTimeout(() => modalScrollRef.current?.scrollToEnd({ animated: true }), 80);
                        }
                      }}
                      activeOpacity={0.7}
                    >
                      <Ionicons name={memoExpanded ? 'chevron-down' : 'chevron-forward'} size={14} color={Colors.mutedFg} />
                      <Text style={styles.memoToggleText}>직접 레슨 기록하기</Text>
                      {manualContent.trim() && <View style={styles.memoDot} />}
                    </TouchableOpacity>
                    {memoExpanded && (
                      <>
                        <Text style={styles.memoToggleDesc}>AI 기능 없이도 자유롭게 기록하고 회원에게 공유할 수 있어요.</Text>
                        <View style={[styles.inputWrapper, inputFocused && styles.inputWrapperFocused, { minHeight: 90, maxHeight: 150, marginHorizontal: 0, marginTop: 8 }]}>
                          <TextInput
                            ref={inputRef}
                            style={styles.memoInput}
                            value={manualContent}
                            onChangeText={v => setManualContent(v.slice(0, 2000))}
                            placeholder="AI 기능 없이 레슨 기록을 자유롭게 적고 회원에게 공유하세요."
                            placeholderTextColor="#AAAAAA"
                            multiline
                            textAlignVertical="top"
                            onFocus={() => {
                              setInputFocused(true);
                              // 키보드 완전히 올라온 뒤 스크롤 (keyboardWillShow 이벤트 처리 후)
                              setTimeout(() => modalScrollRef.current?.scrollToEnd({ animated: true }), 350);
                            }}
                            onBlur={() => setInputFocused(false)}
                            onSelectionChange={e => setCursorPos(e.nativeEvent.selection)}
                            scrollEnabled
                          />
                          <Text style={styles.charCounter}>{manualContent.length.toLocaleString()} / 2,000</Text>
                        </View>
                      </>
                    )}
                  </View>
                </ScrollView>

                {/* AI 처리 중 오버레이 */}
                {isSubmitting && submitMode === 'ai' && (
                  <View style={styles.manualLoadingOverlay}>
                    <ActivityIndicator size="large" color={Colors.primary} />
                    <Text style={styles.manualLoadingText}>AI가 레슨을 정리하고 있어요...</Text>
                    <Text style={styles.manualLoadingSubText}>잠시만 기다려주세요</Text>
                  </View>
                )}

                {/* 하단 CTA — AI 메인, 그대로 서브 */}
                {memoKeyboardHeight === 0 && (() => {
                  const hasContent = !!(manualContent.trim() || memoItems.length > 0);
                  return (
                    <View style={styles.manualBtnRow}>
                      <TouchableOpacity
                        style={[styles.directBtn, (!hasContent || isSubmitting) && styles.btnDisabled]}
                        onPress={handleDirect}
                        disabled={!hasContent || isSubmitting}
                        activeOpacity={0.8}
                      >
                        {isSubmitting && submitMode === 'direct'
                          ? <ActivityIndicator color={Colors.primary} size="small" />
                          : <Text style={[styles.directBtnText, (!hasContent || isSubmitting) && { opacity: 0.4 }]}>그대로 저장</Text>
                        }
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.aiBtn, (!hasContent || isSubmitting) && styles.btnDisabled]}
                        onPress={handleAI}
                        disabled={!hasContent || isSubmitting}
                        activeOpacity={0.85}
                      >
                        {isSubmitting && submitMode === 'ai'
                          ? <ActivityIndicator color="#fff" size="small" />
                          : <><Ionicons name="sparkles" size={16} color="#fff" /><Text style={styles.aiBtnText}> AI로 정리하기</Text></>
                        }
                      </TouchableOpacity>
                    </View>
                  );
                })()}
              </View>
                </KeyboardAvoidingView>
              </SafeAreaView>
            </ReanimatedAnimated.View>
          </GestureDetector>
        </Modal>

        {/* 최근 레슨 기록 */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>최근 레슨 기록</Text>

          {/* 필터 탭 */}
          <View style={styles.filterRow}>
            {(['all', 'unsent', 'sent'] as const).map(f => (
              <TouchableOpacity
                key={f}
                style={[styles.filterTab, recordFilter === f && styles.filterTabActive]}
                onPress={() => setRecordFilter(f)}
              >
                <Text style={[styles.filterTabText, recordFilter === f && styles.filterTabTextActive]}>
                  {f === 'all' ? '전체' : f === 'unsent' ? '미전송' : '전송 완료'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {loading && <ActivityIndicator color={Colors.primary} style={{ marginTop: 20 }} />}

          {!loading && plans.length === 0 && manualReports.length === 0 && (
            <View style={styles.emptyBox}>
              <Ionicons name="analytics-outline" size={40} color={Colors.iconMuted} />
              <Text style={styles.emptyText}>아직 레슨 기록이 없어요</Text>
              <Text style={styles.emptySubText}>위에서 레슨을 녹음하고 AI 분석을 받아보세요</Text>
            </View>
          )}

          {plans
            .filter(plan => {
              const isSent = memberReports[plan.id]?.sent_to_member === true;
              if (recordFilter === 'sent') return isSent;
              if (recordFilter === 'unsent') return !isSent;
              return true;
            })
            .map(plan => {
              const report = memberReports[plan.id];
              const isSent = report?.sent_to_member === true;
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
                  <View style={styles.planTopRow}>
                    <View style={styles.planDateRow}>
                      <Text style={styles.planDate}>{formatDate(plan.created_at)}</Text>
                      {plan.duration_minutes ? (
                        <Text style={styles.planDuration}>· {plan.duration_minutes}분</Text>
                      ) : null}
                    </View>
                    <View style={[styles.sentBadge, isSent ? styles.sentBadgeGreen : styles.sentBadgeTerracotta]}>
                      <Text style={[styles.sentBadgeText, isSent ? styles.sentBadgeTextGreen : styles.sentBadgeTextTerracotta]}>
                        {isSent ? '전송 완료' : '미전송'}
                      </Text>
                    </View>
                  </View>
                  <View style={styles.planTitleRow}>
                    <Text style={styles.planTitleText} numberOfLines={2}>
                      {getPlanTitle(plan)}
                    </Text>
                    <Ionicons name="chevron-forward" size={16} color={Colors.mutedFg} />
                  </View>
                </TouchableOpacity>
              );
            })}

          {/* 수동 기록 카드 */}
          {manualReports
            .filter(report => {
              const isSent = report.sent_to_member === true;
              if (recordFilter === 'sent') return isSent;
              if (recordFilter === 'unsent') return !isSent;
              return true;
            })
            .map(report => {
              const isSent = report.sent_to_member === true;
              return (
              <TouchableOpacity
                key={report.id}
                style={styles.planCard}
                onPress={() => router.push({
                  pathname: '/members/plan-detail',
                  params: {
                    reportId: report.id,
                    memberId: memberId as string,
                    memberName: memberName as string,
                    memberLevel: memberLevel as string,
                  },
                } as any)}
                activeOpacity={0.8}
              >
                <View style={styles.planTopRow}>
                  <View style={styles.planDateRow}>
                    <Text style={styles.planDate}>{formatDate(report.created_at)}</Text>
                  </View>
                  <View style={[styles.sentBadge, isSent ? styles.sentBadgeGreen : styles.sentBadgeTerracotta]}>
                    <Text style={[styles.sentBadgeText, isSent ? styles.sentBadgeTextGreen : styles.sentBadgeTextTerracotta]}>
                      {isSent ? '전송 완료' : '미전송'}
                    </Text>
                  </View>
                </View>
                <View style={styles.planTitleRow}>
                  <Text style={styles.planTitleText} numberOfLines={2}>
                    {report.summary || '레슨 기록'}
                  </Text>
                  <Ionicons name="chevron-forward" size={16} color={Colors.mutedFg} />
                </View>
              </TouchableOpacity>
              );
            })}
        </View>

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

      {/* 코치 동의 모달 */}
      <CoachConsentModal
        visible={coachConsentVisible}
        onAgree={() => {
          setCoachConsentVisible(false);
          checkMemberConsent().then(() => setConsentCheckDone(true));
        }}
        onDecline={() => {
          setCoachConsentVisible(false);
          router.back();
        }}
      />

      {/* 회원 동의 요청 모달 */}
      <MemberConsentRequestModal
        visible={memberConsentVisible}
        memberName={memberName as string}
        onSendRequest={async () => {
          setMemberConsentVisible(false);
          try {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) throw new Error('not authenticated');

            // 기존 pending 요청 중복 방지
            const { data: existing } = await supabase
              .from('ai_consents')
              .select('id')
              .eq('coach_id', user.id)
              .eq('member_id', memberId)
              .eq('consent_type', 'member')
              .eq('consent_status', 'pending')
              .maybeSingle();

            if (!existing) {
              const { error } = await supabase.from('ai_consents').insert({
                coach_id: user.id,
                member_id: memberId,
                consent_type: 'member',
                consent_status: 'pending',
                consent_version: AI_CONSENT_VERSION,
                source: 'coach_app',
              });
              if (error) throw error;
            }

            Alert.alert(
              '동의 요청 전송 완료',
              `${memberName || '회원'}님이 다음에 앱을 열면 동의 요청이 표시됩니다.\n동의 후 바로 녹음을 시작할 수 있어요.`,
            );
          } catch (e: any) {
            Alert.alert('오류', '동의 요청 전송에 실패했습니다.');
            console.error('[CONSENT] send request error:', e?.message);
          }
        }}
        onQRConsent={() => {
          setMemberConsentVisible(false);
          // QR 공유 기능 재사용 (기존 invite 플로우)
          Alert.alert('QR 동의', 'QR 코드를 회원에게 보여주세요.\n회원이 QR을 스캔하면 동의 화면으로 연결됩니다.');
        }}
        onLater={() => setMemberConsentVisible(false)}
      />

      {/* 회원 구두 동의 확인 바텀시트 */}
      <MemberVerbalConsentSheet
        visible={verbalConsentVisible}
        memberName={memberName as string}
        memberId={memberId as string}
        coachId={currentCoachId}
        isMinor={isMinorMember}
        onConfirm={() => {
          setVerbalConsentVisible(false);
          setMemberConsentOk(true);
          AsyncStorage.setItem(MEMBER_VERBAL_CONSENT_KEY, '1');
          startRecording(true);
        }}
        onCancel={() => setVerbalConsentVisible(false)}
      />

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
    backgroundColor: Colors.background,
    paddingTop: Platform.OS === 'ios' ? 56 : 20,
    paddingBottom: 14,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  backBtn: { padding: 4 },
  headerTextWrap: { flex: 1 },
  headerTitle: { fontSize: 20, fontWeight: '800', color: Colors.foreground },
  headerSub: { fontSize: 13, color: Colors.mutedFg, marginTop: 2 },
  scroll: { flex: 1, backgroundColor: Colors.background },
  scrollContent: { backgroundColor: Colors.background, paddingBottom: 48 },

  // 동의 배지
  consentBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    alignSelf: 'flex-start', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5,
    marginBottom: 10,
  },
  consentBadgeOk: { backgroundColor: '#ECFDF5' },
  consentBadgeWarn: { backgroundColor: Colors.primaryLight },
  consentBadgeText: { fontSize: 12, fontWeight: '600' },
  consentBadgeTextOk: { color: '#22C55E' },
  consentBadgeTextWarn: { color: Colors.primary },

  usageHelpBtn: {
    width: 26, height: 26, borderRadius: 13,
    backgroundColor: Colors.primary,
    justifyContent: 'center', alignItems: 'center',
  },
  usageHelpText: { fontSize: 13, fontWeight: '800', color: '#fff', lineHeight: 16 },

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
    marginHorizontal: 16,
    marginTop: 8,
    marginBottom: 10,
    borderRadius: 20,
    padding: 20,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  recordPrompt: { fontSize: 20, fontWeight: '800', color: Colors.foreground, marginBottom: 4 },
  recordDesc: { fontSize: 13, color: Colors.mutedFg, lineHeight: 20, marginBottom: 4 },
  enhancedModeRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 12, paddingHorizontal: 14,
    backgroundColor: Colors.background, borderRadius: 12,
    marginTop: 4, marginBottom: 14, borderWidth: 1, borderColor: Colors.border,
  },
  enhancedModeLeft: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 },
  enhancedModeLabel: { fontSize: 13, color: Colors.mutedFg, fontWeight: '500' },
  enhancedModeLabelOn: { color: Colors.primary, fontWeight: '600' },
  usageBarTrack: {
    height: 4, borderRadius: 2, backgroundColor: Colors.border,
    marginBottom: 8, overflow: 'hidden',
  },
  usageBarFill: {
    height: 4, borderRadius: 2, backgroundColor: Colors.primary,
  },
  usageSummaryRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
  },
  usageSummaryText: { fontSize: 12, color: Colors.mutedFg },
  extraCreditBadge: {
    backgroundColor: Colors.primaryLight, borderRadius: 20,
    paddingHorizontal: 8, paddingVertical: 2,
  },
  extraCreditText: { fontSize: 11, fontWeight: '600', color: Colors.primary },
  usageSummaryRemaining: { fontSize: 12, color: Colors.mutedFg },
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
  analyzingText: { fontSize: 16, fontWeight: '700', color: Colors.primary },
  analyzingSubText: { fontSize: 12, color: Colors.placeholder },
  stepDots: { flexDirection: 'row', gap: 8, marginTop: 4 },
  stepDot: {
    width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.border,
  },
  stepDotActive: { backgroundColor: '#a8d5b5' },
  stepDotCurrent: { backgroundColor: Colors.primary, width: 20, borderRadius: 4 },

  // 녹음 컨트롤
  recordControls: { alignItems: 'center', gap: 12, paddingVertical: 20 },
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
    width: 115, height: 115, borderRadius: 57.5,
    backgroundColor: Colors.primary,
    justifyContent: 'center', alignItems: 'center',
    shadowColor: Colors.primary, shadowOpacity: 0.3, shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 }, elevation: 6, gap: 6,
  },
  recordBtnActive: { backgroundColor: Colors.destructive, shadowColor: Colors.destructive },
  recordBtnPaused: { backgroundColor: Colors.mutedFg, shadowColor: Colors.mutedFg },
  recordBtnText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  recordHint: { fontSize: 12, color: Colors.mutedFg, textAlign: 'center', maxWidth: 240 },
  // 녹음 중 일시정지+종료 가로 배치 (구 스타일 — 미사용이나 혹시 참조 시 보존)
  recordingBtnRow: { flexDirection: 'row', alignItems: 'center', gap: 20 },
  pauseBtn: {
    width: 76, height: 76, borderRadius: 38,
    borderWidth: 2, borderColor: Colors.primary,
    justifyContent: 'center', alignItems: 'center', gap: 4,
    backgroundColor: 'rgba(192,117,90,0.06)',
  },
  pauseBtnText: { fontSize: 11, fontWeight: '700', color: Colors.primary },

  // 풀 녹음 활성 UI (RECORDING/PAUSED)
  recordActiveContent: {
    alignItems: 'center', gap: 8, paddingVertical: 4,
  },
  recordMemberName: {
    fontSize: 18, fontWeight: '700', color: Colors.foreground, marginBottom: 2,
  },
  recordStatusLabel: {
    fontSize: 13, color: Colors.mutedFg, fontWeight: '500', marginBottom: 4,
  },
  recordTimerLarge: {
    fontSize: 52, fontWeight: '800', color: Colors.foreground,
    letterSpacing: 2, fontVariant: ['tabular-nums'] as any,
    marginBottom: 12,
  },
  // 음파 웨이브
  waveContainer: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    height: 52, marginBottom: 24,
  },
  waveBar: {
    width: 4, borderRadius: 3,
  },
  // 하단 버튼 세로 배치
  recordBottomBtns: { alignItems: 'center', gap: 12, width: '100%' },
  stopBtnPrimary: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: Colors.destructive,
    borderRadius: 16, paddingVertical: 16, paddingHorizontal: 40,
    width: '100%', justifyContent: 'center',
    shadowColor: Colors.destructive, shadowOpacity: 0.25, shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 }, elevation: 4,
  },
  stopBtnPrimaryText: { color: '#fff', fontSize: 17, fontWeight: '800' },
  pauseResumeBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: 'rgba(0,0,0,0.05)',
    borderRadius: 14, paddingVertical: 13, paddingHorizontal: 32,
    width: '100%', justifyContent: 'center',
  },
  pauseResumeBtnText: { color: Colors.foreground, fontSize: 15, fontWeight: '600' },
  // READY 상태
  readyTimeBox: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 20 },
  readyTimeText: { fontSize: 28, fontWeight: '800', color: Colors.foreground, letterSpacing: 2 },
  analyzeBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: Colors.primary, borderRadius: 16,
    paddingVertical: 16, paddingHorizontal: 32,
    shadowColor: Colors.primary, shadowOpacity: 0.3, shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 }, elevation: 5,
  },
  analyzeBtnText: { color: '#fff', fontSize: 17, fontWeight: '800' },
  reRecordBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingVertical: 10, paddingHorizontal: 18, marginTop: 10,
  },
  reRecordBtnText: { fontSize: 14, color: Colors.primary, fontWeight: '600' },

  // 최근 레슨 기록 섹션
  section: { paddingHorizontal: 16 },
  sectionTitle: { fontSize: 22, fontWeight: '800', color: Colors.foreground, marginBottom: 14 },
  filterRow: { flexDirection: 'row', gap: 8, marginBottom: 14 },
  filterTab: {
    paddingHorizontal: 18, paddingVertical: 8,
    borderRadius: 24, borderWidth: 1, borderColor: Colors.border,
    backgroundColor: Colors.background,
  },
  filterTabActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  filterTabText: { fontSize: 13, fontWeight: '600', color: Colors.mutedFg },
  filterTabTextActive: { color: '#fff' },

  // 직접 작성 액션 카드
  manualReportBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginHorizontal: 16, marginBottom: 20, paddingVertical: 14, paddingHorizontal: 16,
    backgroundColor: '#fff', borderRadius: 20,
    shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 }, elevation: 2,
  },
  manualReportIconWrap: {
    width: 36, height: 36, borderRadius: 11,
    backgroundColor: '#F7F0E9',
    justifyContent: 'center', alignItems: 'center',
  },
  manualReportBtnTitle: { fontSize: 14, fontWeight: '700', color: Colors.foreground },
  manualReportBtnSub: { fontSize: 12, color: Colors.mutedFg, marginTop: 2 },
  // 레슨 메모 입력 모달
  manualSlidePanel: { flex: 1, borderTopLeftRadius: 12, borderTopRightRadius: 12, overflow: 'hidden' },
  manualSafeArea: { flex: 1, backgroundColor: '#FFFFFF' },
  manualContainer: { flex: 1, flexDirection: 'column', backgroundColor: '#F7F0E9' },
  manualHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: 52,
    paddingHorizontal: 12,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: Platform.OS === 'android' ? 1 : StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(62,43,34,0.07)',
  },
  manualHeaderSide: { minWidth: 76, justifyContent: 'center' },
  manualBackCapsule: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 1,
    minHeight: 36,
    paddingVertical: 7,
    paddingLeft: 8,
    paddingRight: 13,
    borderRadius: 999,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: 'rgba(62,43,34,0.06)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 3,
    elevation: 2,
  },
  manualBackText: { fontSize: 15, fontWeight: '600', color: '#3E2B22' },
  manualHeaderTitle: {
    position: 'absolute',
    left: 76,
    right: 76,
    textAlign: 'center',
    fontSize: 17,
    fontWeight: '700',
    color: '#3E2B22',
  },
  manualIntroBlock: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 12 },
  manualIntroTitle: { fontSize: 16, fontWeight: '700', color: Colors.foreground, marginBottom: 4 },
  manualIntroSub: { fontSize: 13, color: Colors.mutedFg, lineHeight: 19 },
  chipsScroll: { flexGrow: 0, flexShrink: 0 },
  chipsContent: { paddingHorizontal: 20, paddingVertical: 10, gap: 8, flexDirection: 'row', alignItems: 'center' },
  chip: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 14, paddingVertical: 7,
    borderRadius: 20, borderWidth: 1.5, borderColor: Colors.border,
    backgroundColor: '#fff',
  },
  chipAdded: { borderColor: Colors.primary, backgroundColor: Colors.primaryLight },
  chipText: { fontSize: 13, fontWeight: '600', color: Colors.mutedFg },
  chipTextAdded: { color: Colors.primary },
  kwSection: { paddingHorizontal: 16, paddingTop: 14 },
  kwCategoryLabel: { fontSize: 12, fontWeight: '700', color: Colors.mutedFg, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 },
  kwChipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  kwChip: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 12, paddingVertical: 6,
    borderRadius: 18, borderWidth: 1, borderColor: '#E2E2E2',
    backgroundColor: '#FAFAF9',
  },
  kwChipSelected: { borderColor: Colors.primary, backgroundColor: Colors.primary },
  kwChipText: { fontSize: 13, fontWeight: '500', color: '#555555' },
  kwChipTextSelected: { color: '#fff' },
  memoItemRow: {
    flexDirection: 'row', alignItems: 'flex-start',
    backgroundColor: Colors.primaryLight,
    borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10,
    marginBottom: 6,
  },
  memoItemText: { flex: 1, fontSize: 13, color: Colors.foreground, fontWeight: '600', marginRight: 8 },
  memoItemGoalText: { fontSize: 12, color: Colors.primary, marginTop: 2 },
  stepCard: {
    marginHorizontal: 16, marginTop: 10,
    backgroundColor: '#FFFFFF', borderRadius: 14,
    paddingHorizontal: 14, paddingVertical: 12,
    borderWidth: 1, borderColor: '#EBEBEB',
  },
  stepLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
  stepTitle: { fontSize: 13, fontWeight: '700', color: '#282624', flex: 1 },
  stepOptional: { fontSize: 11, color: Colors.mutedFg, fontWeight: '500' },
  previewAddRow: {
    marginHorizontal: 16, marginTop: 12,
    flexDirection: 'row', alignItems: 'center', gap: 10,
  },
  previewBox: {
    flex: 1,
    backgroundColor: Colors.primaryLight,
    borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10,
    borderWidth: 1, borderColor: Colors.primary,
  },
  previewText: { fontSize: 13, color: Colors.primary, fontWeight: '600', lineHeight: 18 },
  addItemBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 14, paddingVertical: 10,
    borderRadius: 12, backgroundColor: Colors.primary,
  },
  addItemBtnText: { fontSize: 13, fontWeight: '700', color: '#fff' },
  memoToggleRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingVertical: 10,
  },
  memoToggleText: { fontSize: 13, fontWeight: '600', color: Colors.mutedFg },
  memoToggleDesc: { fontSize: 12, color: Colors.mutedFg, marginTop: 4, lineHeight: 17 },
  memoDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: Colors.primary, marginLeft: 2 },
  recentComboChip: {
    paddingHorizontal: 12, paddingVertical: 9,
    borderRadius: 12, borderWidth: 1, borderColor: Colors.border,
    backgroundColor: '#fff', maxWidth: 150, minWidth: 72,
  },
  recentComboTech: { fontSize: 13, fontWeight: '700', color: Colors.foreground },
  recentComboDetail: { fontSize: 11, color: Colors.mutedFg, marginTop: 2 },
  kwChipCustom: { borderStyle: 'dashed' },
  kwAddBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    paddingHorizontal: 10, paddingVertical: 7,
    borderRadius: 18, borderWidth: 1, borderColor: Colors.borderLight,
    borderStyle: 'dashed', backgroundColor: 'transparent',
  },
  kwAddBtnText: { fontSize: 12, fontWeight: '500', color: Colors.mutedFg },
  kwAddInputRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    flex: 1, minWidth: 160,
  },
  kwAddInput: {
    flex: 1, height: 34,
    borderRadius: 10, borderWidth: 1, borderColor: Colors.primary,
    paddingHorizontal: 10, fontSize: 13, color: Colors.foreground,
    backgroundColor: '#fff',
  },
  kwAddConfirmBtn: {
    paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: 8, backgroundColor: Colors.primary,
  },
  kwAddConfirmText: { fontSize: 12, fontWeight: '700', color: '#fff' },
  kwAddCancelBtn: {
    padding: 4,
  },
  inputWrapper: {
    flex: 1,
    marginHorizontal: 16,
    marginBottom: 8,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E9E9E9',
    backgroundColor: '#FFFFFF',
    overflow: 'hidden',
    minHeight: 240,
    maxHeight: 320,
  },
  inputWrapperFocused: {
    borderColor: Colors.primary,
    borderWidth: 1,
  },
  memoInput: {
    flex: 1,
    padding: 14,
    fontSize: 14,
    color: '#282624',
    lineHeight: 22,
    textAlignVertical: 'top',
  },
  charCounter: {
    alignSelf: 'flex-end',
    fontSize: 11,
    color: '#AAAAAA',
    paddingHorizontal: 12,
    paddingBottom: 8,
  },
  manualLoadingOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(247,240,233,0.94)',
    justifyContent: 'center', alignItems: 'center', gap: 14,
    zIndex: 10,
  },
  manualLoadingText: { fontSize: 15, fontWeight: '700', color: Colors.foreground },
  manualLoadingSubText: { fontSize: 13, color: Colors.mutedFg },
  manualBtnRow: {
    flexDirection: 'row', gap: 10,
    paddingHorizontal: 16, paddingVertical: 14,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(62,43,34,0.07)',
    backgroundColor: '#F7F0E9',
  },
  directBtn: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1.5, borderColor: Colors.primary, borderRadius: 14,
    paddingVertical: 13,
  },
  directBtnText: { fontSize: 14, fontWeight: '600', color: Colors.primary },
  aiBtn: {
    flex: 2, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: Colors.primary, borderRadius: 14, paddingVertical: 13,
  },
  aiBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  btnDisabled: { opacity: 0.45 },
  emptyBox: { alignItems: 'center', paddingVertical: 32, gap: 8 },
  emptyText: { fontSize: 15, color: Colors.placeholder, fontWeight: '600' },
  emptySubText: { fontSize: 13, color: Colors.placeholder, textAlign: 'center' },

  // 플랜 카드
  planCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 8,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  planTopRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6,
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
