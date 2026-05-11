import { useState, useCallback, useRef, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, FlatList,
  RefreshControl, Alert, Modal, TextInput, ActivityIndicator,
  PanResponder, Animated, Dimensions,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../lib/supabase';
import { Lesson } from '../../types';
import { Colors } from '../../lib/theme';

type ViewTab = '일일' | '주간' | '월간';

interface LessonWithMembers extends Lesson {
  memberNames: string[];
  memberIds: string[];
}
interface WeekLesson {
  date: string;
  lessons: LessonWithMembers[];
}

const DAYS = ['일', '월', '화', '수', '목', '금', '토'];
const HOUR_HEIGHT = 100; // px per hour
const START_HOUR = 6;
const END_HOUR = 22;
const HOURS = Array.from({ length: END_HOUR - START_HOUR + 1 }, (_, i) => i + START_HOUR);
const SPINNER_HOURS = Array.from({ length: 17 }, (_, i) => String(i + 6).padStart(2, '0')); // 06~22
const SPINNER_MINUTES = ['00', '10', '20', '30', '40', '50'];
const DURATION_OPTIONS = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120];

function toKSTDateStr(d: Date): string {
  const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().split('T')[0];
}
function getTodayKST(): string { return toKSTDateStr(new Date()); }
function getWeekDates(): string[] {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(); d.setDate(d.getDate() - 3 + i);
    return toKSTDateStr(d);
  });
}
function getThisWeekDates(): string[] {
  const now = new Date();
  const day = now.getDay();
  const mon = new Date(now); mon.setDate(now.getDate() - ((day + 6) % 7));
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(mon); d.setDate(mon.getDate() + i);
    return toKSTDateStr(d);
  });
}

function getOffsetWeekDates(offset: number): string[] {
  const now = new Date();
  const day = now.getDay(); // 0=일
  const mon = new Date(now);
  mon.setDate(now.getDate() - ((day + 6) % 7) + offset * 7); // 월요일 시작
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(mon); d.setDate(mon.getDate() + i);
    return toKSTDateStr(d);
  });
}

function timeToMinutes(t: string): number {
  const [h, m] = t.slice(0, 5).split(':').map(Number);
  return h * 60 + m;
}
function minutesToTime(m: number): string {
  return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
}
function yToMinutes(y: number): number {
  // y=0 -> START_HOUR:00, snapped to 10min
  const rawMin = (y / HOUR_HEIGHT) * 60 + START_HOUR * 60;
  return Math.round(rawMin / 10) * 10;
}

export default function ScheduleScreen() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<ViewTab>('일일');
  const [lessons, setLessons] = useState<LessonWithMembers[]>([]);
  const [weekData, setWeekData] = useState<WeekLesson[]>([]);
  const [monthLessons, setMonthLessons] = useState<Map<string, LessonWithMembers[]>>(new Map());
  const [monthYear, setMonthYear] = useState(() => { const d = new Date(); return { year: d.getFullYear(), month: d.getMonth() }; });
  const [refreshing, setRefreshing] = useState(false);
  const [today, setToday] = useState(getTodayKST);
  const [selectedDate, setSelectedDate] = useState(getTodayKST);
  const [weekDates, setWeekDates] = useState(getWeekDates);
  const [thisWeekDates, setThisWeekDates] = useState(getThisWeekDates);
  const [weekOffset, setWeekOffset] = useState(0); // 주간 뷰 주 이동 오프셋

  // 새 레슨 등록 모달
  const [newModal, setNewModal] = useState(false);
  const [newMemberIds, setNewMemberIds] = useState<string[]>([]);
  const [newHour, setNewHour] = useState('10');
  const [newMinute, setNewMinute] = useState('00');
  const [newDuration, setNewDuration] = useState(60);
  const [savingNew, setSavingNew] = useState(false);
  const [members, setMembers] = useState<{id: string; name: string}[]>([]);
  const [memberSearch, setMemberSearch] = useState('');
  const [hourPickerVisible, setHourPickerVisible] = useState(false);
  const [minutePickerVisible, setMinutePickerVisible] = useState(false);
  const [durationPickerVisible, setDurationPickerVisible] = useState(false);

  // 드래그 상태
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragTargetMin, setDragTargetMin] = useState(0);
  const dayScrollRef = useRef<any>(null);

  async function attachMemberNames(lessonList: Lesson[]): Promise<LessonWithMembers[]> {
    if (!lessonList.length) return [];
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
    return lessonList.map(l => ({ ...l, memberNames: nameMap.get(l.id) ?? [], memberIds: idMap.get(l.id) ?? [] }));
  }

  function scrollToCurrentTime() {
    const now = new Date();
    const kstNow = new Date(now.getTime() + 9 * 60 * 60 * 1000);
    const currentMin = kstNow.getUTCHours() * 60 + kstNow.getUTCMinutes();
    // 현재 시간보다 30분 전부터 보이도록 스크롤
    const scrollMin = Math.max(START_HOUR * 60, currentMin - 30);
    const y = ((scrollMin - START_HOUR * 60) / 60) * HOUR_HEIGHT;
    setTimeout(() => {
      dayScrollRef.current?.scrollTo({ y: Math.max(0, y), animated: true });
    }, 300);
  }

  async function loadDayLessons(date: string) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data } = await supabase.from('lessons').select('*').eq('coach_id', user.id).eq('date', date).order('start_time');
    setLessons(await attachMemberNames(data ?? []));
    // 오늘이면 현재 시간으로 스크롤, 다른 날이면 첫 레슨으로 스크롤
    const todayStr = toKSTDateStr(new Date());
    if (date === todayStr) {
      scrollToCurrentTime();
    } else {
      // 첫 레슨 시간으로 스크롤
      const firstLesson = (data ?? []).sort((a: any, b: any) => a.start_time.localeCompare(b.start_time))[0];
      if (firstLesson) {
        const mins = timeToMinutes(firstLesson.start_time) - 30;
        const y = ((Math.max(START_HOUR * 60, mins) - START_HOUR * 60) / 60) * HOUR_HEIGHT;
        setTimeout(() => dayScrollRef.current?.scrollTo({ y: Math.max(0, y), animated: true }), 300);
      }
    }
  }

  async function loadWeekLessons(wDates: string[]) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data } = await supabase.from('lessons').select('*').eq('coach_id', user.id)
      .gte('date', wDates[0]).lte('date', wDates[6]).order('start_time');
    const withNames = await attachMemberNames(data ?? []);
    const map = new Map<string, LessonWithMembers[]>();
    for (const d of wDates) map.set(d, []);
    for (const l of withNames) { if (map.has(l.date)) map.get(l.date)!.push(l); }
    setWeekData(wDates.map(d => ({ date: d, lessons: map.get(d) ?? [] })));
  }


  async function loadMonthLessons(year: number, month: number) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const firstDay = `${year}-${String(month + 1).padStart(2, '0')}-01`;
    const lastDay = new Date(year, month + 1, 0);
    const lastDayStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(lastDay.getDate()).padStart(2, '0')}`;
    const { data } = await supabase.from('lessons').select('*')
      .eq('coach_id', user.id).gte('date', firstDay).lte('date', lastDayStr).order('start_time');
    const withNames = await attachMemberNames(data ?? []);
    const map = new Map<string, LessonWithMembers[]>();
    for (const l of withNames) {
      if (!map.has(l.date)) map.set(l.date, []);
      map.get(l.date)!.push(l);
    }
    setMonthLessons(map);
  }

  useFocusEffect(useCallback(() => {
    const newToday = getTodayKST();
    const newWeek = getWeekDates();
    const newThisWeek = getThisWeekDates();
    setToday(newToday); setWeekDates(newWeek); setThisWeekDates(newThisWeek);
    setSelectedDate(prev => newWeek.includes(prev) ? prev : newToday);
    if (activeTab === '일일') loadDayLessons(newToday);
    else if (activeTab === '주간') loadWeekLessons(newThisWeek);
    else { const d = new Date(); loadMonthLessons(d.getFullYear(), d.getMonth()); }
    // 회원 목록 로드
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase.from('members').select('id, name').eq('coach_id', user.id).eq('is_active', true).order('name');
      setMembers(data ?? []);
    })();
  }, [activeTab]));

  const handleSelectDate = useCallback((date: string) => {
    setSelectedDate(date); loadDayLessons(date);
  }, []);

  // ── 시간 그리드 탭 → 새 레슨 등록 ──────────────────────────
  function handleGridTap(y: number) {
    const mins = yToMinutes(y);
    const clamped = Math.max(START_HOUR * 60, Math.min(END_HOUR * 60 - 10, mins));
    const h = Math.floor(clamped / 60);
    const m = Math.round((clamped % 60) / 10) * 10;
    setNewHour(String(h).padStart(2, '0'));
    setNewMinute(String(m).padStart(2, '0'));
    setNewDuration(60);
    setNewMemberIds([]);
    setMemberSearch('');
    setNewModal(true);
  }

  async function handleSaveNew() {
    if (newMemberIds.length === 0) { Alert.alert('오류', '회원을 선택해주세요.'); return; }
    const startMin = parseInt(newHour) * 60 + parseInt(newMinute);
    const endMin = startMin + newDuration;
    const startSt = minutesToTime(startMin) + ':00';
    const endSt = minutesToTime(endMin) + ':00';
    setSavingNew(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setSavingNew(false); return; }
    // 오버랩 체크
    const { data: existing } = await supabase.from('lessons').select('id, start_time, end_time')
      .eq('coach_id', user.id).eq('date', selectedDate);
    const overlap = (existing ?? []).find((l: any) => {
      const ls = timeToMinutes(l.start_time), le = timeToMinutes(l.end_time);
      return startMin < le && endMin > ls;
    });
    if (overlap) {
      setSavingNew(false);
      Alert.alert('시간 충돌', minutesToTime(timeToMinutes((overlap as any).start_time)) + '~' + minutesToTime(timeToMinutes((overlap as any).end_time)) + ' 레슨과 시간이 겹칩니다.\n다른 시간을 선택해주세요.');
      return;
    }
    const selectedNames = members.filter(m => newMemberIds.includes(m.id)).map(m => m.name);
    const title = selectedNames.join(', ');
    const { data: lesson, error } = await supabase.from('lessons').insert({
      coach_id: user.id, title,
      date: selectedDate, start_time: startSt, end_time: endSt,
    }).select('id').single();
    if (error || !lesson) { setSavingNew(false); Alert.alert('오류', '등록 실패'); return; }
    // lesson_members 연결
    for (const memberId of newMemberIds) {
      await supabase.from('lesson_members').insert({ lesson_id: lesson.id, member_id: memberId });
    }
    setSavingNew(false);
    setNewModal(false);
    loadDayLessons(selectedDate);
  }

  // ── 드래그 앤 드랍 ────────────────────────────────────────────
  async function handleDropLesson(lessonId: string, newStartMinutes: number) {
    const lesson = lessons.find(l => l.id === lessonId);
    if (!lesson) return;
    const oldStartMin = timeToMinutes(lesson.start_time);
    const duration = timeToMinutes(lesson.end_time) - oldStartMin;
    const clamped = Math.max(START_HOUR * 60, Math.min(END_HOUR * 60 - 10, newStartMinutes));
    if (Math.abs(clamped - oldStartMin) < 5) return; // 변화 없음
    const newStartStr = minutesToTime(clamped);
    const newEndStr = minutesToTime(clamped + duration);
    Alert.alert(
      '시간 변경',
      lesson.title + '\n' + minutesToTime(oldStartMin) + ' → ' + newStartStr + '\n\n변경하시겠어요?',
      [
        { text: '취소', style: 'cancel' },
        {
          text: '변경', onPress: async () => {
            await supabase.from('lessons').update({
              start_time: newStartStr + ':00',
              end_time: newEndStr + ':00',
            }).eq('id', lessonId);
            loadDayLessons(selectedDate);
          },
        },
      ]
    );
  }


  /** 겹치는 레슨들을 컬럼으로 분배해 좌우 나란히 배치 */
  function computeColumns(lessonList: LessonWithMembers[]): Map<string, { col: number; totalCols: number }> {
    const result = new Map<string, { col: number; totalCols: number }>();
    const sorted = [...lessonList].sort((a, b) => a.start_time.localeCompare(b.start_time));

    // 그룹 단위로 겹치는 레슨 묶기
    const groups: LessonWithMembers[][] = [];
    let current: LessonWithMembers[] = [];
    let groupEnd = 0;

    for (const lesson of sorted) {
      const start = timeToMinutes(lesson.start_time);
      const end = timeToMinutes(lesson.end_time);
      if (current.length === 0 || start < groupEnd) {
        current.push(lesson);
        groupEnd = Math.max(groupEnd, end);
      } else {
        if (current.length > 0) groups.push(current);
        current = [lesson];
        groupEnd = end;
      }
    }
    if (current.length > 0) groups.push(current);

    for (const group of groups) {
      // 컬럼 배정 (greedy)
      const cols: number[] = []; // cols[i] = 해당 컬럼의 마지막 end minute
      for (const lesson of group) {
        const start = timeToMinutes(lesson.start_time);
        const end = timeToMinutes(lesson.end_time);
        let assigned = -1;
        for (let i = 0; i < cols.length; i++) {
          if (cols[i] <= start) { assigned = i; cols[i] = end; break; }
        }
        if (assigned === -1) { assigned = cols.length; cols.push(end); }
        result.set(lesson.id, { col: assigned, totalCols: 0 }); // totalCols 나중에 업데이트
      }
      const totalCols = cols.length;
      for (const lesson of group) {
        const prev = result.get(lesson.id)!;
        result.set(lesson.id, { col: prev.col, totalCols });
      }
    }
    return result;
  }

  // ── 일일 뷰 그리드 렌더 ──────────────────────────────────────
  function renderDayGrid() {
    const gridHeight = (END_HOUR - START_HOUR + 1) * HOUR_HEIGHT;

    return (
      <ScrollView ref={dayScrollRef} style={{ flex: 1 }} showsVerticalScrollIndicator={false}
        scrollEnabled={draggingId === null}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await loadDayLessons(selectedDate); setRefreshing(false); }} tintColor={Colors.navy} />}
      >
        <View style={{ height: gridHeight + 20, position: 'relative' }}>
          {/* 현재 시간 표시선 (오늘만) */}
          {selectedDate === today && (() => {
            const now = new Date();
            const kstNow = new Date(now.getTime() + 9 * 60 * 60 * 1000);
            const curMin = kstNow.getUTCHours() * 60 + kstNow.getUTCMinutes();
            if (curMin < START_HOUR * 60 || curMin > END_HOUR * 60) return null;
            const lineY = ((curMin - START_HOUR * 60) / 60) * HOUR_HEIGHT;
            return (
              <View key="now-line" style={[styles.nowLine, { top: lineY }]}>
                <View style={styles.nowDot} />
                <View style={styles.nowLineBar} />
              </View>
            );
          })()}
          {/* 시간 라인들 */}
          {HOURS.map(h => (
            <View key={h} style={[styles.hourRow, { top: (h - START_HOUR) * HOUR_HEIGHT }]}>
              <Text style={styles.hourLabel}>{String(h).padStart(2, '0')}:00</Text>
              <View style={styles.hourLine} />
            </View>
          ))}

          {/* 탭 가능한 빈 슬롯 오버레이 */}
          <TouchableOpacity
            style={[styles.gridTapOverlay, { height: gridHeight }]}
            activeOpacity={1}
            onPress={e => handleGridTap(e.nativeEvent.locationY)}
          />

          {/* 레슨 카드들 - 겹침 없이 컬럼 배치 */}
          {(() => {
            const colMap = computeColumns(lessons);
            const GRID_LEFT = 56;
            const GRID_RIGHT = 8;
            const GRID_WIDTH = Dimensions.get('window').width - GRID_LEFT - GRID_RIGHT;
            return lessons.map(lesson => {
              const startMin = timeToMinutes(lesson.start_time);
              const endMin = timeToMinutes(lesson.end_time);
              const top = (startMin - START_HOUR * 60) / 60 * HOUR_HEIGHT;
              const height = Math.max(52, (endMin - startMin) / 60 * HOUR_HEIGHT - 4);
              const isDragging = draggingId === lesson.id;
              const layout = colMap.get(lesson.id) ?? { col: 0, totalCols: 1 };
              const colWidth = (GRID_WIDTH - (layout.totalCols - 1) * 3) / layout.totalCols;
              const left = GRID_LEFT + layout.col * (colWidth + 3);
              const width = colWidth;

              return (
                <DraggableLesson
                  key={lesson.id}
                  lesson={lesson}
                  top={top}
                  height={height}
                  left={left}
                  width={width}
                  isDragging={isDragging}
                  onPress={() => router.push('/lessons/' + lesson.id as any)}
                  onDragEnd={(dy) => {
                    const deltaMin = Math.round((dy / HOUR_HEIGHT) * 60 / 10) * 10;
                    const newMin = startMin + deltaMin;
                    handleDropLesson(lesson.id, newMin);
                  }}
                  onDragStart={() => setDraggingId(lesson.id)}
                  onDragCancel={() => setDraggingId(null)}
                />
              );
            });
          })()}
        </View>
        <View style={{ height: 80 }} />
      </ScrollView>
    );
  }

  // ── 주간 뷰 (타임그리드) ─────────────────────────────────────
  function renderWeekGrid() {
    const { width: SCREEN_W } = require('react-native').Dimensions.get('window');
    const TIME_COL = 44;
    const COL_W = Math.floor((SCREEN_W - TIME_COL) / 7);
    const displayDates = getOffsetWeekDates(weekOffset);
    const gridHeight = (END_HOUR - START_HOUR + 1) * HOUR_HEIGHT;
    const DAYS_KO = ['월', '화', '수', '목', '금', '토', '일'];
    const monthLabel = (() => {
      const d = new Date(displayDates[0] + 'T00:00:00');
      return d.toLocaleDateString('ko-KR', { year: 'numeric', month: 'long' });
    })();

    // 레슨을 날짜별로 그룹핑
    const lessonsByDate = new Map<string, LessonWithMembers[]>();
    for (const dd of displayDates) lessonsByDate.set(dd, []);
    for (const d of weekData) { if (lessonsByDate.has(d.date)) lessonsByDate.set(d.date, d.lessons); }

    // 현재 시간선
    const nowKST = new Date(new Date().getTime() + 9 * 3600000);
    const nowMin = nowKST.getUTCHours() * 60 + nowKST.getUTCMinutes();
    const nowLineY = nowMin >= START_HOUR * 60 && nowMin <= END_HOUR * 60
      ? ((nowMin - START_HOUR * 60) / 60) * HOUR_HEIGHT : null;
    const todayInView = displayDates.findIndex(d => d === today);

    return (
      <View style={{ flex: 1, backgroundColor: Colors.background }}>
        {/* 주 네비게이션 헤더 */}
        <View style={styles.weekNavBar}>
          <TouchableOpacity style={styles.weekNavBtn} onPress={() => {
            const newOffset = weekOffset - 1;
            setWeekOffset(newOffset);
            loadWeekLessons(getOffsetWeekDates(newOffset));
          }}>
            <Ionicons name="chevron-back" size={18} color={Colors.navy} />
          </TouchableOpacity>
          <Text style={styles.weekNavTitle}>{monthLabel}</Text>
          <TouchableOpacity style={styles.weekNavBtn} onPress={() => {
            const newOffset = weekOffset + 1;
            setWeekOffset(newOffset);
            loadWeekLessons(getOffsetWeekDates(newOffset));
          }}>
            <Ionicons name="chevron-forward" size={18} color={Colors.navy} />
          </TouchableOpacity>
          {weekOffset !== 0 && (
            <TouchableOpacity style={styles.weekTodayBtn} onPress={() => {
              setWeekOffset(0);
              loadWeekLessons(getOffsetWeekDates(0));
            }}>
              <Text style={styles.weekTodayBtnText}>오늘</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* 요일 헤더 */}
        <View style={[styles.weekDayHeaderRow, { paddingLeft: TIME_COL }]}>
          {displayDates.map((date, i) => {
            const d = new Date(date + 'T00:00:00');
            const isToday = date === today;
            return (
              <View key={date} style={[styles.weekColHeader, { width: COL_W }, isToday && styles.weekColHeaderToday]}>
                <Text style={[styles.weekColDayName, isToday && styles.weekColDayNameToday]}>{DAYS_KO[i]}</Text>
                <Text style={[styles.weekColDayNum, isToday && styles.weekColDayNumToday]}>{d.getDate()}</Text>
              </View>
            );
          })}
        </View>

        {/* 타임 그리드 */}
        <ScrollView
          ref={dayScrollRef}
          style={{ flex: 1 }}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing}
            onRefresh={async () => { setRefreshing(true); await loadWeekLessons(displayDates); setRefreshing(false); }}
            tintColor={Colors.navy} />}
        >
          <View style={{ height: gridHeight + 20, position: 'relative', flexDirection: 'row' }}>
            {/* 시간 라벨 컬럼 */}
            <View style={{ width: TIME_COL }}>
              {HOURS.map(h => (
                <View key={h} style={[styles.weekHourLabel, { top: (h - START_HOUR) * HOUR_HEIGHT }]}>
                  <Text style={styles.hourLabel}>{String(h).padStart(2, '0')}</Text>
                </View>
              ))}
            </View>

            {/* 7개 day 컬럼 */}
            {displayDates.map((date, colIdx) => {
              const isToday = date === today;
              const colLessons = lessonsByDate.get(date) ?? [];
              const colMap = computeColumns(colLessons);
              return (
                <View key={date} style={[styles.weekDayColGrid, { width: COL_W, height: gridHeight },
                  isToday && { backgroundColor: Colors.primary + '10' }]}>
                  {/* 시간 구분선 */}
                  {HOURS.map(h => (
                    <View key={h} style={[styles.weekHourLine, { top: (h - START_HOUR) * HOUR_HEIGHT }]} />
                  ))}
                  {/* 현재 시간선 */}
                  {isToday && nowLineY !== null && (
                    <View style={[styles.weekNowLine, { top: nowLineY }]}>
                      <View style={styles.nowDot} />
                      <View style={styles.nowLineBar} />
                    </View>
                  )}
                  {/* 레슨 블록 */}
                  {colLessons.map(lesson => {
                    const startMin = timeToMinutes(lesson.start_time);
                    const endMin = timeToMinutes(lesson.end_time);
                    const top = (startMin - START_HOUR * 60) / 60 * HOUR_HEIGHT;
                    const height = Math.max(30, (endMin - startMin) / 60 * HOUR_HEIGHT - 2);
                    const layout = colMap.get(lesson.id) ?? { col: 0, totalCols: 1 };
                    const bWidth = (COL_W - 4 - (layout.totalCols - 1) * 2) / layout.totalCols;
                    const left = 2 + layout.col * (bWidth + 2);
                    const isPast = endMin < nowMin && date <= today;
                    return (
                      <TouchableOpacity
                        key={lesson.id}
                        style={[styles.weekLessonBlock, {
                          top, height, left, width: bWidth,
                          backgroundColor: isPast ? Colors.mutedBg : Colors.primary,
                        }]}
                        onPress={() => router.push('/lessons/' + lesson.id as any)}
                        activeOpacity={0.8}
                      >
                        <Text style={[styles.weekBlockName, isPast && { color: Colors.mutedFg }]}
                          numberOfLines={2}>
                          {lesson.memberNames.length > 0 ? lesson.memberNames.join(',') : lesson.title.replace(/ 레슨$/, '')}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              );
            })}
          </View>
          <View style={{ height: 80 }} />
        </ScrollView>
      </View>
    );
  }

    // ── 월간 뷰 ───────────────────────────────────────────────────
  function renderMonthView() {
    const { year, month } = monthYear;
    const firstDayOfMonth = new Date(year, month, 1).getDay(); // 0=일
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const monthLabel = new Date(year, month, 1).toLocaleDateString('ko-KR', { year: 'numeric', month: 'long' });

    const cells: (number | null)[] = [
      ...Array(firstDayOfMonth).fill(null),
      ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
    ];
    // pad to complete last row
    while (cells.length % 7 !== 0) cells.push(null);

    return (
      <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await loadMonthLessons(year, month); setRefreshing(false); }} tintColor={Colors.navy} />}
      >
        {/* 월 헤더 */}
        <View style={styles.monthHeader}>
          <TouchableOpacity style={styles.monthNavBtn} onPress={() => {
            const d = month === 0 ? { year: year - 1, month: 11 } : { year, month: month - 1 };
            setMonthYear(d); loadMonthLessons(d.year, d.month);
          }}>
            <Ionicons name="chevron-back" size={20} color={Colors.navy} />
          </TouchableOpacity>
          <Text style={styles.monthTitle}>{monthLabel}</Text>
          <TouchableOpacity style={styles.monthNavBtn} onPress={() => {
            const d = month === 11 ? { year: year + 1, month: 0 } : { year, month: month + 1 };
            setMonthYear(d); loadMonthLessons(d.year, d.month);
          }}>
            <Ionicons name="chevron-forward" size={20} color={Colors.navy} />
          </TouchableOpacity>
        </View>

        {/* 요일 헤더 */}
        <View style={styles.monthDayHeaders}>
          {['일', '월', '화', '수', '목', '금', '토'].map((d, i) => (
            <Text key={d} style={[styles.monthDayName, i === 0 && { color: Colors.destructive }, i === 6 && { color: Colors.info }]}>{d}</Text>
          ))}
        </View>

        {/* 날짜 그리드 */}
        <View style={styles.monthGrid}>
          {cells.map((day, idx) => {
            if (!day) return <View key={`empty-${idx}`} style={styles.monthCell} />;
            const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
            const dayLessons = monthLessons.get(dateStr) ?? [];
            const isToday = dateStr === today;
            const isSun = idx % 7 === 0;
            const isSat = idx % 7 === 6;
            return (
              <TouchableOpacity
                key={dateStr}
                style={[styles.monthCell, isToday && styles.monthCellToday]}
                onPress={() => { setSelectedDate(dateStr); setActiveTab('일일'); loadDayLessons(dateStr); }}
              >
                <Text style={[
                  styles.monthCellDay,
                  isToday && styles.monthCellDayToday,
                  isSun && !isToday && { color: Colors.destructive },
                  isSat && !isToday && { color: Colors.info },
                ]}>{day}</Text>
                {dayLessons.length > 0 && (
                  <View style={styles.monthLessonDots}>
                    {dayLessons.slice(0, 3).map((l, i) => (
                      <View key={i} style={styles.monthDot} />
                    ))}
                    {dayLessons.length > 0 && (
                      <Text style={styles.monthLessonCount}>{dayLessons.length}</Text>
                    )}
                  </View>
                )}
              </TouchableOpacity>
            );
          })}
        </View>

        {/* 이번 달 레슨 요약 */}
        <View style={styles.monthSummary}>
          <View style={styles.monthSummaryItem}>
            <Text style={styles.monthSummaryNum}>{Array.from(monthLessons.values()).reduce((s, ls) => s + ls.length, 0)}</Text>
            <Text style={styles.monthSummaryLabel}>총 레슨</Text>
          </View>
          <View style={styles.monthSummaryDivider} />
          <View style={styles.monthSummaryItem}>
            <Text style={styles.monthSummaryNum}>{monthLessons.size}</Text>
            <Text style={styles.monthSummaryLabel}>레슨일</Text>
          </View>
          <View style={styles.monthSummaryDivider} />
          <View style={styles.monthSummaryItem}>
            <Text style={styles.monthSummaryNum}>{new Set(Array.from(monthLessons.values()).flat().flatMap(l => l.memberIds)).size}</Text>
            <Text style={styles.monthSummaryLabel}>참여 회원</Text>
          </View>
        </View>
        <View style={{ height: 100 }} />
      </ScrollView>
    );
  }

  return (
    <View style={styles.container}>
      {/* 탭 */}
      <View style={styles.tabRow}>
        {(['일일', '주간', '월간'] as ViewTab[]).map(tab => (
          <TouchableOpacity key={tab} style={[styles.tabBtn, activeTab === tab && styles.tabBtnActive]} onPress={() => setActiveTab(tab)}>
            <Text style={[styles.tabText, activeTab === tab && styles.tabTextActive]}>{tab}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {activeTab === '일일' ? (
        <>
          {/* 날짜 스트립 */}
          <View style={styles.weekStrip}>
            {weekDates.map(date => {
              const d = new Date(date + 'T00:00:00');
              const isSelected = date === selectedDate;
              const isToday = date === today;
              return (
                <TouchableOpacity key={date} style={[styles.dayBtn, isSelected && styles.daySelected]} onPress={() => handleSelectDate(date)}>
                  <Text style={[styles.dayName, isSelected && styles.dayTextSelected]}>{DAYS[d.getDay()]}</Text>
                  <Text style={[styles.dayNum, isSelected && styles.dayTextSelected, isToday && !isSelected && styles.dayToday]}>{d.getDate()}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
          <Text style={styles.dateHeader}>
            {new Date(selectedDate + 'T00:00:00').toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'long' })}
            <Text style={{ fontSize: 12, color: Colors.navy, fontWeight: '500' }}>  시간 탭해서 레슨 등록</Text>
          </Text>
          {renderDayGrid()}
        </>
      ) : activeTab === '주간' ? (
        renderWeekGrid()
      ) : renderMonthView()}

      {/* FAB */}
      <TouchableOpacity style={styles.fab} onPress={() => router.push('/lessons/new')}>
        <Ionicons name="add" size={28} color="#fff" />
      </TouchableOpacity>

      {/* 새 레슨 등록 모달 */}
      <Modal visible={newModal} transparent animationType="slide" onRequestClose={() => setNewModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>새 레슨 등록</Text>
              <TouchableOpacity onPress={() => setNewModal(false)}><Ionicons name="close" size={22} color={Colors.mutedFg} /></TouchableOpacity>
            </View>
            <ScrollView style={{ maxHeight: 520 }} contentContainerStyle={{ padding: 20 }} keyboardShouldPersistTaps="handled">
              {/* 회원 선택 */}
              <Text style={styles.modalLabel}>회원 선택</Text>
              <TextInput style={styles.modalInput} placeholder="이름 검색..." value={memberSearch} onChangeText={setMemberSearch} />
              <ScrollView style={styles.memberList} nestedScrollEnabled>
                {members.filter(m => m.name.includes(memberSearch)).map(m => {
                  const selected = newMemberIds.includes(m.id);
                  return (
                    <TouchableOpacity key={m.id} style={[styles.memberItem, selected && styles.memberItemSelected]}
                      onPress={() => setNewMemberIds(prev => selected ? prev.filter(id => id !== m.id) : [...prev, m.id])}>
                      <Text style={[styles.memberItemText, selected && styles.memberItemTextSelected]}>{m.name}</Text>
                      {selected && <Ionicons name="checkmark" size={16} color={Colors.primary} />}
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
              {newMemberIds.length > 0 && (
                <Text style={styles.selectedNames}>{members.filter(m => newMemberIds.includes(m.id)).map(m => m.name).join(', ')}</Text>
              )}

              {/* 시작 시간 - Hour/Minute 스피너 */}
              <Text style={styles.modalLabel}>시작 시간</Text>
              <View style={styles.timeRow}>
                <TouchableOpacity style={styles.spinnerBtn} onPress={() => { setHourPickerVisible(true); setMinutePickerVisible(false); setDurationPickerVisible(false); }}>
                  <Text style={styles.spinnerBtnLabel}>시</Text>
                  <Text style={styles.spinnerBtnValue}>{newHour}</Text>
                </TouchableOpacity>
                <Text style={styles.colonText}>:</Text>
                <TouchableOpacity style={styles.spinnerBtn} onPress={() => { setMinutePickerVisible(true); setHourPickerVisible(false); setDurationPickerVisible(false); }}>
                  <Text style={styles.spinnerBtnLabel}>분</Text>
                  <Text style={styles.spinnerBtnValue}>{newMinute}</Text>
                </TouchableOpacity>
              </View>
              {hourPickerVisible && (
                <View style={styles.inlinePickerBox}>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                    {SPINNER_HOURS.map(item => (
                      <TouchableOpacity key={item} style={[styles.inlinePickerItem, newHour === item && styles.inlinePickerItemActive]}
                        onPress={() => { setNewHour(item); setHourPickerVisible(false); }}>
                        <Text style={[styles.inlinePickerText, newHour === item && styles.inlinePickerTextActive]}>{item}</Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                </View>
              )}
              {minutePickerVisible && (
                <View style={styles.inlinePickerBox}>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                    {SPINNER_MINUTES.map(item => (
                      <TouchableOpacity key={item} style={[styles.inlinePickerItem, newMinute === item && styles.inlinePickerItemActive]}
                        onPress={() => { setNewMinute(item); setMinutePickerVisible(false); }}>
                        <Text style={[styles.inlinePickerText, newMinute === item && styles.inlinePickerTextActive]}>{item}</Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                </View>
              )}

              {/* 레슨 시간 - 분 스피너 */}
              <Text style={styles.modalLabel}>레슨 시간</Text>
              <TouchableOpacity style={styles.spinnerBtn} onPress={() => { setDurationPickerVisible(v => !v); setHourPickerVisible(false); setMinutePickerVisible(false); }}>
                <Text style={styles.spinnerBtnLabel}>분</Text>
                <Text style={styles.spinnerBtnValue}>{newDuration}분</Text>
              </TouchableOpacity>
              {durationPickerVisible && (
                <View style={styles.inlinePickerBox}>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                    {DURATION_OPTIONS.map(item => (
                      <TouchableOpacity key={item} style={[styles.inlinePickerItem, newDuration === item && styles.inlinePickerItemActive]}
                        onPress={() => { setNewDuration(item); setDurationPickerVisible(false); }}>
                        <Text style={[styles.inlinePickerText, newDuration === item && styles.inlinePickerTextActive]}>{item}</Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                </View>
              )}

              <Text style={styles.timeSummary}>{newHour}:{newMinute} ~ {minutesToTime(parseInt(newHour) * 60 + parseInt(newMinute) + newDuration)}</Text>
              <TouchableOpacity style={styles.saveBtn} onPress={handleSaveNew} disabled={savingNew}>
                {savingNew ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveBtnText}>등록</Text>}
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

// ── 드래그 가능한 레슨 카드 컴포넌트 ──────────────────────────
function DraggableLesson({
  lesson, top, height, left, width, isDragging, onPress, onDragEnd, onDragStart, onDragCancel,
}: {
  lesson: LessonWithMembers; top: number; height: number; left: number; width: number; isDragging: boolean;
  onPress: () => void; onDragEnd: (dy: number) => void; onDragStart: () => void; onDragCancel: () => void;
}) {
  const pan = useRef(new Animated.ValueXY()).current;
  const dragging = useRef(false);

  // 콜백을 ref로 관리 → PanResponder가 항상 최신 콜백 참조
  const onDragEndRef = useRef(onDragEnd);
  const onDragStartRef = useRef(onDragStart);
  const onDragCancelRef = useRef(onDragCancel);
  const onPressRef = useRef(onPress);
  useEffect(() => {
    onDragEndRef.current = onDragEnd;
    onDragStartRef.current = onDragStart;
    onDragCancelRef.current = onDragCancel;
    onPressRef.current = onPress;
  }, [onDragEnd, onDragStart, onDragCancel, onPress]);

  const panResponder = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => dragging.current,
    onStartShouldSetPanResponderCapture: () => dragging.current,
    onMoveShouldSetPanResponder: (_, g) => dragging.current && Math.abs(g.dy) > 3,
    onMoveShouldSetPanResponderCapture: (_, g) => dragging.current && Math.abs(g.dy) > 3,
    onPanResponderGrant: () => {
      pan.setOffset({ x: 0, y: (pan.y as any)._value });
      pan.setValue({ x: 0, y: 0 });
    },
    onPanResponderMove: Animated.event([null, { dy: pan.y }], { useNativeDriver: false }),
    onPanResponderRelease: (_, g) => {
      if (!dragging.current) return;
      dragging.current = false;
      pan.flattenOffset();
      const dy = g.dy;
      pan.setValue({ x: 0, y: 0 });
      onDragEndRef.current(dy);
      onDragCancelRef.current();
    },
    onPanResponderTerminate: () => {
      dragging.current = false;
      pan.setValue({ x: 0, y: 0 });
      onDragCancelRef.current();
    },
    onShouldBlockNativeResponder: () => dragging.current,
  })).current;

  return (
    <Animated.View
      style={[
        styles.lessonCard,
        { top, height, left, width, transform: [{ translateY: pan.y }], zIndex: isDragging ? 999 : 1 },
        isDragging && styles.lessonCardDragging,
      ]}
      {...panResponder.panHandlers}
    >
      <TouchableOpacity
        style={{ flex: 1 }}
        onPress={() => { if (!isDragging) onPressRef.current(); }}
        onLongPress={() => {
          dragging.current = true;
          onDragStartRef.current();
        }}
        delayLongPress={350}
        activeOpacity={0.85}
      >
        <View style={{ flex: 1, justifyContent: 'center' }}>
          <Text style={styles.lessonCardTitle} numberOfLines={2}>
            {lesson.memberNames.length > 0 ? lesson.memberNames.join(', ') : lesson.title.replace(/ 레슨$/, '')}
          </Text>
          <Text style={styles.lessonCardTime} numberOfLines={1}>{lesson.start_time.slice(0, 5)}~{lesson.end_time.slice(0, 5)}</Text>
        </View>
      </TouchableOpacity>
      {isDragging && (
        <View style={styles.dragHandle}>
          <Ionicons name="reorder-three" size={16} color="#fff" />
        </View>
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  tabRow: { flexDirection: 'row', backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: Colors.border, paddingHorizontal: 16, paddingVertical: 8, gap: 8 },
  tabBtn: { flex: 1, paddingVertical: 8, borderRadius: 10, alignItems: 'center', backgroundColor: Colors.mutedBg },
  tabBtnActive: { backgroundColor: Colors.primary },
  tabText: { fontSize: 14, fontWeight: '700', color: Colors.mutedFg },
  tabTextActive: { color: '#fff' },
  weekStrip: { flexDirection: 'row', backgroundColor: '#fff', paddingVertical: 12, paddingHorizontal: 8, borderBottomWidth: 1, borderBottomColor: Colors.border },
  dayBtn: { flex: 1, alignItems: 'center', paddingVertical: 6, borderRadius: 10 },
  daySelected: { backgroundColor: Colors.primary },
  dayName: { fontSize: 11, color: Colors.mutedFg, marginBottom: 4 },
  dayNum: { fontSize: 16, fontWeight: '700', color: Colors.foreground },
  dayTextSelected: { color: '#fff' },
  dayToday: { color: Colors.navy },
  dateHeader: { fontSize: 14, color: Colors.mutedFg, paddingHorizontal: 16, paddingVertical: 8, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: Colors.mutedBg },
  // 그리드
  hourRow: { position: 'absolute', left: 0, right: 0, flexDirection: 'row', alignItems: 'center', height: HOUR_HEIGHT },
  hourLabel: { width: 48, fontSize: 12, color: Colors.placeholder, fontWeight: '600', textAlign: 'right', paddingRight: 8 },
  hourLine: { flex: 1, height: 1, backgroundColor: Colors.border },
  gridTapOverlay: { position: 'absolute', left: 48, right: 0, top: 0 },
  // 레슨 카드 (그리드)
  lessonCard: {
    position: 'absolute',
    backgroundColor: Colors.primary, borderRadius: 8, padding: 6, paddingHorizontal: 8,
    },
  lessonCardDragging: { opacity: 0.85, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8, elevation: 8 },
  lessonCardTime: { fontSize: 12, color: 'rgba(255,255,255,0.75)', fontWeight: '600', flexShrink: 0 },
  lessonCardTitle: { fontSize: 14, color: '#fff', fontWeight: '800', flexShrink: 1 },
  lessonCardMembers: { fontSize: 10, color: 'rgba(255,255,255,0.75)', marginTop: 1 },
  dragHandle: { position: 'absolute', bottom: 3, right: 6 },
  // 주간 뷰
  weekScroll: { flex: 1 },
  weekDayCol: { width: 130, backgroundColor: '#fff', borderRadius: 12, overflow: 'hidden', shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 4, elevation: 1 },
  weekDayColToday: { borderWidth: 2, borderColor: Colors.primary },
  weekDayHeader: { backgroundColor: Colors.background, paddingVertical: 10, alignItems: 'center', borderBottomWidth: 1, borderBottomColor: Colors.border },
  weekDayHeaderToday: { backgroundColor: Colors.primary },
  weekDayName: { fontSize: 13, color: Colors.mutedFg, fontWeight: '600' },
  weekDayNameToday: { color: 'rgba(255,255,255,0.85)' },
  weekDayNum: { fontSize: 22, fontWeight: '800', color: Colors.foreground, marginTop: 2 },
  weekDayNumToday: { color: '#fff' },
  weekEmptySlot: { padding: 16, alignItems: 'center' },
  weekEmptyText: { fontSize: 20, color: Colors.border },
  weekLessonCard: { margin: 8, backgroundColor: Colors.primaryLight, borderRadius: 8, padding: 8 },
  weekLessonTime: { fontSize: 13, color: Colors.navy, fontWeight: '700', marginBottom: 2 },
  weekLessonTitle: { fontSize: 14, color: Colors.foreground, fontWeight: '600' },
  weekLessonMembers: { fontSize: 11, color: Colors.navy, marginTop: 2 },
  // FAB
  fab: { position: 'absolute', bottom: 24, right: 20, width: 56, height: 56, borderRadius: 28, backgroundColor: Colors.primary, justifyContent: 'center', alignItems: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.2, shadowRadius: 8, elevation: 6 },
  // 모달
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  modalSheet: { backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingBottom: 40 },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: Colors.border },
  modalTitle: { fontSize: 17, fontWeight: '700', color: Colors.foreground },
  modalLabel: { fontSize: 13, fontWeight: '600', color: Colors.mutedFg, marginBottom: 8, marginTop: 12 },
  modalInput: { backgroundColor: Colors.mutedBg, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, fontSize: 15, color: Colors.foreground, borderWidth: 1, borderColor: Colors.border },
  timeRow: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  timeAdj: { flex: 1, backgroundColor: Colors.mutedBg, borderRadius: 8, paddingVertical: 8, alignItems: 'center' },
  timeAdjText: { fontSize: 13, fontWeight: '600', color: Colors.mutedFg },
  timeDisplay: { fontSize: 32, fontWeight: '800', color: Colors.navy, textAlign: 'center', marginBottom: 4 },
  timeSummary: { fontSize: 13, color: Colors.mutedFg, textAlign: 'center', marginBottom: 16 },
  durationBtn: { flex: 1, backgroundColor: Colors.mutedBg, borderRadius: 8, paddingVertical: 8, alignItems: 'center' },
  durationBtnActive: { backgroundColor: Colors.primary },
  durationBtnText: { fontSize: 13, fontWeight: '600', color: Colors.mutedFg },
  durationBtnTextActive: { color: '#fff' },
  saveBtn: { backgroundColor: Colors.primary, borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginTop: 8 },
  saveBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  nowLine: { position: 'absolute', left: 0, right: 0, flexDirection: 'row', alignItems: 'center', zIndex: 10 },
  nowDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: Colors.destructive, marginLeft: 42 },
  nowLineBar: { flex: 1, height: 2, backgroundColor: Colors.destructive, marginLeft: 2 },
  memberList: { maxHeight: 160, borderWidth: 1, borderColor: Colors.border, borderRadius: 10, marginBottom: 8 },
  memberItem: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: Colors.mutedBg },
  memberItemSelected: { backgroundColor: Colors.primaryLight },
  memberItemText: { fontSize: 14, color: Colors.foreground },
  memberItemTextSelected: { color: Colors.navy, fontWeight: '700' },
  selectedNames: { fontSize: 12, color: Colors.navy, fontWeight: '600', marginBottom: 4, backgroundColor: Colors.primaryLight, padding: 8, borderRadius: 8 },
  spinnerBtn: { flex: 1, backgroundColor: Colors.mutedBg, borderRadius: 10, padding: 12, alignItems: 'center', borderWidth: 1, borderColor: Colors.border },
  spinnerBtnLabel: { fontSize: 11, color: Colors.placeholder, fontWeight: '600', marginBottom: 2 },
  spinnerBtnValue: { fontSize: 20, fontWeight: '800', color: Colors.navy },
  colonText: { fontSize: 24, fontWeight: '800', color: Colors.foreground, paddingHorizontal: 8, alignSelf: 'center', marginTop: 12 },
  inlinePickerBox: { backgroundColor: Colors.background, borderRadius: 10, padding: 8, marginTop: 6, marginBottom: 4 },
  inlinePickerItem: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 8, marginHorizontal: 3, alignItems: 'center' },
  inlinePickerItemActive: { backgroundColor: Colors.primary },
  inlinePickerText: { fontSize: 16, fontWeight: '600', color: Colors.mutedFg },
  inlinePickerTextActive: { color: '#fff', fontWeight: '800' },


  // 주간 타임그리드 스타일
  weekNavBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16, paddingVertical: 10, backgroundColor: Colors.white, borderBottomWidth: 1, borderBottomColor: Colors.border, gap: 8 },
  weekNavBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: Colors.mutedBg, justifyContent: 'center', alignItems: 'center' },
  weekNavTitle: { flex: 1, textAlign: 'center', fontSize: 16, fontWeight: '800', color: Colors.navy },
  weekTodayBtn: { backgroundColor: Colors.primary, paddingHorizontal: 12, paddingVertical: 5, borderRadius: 8 },
  weekTodayBtnText: { color: Colors.white, fontSize: 12, fontWeight: '700' },
  weekDayHeaderRow: { flexDirection: 'row', backgroundColor: Colors.white, borderBottomWidth: 1, borderBottomColor: Colors.border },
  weekColHeader: { alignItems: 'center', paddingVertical: 8, borderLeftWidth: 1, borderLeftColor: Colors.border },
  weekColHeaderToday: { backgroundColor: Colors.primary },
  weekColDayName: { fontSize: 11, fontWeight: '700', color: Colors.mutedFg },
  weekColDayNameToday: { color: 'rgba(255,255,255,0.8)' },
  weekColDayNum: { fontSize: 17, fontWeight: '800', color: Colors.foreground, marginTop: 1 },
  weekColDayNumToday: { color: Colors.white },
  weekHourLabel: { position: 'absolute', left: 0, right: 0, justifyContent: 'flex-start', alignItems: 'flex-end', paddingRight: 6, height: HOUR_HEIGHT },
  weekDayColGrid: { position: 'relative', borderLeftWidth: 1, borderLeftColor: Colors.border },
  weekHourLine: { position: 'absolute', left: 0, right: 0, height: 1, backgroundColor: Colors.border },
  weekNowLine: { position: 'absolute', left: 0, right: 0, flexDirection: 'row', alignItems: 'center', zIndex: 10 },
  weekLessonBlock: { position: 'absolute', borderRadius: 4, paddingHorizontal: 3, paddingVertical: 2, overflow: 'hidden' },
  weekBlockName: { fontSize: 10, fontWeight: '700', color: Colors.white, lineHeight: 13 },
  // 월간 뷰
  monthHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 14, backgroundColor: Colors.white, borderBottomWidth: 1, borderBottomColor: Colors.border },
  monthNavBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: Colors.mutedBg, justifyContent: 'center', alignItems: 'center' },
  monthTitle: { fontSize: 17, fontWeight: '800', color: Colors.navy },
  monthDayHeaders: { flexDirection: 'row', backgroundColor: Colors.white, paddingVertical: 8, paddingHorizontal: 4, borderBottomWidth: 1, borderBottomColor: Colors.border },
  monthDayName: { flex: 1, textAlign: 'center', fontSize: 12, fontWeight: '700', color: Colors.mutedFg },
  monthGrid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 4, paddingTop: 4 },
  monthCell: { width: '14.28%', minHeight: 64, padding: 4, alignItems: 'center', borderRadius: 8 },
  monthCellToday: { backgroundColor: Colors.primary + '18' },
  monthCellDay: { fontSize: 15, fontWeight: '600', color: Colors.foreground, marginBottom: 3 },
  monthCellDayToday: { color: Colors.primary, fontWeight: '800' },
  monthLessonDots: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  monthDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: Colors.primary },
  monthLessonCount: { fontSize: 10, fontWeight: '700', color: Colors.primary, marginLeft: 1 },
  monthSummary: { flexDirection: 'row', marginHorizontal: 16, marginTop: 16, backgroundColor: Colors.white, borderRadius: 14, padding: 16, borderWidth: 1, borderColor: Colors.border },
  monthSummaryItem: { flex: 1, alignItems: 'center' },
  monthSummaryDivider: { width: 1, backgroundColor: Colors.border },
  monthSummaryNum: { fontSize: 22, fontWeight: '800', color: Colors.navy },
  monthSummaryLabel: { fontSize: 11, color: Colors.mutedFg, marginTop: 2 },
});
