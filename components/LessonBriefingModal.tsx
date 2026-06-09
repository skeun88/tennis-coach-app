import React, { useEffect, useState } from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';
import { LessonPlan } from '../types';
import { Colors, Radius } from '../lib/theme';
import { extractIssueTags } from '../lib/issueTagUtils';

interface MemberBriefing {
  memberId: string;
  memberName: string;
  lastPlan: LessonPlan | null;
  tags: string[];
}

interface LessonBriefingModalProps {
  visible: boolean;
  onClose: () => void;
  /** 레슨에 참여하는 회원 목록 */
  memberIds: string[];
}

export default function LessonBriefingModal({
  visible,
  onClose,
  memberIds,
}: LessonBriefingModalProps) {
  const [briefings, setBriefings] = useState<MemberBriefing[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (visible && memberIds.length > 0) {
      loadBriefings();
    }
  }, [visible, memberIds.join(',')]);

  async function loadBriefings() {
    setLoading(true);
    const results: MemberBriefing[] = [];

    for (const memberId of memberIds) {
      // 회원 이름 가져오기
      const { data: memberData } = await supabase
        .from('members')
        .select('name')
        .eq('id', memberId)
        .single();

      // 최근 5개 레슨 플랜 가져오기
      const { data: plansData } = await supabase
        .from('lesson_plans')
        .select(
          'id, summary, improvement_points, next_goals, session_goals, created_at, updated_at'
        )
        .eq('member_id', memberId)
        .order('created_at', { ascending: false })
        .limit(5);

      const plans = (plansData ?? []) as LessonPlan[];
      const lastPlan = plans.length > 0 ? plans[0] : null;
      const tags = extractIssueTags(plans);

      results.push({
        memberId,
        memberName: (memberData as { name: string } | null)?.name ?? '회원',
        lastPlan,
        tags,
      });
    }

    setBriefings(results);
    setLoading(false);
  }

  /** 텍스트를 최대 길이로 자르되 자연스러운 위치에서 자름 */
  function truncate(text: string | null | undefined, maxLen: number): string {
    if (!text) return '';
    if (text.length <= maxLen) return text;
    return text.slice(0, maxLen).replace(/[,.\s]+$/, '') + '…';
  }

  /** 집중 포인트: next_goals > session_goals > improvement_points 첫 줄 순 */
  function getFocusPoint(plan: LessonPlan): string {
    const candidates = [plan.next_goals, plan.session_goals, plan.improvement_points];
    for (const c of candidates) {
      if (c && c.trim().length > 0) {
        const firstLine = c.split(/[\n.]/)[0].trim();
        if (firstLine.length > 0) return truncate(firstLine, 60);
      }
    }
    return '';
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          {/* 헤더 */}
          <View style={styles.header}>
            <View style={styles.headerLeft}>
              <View style={styles.headerIconWrap}>
                <Ionicons name="clipboard" size={18} color={Colors.primary} />
              </View>
              <View>
                <Text style={styles.headerTitle}>레슨 브리핑</Text>
                <Text style={styles.headerSub}>오늘 레슨 전 확인사항</Text>
              </View>
            </View>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <Ionicons name="close" size={22} color={Colors.mutedFg} />
            </TouchableOpacity>
          </View>

          {/* Pro 뱃지 */}
          <View style={styles.proBadgeRow}>
            <View style={styles.proBadge}>
              <Ionicons name="star" size={10} color="#fff" />
              <Text style={styles.proBadgeText}>PRO 전용</Text>
            </View>
            <Text style={styles.proBadgeDesc}>코치에게만 표시됩니다</Text>
          </View>

          {loading ? (
            <View style={styles.loadingWrap}>
              <ActivityIndicator size="large" color={Colors.primary} />
              <Text style={styles.loadingText}>브리핑 준비 중…</Text>
            </View>
          ) : (
            <ScrollView
              style={styles.scroll}
              contentContainerStyle={{ paddingBottom: 32 }}
              showsVerticalScrollIndicator={false}
            >
              {briefings.map((b, idx) => (
                <View key={b.memberId} style={[styles.memberCard, idx > 0 && { marginTop: 12 }]}>
                  {/* 회원 헤더 */}
                  <View style={styles.memberHeader}>
                    <View style={styles.memberAvatar}>
                      <Text style={styles.memberAvatarText}>
                        {b.memberName.slice(0, 1)}
                      </Text>
                    </View>
                    <Text style={styles.memberName}>{b.memberName}</Text>
                  </View>

                  {b.lastPlan === null ? (
                    /* 레슨 플랜 없음 */
                    <View style={styles.noDataWrap}>
                      <Text style={styles.noDataText}>
                        첫 레슨이에요! AI 분석으로 맞춤 리포트를 만들어보세요 ✨
                      </Text>
                    </View>
                  ) : (
                    <>
                      {/* 저번 레슨 핵심 포인트 */}
                      <View style={styles.section}>
                        <View style={styles.sectionLabelRow}>
                          <Ionicons name="time-outline" size={12} color={Colors.mutedFg} />
                          <Text style={styles.sectionLabel}>저번 레슨 핵심 포인트</Text>
                        </View>
                        <Text style={styles.summaryText}>
                          {truncate(b.lastPlan.summary, 120) ||
                            truncate(b.lastPlan.improvement_points, 120) ||
                            '분석 내용 없음'}
                        </Text>
                      </View>

                      {/* 반복 이슈 태그 */}
                      {b.tags.length > 0 && (
                        <View style={styles.section}>
                          <View style={styles.sectionLabelRow}>
                            <Ionicons name="pricetag-outline" size={12} color={Colors.mutedFg} />
                            <Text style={styles.sectionLabel}>반복 이슈</Text>
                          </View>
                          <View style={styles.tagRow}>
                            {b.tags.map(tag => (
                              <View key={tag} style={styles.tag}>
                                <Text style={styles.tagText}>#{tag}</Text>
                              </View>
                            ))}
                          </View>
                        </View>
                      )}

                      {/* 이번 레슨 집중 포인트 */}
                      {getFocusPoint(b.lastPlan).length > 0 && (
                        <View style={styles.focusWrap}>
                          <Ionicons name="bulb" size={14} color="#F59E0B" />
                          <Text style={styles.focusText}>
                            <Text style={styles.focusLabel}>이번 집중: </Text>
                            {getFocusPoint(b.lastPlan)}
                          </Text>
                        </View>
                      )}
                    </>
                  )}
                </View>
              ))}
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: Colors.background,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '85%',
    paddingBottom: 20,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  headerIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: Colors.navy,
  },
  headerSub: {
    fontSize: 12,
    color: Colors.mutedFg,
    marginTop: 1,
  },
  closeBtn: {
    padding: 8,
    borderRadius: Radius.full,
    backgroundColor: Colors.mutedBg,
  },
  proBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 20,
    paddingVertical: 8,
    backgroundColor: Colors.primaryLight,
    borderBottomWidth: 1,
    borderBottomColor: Colors.primary + '20',
  },
  proBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#8B5CF6',
    borderRadius: Radius.full,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  proBadgeText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  proBadgeDesc: {
    fontSize: 12,
    color: Colors.mutedFg,
  },
  loadingWrap: {
    alignItems: 'center',
    paddingVertical: 40,
    gap: 12,
  },
  loadingText: {
    fontSize: 14,
    color: Colors.mutedFg,
  },
  scroll: {
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  memberCard: {
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  memberHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 12,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  memberAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  memberAvatarText: {
    fontSize: 14,
    fontWeight: '800',
    color: '#fff',
  },
  memberName: {
    fontSize: 15,
    fontWeight: '700',
    color: Colors.foreground,
  },
  noDataWrap: {
    backgroundColor: Colors.primaryLight,
    borderRadius: Radius.md,
    padding: 12,
  },
  noDataText: {
    fontSize: 13,
    color: Colors.mutedFg,
    lineHeight: 20,
  },
  section: {
    marginBottom: 10,
  },
  sectionLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 5,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.mutedFg,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  summaryText: {
    fontSize: 13,
    color: Colors.foreground,
    lineHeight: 20,
    backgroundColor: Colors.mutedBg,
    borderRadius: Radius.sm,
    padding: 10,
  },
  tagRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  tag: {
    backgroundColor: Colors.primaryLight,
    borderRadius: Radius.full,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: Colors.primary + '40',
  },
  tagText: {
    fontSize: 11,
    fontWeight: '600',
    color: Colors.primary,
  },
  focusWrap: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    backgroundColor: '#FFFBEB',
    borderRadius: Radius.sm,
    padding: 10,
    borderWidth: 1,
    borderColor: '#FDE68A',
    marginTop: 4,
  },
  focusLabel: {
    fontWeight: '700',
    color: '#B45309',
  },
  focusText: {
    flex: 1,
    fontSize: 13,
    color: '#92400E',
    lineHeight: 20,
  },
});
