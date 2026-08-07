/**
 * ClipRecorderModal
 * Pro 6개월 선결제 선택 시 표시되는 클립형 녹음기 안내 모달
 *
 * 녹음기 실물 사진 추가 방법:
 *   1. 사진 파일을 assets/images/clip-recorder.jpg 에 복사
 *   2. imagePlaceholder View 를 아래 Image 로 교체:
 *      <Image source={require('../assets/images/clip-recorder.jpg')} style={styles.productImage} resizeMode="contain" />
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

const FEATURES = [
  { icon: 'mic' as const, text: '옷깃·모자에 클립으로 간편 부착' },
  { icon: 'volume-high' as const, text: '스마트폰 대비 훨씬 선명한 음질' },
  { icon: 'sparkles' as const, text: 'AI 레슨 분석 정확도 대폭 향상' },
  { icon: 'gift' as const, text: '시중가 ₩30,000 상당 — 무상 제공' },
];

export default function ClipRecorderModal({
  visible,
  onClose,
  onConfirm,
}: ClipRecorderModalProps) {
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={onClose}>
        <TouchableOpacity activeOpacity={1} onPress={() => {}} style={styles.sheet}>
          <View style={styles.handle} />

          {/* 제품 이미지 영역 — 실물 사진으로 교체 가능 */}
          <View style={styles.imageWrap}>
            <View style={styles.imagePlaceholder}>
              <Text style={styles.recorderEmoji}>🎙️</Text>
              <Text style={styles.placeholderLabel}>클립형 녹음기</Text>
            </View>
            <View style={styles.freeTag}>
              <Text style={styles.freeTagText}>무상 제공</Text>
            </View>
          </View>

          <ScrollView showsVerticalScrollIndicator={false}>
            <Text style={styles.title}>레슨 품질을 높이는{'\n'}나만의 전용 녹음기</Text>
            <Text style={styles.subtitle}>
              6개월 선결제 코치님께 드리는 특별 선물 — AI 분석 퀄리티가 달라집니다
            </Text>

            {/* 기능 목록 */}
            <View style={styles.featureList}>
              {FEATURES.map((f, i) => (
                <View key={i} style={styles.featureRow}>
                  <View style={styles.featureIconWrap}>
                    <Ionicons name={f.icon} size={16} color="#9b59b6" />
                  </View>
                  <Text style={styles.featureText}>{f.text}</Text>
                </View>
              ))}
            </View>

            {/* 가격 비교 */}
            <View style={styles.priceBox}>
              <View style={styles.priceRow}>
                <Text style={styles.priceOldLabel}>일반 구매가</Text>
                <Text style={styles.priceOld}>₩30,000</Text>
              </View>
              <View style={styles.priceDivider} />
              <View style={styles.priceRow}>
                <Text style={styles.priceFreeLabel}>6개월 선결제 시</Text>
                <View style={styles.freeBadge}>
                  <Text style={styles.freeBadgeText}>₩0  무료</Text>
                </View>
              </View>
            </View>

            <Text style={styles.note}>
              * 가입 완료 후 배송지 입력 화면으로 안내됩니다
            </Text>

            {/* CTA */}
            <TouchableOpacity style={styles.confirmBtn} onPress={onConfirm} activeOpacity={0.85}>
              <Ionicons name="gift" size={18} color="#fff" />
              <Text style={styles.confirmBtnText}>6개월 선결제로 녹음기 받기</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.cancelBtn} onPress={onClose}>
              <Text style={styles.cancelBtnText}>결제 방식 직접 선택</Text>
            </TouchableOpacity>
          </ScrollView>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingTop: 16,
    paddingHorizontal: 24,
    paddingBottom: 40,
    maxHeight: '90%',
  },
  handle: {
    width: 40,
    height: 4,
    backgroundColor: '#e0e0e0',
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 16,
  },
  imageWrap: {
    width: '100%',
    height: 200,
    backgroundColor: '#f5f0fa',
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 24,
    overflow: 'hidden',
    position: 'relative',
  },
  productImage: {
    width: '100%',
    height: '100%',
  },
  imagePlaceholder: {
    alignItems: 'center',
    gap: 10,
  },
  recorderEmoji: { fontSize: 72 },
  placeholderLabel: {
    fontSize: 13,
    color: '#9b59b6',
    fontWeight: '600',
    backgroundColor: 'rgba(155,89,182,0.12)',
    paddingHorizontal: 14,
    paddingVertical: 5,
    borderRadius: 20,
  },
  freeTag: {
    position: 'absolute',
    top: 14,
    right: 14,
    backgroundColor: '#9b59b6',
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  freeTagText: { color: '#fff', fontSize: 12, fontWeight: '800' },
  title: {
    fontSize: 22,
    fontWeight: '800',
    color: '#1a1a2e',
    textAlign: 'center',
    lineHeight: 30,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 13,
    color: '#888',
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 20,
  },
  featureList: {
    backgroundColor: '#faf8ff',
    borderRadius: 16,
    padding: 16,
    gap: 12,
    marginBottom: 16,
  },
  featureRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  featureIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: 'rgba(155,89,182,0.12)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  featureText: { flex: 1, fontSize: 14, color: '#333', lineHeight: 20 },
  priceBox: {
    backgroundColor: '#f5f0fa',
    borderRadius: 14,
    padding: 16,
    gap: 10,
    marginBottom: 10,
  },
  priceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  priceDivider: { height: 1, backgroundColor: 'rgba(155,89,182,0.15)' },
  priceOldLabel: { fontSize: 13, color: '#999' },
  priceOld: { fontSize: 15, color: '#bbb', textDecorationLine: 'line-through' },
  priceFreeLabel: { fontSize: 14, color: '#9b59b6', fontWeight: '700' },
  freeBadge: {
    backgroundColor: '#9b59b6',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  freeBadgeText: { color: '#fff', fontSize: 14, fontWeight: '800' },
  note: {
    fontSize: 11,
    color: '#bbb',
    textAlign: 'center',
    marginBottom: 20,
  },
  confirmBtn: {
    backgroundColor: '#9b59b6',
    borderRadius: 16,
    padding: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 10,
  },
  confirmBtnText: { color: '#fff', fontSize: 16, fontWeight: '800' },
  cancelBtn: { alignItems: 'center', padding: 12 },
  cancelBtnText: { color: '#bbb', fontSize: 14 },
});
