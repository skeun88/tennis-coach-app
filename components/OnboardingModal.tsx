/**
 * OnboardingModal
 * 첫 로그인 코치를 위한 3단계 온보딩 안내 모달
 * Step 1: 녹음 팁 (에어팟/핀마이크)
 * Step 2: 주요 탭 안내
 * Step 3: 레슨권 등록
 */
import React, { useState } from 'react';
import { Modal, View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../lib/theme';

export interface OnboardingModalProps {
  visible: boolean;
  onRegister: () => void;
  onDismiss: () => void;
}

const TOTAL_STEPS = 4;

const TABS = [
  { icon: 'home-outline' as const, name: '홈', desc: '오늘 레슨 일정 + 회원 현황 한눈에 보기' },
  { icon: 'people-outline' as const, name: '회원', desc: '회원 등록 · 레슨 기록 · 출석 관리' },
  { icon: 'calendar-outline' as const, name: '스케줄', desc: '주간 레슨 일정 달력으로 확인' },
  { icon: 'card-outline' as const, name: '결제', desc: '미납 회원 · 결제 현황 관리' },
];

export default function OnboardingModal({ visible, onRegister, onDismiss }: OnboardingModalProps) {
  const [step, setStep] = useState(0);

  const handleClose = () => {
    setStep(0);
    onDismiss();
  };

  const handleNext = () => {
    if (step < TOTAL_STEPS - 1) {
      setStep(s => s + 1);
    }
  };

  const isLast = step === TOTAL_STEPS - 1;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={handleClose}>
      <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={handleClose}>
        <TouchableOpacity activeOpacity={1} onPress={() => {}} style={styles.sheet}>
          {/* 스텝 인디케이터 */}
          <View style={styles.stepRow}>
            {Array.from({ length: TOTAL_STEPS }).map((_, i) => (
              <View key={i} style={[styles.stepDot, i === step && styles.stepDotActive]} />
            ))}
          </View>

          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
            {step === 0 && <Step1 />}
            {step === 1 && <Step2 />}
            {step === 2 && <Step4 />}
            {step === 3 && <Step3 />}
          </ScrollView>

          {/* 버튼 */}
          <View style={styles.btnArea}>
            {isLast ? (
              <TouchableOpacity style={styles.primaryBtn} onPress={() => { setStep(0); onRegister(); }}>
                <Text style={styles.primaryBtnText}>레슨권 등록하기</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity style={styles.primaryBtn} onPress={handleNext}>
                <Text style={styles.primaryBtnText}>다음</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity style={styles.skipBtn} onPress={handleClose}>
              <Text style={styles.skipBtnText}>{isLast ? '나중에 할게요' : '건너뛰기'}</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

function Step1() {
  return (
    <View style={styles.stepContent}>
      <View style={styles.iconCircle}>
        <Text style={{ fontSize: 40 }}>🎙️</Text>
      </View>
      <Text style={styles.stepTitle}>AI 레슨 리포트{'\n'}지금 바로 시작하세요</Text>
      <Text style={styles.stepSubtitle}>
        별도 장비 없이도 바로 사용할 수 있어요
      </Text>

      <View style={styles.card}>
        {[
          {
            icon: 'headset-outline' as const,
            title: '에어팟 · 이어폰으로 바로 시작',
            desc: '무선 이어폰의 마이크를 활용하면\n음성 인식 품질이 크게 향상돼요',
          },
          {
            icon: 'mic-outline' as const,
            title: '핀마이크로 더 선명하게',
            desc: '옷깃에 부착하는 클립형 핀마이크는\nKERRI 앱을 통해 구매할 수 있어요 (Pro 6개월 혜택)',
          },
          {
            icon: 'time-outline' as const,
            title: '레슨 후 30초만 말해도 충분',
            desc: '오늘 배운 것, 잘된 점, 숙제를\n간단히 말하면 AI가 리포트를 작성해줘요',
          },
        ].map((item, i) => (
          <View key={i} style={[styles.featureRow, i > 0 && styles.featureRowBorder]}>
            <View style={styles.featureIcon}>
              <Ionicons name={item.icon} size={20} color={Colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.featureTitle}>{item.title}</Text>
              <Text style={styles.featureDesc}>{item.desc}</Text>
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}

function Step2() {
  return (
    <View style={styles.stepContent}>
      <View style={styles.iconCircle}>
        <Text style={{ fontSize: 40 }}>📱</Text>
      </View>
      <Text style={styles.stepTitle}>KERRI 주요 기능</Text>
      <Text style={styles.stepSubtitle}>
        하단 탭으로 모든 코칭 업무를 관리하세요
      </Text>

      <View style={styles.card}>
        {TABS.map((tab, i) => (
          <View key={i} style={[styles.featureRow, i > 0 && styles.featureRowBorder]}>
            <View style={styles.tabIconWrap}>
              <Ionicons name={tab.icon} size={22} color={Colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.featureTitle}>{tab.name}</Text>
              <Text style={styles.featureDesc}>{tab.desc}</Text>
            </View>
          </View>
        ))}
      </View>

      <View style={styles.tipBox}>
        <Ionicons name="bulb-outline" size={16} color="#f59e0b" />
        <Text style={styles.tipText}>회원을 등록하면 홈 화면에서 오늘 레슨 현황이 바로 보여요</Text>
      </View>
    </View>
  );
}

function Step4() {
  return (
    <View style={styles.stepContent}>
      <View style={styles.iconCircle}>
        <Text style={{ fontSize: 40 }}>🚫</Text>
      </View>
      <Text style={styles.stepTitle}>레슨 불가 시간을{'\n'}블럭해두세요</Text>
      <Text style={styles.stepSubtitle}>
        회원이 보강 레슨을 신청할 수 있는{'\n'}가능한 시간대를 미리 설정할 수 있어요
      </Text>

      <View style={styles.card}>
        {[
          {
            icon: 'time-outline' as const,
            title: '가용 시간 직접 설정',
            desc: '요일별로 레슨 가능한 시간대를 지정하면\n그 외 시간엔 회원이 신청할 수 없어요',
          },
          {
            icon: 'ban-outline' as const,
            title: '개인 일정은 자동 차단',
            desc: '설정한 시간 외엔 회원 앱에서\n해당 슬롯이 표시되지 않아요',
          },
          {
            icon: 'settings-outline' as const,
            title: '설정 → 레슨 가능 시간',
            desc: '언제든지 수정 가능해요',
          },
        ].map((item, i) => (
          <View key={i} style={[styles.featureRow, i > 0 && styles.featureRowBorder]}>
            <View style={styles.featureIcon}>
              <Ionicons name={item.icon} size={20} color={Colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.featureTitle}>{item.title}</Text>
              <Text style={styles.featureDesc}>{item.desc}</Text>
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}

function Step3() {
  return (
    <View style={styles.stepContent}>
      <View style={styles.iconCircle}>
        <Ionicons name="ticket-outline" size={40} color={Colors.primary} />
      </View>
      <Text style={styles.stepTitle}>레슨권을 먼저{'\n'}등록해주세요</Text>
      <Text style={styles.stepSubtitle}>
        회원 등록 및 출석 관리를 위해{'\n'}레슨권이 필요해요
      </Text>

      <View style={styles.card}>
        <Text style={styles.exampleLabel}>예시</Text>
        {[
          { label: '10회 레슨권', sub: '300,000원 · 60분' },
          { label: '20회 레슨권', sub: '550,000원 · 60분' },
          { label: '체험 레슨', sub: '30,000원 · 30분' },
        ].map((item, i) => (
          <View key={i} style={[styles.featureRow, i > 0 && styles.featureRowBorder]}>
            <View style={styles.featureIcon}>
              <Ionicons name="tennisball-outline" size={18} color={Colors.primary} />
            </View>
            <View>
              <Text style={styles.featureTitle}>{item.label}</Text>
              <Text style={styles.featureDesc}>{item.sub}</Text>
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  sheet: {
    backgroundColor: '#fff',
    borderRadius: 24,
    paddingTop: 24,
    paddingBottom: 28,
    maxHeight: '85%',
  },
  stepRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 20,
  },
  stepDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.border,
  },
  stepDotActive: {
    width: 24,
    backgroundColor: Colors.primary,
  },
  scrollContent: {
    paddingHorizontal: 24,
  },
  stepContent: {
    alignItems: 'center',
  },
  iconCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: Colors.primary + '14',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  stepTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: Colors.foreground,
    textAlign: 'center',
    lineHeight: 28,
    marginBottom: 8,
  },
  stepSubtitle: {
    fontSize: 14,
    color: Colors.mutedFg,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 20,
  },
  card: {
    width: '100%',
    backgroundColor: Colors.background,
    borderRadius: 16,
    padding: 4,
    marginBottom: 12,
  },
  featureRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  featureRowBorder: {
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  featureIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: Colors.primary + '14',
    justifyContent: 'center',
    alignItems: 'center',
  },
  tabIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: Colors.primary + '14',
    justifyContent: 'center',
    alignItems: 'center',
  },
  featureTitle: { fontSize: 14, fontWeight: '700', color: Colors.foreground, marginBottom: 2 },
  featureDesc: { fontSize: 12, color: Colors.mutedFg, lineHeight: 18 },
  tipBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: '#fef3c7',
    borderRadius: 10,
    padding: 12,
    width: '100%',
  },
  tipText: { flex: 1, fontSize: 13, color: '#92400e', lineHeight: 18 },
  exampleLabel: { fontSize: 11, fontWeight: '700', color: Colors.mutedFg, paddingHorizontal: 12, paddingTop: 8, paddingBottom: 4 },
  btnArea: { paddingHorizontal: 20, paddingTop: 16, gap: 8 },
  primaryBtn: {
    backgroundColor: Colors.primary,
    borderRadius: 14,
    paddingVertical: 15,
    alignItems: 'center',
  },
  primaryBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  skipBtn: { paddingVertical: 10, alignItems: 'center' },
  skipBtnText: { color: Colors.mutedFg, fontSize: 14 },
});
