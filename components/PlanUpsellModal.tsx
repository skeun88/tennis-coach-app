/**
 * PlanUpsellModal
 * - Free → Basic 또는 Pro 유도
 * - Basic (AI 한도 초과) → Pro 유도
 * - targetPlan 을 명시하거나 context로 자동 결정
 */
import React from 'react';
import { IS_BETA } from '../lib/beta';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Colors, Radius, Shadow } from '../lib/theme';
import { PlanId, PLANS } from '../lib/subscription';

export type UpsellContext =
  | 'ai_analysis_free'        // Free → AI 쓰려면 Basic 이상
  | 'ai_analysis_limit'       // Basic 월한도 초과 → Pro 유도
  | 'ai_coaching_model'       // Pro 전용
  | 'coaching_stats_public'   // Pro 전용 (코칭 실적 공개)
  | 'tagging'                 // Pro 전용
  | 'operations'              // Free → 운영관리 쓰려면 Basic 이상
  | 'member_limit'            // Free 회원 3명 초과 → Basic 이상
  | 'generic_pro';            // 기타 Pro 전용

export interface PlanUpsellModalProps {
  visible: boolean;
  onClose: () => void;
  context: UpsellContext;
  /** 현재 플랜 (없으면 free로 간주) */
  currentPlanId?: PlanId | null;
  /** 추가 설명 (없으면 context에서 자동 생성) */
  featureDesc?: string;
  /** AI 분석 사용량 표시용 */
  usageInfo?: { used: number; limit: number };
}

// context별 UI 설정
const CONTEXT_CONFIG: Record<UpsellContext, {
  icon: string;
  title: string;
  featureName: string;
  targetPlan: 'basic' | 'pro';
  features: Array<{ icon: string; label: string }>;
}> = {
  ai_analysis_free: {
    icon: 'mic',
    title: 'AI 레슨 분석',
    featureName: 'AI 레슨 분석',
    targetPlan: 'basic',
    features: [
      { icon: 'mic', label: 'AI 레슨 기록 (Free: 월 3개, Basic: 월 10개, Pro: 월 50개)' },
      { icon: 'document-text', label: '범용 AI 리포트' },
      { icon: 'people', label: '회원 알림 · 운영 관리' },
    ],
  },
  ai_analysis_limit: {
    icon: 'mic',
    title: 'AI 분석 월 한도 초과',
    featureName: 'AI 레슨 분석 무제한',
    targetPlan: 'pro',
    features: [
      { icon: 'mic', label: 'AI 레슨 분석 월 50개' },
      { icon: 'bulb', label: '개인화 AI 코칭 모델 (음성 기반)' },
      { icon: 'bar-chart', label: '코칭 데이터 분석 · 패턴 태그' },
      { icon: 'ribbon', label: 'KERRI 검증 배지 · 코칭 실적 공개' },
    ],
  },
  ai_coaching_model: {
    icon: 'bulb',
    title: 'AI 코칭 모델',
    featureName: 'AI 코칭 모델',
    targetPlan: 'pro',
    features: [
      { icon: 'bulb', label: '음성 기반 코칭 스타일 학습' },
      { icon: 'mic', label: 'AI 레슨 분석 월 50개' },
      { icon: 'bar-chart', label: '기술별 패턴 분석 · 회원 변화 추적' },
      { icon: 'ribbon', label: 'KERRI 검증 배지' },
    ],
  },
  coaching_stats_public: {
    icon: 'ribbon',
    title: '코칭 실적 공개',
    featureName: '코칭 실적 공개 + KERRI 검증',
    targetPlan: 'pro',
    features: [
      { icon: 'ribbon', label: 'KERRI 검증 배지 · 4대 지표 공개' },
      { icon: 'bulb', label: 'AI 코칭 모델' },
      { icon: 'mic', label: 'AI 레슨 분석 월 50개' },
    ],
  },
  tagging: {
    icon: 'pricetag',
    title: '코칭 데이터 분석',
    featureName: '반복 이슈 태그 · 패턴 분석',
    targetPlan: 'pro',
    features: [
      { icon: 'pricetag', label: '반복 이슈 태그 · 기술별 패턴 분석' },
      { icon: 'trending-up', label: '회원 변화 추적' },
      { icon: 'mic', label: 'AI 레슨 분석 월 50개' },
    ],
  },
  operations: {
    icon: 'grid',
    title: '운영 관리',
    featureName: '미납 · 이탈 · 재등록 관리',
    targetPlan: 'basic',
    features: [
      { icon: 'grid', label: '미납 · 만료 · 이탈 위험 · 재등록 관리' },
      { icon: 'notifications', label: '레슨 리마인드 · 재등록 알림' },
      { icon: 'mic', label: 'AI 레슨 분석 월 10회' },
    ],
  },
  member_limit: {
    icon: 'people',
    title: '회원 추가',
    featureName: '회원 무제한 등록',
    targetPlan: 'basic',
    features: [
      { icon: 'people', label: '회원 무제한 등록' },
      { icon: 'grid', label: '운영 관리 · 회원 알림' },
      { icon: 'mic', label: 'AI 레슨 분석 월 10회' },
    ],
  },
  generic_pro: {
    icon: 'star',
    title: 'Pro 전용 기능',
    featureName: 'Pro 플랜 전용',
    targetPlan: 'pro',
    features: [
      { icon: 'mic', label: 'AI 레슨 분석 월 50개' },
      { icon: 'bulb', label: 'AI 코칭 모델' },
      { icon: 'ribbon', label: 'KERRI 검증 배지' },
      { icon: 'bar-chart', label: '코칭 데이터 분석 · 태그' },
    ],
  },
};

const PLAN_COLOR: Record<'basic' | 'pro', string> = {
  basic: '#4A90D9',
  pro: '#8B5CF6',
};

export default function PlanUpsellModal({
  visible,
  onClose,
  context,
  currentPlanId,
  featureDesc,
  usageInfo,
}: PlanUpsellModalProps) {
  if (IS_BETA) return null;

  const router = useRouter();
  const cfg = CONTEXT_CONFIG[context];
  const planColor = PLAN_COLOR[cfg.targetPlan];
  const targetPlanLabel = cfg.targetPlan === 'pro' ? 'Pro' : 'Basic';
  const targetPrice = PLANS[cfg.targetPlan].price.toLocaleString();

  const defaultDesc = () => {
    if (context === 'ai_analysis_limit' && usageInfo) {
      return `이번 달 AI 분석을 ${usageInfo.used}/${usageInfo.limit}회 사용했어요.\nBasic 10회 초과 시 Pro로 업그레이드하면 월 50개까지 사용할 수 있어요.`;
    }
    if (context === 'member_limit') {
      return `Free 플랜은 회원 3명까지 등록할 수 있어요.\nBasic 이상으로 업그레이드하면 무제한 등록이 가능해요.`;
    }
    if (cfg.targetPlan === 'basic') {
      return `${cfg.featureName}은 Basic 플랜부터 사용할 수 있어요.\nBasic으로 업그레이드하고 바로 시작해보세요.`;
    }
    return `${cfg.featureName}은 Pro 플랜 전용 기능이에요.\nPro로 업그레이드하고 모든 기능을 활용해보세요.`;
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <SafeAreaView style={styles.container}>
        <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
          <Ionicons name="close" size={24} color={Colors.foreground} />
        </TouchableOpacity>

        <View style={styles.content}>
          {/* 아이콘 */}
          <View style={[styles.iconWrap, { backgroundColor: planColor + '20' }]}>
            <Ionicons name={cfg.icon as any} size={40} color={planColor} />
          </View>

          {/* 플랜 배지 */}
          <View style={[styles.planBadge, { backgroundColor: planColor }]}>
            <Text style={styles.planBadgeText}>
              {targetPlanLabel} {targetPrice}원/월
            </Text>
          </View>

          <Text style={styles.title}>{cfg.title}</Text>

          {/* 사용량 바 (한도 초과 맥락) */}
          {context === 'ai_analysis_limit' && usageInfo && (
            <View style={styles.usageBar}>
              <View style={styles.usageBarTrack}>
                <View style={[styles.usageBarFill, { width: '100%', backgroundColor: '#e74c3c' }]} />
              </View>
              <Text style={styles.usageBarLabel}>
                이번 달 {usageInfo.used}/{usageInfo.limit}회 사용 완료
              </Text>
            </View>
          )}

          <Text style={styles.desc}>{featureDesc ?? defaultDesc()}</Text>

          {/* 포함 기능 목록 */}
          <View style={styles.featureList}>
            <Text style={[styles.featureListHeader, { color: planColor }]}>
              {targetPlanLabel} 플랜 포함
            </Text>
            {cfg.features.map((f) => (
              <View key={f.label} style={styles.featureRow}>
                <Ionicons name={f.icon as any} size={16} color={planColor} />
                <Text style={styles.featureRowText}>{f.label}</Text>
              </View>
            ))}
          </View>

          {/* 업그레이드 버튼 */}
          <TouchableOpacity
            style={[styles.upgradeBtn, { backgroundColor: planColor }]}
            onPress={() => {
              onClose();
              router.push('/subscription/select-plan');
            }}
          >
            <Ionicons name="star" size={18} color="#fff" />
            <Text style={styles.upgradeBtnText}>
              {currentPlanId && currentPlanId !== 'free'
                ? `${targetPlanLabel}로 업그레이드`
                : `${targetPlanLabel} 플랜 시작하기`}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.cancelBtn} onPress={onClose}>
            <Text style={styles.cancelText}>지금은 괜찮아요</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  closeBtn: {
    position: 'absolute', top: 16, right: 16, zIndex: 10,
    padding: 8, borderRadius: Radius.full, backgroundColor: Colors.mutedBg,
  },
  content: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 32, paddingBottom: 40,
  },
  iconWrap: {
    width: 80, height: 80, borderRadius: 40,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 16, ...Shadow.md,
  },
  planBadge: {
    borderRadius: Radius.full,
    paddingHorizontal: 14, paddingVertical: 4,
    marginBottom: 16,
  },
  planBadgeText: { color: '#fff', fontSize: 13, fontWeight: '800' },
  title: {
    fontSize: 22, fontWeight: '800', color: Colors.navy,
    textAlign: 'center', marginBottom: 12,
  },
  usageBar: { width: '100%', marginBottom: 12 },
  usageBarTrack: {
    height: 6, backgroundColor: '#f0f0f0', borderRadius: 3, overflow: 'hidden', marginBottom: 4,
  },
  usageBarFill: { height: '100%', borderRadius: 3 },
  usageBarLabel: { fontSize: 12, color: '#e74c3c', fontWeight: '600', textAlign: 'center' },
  desc: {
    fontSize: 14, color: Colors.mutedFg,
    textAlign: 'center', lineHeight: 22, marginBottom: 24,
  },
  featureList: {
    width: '100%', backgroundColor: Colors.white,
    borderRadius: Radius.lg, padding: 16, gap: 10,
    marginBottom: 24, ...Shadow.sm,
  },
  featureListHeader: { fontSize: 12, fontWeight: '800', marginBottom: 4 },
  featureRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  featureRowText: { fontSize: 14, color: Colors.foreground, fontWeight: '500', flex: 1 },
  upgradeBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    borderRadius: Radius.lg, paddingVertical: 16,
    width: '100%', marginBottom: 12, ...Shadow.md,
  },
  upgradeBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  cancelBtn: { paddingVertical: 12 },
  cancelText: { color: Colors.mutedFg, fontSize: 14 },
});
