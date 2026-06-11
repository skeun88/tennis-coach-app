import { useState, useRef, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, TextInput,
  TouchableOpacity, KeyboardAvoidingView, Platform,
  ActivityIndicator, SafeAreaView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../lib/theme';

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

const QUICK_QUESTIONS = [
  '서브 속도를 높이는 드릴 추천해줘',
  '입문자용 포핸드 레슨 플랜 알려줘',
  '랠리 전술 훈련 방법이 궁금해요',
  '미납 알림은 어떻게 확인하나요?',
  '고정 스케줄 설정 방법이 궁금해요',
];

export default function ChatScreen() {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: '0',
      role: 'assistant',
      content: '안녕하세요! 앱 사용법은 물론, 드릴 구성·훈련법·테니스 이론까지 무엇이든 편하게 물어보세요 🎾\n참고 자료를 활용할 때는 출처도 함께 알려드릴게요 📚',
      timestamp: new Date(),
    },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const flatListRef = useRef<FlatList>(null);

  // 대화 히스토리 (Anthropic 형식)
  const historyRef = useRef<{ role: string; content: string }[]>([]);

  const sendMessage = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || loading) return;

    const userMsg: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: trimmed,
      timestamp: new Date(),
    };

    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setLoading(true);

    // 히스토리에 유저 메시지 추가
    historyRef.current = [...historyRef.current, { role: 'user', content: trimmed }];

    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/chatbot`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({
          message: trimmed,
          history: historyRef.current.slice(-10), // 최근 10개만
        }),
      });

      const data = await res.json();
      const reply = data.reply || '죄송합니다, 잠시 후 다시 시도해주세요.';

      // 히스토리에 응답 추가
      historyRef.current = [...historyRef.current, { role: 'assistant', content: reply }];

      const assistantMsg: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: reply,
        timestamp: new Date(),
      };

      setMessages(prev => [...prev, assistantMsg]);
    } catch (e) {
      const errorMsg: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: '일시적인 오류가 발생했습니다. 문의사항은 hyunsoo@kerri.co.kr로 연락 주세요.',
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, errorMsg]);
    } finally {
      setLoading(false);
      setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);
    }
  }, [loading]);

  function renderMessage({ item }: { item: Message }) {
    const isUser = item.role === 'user';
    return (
      <View style={[styles.messageRow, isUser && styles.messageRowUser]}>
        {!isUser && (
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>K</Text>
          </View>
        )}
        <View style={[styles.bubble, isUser ? styles.bubbleUser : styles.bubbleAssistant]}>
          <Text style={[styles.bubbleText, isUser && styles.bubbleTextUser]}>
            {item.content}
          </Text>
        </View>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
      >
        <FlatList
          ref={flatListRef}
          data={messages}
          keyExtractor={item => item.id}
          renderItem={renderMessage}
          contentContainerStyle={styles.messageList}
          onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: true })}
          ListFooterComponent={
            loading ? (
              <View style={styles.typingIndicator}>
                <View style={styles.avatar}>
                  <Text style={styles.avatarText}>K</Text>
                </View>
                <View style={styles.bubbleAssistant}>
                  <ActivityIndicator size="small" color={Colors.primary} />
                </View>
              </View>
            ) : null
          }
          ListHeaderComponent={
            messages.length <= 1 ? (
              <View style={styles.quickBox}>
                <View style={styles.hintBanner}>
                  <Ionicons name="bulb-outline" size={14} color="#7C3AED" />
                  <Text style={styles.hintText}>앱 사용법 외에도 드릴, 테니스 이론 등 코칭 관련 무엇이든 질문해보세요!</Text>
                </View>
                <Text style={styles.quickTitle}>자주 묻는 질문</Text>
                {QUICK_QUESTIONS.map((q, i) => (
                  <TouchableOpacity
                    key={i}
                    style={styles.quickBtn}
                    onPress={() => sendMessage(q)}
                  >
                    <Text style={styles.quickBtnText}>{q}</Text>
                    <Ionicons name="chevron-forward" size={14} color={Colors.primary} />
                  </TouchableOpacity>
                ))}
              </View>
            ) : null
          }
        />

        <View style={styles.inputBar}>
          <TextInput
            style={styles.input}
            value={input}
            onChangeText={setInput}
            placeholder="궁금한 점을 입력하세요..."
            placeholderTextColor={Colors.placeholder}
            multiline
            maxLength={500}
            returnKeyType="send"
            onSubmitEditing={() => sendMessage(input)}
          />
          <TouchableOpacity
            style={[styles.sendBtn, (!input.trim() || loading) && styles.sendBtnDisabled]}
            onPress={() => sendMessage(input)}
            disabled={!input.trim() || loading}
          >
            <Ionicons name="send" size={20} color="#fff" />
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  flex: { flex: 1 },
  messageList: { padding: 16, paddingBottom: 8 },

  // Quick questions
  quickBox: {
    backgroundColor: '#fff', borderRadius: 14, padding: 16,
    marginBottom: 16,
    shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 }, elevation: 2,
  },
  hintBanner: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#F5F3FF', borderRadius: 8, padding: 10, marginBottom: 14 },
  hintText: { fontSize: 12, color: '#7C3AED', flex: 1, lineHeight: 18 },
  quickTitle: { fontSize: 13, fontWeight: '700', color: Colors.mutedFg, marginBottom: 10 },
  quickBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: Colors.mutedBg,
  },
  quickBtnText: { fontSize: 14, color: Colors.foreground, flex: 1 },

  // Messages
  messageRow: { flexDirection: 'row', alignItems: 'flex-end', marginBottom: 12, gap: 8 },
  messageRowUser: { flexDirection: 'row-reverse' },
  avatar: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: Colors.primary,
    justifyContent: 'center', alignItems: 'center',
    flexShrink: 0,
  },
  avatarText: { color: '#fff', fontWeight: '800', fontSize: 14 },
  bubble: {
    maxWidth: '75%', borderRadius: 16, padding: 12,
  },
  bubbleAssistant: {
    backgroundColor: '#fff',
    borderBottomLeftRadius: 4,
    shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 }, elevation: 1,
  },
  bubbleUser: {
    backgroundColor: Colors.primary,
    borderBottomRightRadius: 4,
  },
  bubbleText: { fontSize: 15, color: Colors.foreground, lineHeight: 22 },
  bubbleTextUser: { color: '#fff' },

  // Typing
  typingIndicator: { flexDirection: 'row', alignItems: 'flex-end', marginBottom: 12, gap: 8 },

  // Input bar
  inputBar: {
    flexDirection: 'row', alignItems: 'flex-end',
    backgroundColor: '#fff', paddingHorizontal: 12, paddingVertical: 10,
    borderTopWidth: 1, borderTopColor: Colors.border, gap: 8,
  },
  input: {
    flex: 1, fontSize: 15, color: Colors.foreground,
    backgroundColor: Colors.background, borderRadius: 20,
    paddingHorizontal: 16, paddingVertical: 10,
    maxHeight: 100, lineHeight: 20,
  },
  sendBtn: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: Colors.primary,
    justifyContent: 'center', alignItems: 'center',
  },
  sendBtnDisabled: { backgroundColor: Colors.iconMuted },
});
