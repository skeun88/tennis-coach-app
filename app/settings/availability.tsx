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

export default function AvailabilityScreen() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [selectedDays, setSelectedDays] = useState<number[]>([1, 2, 3, 4, 5]);
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
      setSelectedDays(data.available_days ?? [1,2,3,4,5]);
      const [sh, sm] = (data.available_start ?? '09:00').slice(0, 5).split(':');
      const [eh, em] = (data.available_end ?? '18:00').slice(0, 5).split(':');
      setStartHour(sh); setStartMin(sm);
      setEndHour(eh); setEndMin(em);
    }
    setLoading(false);
  }

  function toggleDay(idx: number) {
    setSelectedDays(prev =>
      prev.includes(idx) ? prev.filter(d => d !== idx) : [...prev, idx].sort()
    );
  }

  async function doSave() {
    setSaving(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setSaving(false); return; }
    const { error } = await supabase.from('coach_availability').upsert({
      coach_id: user.id,
      available_days: selectedDays,
      available_start: `${startHour}:${startMin}:00`,
      available_end: `${endHour}:${endMin}:00`,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'coach_id' });
    setSaving(false);
    if (error) { Alert.alert('오류', '저장에 실패했습니다.'); return; }
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }

  async function handleSave() {
    if (selectedDays.length === 0) {
      Alert.alert('오류', '최소 하나의 요일을 선택해주세요.');
      return;
    }
    const newStartMin = parseInt(startHour) * 60 + parseInt(startMin);
    const newEndMin = parseInt(endHour) * 60 + parseInt(endMin);
    if (newEndMin <= newStartMin) {
      Alert.alert('오류', '종료 시간이 시작 시간보다 늦어야 합니다.');
      return;
    }

    // 새 가용시간 밖에 잡힌 기존 예약 확인
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const todayStr = new Date().toISOString().split('T')[0];
    const { data: futureLessons } = await supabase
      .from('lessons')
      .select('id, date, start_time')
      .eq('coach_id', user.id)
      .gte('date', todayStr);

    const conflictCount = (futureLessons ?? []).filter((l: any) => {
      const dow = new Date(l.date + 'T00:00:00').getDay();
      const [lh, lm] = l.start_time.slice(0, 5).split(':').map(Number);
      const lStartMin = lh * 60 + lm;
      return !selectedDays.includes(dow) || lStartMin < newStartMin || lStartMin >= newEndMin;
    }).length;

    if (conflictCount > 0) {
      Alert.alert(
        '기존 예약 안내',
        `설정한 시간 밖에 이미 예약된 레슨이 ${conflictCount}건 있어요.\n기존 예약은 그대로 유지됩니다.`,
        [
          { text: '취소', style: 'cancel' },
          { text: '저장', onPress: doSave },
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
            회원이 레슨을 신청할 수 있는 요일과 시간대를 설정합니다. 설정된 시간 외에는 레슨 신청이 불가합니다.
          </Text>
        </View>

        {/* 요일 선택 */}
        <Text style={styles.sectionLabel}>레슨 가능 요일</Text>
        <View style={styles.card}>
          <View style={styles.daysRow}>
            {DAYS.map((day, idx) => {
              const selected = selectedDays.includes(idx);
              return (
                <TouchableOpacity
                  key={idx}
                  style={[styles.dayBtn, selected && styles.dayBtnActive]}
                  onPress={() => toggleDay(idx)}
                >
                  <Text style={[styles.dayText, selected && styles.dayTextActive]}>{day}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* 시간대 설정 */}
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

          {/* 피커들 */}
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

          <Text style={styles.timeSummary}>
            {selectedDays.map(d => DAYS[d]).join(', ')}  {startHour}:{startMin} ~ {endHour}:{endMin}
          </Text>
        </View>

        <TouchableOpacity style={styles.saveBtn} onPress={handleSave} disabled={saving}>
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
  dayText: { fontSize: 14, fontWeight: '600', color: Colors.mutedFg },
  dayTextActive: { color: '#fff' },
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
  timeSummary: {
    textAlign: 'center', color: Colors.mutedFg, fontSize: 13, marginTop: 14, fontWeight: '500',
  },
  saveBtn: {
    backgroundColor: Colors.primary, borderRadius: 12,
    paddingVertical: 14, alignItems: 'center',
  },
  saveBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
