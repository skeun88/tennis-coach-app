/**
 * ClipRecorderModal
 * Pro 6개월 선결제 선택 시 표시되는 클립형 녹음기 안내 모달
 */
import React from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

export interface ClipRecorderModalProps {
  visible: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

export default function ClipRecorderModal({
  visible,
  onClose,
  onConfirm,
}: ClipRecorderModalProps) {
  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <View style={styles.handle} />

          <ScrollView showsVerticalScrollIndicator={false}>
            {/* 아이콘 */}
            <View style={styles.iconWrap}>
              <Text style={styles.iconEmoji}>📎</Text>
            </View>

            <Text style={styles.title}>클립형 녹음기란?</Text>
            <Text style={styles.subtitle}>
              레슨 중 AI 분석 퀄리티를 높이는 전용 녹음기예요.
            </Text>

            {/* 기능 목록 */}
            <View style={styles.featureList}>
              <View style={styles.featureRow}>
                <Ionicons name="checkmark-circle" size={20} color="#9b59b6" />
                <Text style={styles.featureText}>옷깃/모자에 클립으로 부착</Text>
              </View>
              <View style={styles.featureRow}>
                <Ionicons name="checkmark-circle" size={20} color="#9b59b6" />
                <Text style={styles.featureText}>고음질 레슨 음성 포착</Text>
              </View>
              <View style={styles.featureRow}>
                <Ionicons name="checkmark-circle" size={20} color="#9b59b6" />
                <Text style={styles.featureText}>
                  스마트폰 마이크 대비 훨씬 선명한 녹음
                </Text>
              </View>
              <View style={styles.featureRow}>
                <Ionicons name="checkmark-circle" size={20} color="#9b59b6" />
                <Text style={styles.featureText}>
                  약 3만 원 상당 무상 제공 (6개월 선결제 한정)
                </Text>
              </View>
            </View>

            {/* 가격 정보 */}
            <View style={styles.priceBox}>
              <View style={styles.priceRow}>
                <Text style={styles.priceLabel}>시중가</Text>
                <Text style={styles.priceOriginal}>₩30,000</Text>
              </View>
              <View style={styles.priceRow}>
                <Text style={styles.priceFreeLabel}>6개월 선결제 시</Text>
                <View style={styles.freeBadge}>
                  <Text style={styles.freeBadgeText}>무상 제공</Text>
                </View>
              </View>
            </View>

            <Text style={styles.note}>
              * 가입 완료 후 배송지 입력 화면이 안내됩니다.
            </Text>

            {/* 버튼 */}
            <TouchableOpacity style={styles.confirmBtn} onPress={onConfirm}>
              <Text style={styles.confirmBtnText}>6개월 선결제로 시작하기</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.cancelBtn} onPress={onClose}>
              <Text style={styles.cancelBtnText}>나중에 볼게요</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    paddingBottom: 40,
    maxHeight: '85%',
  },
  handle: {
    width: 40,
    height: 4,
    backgroundColor: '#e0e0e0',
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 24,
  },
  iconWrap: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#f5f0fa',
    justifyContent: 'center',
    alignItems: 'center',
    alignSelf: 'center',
    marginBottom: 16,
  },
  iconEmoji: { fontSize: 36 },
  title: {
    fontSize: 22,
    fontWeight: '800',
    color: '#1a1a2e',
    textAlign: 'center',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 24,
  },
  featureList: {
    backgroundColor: '#f8f9fa',
    borderRadius: 14,
    padding: 16,
    gap: 12,
    marginBottom: 16,
  },
  featureRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  featureText: {
    flex: 1,
    fontSize: 14,
    color: '#333',
    lineHeight: 20,
  },
  priceBox: {
    backgroundColor: '#f5f0fa',
    borderRadius: 12,
    padding: 14,
    gap: 8,
    marginBottom: 12,
  },
  priceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  priceLabel: { fontSize: 13, color: '#888', width: 80 },
  priceOriginal: {
    fontSize: 15,
    color: '#aaa',
    textDecorationLine: 'line-through',
  },
  priceFreeLabel: { fontSize: 13, color: '#9b59b6', width: 80, fontWeight: '600' },
  freeBadge: {
    backgroundColor: '#9b59b6',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  freeBadgeText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  note: {
    fontSize: 12,
    color: '#aaa',
    textAlign: 'center',
    marginBottom: 24,
    lineHeight: 18,
  },
  confirmBtn: {
    backgroundColor: '#9b59b6',
    borderRadius: 14,
    padding: 18,
    alignItems: 'center',
    marginBottom: 10,
  },
  confirmBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  cancelBtn: { alignItems: 'center', padding: 12 },
  cancelBtnText: { color: '#888', fontSize: 14 },
});
