import { useEffect, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  RefreshControl, ScrollView,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../lib/supabase';
import { Lesson } from '../../types';

type ViewTab = '일일' | '주간';

interface LessonWithMembers extends Lesson {
  memberNames: string[];
  memberIds: string[];
}

interface WeekLesson {
  date: string;
  lessons: LessonWithMembers[];
}

const DAYS = ['일', '월', '화', '수', '목', '금', '토'];

export default function ScheduleScreen() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<ViewTab>('일일');
  const [lessons, setLessons] = useState<LessonWithMembers[]>([]);
  const [weekData, setWeekData] = useState<WeekLesson[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedDate, setSelectedDate] = useState<string>(
    new Date().toISOString().split('T')[0]
  );

  const today = new Date().toISOString().split('T')[0];

  // 7-day window centered on today (−3 to +3)
  const weekDates = Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - 3 + i);
    return d.toISOString().split('T')[0];
  });

  // Week starting Monday of current week
  const thisWeekDates = (() => {
    const now = new Date();
    const day = now.getDay(); // 0=Sun
    const monday = new Date(now);
    monday.setDate(now.getDate() - ((day + 6) % 7));
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      return d.toISOString().split('T')[0];
    });
  })();

  async function attachMemberNames(lessonList: Lesson[]): Promise<LessonWithMembers[]> {
    if (lessonList.length === 0) return [];
    const ids = lessonList.map(l => l.id);
    const { data: lm } = await supabase
      .from('lesson_members')
      .select('lesson_id, member_id, member:members(name)')
      .in('lesson_id', ids);
    const nameMap = new Map<string, string[]>();
    const idMap = new Map<string, string[]>();
    for (const row of lm ?? []) {
      const n = (row.member as any)?.name;
      if (!n) continue;
      if (!nameMap.has(row.lesson_id)) nameMap.set(row.lesson_id, []);
      if (!idMap.has(row.lesson_id)) idMap.set(row.lesson_id, []);
      nameMap.get(row.lesson_id)!.push(n);
      idMap.get(row.lesson_id)!.push(row.member_id);
    }
    return lessonList.map(l => ({
      ...l,
      memberNames: nameMap.get(l.id) ?? [],
      memberIds: idMap.get(l.id) ?? [],
    }));
  }

  async function loadDayLessons() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data } = await supabase
      .from('lessons')
      .select('*')
      .eq('coach_id', user.id)
      .eq('date', selectedDate)
      .order('start_time');
    setLessons(await attachMemberNames(data ?? []));
  }

  async function loadWeekLessons() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const [startDate, endDate] = [thisWeekDates[0], thisWeekDates[6]];
    const { data } = await supabase
      .from('lessons')
      .select('*')
      .eq('coach_id', user.id)
      .gte('date', startDate)
      .lte('date', endDate)
      .order('start_time');
    const withNames = await attachMemberNames(data ?? []);
    const map = new Map<string, LessonWithMembers[]>();
    for (const d of thisWeekDates) map.set(d, []);
    for (const l of withNames) {
      if (map.has(l.date)) map.get(l.date)!.push(l);
    }
    setWeekData(thisWeekDates.map(d => ({ date: d, lessons: map.get(d) ?? [] })));
  }

  async function loadAll() {
    if (activeTab === '일일') await loadDayLessons();
    else await loadWeekLessons();
  }

  useFocusEffect(useCallback(() => { loadAll(); }, [activeTab, selectedDate]));

  // ─── Day tab render ───────────────────────────────────────────────
  function renderLesson({ item }: { item: LessonWithMembers }) {
    return (
      <TouchableOpacity style={styles.card} onPress={() => router.push(`/lessons/${item.id}`)}>
        <View style={styles.timeBadge}>
          <Text style={styles.timeText}>{item.start_time.slice(0, 5)}</Text>
          <Text style={styles.timeEnd}>{item.end_time.slice(0, 5)}</Text>
        </View>
        <View style={styles.cardInfo}>
          <Text style={styles.lessonTitle}>{item.title}</Text>
          <View style={styles.row}>
            <Ionicons name="person-outline" size={12} color="#1a7a4a" />
            {item.memberNames.length > 0 ? (
              <View style={styles.memberNameRow}>
                {item.memberNames.map((name, i) => (
                  <TouchableOpacity key={item.memberIds[i]} onPress={() => router.push(`/members/${item.memberIds[i]}`)}>
                    <Text style={styles.memberNameText}>{name}{i < item.memberNames.length - 1 ? ', ' : ''}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            ) : (
              <Text style={styles.memberNameText}>{item.title}</Text>
            )}
          </View>
          {item.location && (
            <View style={styles.row}>
              <Ionicons name="location-outline" size={12} color="#888" />
              <Text style={styles.detail}>{item.location}</Text>
            </View>
          )}
          {item.notes && (
            <Text style={styles.notes} numberOfLines={1}>{item.notes}</Text>
          )}
        </View>
        <Ionicons name="chevron-forward" size={16} color="#ccc" />
      </TouchableOpacity>
    );
  }

  // ─── Week tab render ──────────────────────────────────────────────
  function renderWeekDay(item: WeekLesson) {
    const d = new Date(item.date + 'T00:00:00');
    const isToday = item.date === today;
    return (
      <View key={item.date} style={[styles.weekDayCol, isToday && styles.weekDayColToday]}>
        {/* Day header */}
        <View style={[styles.weekDayHeader, isToday && styles.weekDayHeaderToday]}>
          <Text style={[styles.weekDayName, isToday && styles.weekDayNameToday]}>
            {DAYS[d.getDay()]}
          </Text>
          <Text style={[styles.weekDayNum, isToday && styles.weekDayNumToday]}>
            {d.getDate()}
          </Text>
        </View>

        {/* Lesson cards for this day */}
        {item.lessons.length === 0 ? (
          <View style={styles.weekEmptySlot}>
            <Text style={styles.weekEmptyText}>-</Text>
          </View>
        ) : (
          item.lessons.map(lesson => (
            <TouchableOpacity
              key={lesson.id}
              style={styles.weekLessonCard}
              onPress={() => router.push(`/lessons/${lesson.id}`)}
            >
              <Text style={styles.weekLessonTime}>{lesson.start_time.slice(0, 5)}</Text>
              <Text style={styles.weekLessonTitle} numberOfLines={2}>{lesson.title}</Text>
              <Text style={styles.weekLessonMembers} numberOfLines={1}>
                {lesson.memberNames.length > 0 ? lesson.memberNames.join(', ') : lesson.title}
              </Text>
            </TouchableOpacity>
          ))
        )}
      </View>
    );
  }

  // ─── Main render ──────────────────────────────────────────────────
  return (
    <View style={styles.container}>
      {/* Tab switcher */}
      <View style={styles.tabRow}>
        {(['일일', '주간'] as ViewTab[]).map(tab => (
          <TouchableOpacity
            key={tab}
            style={[styles.tabBtn, activeTab === tab && styles.tabBtnActive]}
            onPress={() => setActiveTab(tab)}
          >
            <Text style={[styles.tabText, activeTab === tab && styles.tabTextActive]}>
              {tab}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {activeTab === '일일' ? (
        <>
          {/* Day picker strip */}
          <View style={styles.weekStrip}>
            {weekDates.map(date => {
              const d = new Date(date + 'T00:00:00');
              const isSelected = date === selectedDate;
              const isToday = date === today;
              return (
                <TouchableOpacity
                  key={date}
                  style={[styles.dayBtn, isSelected && styles.daySelected]}
                  onPress={() => setSelectedDate(date)}
                >
                  <Text style={[styles.dayName, isSelected && styles.dayTextSelected]}>
                    {DAYS[d.getDay()]}
                  </Text>
                  <Text style={[
                    styles.dayNum,
                    isSelected && styles.dayTextSelected,
                    isToday && !isSelected && styles.dayToday,
                  ]}>
                    {d.getDate()}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <Text style={styles.dateHeader}>
            {new Date(selectedDate + 'T00:00:00').toLocaleDateString('ko-KR', {
              month: 'long', day: 'numeric', weekday: 'long',
            })}
          </Text>

          <FlatList
            data={lessons}
            keyExtractor={item => item.id}
            renderItem={renderLesson}
            contentContainerStyle={{ padding: 16, paddingTop: 0 }}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={async () => { setRefreshing(true); await loadAll(); setRefreshing(false); }}
                tintColor="#1a7a4a"
              />
            }
            ListEmptyComponent={
              <View style={styles.empty}>
                <Ionicons name="calendar-outline" size={48} color="#ccc" />
                <Text style={styles.emptyText}>이 날 레슨이 없습니다</Text>
              </View>
            }
          />
        </>
      ) : (
        /* Week view */
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.weekScroll}
          contentContainerStyle={styles.weekScrollContent}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={async () => { setRefreshing(true); await loadWeekLessons(); setRefreshing(false); }}
              tintColor="#1a7a4a"
            />
          }
        >
          {weekData.map(item => renderWeekDay(item))}
        </ScrollView>
      )}

      <TouchableOpacity style={styles.fab} onPress={() => router.push('/lessons/new')}>
        <Ionicons name="add" size={28} color="#fff" />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f7fa' },

  // Tabs
  tabRow: {
    flexDirection: 'row', backgroundColor: '#fff',
    borderBottomWidth: 1, borderBottomColor: '#eee',
    paddingHorizontal: 16, paddingVertical: 8, gap: 8,
  },
  tabBtn: {
    flex: 1, paddingVertical: 8, borderRadius: 10,
    alignItems: 'center', backgroundColor: '#f0f0f0',
  },
  tabBtnActive: { backgroundColor: '#1a7a4a' },
  tabText: { fontSize: 14, fontWeight: '700', color: '#888' },
  tabTextActive: { color: '#fff' },

  // Day strip
  weekStrip: {
    flexDirection: 'row', backgroundColor: '#fff',
    paddingVertical: 12, paddingHorizontal: 8,
    borderBottomWidth: 1, borderBottomColor: '#eee',
  },
  dayBtn: { flex: 1, alignItems: 'center', paddingVertical: 6, borderRadius: 10 },
  daySelected: { backgroundColor: '#1a7a4a' },
  dayName: { fontSize: 11, color: '#888', marginBottom: 4 },
  dayNum: { fontSize: 16, fontWeight: '700', color: '#1a1a1a' },
  dayTextSelected: { color: '#fff' },
  dayToday: { color: '#1a7a4a' },
  dateHeader: { fontSize: 14, color: '#888', paddingHorizontal: 16, paddingVertical: 10 },

  // Lesson card (daily)
  card: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff',
    borderRadius: 12, padding: 14, marginBottom: 8,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 4, elevation: 1,
  },
  timeBadge: {
    backgroundColor: '#f0fdf4', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6,
    alignItems: 'center', marginRight: 12, minWidth: 50,
  },
  timeText: { fontSize: 14, fontWeight: '700', color: '#1a7a4a' },
  timeEnd: { fontSize: 11, color: '#888', marginTop: 2 },
  cardInfo: { flex: 1 },
  lessonTitle: { fontSize: 15, fontWeight: '700', color: '#1a1a1a', marginBottom: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  detail: { fontSize: 12, color: '#888' },
  notes: { fontSize: 12, color: '#aaa', marginTop: 2 },
  memberNameRow: { flexDirection: 'row', flexWrap: 'wrap' },
  memberNameText: { fontSize: 12, color: '#1a7a4a', fontWeight: '600' },

  // Empty
  empty: { alignItems: 'center', padding: 60 },
  emptyText: { fontSize: 15, color: '#aaa', fontWeight: '500', marginTop: 12 },

  // FAB
  fab: {
    position: 'absolute', bottom: 24, right: 20,
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: '#1a7a4a', justifyContent: 'center', alignItems: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.2, shadowRadius: 8, elevation: 6,
  },

  // Week view
  weekScroll: { flex: 1 },
  weekScrollContent: { padding: 12, gap: 8, flexDirection: 'row' },
  weekDayCol: {
    width: 130, backgroundColor: '#fff', borderRadius: 12,
    overflow: 'hidden',
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 4, elevation: 1,
  },
  weekDayColToday: {
    borderWidth: 2, borderColor: '#1a7a4a',
  },
  weekDayHeader: {
    backgroundColor: '#f5f7fa', paddingVertical: 10,
    alignItems: 'center', borderBottomWidth: 1, borderBottomColor: '#eee',
  },
  weekDayHeaderToday: { backgroundColor: '#1a7a4a' },
  weekDayName: { fontSize: 12, color: '#888', fontWeight: '600' },
  weekDayNameToday: { color: 'rgba(255,255,255,0.85)' },
  weekDayNum: { fontSize: 20, fontWeight: '800', color: '#1a1a1a', marginTop: 2 },
  weekDayNumToday: { color: '#fff' },
  weekEmptySlot: { padding: 16, alignItems: 'center' },
  weekEmptyText: { fontSize: 20, color: '#ddd' },
  weekLessonCard: {
    margin: 8, backgroundColor: '#f0fdf4', borderRadius: 8,
    padding: 8, borderLeftWidth: 3, borderLeftColor: '#1a7a4a',
  },
  weekLessonTime: { fontSize: 11, color: '#1a7a4a', fontWeight: '700', marginBottom: 2 },
  weekLessonTitle: { fontSize: 12, color: '#1a1a1a', fontWeight: '600' },
  weekLessonMembers: { fontSize: 11, color: '#1a7a4a', marginTop: 2 },
});
