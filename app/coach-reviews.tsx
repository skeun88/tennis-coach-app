import { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, SafeAreaView,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';

const BG = '#FAF8F5';
const CARD = '#FFFFFF';
const TERRA = '#C0755A';
const TERRA_LIGHT = '#FBF2EF';
const PEACH = '#FCEADE';
const TEXT_PRIMARY = '#20242C';
const TEXT_MUTED = '#667085';
const DIVIDER = '#E8EBEF';

interface ReviewKeyword {
  code: string;
  label: string;
}

interface Review {
  id: string;
  rating: number;
  keyword_codes: string[];
  comment: string | null;
  submitted_at: string;
}

interface ReviewSummary {
  avgRating: number | null;
  totalCount: number;
  topKeywords: Array<{ code: string; label: string; count: number }>;
}

function StarRow({ rating, size = 14 }: { rating: number; size?: number }) {
  return (
    <View style={{ flexDirection: 'row', gap: 2 }}>
      {[1, 2, 3, 4, 5].map(s => (
        <Ionicons
          key={s}
          name={s <= rating ? 'star' : 'star-outline'}
          size={size}
          color={s <= rating ? TERRA : DIVIDER}
        />
      ))}
    </View>
  );
}

function ReviewCard({ review, keywords }: { review: Review; keywords: ReviewKeyword[] }) {
  const keywordMap = new Map(keywords.map(k => [k.code, k.label]));
  const dateStr = review.submitted_at
    ? new Date(review.submitted_at).toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' })
    : '';

  return (
    <View style={styles.reviewCard}>
      <View style={styles.reviewCardHeader}>
        <View style={styles.anonRow}>
          <View style={styles.anonAvatar}>
            <Ionicons name="person-outline" size={16} color={TEXT_MUTED} />
          </View>
          <Text style={styles.anonName}>익명 회원</Text>
        </View>
        <View style={styles.reviewMeta}>
          <StarRow rating={review.rating} />
          <Text style={styles.reviewDate}>{dateStr}</Text>
        </View>
      </View>

      {review.keyword_codes && review.keyword_codes.length > 0 && (
        <View style={styles.chipRow}>
          {review.keyword_codes.map(code => (
            <View key={code} style={styles.chip}>
              <Text style={styles.chipText}>{keywordMap.get(code) ?? code}</Text>
            </View>
          ))}
        </View>
      )}

      {review.comment ? (
        <Text style={styles.reviewComment}>{review.comment}</Text>
      ) : null}
    </View>
  );
}

export default function CoachReviewsScreen() {
  const router = useRouter();
  const [reviews, setReviews] = useState<Review[]>([]);
  const [keywords, setKeywords] = useState<ReviewKeyword[]>([]);
  const [summary, setSummary] = useState<ReviewSummary>({ avgRating: null, totalCount: 0, topKeywords: [] });
  const [loading, setLoading] = useState(true);

  const loadReviews = useCallback(async () => {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); return; }

    const [{ data: kws }, { data: reviewRows }] = await Promise.all([
      supabase.from('review_keywords').select('code, label').order('sort_order'),
      supabase
        .from('coach_reviews')
        .select('id, rating, keyword_codes, comment, submitted_at')
        .eq('coach_id', user.id)
        .eq('is_deleted', false)
        .order('submitted_at', { ascending: false }),
    ]);

    const kwList: ReviewKeyword[] = kws ?? [];
    setKeywords(kwList);

    const rows: Review[] = reviewRows ?? [];
    setReviews(rows);

    // 요약 계산
    const totalCount = rows.length;
    const avgRating = totalCount > 0
      ? Math.round((rows.reduce((s, r) => s + r.rating, 0) / totalCount) * 10) / 10
      : null;

    // TOP 3 키워드 집계
    const kwCounts = new Map<string, number>();
    rows.forEach(r => {
      (r.keyword_codes ?? []).forEach(code => {
        kwCounts.set(code, (kwCounts.get(code) ?? 0) + 1);
      });
    });
    const kwMap = new Map(kwList.map(k => [k.code, k.label]));
    const topKeywords = Array.from(kwCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([code, count]) => ({ code, label: kwMap.get(code) ?? code, count }));

    setSummary({ avgRating, totalCount, topKeywords });
    setLoading(false);
  }, []);

  useFocusEffect(useCallback(() => { loadReviews(); }, [loadReviews]));

  return (
    <SafeAreaView style={styles.container}>
      {/* 헤더 */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={24} color={TEXT_PRIMARY} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>받은 회원 후기</Text>
        <View style={styles.headerRight} />
      </View>

      {loading ? (
        <View style={styles.loadingCenter}>
          <ActivityIndicator color={TERRA} />
        </View>
      ) : (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          {/* 요약 카드 */}
          <View style={styles.summaryCard}>
            <View style={styles.summaryTop}>
              <View style={styles.ratingBlock}>
                <Ionicons name="star" size={22} color={TERRA} />
                <Text style={styles.avgRatingText}>
                  {summary.avgRating != null ? summary.avgRating.toFixed(1) : '—'}
                </Text>
                <Text style={styles.totalCountText}>
                  ({summary.totalCount}개)
                </Text>
              </View>
            </View>

            {summary.topKeywords.length > 0 && (
              <View style={styles.topKeywordsRow}>
                {summary.topKeywords.map(kw => (
                  <View key={kw.code} style={styles.topKwChip}>
                    <Ionicons name="checkmark-circle" size={13} color={TERRA} />
                    <Text style={styles.topKwText}>{kw.label}</Text>
                  </View>
                ))}
              </View>
            )}
          </View>

          {/* 리뷰 목록 */}
          {reviews.length === 0 ? (
            <View style={styles.emptyBox}>
              <Ionicons name="heart-outline" size={40} color={DIVIDER} />
              <Text style={styles.emptyText}>아직 등록된 리뷰가 없어요</Text>
              <Text style={styles.emptySubText}>회원이 레슨 후기를 남기면 이곳에 표시돼요</Text>
            </View>
          ) : (
            reviews.map(r => (
              <ReviewCard key={r.id} review={r} keywords={keywords} />
            ))
          )}

          <View style={{ height: 40 }} />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: BG },
  loadingCenter: { flex: 1, justifyContent: 'center', alignItems: 'center' },

  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 8, paddingTop: 4,
    paddingBottom: 8, backgroundColor: BG,
    borderBottomWidth: 1, borderBottomColor: DIVIDER,
  },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, textAlign: 'center', fontSize: 17, fontWeight: '700', color: TEXT_PRIMARY },
  headerRight: { width: 40 },

  scroll: { flex: 1 },
  scrollContent: { padding: 16 },

  // 요약 카드
  summaryCard: {
    backgroundColor: CARD, borderRadius: 16,
    padding: 20, marginBottom: 16,
    borderWidth: 1, borderColor: DIVIDER,
  },
  summaryTop: { marginBottom: 12 },
  ratingBlock: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  avgRatingText: { fontSize: 28, fontWeight: '800', color: TEXT_PRIMARY },
  totalCountText: { fontSize: 15, color: TEXT_MUTED, alignSelf: 'flex-end', marginBottom: 2 },
  topKeywordsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  topKwChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: TERRA_LIGHT, borderRadius: 20,
    paddingHorizontal: 12, paddingVertical: 6,
  },
  topKwText: { fontSize: 13, fontWeight: '600', color: TERRA },

  // 리뷰 카드
  reviewCard: {
    backgroundColor: CARD, borderRadius: 16,
    padding: 16, marginBottom: 10,
    borderWidth: 1, borderColor: DIVIDER,
  },
  reviewCardHeader: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'flex-start', marginBottom: 10,
  },
  anonRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  anonAvatar: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: '#F3F4F6',
    alignItems: 'center', justifyContent: 'center',
  },
  anonName: { fontSize: 14, fontWeight: '600', color: TEXT_PRIMARY },
  reviewMeta: { alignItems: 'flex-end', gap: 4 },
  reviewDate: { fontSize: 12, color: TEXT_MUTED },

  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8 },
  chip: {
    backgroundColor: PEACH, borderRadius: 20,
    paddingHorizontal: 10, paddingVertical: 4,
  },
  chipText: { fontSize: 12, fontWeight: '600', color: TERRA },

  reviewComment: { fontSize: 14, color: TEXT_PRIMARY, lineHeight: 21 },

  // 빈 상태
  emptyBox: {
    alignItems: 'center', justifyContent: 'center',
    paddingVertical: 60, gap: 10,
  },
  emptyText: { fontSize: 16, fontWeight: '700', color: TEXT_MUTED },
  emptySubText: { fontSize: 13, color: TEXT_MUTED, textAlign: 'center' },
});
