import React, { useState, useRef } from 'react';
import {
  View, Text, TouchableOpacity, Modal, FlatList,
  ScrollView, StyleSheet,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../lib/theme';

const DAYS_KR = ['일', '월', '화', '수', '목', '금', '토'];
const HOURS = Array.from({ length: 18 }, (_, i) => String(i + 6).padStart(2, '0'));
const MINUTES = ['00', '10', '20', '30', '40', '50'];
const MONTHS_KR = ['1월','2월','3월','4월','5월','6월','7월','8월','9월','10월','11월','12월'];
const DAYS_LABEL = ['일','월','화','수','목','금','토'];

function toKSTDateStr(d: Date): string {
  const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().split('T')[0];
}

export type ScheduleType = 'regular' | 'by_date' | 'later';
export type DayTimes = Record<number, string[]>;
export type DateEntry = { date: string; time: string };

interface Props {
  scheduleType: ScheduleType;
  onScheduleTypeChange: (t: ScheduleType) => void;
  scheduleDays: number[];
  onDaysChange: (days: number[]) => void;
  dayTimes: DayTimes;
  onDayTimesChange: (dt: DayTimes) => void;
  byDateEntries?: DateEntry[];
  onByDateEntriesChange?: (entries: DateEntry[]) => void;
  startDate: string;
  onStartDateChange: (date: string) => void;
  startDateLabel?: string;
  hideNeverOption?: boolean;
  hideRegularOption?: boolean;
  byDateContent?: React.ReactNode;
  onDayAdded?: (day: number) => void;
  lessonDuration?: number;
}

function calcEndTime(startTime: string, durationMinutes: number): string {
  const [h, m] = startTime.split(':').map(Number);
  const endMin = h * 60 + m + durationMinutes;
  return `${String(Math.floor(endMin / 60)).padStart(2, '0')}:${String(endMin % 60).padStart(2, '0')}`;
}

export function ScheduleSection({
  scheduleType,
  onScheduleTypeChange,
  scheduleDays,
  onDaysChange,
  dayTimes,
  onDayTimesChange,
  byDateEntries = [],
  onByDateEntriesChange,
  startDate,
  onStartDateChange,
  startDateLabel = '첫 레슨 날짜',
  hideNeverOption = false,
  hideRegularOption = false,
  byDateContent,
  onDayAdded,
  lessonDuration,
}: Props) {
  const [timePickerVisible, setTimePickerVisible] = useState(false);
  const [editingDay, setEditingDay] = useState<number | null>(null);
  const [editingTimeIndex, setEditingTimeIndex] = useState<number | null>(null);
  const [tempHour, setTempHour] = useState('');
  const [tempMinute, setTempMinute] = useState('00');
  const timePickerModeRef = useRef<'regular' | 'by_date'>('regular');
  const byDateTempDateRef = useRef('');

  const [startDateModalVisible, setStartDateModalVisible] = useState(false);
  const [startCalMonth, setStartCalMonth] = useState({
    year: new Date().getFullYear(),
    month: new Date().getMonth(),
  });

  const [byDatePickerVisible, setByDatePickerVisible] = useState(false);
  const [byDateCalMonth, setByDateCalMonth] = useState({
    year: new Date().getFullYear(),
    month: new Date().getMonth(),
  });

  const allDaysHaveTimes = scheduleDays.length > 0 && scheduleDays.every(d => (dayTimes[d]?.length ?? 0) > 0);
  const todayStr = toKSTDateStr(new Date());

  function openTimePicker(day: number, timeIndex: number | null = null) {
    setEditingDay(day);
    setEditingTimeIndex(timeIndex);
    if (timeIndex !== null) {
      const existing = dayTimes[day]?.[timeIndex];
      if (existing) {
        setTempHour(existing.split(':')[0]);
        setTempMinute(existing.split(':')[1] || '00');
      } else {
        setTempHour(''); setTempMinute('00');
      }
    } else {
      setTempHour(''); setTempMinute('00');
    }
    setTimePickerVisible(true);
  }

  function confirmTime() {
    if (!tempHour) return;
    const newTime = `${tempHour}:${tempMinute}`;
    if (timePickerModeRef.current === 'by_date') {
      if (byDateTempDateRef.current && onByDateEntriesChange) {
        const entry: DateEntry = { date: byDateTempDateRef.current, time: newTime };
        onByDateEntriesChange(
          [...byDateEntries, entry].sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time))
        );
      }
      timePickerModeRef.current = 'regular';
      byDateTempDateRef.current = '';
      setTempHour(''); setTempMinute('00');
      setTimePickerVisible(false);
      return;
    }
    if (editingDay === null) return;
    const times = [...(dayTimes[editingDay] ?? [])];
    if (editingTimeIndex !== null) {
      times[editingTimeIndex] = newTime;
    } else {
      if (!times.includes(newTime)) times.push(newTime);
    }
    times.sort();
    onDayTimesChange({ ...dayTimes, [editingDay]: times });
    setTimePickerVisible(false);
    setEditingDay(null);
    setEditingTimeIndex(null);
  }

  function removeTime(day: number, timeIndex: number) {
    const times = [...(dayTimes[day] ?? [])];
    times.splice(timeIndex, 1);
    onDayTimesChange({ ...dayTimes, [day]: times });
  }

  const options: { key: ScheduleType; label: string; icon: string }[] = [
    ...(hideRegularOption ? [] : [{ key: 'regular' as const, label: '매주 같은 요일', icon: 'repeat' }]),
    { key: 'by_date', label: '날짜 직접 선택', icon: 'calendar' },
    ...(hideNeverOption ? [] : [{ key: 'later' as const, label: '나중에 설정', icon: 'time-outline' }]),
  ];

  function renderCalendar(
    calMonth: { year: number; month: number },
    setCalMonth: React.Dispatch<React.SetStateAction<{ year: number; month: number }>>,
    selectedDate: string,
    onSelectDate: (d: string) => void,
    markedDates?: string[],
    disablePast?: boolean,
  ) {
    const { year, month } = calMonth;
    const firstDow = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const cells: (number | null)[] = [];
    for (let i = 0; i < firstDow; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) cells.push(d);
    while (cells.length % 7 !== 0) cells.push(null);
    return (
      <View>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <TouchableOpacity style={{ padding: 8 }} onPress={() => setCalMonth(p => {
            const m = p.month - 1; return m < 0 ? { year: p.year - 1, month: 11 } : { year: p.year, month: m };
          })}>
            <Ionicons name="chevron-back" size={20} color={Colors.primary} />
          </TouchableOpacity>
          <Text style={{ fontSize: 16, fontWeight: '800', color: Colors.primary }}>{year}년 {MONTHS_KR[month]}</Text>
          <TouchableOpacity style={{ padding: 8 }} onPress={() => setCalMonth(p => {
            const m = p.month + 1; return m > 11 ? { year: p.year + 1, month: 0 } : { year: p.year, month: m };
          })}>
            <Ionicons name="chevron-forward" size={20} color={Colors.primary} />
          </TouchableOpacity>
        </View>
        <View style={{ flexDirection: 'row', marginBottom: 4 }}>
          {DAYS_LABEL.map((dl, di) => (
            <Text key={di} style={{ flex: 1, textAlign: 'center', fontSize: 14, fontWeight: '700',
              color: di === 0 ? Colors.destructive : di === 6 ? Colors.accentWarm : Colors.mutedFg, paddingVertical: 4 }}>{dl}</Text>
          ))}
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
          {cells.map((day, ci) => {
            if (!day) return <View key={ci} style={{ width: '14.28%', paddingVertical: 3 }} />;
            const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
            const isToday = dateStr === todayStr;
            const isSelected = dateStr === selectedDate;
            const isMarked = markedDates?.includes(dateStr);
            const isPast = disablePast && dateStr < todayStr;
            const dow = ci % 7;
            return (
              <TouchableOpacity
                key={ci}
                disabled={isPast}
                style={{ width: '14.28%', alignItems: 'center', paddingVertical: 3 }}
                onPress={() => onSelectDate(dateStr)}
              >
                <View style={{ width: 34, height: 34, borderRadius: 17, justifyContent: 'center', alignItems: 'center',
                  backgroundColor: isSelected || isMarked ? Colors.primary : isToday ? Colors.primary + '18' : 'transparent' }}>
                  <Text style={{ fontSize: 14, fontWeight: isSelected || isToday || isMarked ? '800' : '400',
                    color: isSelected || isMarked ? '#fff' : isPast ? Colors.border : dow === 0 ? Colors.destructive : dow === 6 ? Colors.accentWarm : Colors.foreground,
                  }}>{day}</Text>
                </View>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>
    );
  }

  return (
    <>
      {/* 일정 방식 선택 */}
      <View style={typeStyles.row}>
        {options.map(opt => (
          <TouchableOpacity
            key={opt.key}
            style={[typeStyles.btn, scheduleType === opt.key && typeStyles.btnActive]}
            onPress={() => onScheduleTypeChange(opt.key)}
          >
            <Ionicons name={opt.icon as any} size={16} color={scheduleType === opt.key ? '#fff' : Colors.mutedFg} />
            <Text style={[typeStyles.btnText, scheduleType === opt.key && typeStyles.btnTextActive]}>{opt.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* 매주 같은 요일 */}
      {scheduleType === 'regular' && (
        <>
          <Text style={ss.label}>레슨 요일</Text>
          <View style={ss.dayRow}>
            {DAYS_KR.map((d, i) => (
              <TouchableOpacity
                key={i}
                style={[ss.dayBtn, scheduleDays.includes(i) && ss.dayBtnActive]}
                onPress={() => {
                  if (scheduleDays.includes(i)) {
                    onDaysChange(scheduleDays.filter(x => x !== i));
                    const nd = { ...dayTimes };
                    delete nd[i];
                    onDayTimesChange(nd);
                  } else {
                    onDaysChange([...scheduleDays, i].sort((a, b) => a - b));
                    onDayAdded?.(i);
                  }
                }}
              >
                <Text style={[ss.dayBtnText, scheduleDays.includes(i) && ss.dayBtnTextActive]}>{d}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {scheduleDays.length > 0 && (
            <View style={ss.dayTimeList}>
              <Text style={ss.label}>요일별 시작 시간 <Text style={ss.labelHint}>(타임 여러개 추가 가능)</Text></Text>
              {scheduleDays.map(day => {
                const times = dayTimes[day] ?? [];
                return (
                  <View key={day} style={ss.dayTimeBlock}>
                    <View style={ss.dayTimeBlockHeader}>
                      <View style={[ss.dayTimeBadge, times.length > 0 ? ss.dayTimeBadgeSet : ss.dayTimeBadgeEmpty]}>
                        <Text style={[ss.dayTimeBadgeText, times.length > 0 ? ss.dayTimeBadgeTextSet : {}]}>{DAYS_KR[day]}</Text>
                      </View>
                      <TouchableOpacity style={ss.addTimeBtn} onPress={() => openTimePicker(day, null)}>
                        <Ionicons name="add-circle-outline" size={18} color={Colors.primary} />
                        <Text style={ss.addTimeBtnText}>시간 추가</Text>
                      </TouchableOpacity>
                    </View>
                    {times.length === 0 && (
                      <Text style={ss.dayTimeEmpty}>시간을 추가해주세요</Text>
                    )}
                    {times.map((time, idx) => (
                      <View key={idx} style={ss.dayTimeRow}>
                        <Ionicons name="time" size={15} color={Colors.primary} />
                        <Text style={ss.dayTimeValue}>
                          {time}
                          {lessonDuration ? (
                            <Text style={ss.endTimeLabel}> → {calcEndTime(time, lessonDuration)}</Text>
                          ) : null}
                        </Text>
                        <TouchableOpacity onPress={() => openTimePicker(day, idx)} style={ss.timeAction}>
                          <Ionicons name="pencil-outline" size={15} color={Colors.mutedFg} />
                        </TouchableOpacity>
                        <TouchableOpacity onPress={() => removeTime(day, idx)} style={ss.timeAction}>
                          <Ionicons name="close-circle-outline" size={17} color="#ff4444" />
                        </TouchableOpacity>
                      </View>
                    ))}
                  </View>
                );
              })}
              {!allDaysHaveTimes && (
                <Text style={ss.dayTimeHint}>⚑ 모든 요일에 최소 1개 시간을 설정해야 스케줄이 자동 생성됩니다</Text>
              )}
            </View>
          )}

          <Text style={[ss.label, { marginTop: 14 }]}>{startDateLabel}</Text>
          <TouchableOpacity style={ss.datePickerBtn} onPress={() => setStartDateModalVisible(true)}>
            <Ionicons name="calendar-outline" size={18} color={Colors.primary} />
            <Text style={ss.datePickerText}>
              {startDate ? (() => {
                const d = new Date(startDate + 'T00:00:00');
                return d.toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' });
              })() : '날짜 선택'}
            </Text>
            {startDate === todayStr && (
              <View style={ss.todayTag}><Text style={ss.todayTagText}>오늘</Text></View>
            )}
          </TouchableOpacity>
        </>
      )}

      {/* 날짜 직접 선택 */}
      {scheduleType === 'by_date' && (
        byDateContent != null ? (
          byDateContent
        ) : (
          <View>
            <Text style={ss.label}>날짜별 레슨 일정</Text>
            {byDateEntries.length === 0 && (
              <Text style={{ fontSize: 14, color: Colors.placeholder, marginBottom: 10 }}>
                날짜와 시간을 직접 선택해 레슨 일정을 추가하세요
              </Text>
            )}
            {byDateEntries.map((entry, idx) => (
              <View key={idx} style={[ss.dayTimeRow, { marginBottom: 6 }]}>
                <Ionicons name="calendar" size={15} color={Colors.primary} />
                <Text style={ss.dayTimeValue}>
                  {new Date(entry.date + 'T00:00:00').toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'short' })} {entry.time}
                </Text>
                <TouchableOpacity
                  onPress={() => onByDateEntriesChange && onByDateEntriesChange(byDateEntries.filter((_, i) => i !== idx))}
                  style={ss.timeAction}
                >
                  <Ionicons name="close-circle-outline" size={17} color="#ff4444" />
                </TouchableOpacity>
              </View>
            ))}
            <TouchableOpacity
              style={[ss.addTimeBtn, { marginTop: 4, alignSelf: 'flex-start' }]}
              onPress={() => {
                setByDateCalMonth({ year: new Date().getFullYear(), month: new Date().getMonth() });
                setByDatePickerVisible(true);
              }}
            >
              <Ionicons name="add-circle-outline" size={18} color={Colors.primary} />
              <Text style={ss.addTimeBtnText}>날짜 추가</Text>
            </TouchableOpacity>
          </View>
        )
      )}

      {/* 나중에 설정 */}
      {scheduleType === 'later' && !hideNeverOption && (
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10, backgroundColor: Colors.mutedBg, borderRadius: 10, padding: 12, borderWidth: 1, borderColor: Colors.border }}>
          <Ionicons name="time-outline" size={18} color={Colors.mutedFg} />
          <Text style={{ fontSize: 14, color: Colors.mutedFg, flex: 1, lineHeight: 20 }}>
            일정은 나중에 회원 상세 화면에서 설정할 수 있어요.
          </Text>
        </View>
      )}

      {/* 시간 스피너 모달 */}
      <Modal visible={timePickerVisible} transparent animationType="slide" onRequestClose={() => setTimePickerVisible(false)}>
        <View style={ss.modalOverlay}>
          <View style={ss.modalSheet}>
            <View style={ss.modalHeader}>
              <Text style={ss.modalTitle}>
                {editingDay !== null
                  ? `${DAYS_KR[editingDay]}요일 ${editingTimeIndex !== null ? '시간 수정' : '시간 추가'}`
                  : '시작 시간'}
              </Text>
              <TouchableOpacity onPress={() => setTimePickerVisible(false)}>
                <Ionicons name="close" size={22} color={Colors.mutedFg} />
              </TouchableOpacity>
            </View>
            <View style={ss.spinnerRow}>
              <View style={ss.spinnerCol}>
                <Text style={ss.spinnerLabel}>시</Text>
                <FlatList
                  data={HOURS} keyExtractor={item => item}
                  showsVerticalScrollIndicator={false} style={ss.spinnerList}
                  renderItem={({ item }) => {
                    const isSel = item === tempHour;
                    return (
                      <TouchableOpacity style={[ss.spinnerItem, isSel && ss.spinnerItemSelected]} onPress={() => setTempHour(item)}>
                        <Text style={[ss.spinnerItemText, isSel && ss.spinnerItemTextSelected]}>{item}</Text>
                      </TouchableOpacity>
                    );
                  }}
                />
              </View>
              <Text style={ss.spinnerColon}>:</Text>
              <View style={ss.spinnerCol}>
                <Text style={ss.spinnerLabel}>분</Text>
                <FlatList
                  data={MINUTES} keyExtractor={item => item}
                  showsVerticalScrollIndicator={false} style={ss.spinnerList}
                  renderItem={({ item }) => {
                    const isSel = item === tempMinute;
                    return (
                      <TouchableOpacity style={[ss.spinnerItem, isSel && ss.spinnerItemSelected]} onPress={() => setTempMinute(item)}>
                        <Text style={[ss.spinnerItemText, isSel && ss.spinnerItemTextSelected]}>{item}</Text>
                      </TouchableOpacity>
                    );
                  }}
                />
              </View>
            </View>
            <TouchableOpacity
              style={[ss.confirmBtn, !tempHour && ss.confirmBtnDisabled]}
              onPress={confirmTime}
            >
              <Text style={ss.confirmBtnText}>
                {tempHour ? `${tempHour}:${tempMinute} 선택` : '시간을 선택하세요'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* 첫 레슨 날짜 / 적용 시작일 모달 */}
      <Modal visible={startDateModalVisible} transparent animationType="slide" onRequestClose={() => setStartDateModalVisible(false)}>
        <View style={ss.modalOverlay}>
          <View style={ss.modalSheet}>
            <View style={ss.modalHeader}>
              <Text style={ss.modalTitle}>{startDateLabel} 선택</Text>
              <TouchableOpacity onPress={() => setStartDateModalVisible(false)}>
                <Ionicons name="close" size={22} color={Colors.foreground} />
              </TouchableOpacity>
            </View>
            <View style={{ marginHorizontal: 16, marginTop: 12, marginBottom: 8, backgroundColor: Colors.primary + '12', borderRadius: 10, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Ionicons name="calendar" size={18} color={Colors.primary} />
              <Text style={{ fontSize: 14, fontWeight: '700', color: Colors.primary }}>
                {startDate ? (() => {
                  const d = new Date(startDate + 'T00:00:00');
                  return d.toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' });
                })() : '날짜를 선택하세요'}
              </Text>
              {startDate === todayStr && (
                <View style={{ marginLeft: 'auto', backgroundColor: Colors.primary, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2 }}>
                  <Text style={{ fontSize: 13, color: '#fff', fontWeight: '700' }}>오늘</Text>
                </View>
              )}
            </View>
            <ScrollView style={{ maxHeight: 360 }}>
              <View style={{ paddingHorizontal: 12, paddingBottom: 8 }}>
                {renderCalendar(
                  startCalMonth,
                  setStartCalMonth,
                  startDate,
                  (dateStr) => onStartDateChange(dateStr),
                )}
              </View>
            </ScrollView>
            <View style={{ flexDirection: 'row', gap: 8, margin: 16, marginTop: 8 }}>
              <TouchableOpacity style={{ flex: 1, borderRadius: 10, paddingVertical: 13, alignItems: 'center', backgroundColor: Colors.mutedBg }} onPress={() => setStartDateModalVisible(false)}>
                <Text style={{ fontWeight: '700', fontSize: 14, color: Colors.primary }}>취소</Text>
              </TouchableOpacity>
              <TouchableOpacity style={{ flex: 2, borderRadius: 10, paddingVertical: 13, alignItems: 'center', backgroundColor: Colors.primary }} onPress={() => setStartDateModalVisible(false)}>
                <Text style={{ fontWeight: '700', fontSize: 14, color: '#fff' }}>선택 완료</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* 날짜별 일정 - 날짜 선택 모달 (신규 등록 모드에서만) */}
      {byDateContent == null && (
        <Modal visible={byDatePickerVisible} transparent animationType="slide" onRequestClose={() => setByDatePickerVisible(false)}>
          <View style={ss.modalOverlay}>
            <View style={ss.modalSheet}>
              <View style={ss.modalHeader}>
                <Text style={ss.modalTitle}>날짜 선택</Text>
                <TouchableOpacity onPress={() => setByDatePickerVisible(false)}>
                  <Ionicons name="close" size={22} color={Colors.foreground} />
                </TouchableOpacity>
              </View>
              <ScrollView style={{ maxHeight: 360 }}>
                <View style={{ paddingHorizontal: 12, paddingBottom: 8 }}>
                  {renderCalendar(
                    byDateCalMonth,
                    setByDateCalMonth,
                    '',
                    (dateStr) => {
                      byDateTempDateRef.current = dateStr;
                      setByDatePickerVisible(false);
                      setTempHour(''); setTempMinute('00');
                      timePickerModeRef.current = 'by_date';
                      setTimePickerVisible(true);
                    },
                    byDateEntries.map(e => e.date),
                  )}
                </View>
              </ScrollView>
              <TouchableOpacity style={[ss.confirmBtn, { margin: 16, marginTop: 4 }]} onPress={() => setByDatePickerVisible(false)}>
                <Text style={ss.confirmBtnText}>닫기</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      )}
    </>
  );
}

const typeStyles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 8, marginBottom: 14 },
  btn: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    gap: 4, paddingVertical: 10, paddingHorizontal: 4, borderRadius: 10,
    borderWidth: 1.5, borderColor: Colors.border, backgroundColor: Colors.mutedBg,
  },
  btnActive: { borderColor: Colors.primary, backgroundColor: Colors.primary },
  btnText: { fontSize: 12, fontWeight: '700', color: Colors.mutedFg, textAlign: 'center' },
  btnTextActive: { color: '#fff' },
});

const ss = StyleSheet.create({
  label: { fontSize: 13, fontWeight: '600', color: Colors.mutedFg, marginBottom: 6 },
  labelHint: { fontSize: 13, fontWeight: '400', color: Colors.placeholder },
  dayRow: { flexDirection: 'row', gap: 6, flexWrap: 'wrap', marginBottom: 16 },
  dayBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: Colors.mutedBg, justifyContent: 'center', alignItems: 'center' },
  dayBtnActive: { backgroundColor: Colors.primary },
  dayBtnText: { fontSize: 13, fontWeight: '700', color: Colors.mutedFg },
  dayBtnTextActive: { color: '#fff' },
  dayTimeList: { gap: 10, marginBottom: 4 },
  dayTimeBlock: { backgroundColor: Colors.card, borderRadius: 10, padding: 10, borderWidth: 1, borderColor: Colors.border, gap: 6 },
  dayTimeBlockHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  dayTimeBadge: { width: 30, height: 30, borderRadius: 15, justifyContent: 'center', alignItems: 'center' },
  dayTimeBadgeEmpty: { backgroundColor: Colors.border },
  dayTimeBadgeSet: { backgroundColor: Colors.primary },
  dayTimeBadgeText: { fontSize: 13, fontWeight: '700', color: Colors.mutedFg },
  dayTimeBadgeTextSet: { color: '#fff' },
  addTimeBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 5, backgroundColor: Colors.primaryLight, borderRadius: 8, borderWidth: 1, borderColor: Colors.accentWarm },
  addTimeBtnText: { fontSize: 13, color: Colors.navy, fontWeight: '600' },
  dayTimeEmpty: { fontSize: 13, color: Colors.placeholder, paddingHorizontal: 4, paddingBottom: 2 },
  dayTimeRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderColor: Colors.border, gap: 8 },
  dayTimeValue: { flex: 1, fontSize: 15, fontWeight: '600', color: Colors.foreground },
  endTimeLabel: { fontSize: 14, fontWeight: '400', color: Colors.mutedFg },
  timeAction: { padding: 2 },
  dayTimeHint: { fontSize: 14, color: Colors.warning, marginTop: 4 },
  datePickerBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: Colors.mutedBg, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, marginBottom: 12, borderWidth: 1, borderColor: Colors.border },
  datePickerText: { flex: 1, fontSize: 15, color: Colors.foreground },
  todayTag: { backgroundColor: Colors.primary, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2 },
  todayTagText: { fontSize: 12, color: '#fff', fontWeight: '700' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  modalSheet: { backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingBottom: 40 },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: Colors.border },
  modalTitle: { fontSize: 16, fontWeight: '700', color: Colors.foreground },
  spinnerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20, paddingTop: 12 },
  spinnerCol: { flex: 1, alignItems: 'center' },
  spinnerLabel: { fontSize: 14, fontWeight: '700', color: Colors.mutedFg, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 },
  spinnerList: { height: 220 },
  spinnerItem: { paddingVertical: 12, paddingHorizontal: 24, borderRadius: 12, marginBottom: 2, alignItems: 'center' },
  spinnerItemSelected: { backgroundColor: Colors.primary },
  spinnerItemText: { fontSize: 22, fontWeight: '600', color: Colors.mutedFg },
  spinnerItemTextSelected: { color: '#fff', fontWeight: '800' },
  spinnerColon: { fontSize: 28, fontWeight: '800', color: Colors.foreground, paddingHorizontal: 8, paddingTop: 28 },
  confirmBtn: { margin: 16, backgroundColor: Colors.primary, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  confirmBtnDisabled: { backgroundColor: Colors.iconMuted },
  confirmBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
