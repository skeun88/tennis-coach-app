import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';
import { LessonPlan } from '../types';
import { Colors, Radius } from '../lib/theme';
import { extractIssueTags } from '../lib/issueTagUtils';

interface MemberIssueTagsProps {
  memberId: string;
  isPro: boolean;
  onUpgrade: () => void;
}

export default function MemberIssueTags({
  memberId,
  isPro,
  onUpgrade,
}: MemberIssueTagsProps) {
  const [tags, setTags] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasData, setHasData] = useState(false);

  useEffect(() => {
    if (!isPro) return;
    fetchTags();
  }, [memberId, isPro]);

  async function fetchTags() {
    setLoading(true);
    const { data } = await supabase
      .from('lesson_plans')
      .select('id, summary, improvement_points, next_goals, session_goals')
      .eq('member_id', memberId)
      .order('created_at', { ascending: false })
      .limit(5);

    const plans = (data ?? []) as LessonPlan[];
    setHasData(plans.length > 0);
    setTags(extractIssueTags(plans));
    setLoading(false);
  }

  // 잠금 상태 (베이직 코치)
  if (!isPro) {
    return (
      <View style={styles.lockedContainer}>
        <View style={styles.lockedHeader}>
          <View style={styles.lockedIconWrap}>
            <Ionicons name="pricetag" size={14} color="#8B5CF6" />
          </View>
          <Text style={styles.sectionTitle}>반복 이슈 태그</Text>
          <View style={styles.proBadge}>
            <Text style={styles.proBadgeText}>PRO</Text>
          </View>
        </View>

        {/* 흐린 더미 태그들 */}
        <View style={styles.dummyTagRow}>
          {['#서브', '#풋워크', '#그립', '#타이밍'].map(tag => (
            <View key={tag} style={[styles.tag, styles.tagDummy]}>
              <Text style={styles.tagTextDummy}>{tag}</Text>
            </View>
          ))}
        </View>

        <TouchableOpacity style={styles.upgradeBtn} onPress={onUpgrade}>
          <Ionicons name="lock-closed" size={13} color="#8B5CF6" />
          <Text style={styles.upgradeBtnText}>Pro로 업그레이드하면 이 기능을 쓸 수 있어요</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // 로딩
  if (loading) {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <Ionicons name="pricetag" size={14} color={Colors.primary} />
          <Text style={styles.sectionTitle}>반복 이슈 태그</Text>
        </View>
        <ActivityIndicator size="small" color={Colors.primary} style={{ marginTop: 8 }} />
      </View>
    );
  }

  // 데이터 없음
  if (!hasData) {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <Ionicons name="pricetag" size={14} color={Colors.primary} />
          <Text style={styles.sectionTitle}>반복 이슈 태그</Text>
        </View>
        <Text style={styles.emptyText}>
          AI 레슨 분석 후 반복 이슈가 자동으로 추출돼요
        </Text>
      </View>
    );
  }

  // 태그 없음 (데이터는 있지만 패턴 없음)
  if (tags.length === 0) {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <Ionicons name="pricetag" size={14} color={Colors.primary} />
          <Text style={styles.sectionTitle}>반복 이슈 태그</Text>
        </View>
        <Text style={styles.emptyText}>
          아직 반복되는 패턴이 보이지 않아요 👍
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Ionicons name="pricetag" size={14} color={Colors.primary} />
        <Text style={styles.sectionTitle}>반복 이슈 태그</Text>
        <Text style={styles.subLabel}>최근 5회 레슨 기준</Text>
      </View>
      <View style={styles.tagRow}>
        {tags.map(tag => (
          <View key={tag} style={styles.tag}>
            <Text style={styles.tagText}>#{tag}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: Colors.primaryLight,
    borderRadius: Radius.md,
    padding: 12,
    marginTop: 8,
    borderWidth: 1,
    borderColor: Colors.primary + '30',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 8,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.navy,
    flex: 1,
  },
  subLabel: {
    fontSize: 11,
    color: Colors.mutedFg,
  },
  tagRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  tag: {
    backgroundColor: Colors.white,
    borderRadius: Radius.full,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: Colors.primary + '50',
  },
  tagText: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.primary,
  },
  emptyText: {
    fontSize: 12,
    color: Colors.mutedFg,
  },
  // 잠금 상태
  lockedContainer: {
    backgroundColor: '#F8F4FF',
    borderRadius: Radius.md,
    padding: 12,
    marginTop: 8,
    borderWidth: 1,
    borderColor: '#DDD6FE',
  },
  lockedHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 8,
  },
  lockedIconWrap: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#EDE9FE',
    alignItems: 'center',
    justifyContent: 'center',
  },
  proBadge: {
    backgroundColor: '#8B5CF6',
    borderRadius: Radius.full,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  proBadgeText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1,
  },
  dummyTagRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 8,
    opacity: 0.35,
  },
  tagDummy: {
    backgroundColor: '#C4B5FD',
    borderRadius: Radius.full,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderWidth: 0,
  },
  tagTextDummy: {
    fontSize: 12,
    fontWeight: '600',
    color: '#5B21B6',
  },
  upgradeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  upgradeBtnText: {
    fontSize: 12,
    color: '#8B5CF6',
    fontWeight: '600',
  },
});
