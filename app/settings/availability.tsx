import { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView,
  Alert, ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../lib/supabase';
import { Colors } from '../../lib/theme';

const DAYS = ['일', '월', '화', '수', '목', '금', '토'];
const HOURS = Array.from({ length: 18 }, (_, i) => String(i + 6).padStart(2, '0'));
const HALF_HOURS = ['00', '30'];

type DaySchedule = { start: string; end: string };

export default function AvailabilityScreen() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [daySchedules, setDaySchedules] = useState<Record<number, DaySchedule>>({});
  const [selectedDays, setSelectedDays] = useState<number[]>([]);
  const [startHour, setStartHour] = useState('09');
  const [startMin, setStartMin] = useState('00');
  const [endHour, setEndHour] = useState('18');
  const [endMin, setEndMin] = useState('00');
  const [startHourOpen, setStartHourOpen] = useState(false);
  const [startMinOpen, setStartMinOpen] = useState(false);
  const [endHourOpen, setEndHourOpen] = useState(false);
  const [endMinOpen, setEndMinOpen] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => { loadAvailability(); }, []);

  async function loadAvailability() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); return; }
    const { data } = await supabase
      .from('coach_availability')
      .select('*')
      .eq('coach_id', user.id)
      .maybeSingle();
    if (data) {
      const times = (data as any).available_times ?? {};
      if (Object.keys(times).length > 0) {
        const schedules: Record<number, DaySchedule> = {};
        for (const [k, v] of Object.entries(times)) {
          schedules[Number(k)] = v as DaySchedule;
        }
        setDaySchedules(schedules);
      } else if ((data.available_days ?? []).length > 0) {
        // 기존 레거시 데이터: 전체 요일에 동일 시간 적용
        const [sh, sm] = (data.available_start ?? '09:00:00').slice(0, 5).split(':');
        const [eh, em] = (data.available_end ?? '18:00:00').slice(0, 5).split(':');
        const schedules: Record<number, DaySchedule> = {};
        for (const d of (data.available_days as number[])) {
          schedules[d] = { start: `${sh}:${sm}`, end: `${eh}:${em}` };
        }
        setDaySchedules(schedules);
      }
    }
    setLoading(false);
  }

  function toggleDay(idx: number) {
    setSelectedDays(prev => {
      if (prev.includes(idx)) return prev.filter(d => d !== idx);
      const next = [...prev, idx].sort();
      // 이미 저장된 요일이면 그 시간으로 피커 채우기 (단일 선택 시)
      if (prev.length === 0 && daySchedules[idx]) {
        const [sh, sm] = daySchedules[idx].start.split(':');
        const [eh, em] = daySchedules[idx].end.split(':');
        setStartHour(sh); setStartMin(sm);
        setEndHour(eh); setEndMin(em);
      }
      return next;
    });
  }

  function handleAdd() {
    if (selectedDays.length === 0) {
      Alert.alert('요일 선택', '요일을 먼저 선택해주세요.');
      return;
    }
    const newStartMin = parseInt(startHour) * 60 + parseInt(startMin);
    const newEndMin = parseInt(endHour) * 60 + parseInt(endMin);
    if (newEndMin <= newStartMin) {
      Alert.alert('오류', '종료 시간이 시작 시간보다 늦어야 합니다.');
      return;
    }
    const schedule: DaySchedule = { start: `${startHour}:${startMin}`, end: `${endHour}:${endMin}` };
    setDaySchedules(prev => {
      const next = { ...prev };
      for (const d of selectedDays) next[d] = schedule;
      return next;
    });
    setSelectedDays([]);
    closeAllPickers();
  }

  function removeDay(idx: number) {
    setDaySchedules(prev => {
      const next = { ...prev };
      delete next[idx];
      return next;
    });
  }

  function closeAllPickers() {
    setStartHourOpen(false); setStartMinOpen(false);
    setEndHourOpen(false); setEndMinOpen(false);
  }

  async function handleSave() {
    if (Object.keys(daySchedules).length === 0) {
      Alert.alert('오류', '최소 하나의 요일을 추가해주세요.');
      return;
    }
    setSaving(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setSaving(false); return; }

    const sortedDays = Object.keys(daySchedules).map(Number).sort();
    const firstDay = daySchedules[sortedDays[0]];

    // 새 가용시간 밖에 잡힌 기존 예약 확인
    const todayStr = new Date().toISOString().split('T')[0];
    const { data: futureLessons } = await supabase
      .from('lessons')
      .select('id, date, start_time')
      .eq('coach_id', user.id)
      .gte('date', todayStr);

    const conflictCount = (futureLessons ?? []).filter((l: any) => {
      const dow = new Date(l.date + 'T00:00:00').getDay();
      const sched = daySchedules[dow];
      if (!sched) return !sortedDays.includes(dow);
      const [lh, lm] = l.start_time.slice(0, 5).split(':').map(Number);
      const lStartMin = lh * 60 + lm;
      const [sh, sm] = sched.start.split(':').map(Number);
      const [eh, em] = sched.end.split(':').map(Number);
      return lStartMin < sh * 60 + sm || lStartMin >= eh * 60 + em;
    }).length;

    const doSave = async () => {
      const { error } = await supabase.from('coach_availability').upsert({
        coach_id: user!.id,
        available_days: sortedDays,
        available_start: `${firstDay.start}:00`,
        available_end: `${firstDay.end}:00`,
        available_times: daySchedules,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'coach_id' });
      setSaving(false);
      if (error) { Alert.alert('오류', '저장에 실패했습니다.'); return; }
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    };

    if (conflictCount > 0) {
      setSaving(false);
      Alert.alert(
        '기존 예약 안내',
        `설정한 시간 밖에 이미 예약된 레슨이 ${conflictCount}건 있어요.\n기존 예약은 그대로 유지됩니다.`,
        [
          { text: '취소', style: 'cancel' },
          { text: '저장', onPress: () => { setSaving(true); doSave(); } },
        ]
      );
    } else {
      await doSave();
    }
  }

  if (loading) {
    return (
      <View style={[styles.container, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator size="large" color={Colors.primary} />
      </View>
    );
  }

  const sortedScheduleDays = Object.keys(daySchedules).map(Number).sort();

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color={Colors.foreground} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>레슨 가능 시간</Text>
        {saved ? (
          <View style={styles.savedBadge}>
            <Ionicons name="checkmark" size={14} color={Colors.primary} />
            <Text style={styles.savedText}>저장됨</Text>
          </View>
        ) : <View style={{ width: 60 }} />}
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.infoBanner}>
          <Ionicons name="information-circle-outline" size={18} color={Colors.info} />
          <Text style={styles.infoText}>
            요일을 선택하고 시간을 설정한 뒤 추가하세요. 요일마다 다른 시간대를 설정할 수 있어요.
          </Text>
        </View>

        {/* 요일 선택 */}
        <Text style={styles.sectionLabel}>요일 선택</Text>
        <View style={styles.card}>
          <View style={styles.daysRow}>
            {DAYS.map((day, idx) => {
              const selected = selectedDays.includes(idx);
              const hasSchedule = !!daySchedules[idx];
              return (
                <TouchableOpacity
                  key={idx}
                  style={[
                    styles.dayBtn,
                    selected && styles.dayBtnActive,
                    !selected && hasSchedule && styles.dayBtnHasSchedule,
                  ]}
                  onPress={() => toggleDay(idx)}
                >
                  <Text style={[
                    styles.dayText,
                    selected && styles.dayTextActive,
                    !selected && hasSchedule && { color: Colors.primary },
                  ]}>{day}</Text>
                  {hasSchedule && !selected && (
                    <View style={styles.dotIndicator} />
                  )}
                </TouchableOpacity>
              );
            })}
          </View>
          {selectedDays.length > 0 && (
            <Text style={styles.selectedDaysHint}>
              {selectedDays.map(d => DAYS[d]).join(', ')} 선택됨
            </Text>
          )}
        </View>

        {/* 시간 설정 */}
        <Text style={styles.sectionLabel}>레슨 가능 시간</Text>
        <View style={styles.card}>
          <View style={styles.timeRow}>
            <View style={styles.timePicker}>
              <Text style={styles.timeLabel}>시작</Text>
              <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
                <TouchableOpacity style={styles.timeBtn} onPress={() => { setStartHourOpen(v => !v); setStartMinOpen(false); setEndHourOpen(false); setEndMinOpen(false); }}>
                  <Text style={styles.timeBtnText}>{startHour}</Text>
                </TouchableOpacity>
                <Text style={styles.colonText}>:</Text>
                <TouchableOpacity style={styles.timeBtn} onPress={() => { setStartMinOpen(v => !v); setStartHourOpen(false); setEndHourOpen(false); setEndMinOpen(false); }}>
                  <Text style={styles.timeBtnText}>{startMin}</Text>
                </TouchableOpacity>
              </View>
            </View>
            <Ionicons name="arrow-forward" size={18} color={Colors.mutedFg} />
            <View style={styles.timePicker}>
              <Text style={styles.timeLabel}>종료</Text>
              <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
                <TouchableOpacity style={styles.timeBtn} onPress={() => { setEndHourOpen(v => !v); setStartHourOpen(false); setStartMinOpen(false); setEndMinOpen(false); }}>
                  <Text style={styles.timeBtnText}>{endHour}</Text>
                </TouchableOpacity>
                <Text style={styles.colonText}>:</Text>
                <TouchableOpacity style={styles.timeBtn} onPress={() => { setEndMinOpen(v => !v); setStartHourOpen(false); setStartMinOpen(false); setEndHourOpen(false); }}>
                  <Text style={styles.timeBtnText}>{endMin}</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>

          {startHourOpen && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.pickerRow}>
              {HOURS.map(h => (
                <TouchableOpacity key={h} style={[styles.pickerItem, startHour === h && styles.pickerItemActive]}
                  onPress={() => { setStartHour(h); setStartHourOpen(false); }}>
                  <Text style={[styles.pickerText, startHour === h && styles.pickerTextActive]}>{h}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          )}
          {startMinOpen && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.pickerRow}>
              {HALF_HOURS.map(m => (
                <TouchableOpacity key={m} style={[styles.pickerItem, startMin === m && styles.pickerItemActive]}
                  onPress={() => { setStartMin(m); setStartMinOpen(false); }}>
                  <Text style={[styles.pickerText, startMin === m && styles.pickerTextActive]}>{m}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          )}
          {endHourOpen && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.pickerRow}>
              {HOURS.map(h => (
                <TouchableOpacity key={h} style={[styles.pickerItem, endHour === h && styles.pickerItemActive]}
                  onPress={() => { setEndHour(h); setEndHourOpen(false); }}>
                  <Text style={[styles.pickerText, endHour === h && styles.pickerTextActive]}>{h}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          )}
          {endMinOpen && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.pickerRow}>
              {HALF_HOURS.map(m => (
                <TouchableOpacity key={m} style={[styles.pickerItem, endMin === m && styles.pickerItemActive]}
                  onPress={() => { setEndMin(m); setEndMinOpen(false); }}>
                  <Text style={[styles.pickerText, endMin === m && styles.pickerTextActive]}>{m}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          )}

          <TouchableOpacity
            style={[styles.addBtn, selectedDays.length === 0 && styles.addBtnDisabled]}
            onPress={handleAdd}
            disabled={selectedDays.length === 0}
          >
            <Ionicons name="add-circle-outline" size={18} color={selectedDays.length > 0 ? Colors.primary : Colors.placeholder} />
            <Text style={[styles.addBtnText, selectedDays.length === 0 && { color: Colors.placeholder }]}>
              {selectedDays.length > 0
                ? `${selectedDays.map(d => DAYS[d]).join('·')}요일 추가`
                : '요일을 먼저 선택하세요'}
            </Text>
          </TouchableOpacity>
        </View>

        {/* 추가된 일정 목록 */}
        {sortedScheduleDays.length > 0 && (
          <>
            <Text style={styles.sectionLabel}>설정된 요일 ({sortedScheduleDays.length}개)</Text>
            <View style={styles.card}>
              {sortedScheduleDays.map((dayIdx, i) => (
                <View
                  key={dayIdx}
                  style={{
                    flexDirection: 'row', alignItems: 'center',
                    justifyContent: 'space-between', paddingVertical: 12,
                    borderBottomWidth: i < sortedScheduleDays.length - 1 ? 1 : 0,
                    borderBottomColor: Colors.border,
                  }}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                    <View style={styles.dayChip}>
                      <Text style={styles.dayChipText}>{DAYS[dayIdx]}</Text>
                    </View>
                    <Text style={{ fontSize: 14, color: Colors.foreground }}>
                      {daySchedules[dayIdx].start} ~ {daySchedules[dayIdx].end}
                    </Text>
                  </View>
                  <TouchableOpacity onPress={() => removeDay(dayIdx)} style={{ padding: 6 }}>
                    <Ionicons name="close-circle" size={20} color={Colors.destructive} />
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          </>
        )}

        <TouchableOpacity
          style={[styles.saveBtn, sortedScheduleDays.length === 0 && { backgroundColor: Colors.iconMuted }]}
          onPress={handleSave}
          disabled={saving || sortedScheduleDays.length === 0}
        >
          {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveBtnText}>저장</Text>}
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: '#fff', paddingTop: 56, paddingBottom: 14, paddingHorizontal: 16,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  backBtn: { padding: 4 },
  headerTitle: { fontSize: 17, fontWeight: '700', color: Colors.foreground },
  savedBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: Colors.primaryLight, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12,
  },
  savedText: { fontSize: 12, color: Colors.navy, fontWeight: '600' },
  content: { padding: 16, paddingBottom: 48 },
  infoBanner: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    backgroundColor: Colors.primaryLight, borderRadius: 10, padding: 12, marginBottom: 20,
    borderWidth: 1, borderColor: '#bfdbfe',
  },
  infoText: { flex: 1, fontSize: 13, color: Colors.info, lineHeight: 18 },
  sectionLabel: {
    fontSize: 13, fontWeight: '700', color: Colors.mutedFg,
    textTransform: 'uppercase', letterSpacing: 0.5,
    marginBottom: 8, marginTop: 4,
  },
  card: {
    backgroundColor: '#fff', borderRadius: 14, padding: 16, marginBottom: 20,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 4, elevation: 2,
  },
  daysRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 4 },
  dayBtn: {
    flex: 1, paddingVertical: 10, borderRadius: 10,
    alignItems: 'center', backgroundColor: Colors.mutedBg,
  },
  dayBtnActive: { backgroundColor: Colors.primary },
  dayBtnHasSchedule: { backgroundColor: Colors.primaryLight, borderWidth: 1.5, borderColor: Colors.primary },
  dayText: { fontSize: 14, fontWeight: '600', color: Colors.mutedFg },
  dayTextActive: { color: '#fff' },
  dotIndicator: {
    width: 5, height: 5, borderRadius: 3,
    backgroundColor: Colors.primary, marginTop: 3,
  },
  selectedDaysHint: {
    marginTop: 10, textAlign: 'center', fontSize: 13, color: Colors.primary, fontWeight: '600',
  },
  timeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around', paddingVertical: 4 },
  timePicker: { alignItems: 'center', gap: 6 },
  timeLabel: { fontSize: 12, color: Colors.mutedFg, fontWeight: '600' },
  timeBtn: {
    backgroundColor: Colors.mutedBg, borderRadius: 8,
    paddingHorizontal: 14, paddingVertical: 8, minWidth: 44, alignItems: 'center',
  },
  timeBtnText: { fontSize: 18, fontWeight: '700', color: Colors.foreground },
  colonText: { fontSize: 18, fontWeight: '700', color: Colors.foreground },
  pickerRow: { marginTop: 8, backgroundColor: Colors.background, borderRadius: 10, padding: 6 },
  pickerItem: {
    paddingHorizontal: 14, paddingVertical: 8, marginRight: 4, borderRadius: 8,
    backgroundColor: '#fff', borderWidth: 1, borderColor: Colors.border,
  },
  pickerItemActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  pickerText: { fontSize: 15, fontWeight: '600', color: Colors.foreground },
  pickerTextActive: { color: '#fff' },
  addBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    marginTop: 14, paddingVertical: 10, borderRadius: 10,
    borderWidth: 1.5, borderColor: Colors.primary, borderStyle: 'dashed',
  },
  addBtnDisabled: { borderColor: Colors.placeholder },
  addBtnText: { fontSize: 14, fontWeight: '700', color: Colors.primary },
  dayChip: {
    backgroundColor: Colors.primary, borderRadius: 8,
    paddingHorizontal: 10, paddingVertical: 4,
  },
  dayChipText: { fontSize: 13, fontWeight: '800', color: '#fff' },
  saveBtn: {
    backgroundColor: Colors.primary, borderRadius: 12,
    paddingVertical: 14, alignItems: 'center',
  },
  saveBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
