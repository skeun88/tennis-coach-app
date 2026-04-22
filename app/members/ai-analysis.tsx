import { useEffect, useState, useRef } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Alert, ActivityIndicator, Platform, Animated,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAudioRecorder, AudioModule, RecordingPresets, setAudioModeAsync } from 'expo-audio';
import { supabase } from '../../lib/supabase';
import { LessonPlan, DrillSuggestion } from '../../types';

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;

const ANALYSIS_STEPS = [
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

  const audioRecorder = useAudioRecorder({
    ...RecordingPresets.HIGH_QUALITY,
    isMeteringEnabled: false,
  });
  const [isRecording, setIsRecording] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisStep, setAnalysisStep] = useState(0); // 0 = 대기, 1~4 = 진행중
  const [plans, setPlans] = useState<LessonPlan[]>([]);
  const [expandedPlan, setExpandedPlan] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    loadPlans();
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, []);

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

  async function loadPlans() {
    const { data } = await supabase
      .from('lesson_plans')
      .select('*')
      .eq('member_id', memberId)
      .order('created_at', { ascending: false })
      .limit(10);
    setPlans(data ?? []);
    setLoading(false);
  }

  async function startRecording() {
    try {
      const status = await AudioModule.requestRecordingPermissionsAsync();
      if (!status.granted) {
        Alert.alert('권한 필요', '마이크 권한이 필요합니다.');
        return;
      }
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await audioRecorder.prepareToRecordAsync(RecordingPresets.HIGH_QUALITY);
      audioRecorder.record();
      setIsRecording(true);
      setRecordingDuration(0);
      timerRef.current = setInterval(() => setRecordingDuration(d => d + 1), 1000);
    } catch (e: any) {
      Alert.alert('오류', `녹음을 시작할 수 없습니다.\n${e?.message ?? ''}`);
    }
  }

  async function stopAndAnalyze() {
    if (!isRecording) return;
    if (timerRef.current) clearInterval(timerRef.current);
    setIsRecording(false);
    setIsAnalyzing(true);
    setAnalysisStep(1);

    try {
      await audioRecorder.stop();
      const uri = audioRecorder.uri;
      if (!uri) throw new Error('녹음 파일을 찾을 수 없습니다.');

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('로그인이 필요합니다.');

      const formData = new FormData();
      formData.append('audio', { uri, type: 'audio/m4a', name: 'lesson.m4a' } as any);
      formData.append('member_id', memberId);
      formData.append('coach_id', user.id);

      // SSE 스트리밍 요청
      const res = await fetch(`${SUPABASE_URL}/functions/v1/process-lesson`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
          'Accept': 'text/event-stream',
        },
        body: formData,
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || '분석에 실패했습니다.');
      }

      // SSE 스트림 파싱
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let finalResult: any = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const evt = JSON.parse(line.slice(6));
            if (evt.type === 'progress') {
              setAnalysisStep(evt.step);
            } else if (evt.type === 'done') {
              finalResult = evt;
            } else if (evt.type === 'error') {
              throw new Error(evt.error);
            }
          } catch (parseErr: any) {
            if (parseErr.message && !parseErr.message.includes('JSON')) throw parseErr;
          }
        }
      }

      // SSE 미지원 fallback: 일반 JSON 응답
      if (!finalResult) {
        const fallbackRes = await fetch(`${SUPABASE_URL}/functions/v1/process-lesson`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` },
          body: formData,
        });
        finalResult = await fallbackRes.json();
        if (!fallbackRes.ok || finalResult.error) throw new Error(finalResult.error || '분석 실패');
      }

      await loadPlans();
      if (finalResult.plan?.id) setExpandedPlan(finalResult.plan.id);
      Alert.alert('완료', 'AI 레슨 분석이 완료됐습니다! 🎾');

    } catch (e: any) {
      Alert.alert('오류', e.message || '분석 중 오류가 발생했습니다.');
    } finally {
      setIsAnalyzing(false);
      setAnalysisStep(0);
    }
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
        <ActivityIndicator size="large" color="#1a7a4a" />
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

        {/* 분석 기록 */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>📋 AI 분석 기록</Text>

          {loading && <ActivityIndicator color="#1a7a4a" style={{ marginTop: 20 }} />}

          {!loading && plans.length === 0 && (
            <View style={styles.emptyBox}>
              <Ionicons name="analytics-outline" size={40} color="#ccc" />
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
                    {plan.summary || '분석 결과를 확인하세요'}
                  </Text>
                </View>
                <Ionicons
                  name={expandedPlan === plan.id ? 'chevron-up' : 'chevron-down'}
                  size={20}
                  color="#888"
                />
              </View>

              {/* 확장 상세 */}
              {expandedPlan === plan.id && (
                <View style={styles.planDetail}>
                  <View style={styles.divider} />

                  {plan.summary ? (
                    <View style={styles.planSection}>
                      <Text style={styles.planSectionTitle}>📌 오늘 레슨 요약</Text>
                      <Text style={styles.planSectionContent}>{plan.summary}</Text>
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
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f7fa' },
  header: {
    backgroundColor: '#1a7a4a',
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
  recordTitle: { fontSize: 17, fontWeight: '800', color: '#1a1a1a', marginBottom: 8 },
  recordDesc: { fontSize: 13, color: '#666', lineHeight: 20, marginBottom: 20 },

  // 분석 진행 상태
  analyzingBox: { alignItems: 'center', paddingVertical: 20, gap: 10 },
  analyzingText: { fontSize: 16, fontWeight: '700', color: '#1a7a4a' },
  analyzingSubText: { fontSize: 12, color: '#aaa' },
  stepDots: { flexDirection: 'row', gap: 8, marginTop: 4 },
  stepDot: {
    width: 8, height: 8, borderRadius: 4, backgroundColor: '#e0e0e0',
  },
  stepDotActive: { backgroundColor: '#a8d5b5' },
  stepDotCurrent: { backgroundColor: '#1a7a4a', width: 20, borderRadius: 4 },

  // 녹음 컨트롤
  recordControls: { alignItems: 'center', gap: 12 },
  durationBox: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  recordingDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#ef4444' },
  durationText: { fontSize: 24, fontWeight: '800', color: '#1a1a1a', letterSpacing: 2 },
  recordBtn: {
    width: 100, height: 100, borderRadius: 50,
    backgroundColor: '#1a7a4a',
    justifyContent: 'center', alignItems: 'center',
    shadowColor: '#1a7a4a', shadowOpacity: 0.3, shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 }, elevation: 6, gap: 4,
  },
  recordBtnActive: { backgroundColor: '#ef4444', shadowColor: '#ef4444' },
  recordBtnText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  recordHint: { fontSize: 12, color: '#888', textAlign: 'center', maxWidth: 240 },

  // 분석 기록
  section: { paddingHorizontal: 16 },
  sectionTitle: { fontSize: 16, fontWeight: '800', color: '#1a1a1a', marginBottom: 12 },
  emptyBox: { alignItems: 'center', paddingVertical: 32, gap: 8 },
  emptyText: { fontSize: 15, color: '#aaa', fontWeight: '600' },
  emptySubText: { fontSize: 13, color: '#bbb', textAlign: 'center' },

  // 플랜 카드
  planCard: {
    backgroundColor: '#fff', borderRadius: 12, padding: 16, marginBottom: 10,
    shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 }, elevation: 2,
  },
  planHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 },
  planMeta: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' },
  planDate: { fontSize: 12, color: '#888' },
  planDuration: { fontSize: 12, color: '#aaa' },
  courtBadge: {
    backgroundColor: '#e8f5ee', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2,
  },
  courtBadgeText: { fontSize: 11, color: '#1a7a4a', fontWeight: '700' },
  planPreview: { fontSize: 14, color: '#333', lineHeight: 20 },
  planDetail: { marginTop: 4 },
  divider: { height: 1, backgroundColor: '#f0f0f0', marginVertical: 12 },
  planSection: { marginBottom: 16 },
  planSectionTitle: { fontSize: 13, fontWeight: '800', color: '#1a1a1a', marginBottom: 8 },
  planSectionContent: { fontSize: 14, color: '#444', lineHeight: 22 },

  // Bullet list
  bulletRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 6 },
  bulletIcon: { fontSize: 14, color: '#1a7a4a', marginTop: 3, width: 14 },
  bulletText: { fontSize: 14, color: '#444', lineHeight: 22, flex: 1 },

  // 드릴 카드
  drillCard: {
    backgroundColor: '#f8fdf9',
    borderRadius: 10,
    borderLeftWidth: 3,
    borderLeftColor: '#1a7a4a',
    marginBottom: 10,
    overflow: 'hidden',
  },
  drillHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 12, paddingTop: 12, paddingBottom: 8,
  },
  drillIndex: {
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: '#1a7a4a', justifyContent: 'center', alignItems: 'center',
  },
  drillIndexText: { fontSize: 11, fontWeight: '800', color: '#fff' },
  drillName: { fontSize: 14, fontWeight: '800', color: '#1a1a1a', flex: 1 },
  drillBody: { paddingHorizontal: 12, paddingBottom: 12, gap: 4 },
  drillRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  drillLabel: {
    fontSize: 12, fontWeight: '700', color: '#1a7a4a',
    width: 60, marginTop: 2, flexShrink: 0,
  },
  drillValue: { fontSize: 13, color: '#444', lineHeight: 20, flex: 1 },
});
