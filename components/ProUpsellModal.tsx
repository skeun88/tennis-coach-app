import React from 'react';
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

interface ProUpsellModalProps {
  visible: boolean;
  onClose: () => void;
  /** 기능명 (예: 'AI 레슨 분석') */
  featureTitle: string;
  /** 부연 설명 (선택) */
  featureDesc?: string;
}

const PRO_FEATURES = [
  { icon: 'mic', label: 'AI 음성 레슨 분석' },
  { icon: 'bulb', label: 'AI 코칭 모델 개발' },
  { icon: 'document-text', label: '레포트 생성 및 회원 제공' },
  { icon: 'pricetag', label: '회원 태깅 & 분류' },
];

export default function ProUpsellModal({
  visible,
  onClose,
  featureTitle,
  featureDesc,
}: ProUpsellModalProps) {
  const router = useRouter();

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <SafeAreaView style={styles.container}>
        {/* 닫기 버튼 */}
        <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
          <Ionicons name="close" size={24} color={Colors.foreground} />
        </TouchableOpacity>

        <View style={styles.content}>
          {/* 자물쇠 아이콘 */}
          <View style={styles.lockWrap}>
            <Ionicons name="lock-closed" size={40} color="#8B5CF6" />
          </View>

          {/* Pro 뱃지 */}
          <View style={styles.proBadge}>
            <Text style={styles.proBadgeText}>PRO</Text>
          </View>

          <Text style={styles.title}>Pro 플랜 전용 기능</Text>
          <Text style={styles.featureName}>{featureTitle}</Text>
          <Text style={styles.desc}>
            {featureDesc ??
              `${featureTitle}은 Pro 플랜에서만 사용할 수 있어요.\nPro로 업그레이드하고 모든 기능을 활용해보세요!`}
          </Text>

          {/* Pro 포함 기능 목록 */}
          <View style={styles.featureList}>
            {PRO_FEATURES.map((f) => (
              <View key={f.label} style={styles.featureRow}>
                <Ionicons name={f.icon as any} size={18} color="#8B5CF6" />
                <Text style={styles.featureRowText}>{f.label}</Text>
              </View>
            ))}
          </View>

          {/* 업그레이드 버튼 */}
          <TouchableOpacity
            style={styles.upgradeBtn}
            onPress={() => {
              onClose();
              router.push('/subscription/select-plan');
            }}
          >
            <Ionicons name="star" size={18} color="#fff" />
            <Text style={styles.upgradeBtnText}>Pro로 업그레이드</Text>
          </TouchableOpacity>

          {/* 닫기 텍스트 버튼 */}
          <TouchableOpacity style={styles.cancelBtn} onPress={onClose}>
            <Text style={styles.cancelText}>지금은 괜찮아요</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  closeBtn: {
    position: 'absolute',
    top: 16,
    right: 16,
    zIndex: 10,
    padding: 8,
    borderRadius: Radius.full,
    backgroundColor: Colors.mutedBg,
  },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    paddingBottom: 40,
  },
  lockWrap: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#F3E8FF',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
    ...Shadow.md,
  },
  proBadge: {
    backgroundColor: '#8B5CF6',
    borderRadius: Radius.full,
    paddingHorizontal: 14,
    paddingVertical: 4,
    marginBottom: 16,
  },
  proBadgeText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 2,
  },
  title: {
    fontSize: 22,
    fontWeight: '800',
    color: Colors.navy,
    textAlign: 'center',
    marginBottom: 6,
  },
  featureName: {
    fontSize: 16,
    fontWeight: '700',
    color: '#8B5CF6',
    textAlign: 'center',
    marginBottom: 12,
  },
  desc: {
    fontSize: 14,
    color: Colors.mutedFg,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 28,
  },
  featureList: {
    width: '100%',
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    padding: 16,
    gap: 12,
    marginBottom: 28,
    ...Shadow.sm,
  },
  featureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  featureRowText: {
    fontSize: 14,
    color: Colors.foreground,
    fontWeight: '500',
  },
  upgradeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#8B5CF6',
    borderRadius: Radius.lg,
    paddingVertical: 16,
    width: '100%',
    marginBottom: 12,
    ...Shadow.md,
  },
  upgradeBtnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  cancelBtn: {
    paddingVertical: 12,
  },
  cancelText: {
    color: Colors.mutedFg,
    fontSize: 14,
  },
});
