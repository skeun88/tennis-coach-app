import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Colors } from '../lib/theme';

interface Props {
  used: number;
  limit: number;
  extraCredits?: number;
  onTopupPress?: () => void;
}

export default function ReportQuotaBar({ used, limit, extraCredits = 0, onTopupPress }: Props) {
  const ratio = limit > 0 ? Math.min(used / limit, 1) : 1;
  const remaining = Math.max(limit - used, 0);
  const isWarning = ratio >= 0.8;
  const isExhausted = used >= limit;

  return (
    <View style={styles.container}>
      {/* 진행바 */}
      <View style={styles.barTrack}>
        <View
          style={[
            styles.barFill,
            { width: `${ratio * 100}%` },
            isWarning && styles.barWarning,
            isExhausted && styles.barExhausted,
          ]}
        />
      </View>

      {/* 수치 표시 */}
      <View style={styles.row}>
        <Text style={styles.usageText}>
          {used} / {limit} 사용
          {extraCredits > 0 ? (
            <Text style={styles.extraText}>  +{extraCredits}개 추가</Text>
          ) : null}
        </Text>
        {isExhausted ? (
          <Text style={[styles.remainingText, styles.exhaustedText]}>소진됨</Text>
        ) : (
          <Text style={[styles.remainingText, isWarning && styles.warningText]}>
            남은 리포트 {remaining}개
          </Text>
        )}
      </View>

      {/* 80% 경고 배너 */}
      {isWarning && !isExhausted && onTopupPress && (
        <TouchableOpacity style={styles.warningBanner} onPress={onTopupPress} activeOpacity={0.8}>
          <Text style={styles.warningBannerText}>
            이번 달 AI 리포트가 거의 소진되었습니다. 남은 {remaining}개{'  '}
            <Text style={styles.warningBannerLink}>추가 충전 →</Text>
          </Text>
        </TouchableOpacity>
      )}

      {/* 소진 배너 */}
      {isExhausted && onTopupPress && extraCredits === 0 && (
        <TouchableOpacity style={styles.exhaustedBanner} onPress={onTopupPress} activeOpacity={0.8}>
          <Text style={styles.exhaustedBannerText}>
            이번 달 리포트를 모두 사용했어요.{'  '}
            <Text style={styles.exhaustedBannerLink}>추가 충전 →</Text>
          </Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 6 },
  barTrack: {
    height: 6,
    backgroundColor: Colors.border,
    borderRadius: 3,
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    backgroundColor: Colors.primary,
    borderRadius: 3,
  },
  barWarning: { backgroundColor: '#F59E0B' },
  barExhausted: { backgroundColor: '#EF4444' },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  usageText: { fontSize: 12, color: Colors.mutedFg },
  extraText: { fontSize: 12, color: Colors.primary, fontWeight: '600' },
  remainingText: { fontSize: 12, color: Colors.mutedFg },
  warningText: { color: '#D97706', fontWeight: '600' },
  exhaustedText: { color: '#EF4444', fontWeight: '600' },
  warningBanner: {
    backgroundColor: '#FFFBEB',
    borderWidth: 1,
    borderColor: '#FDE68A',
    borderRadius: 8,
    padding: 8,
    marginTop: 2,
  },
  warningBannerText: { fontSize: 12, color: '#92400E', lineHeight: 18 },
  warningBannerLink: { color: '#D97706', fontWeight: '700' },
  exhaustedBanner: {
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FECACA',
    borderRadius: 8,
    padding: 8,
    marginTop: 2,
  },
  exhaustedBannerText: { fontSize: 12, color: '#7F1D1D', lineHeight: 18 },
  exhaustedBannerLink: { color: '#EF4444', fontWeight: '700' },
});
