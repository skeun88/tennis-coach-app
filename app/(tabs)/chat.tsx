import { useState, useRef, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, TextInput,
  TouchableOpacity, KeyboardAvoidingView, Platform,
  ActivityIndicator, SafeAreaView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

const QUICK_QUESTIONS = [
  '미납 알림은 어떻게 확인하나요?',
  '레슨 크레딧은 어떻게 관리하나요?',
  '고정 스케줄 설정 방법이 궁금해요',
  'AI 레슨 분석은 어떻게 사용하나요?',
];

export default function ChatScreen() {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: '0',
      role: 'assistant',
      content: '안녕하세요! 테니스 코치 앱 사용에 대해 궁금한 점이 있으신가요? 편하게 물어보세요 🎾',
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
                  <ActivityIndicator size="small" color="#1a7a4a" />
                </View>
              </View>
            ) : null
          }
          ListHeaderComponent={
            messages.length <= 1 ? (
              <View style={styles.quickBox}>
                <Text style={styles.quickTitle}>자주 묻는 질문</Text>
                {QUICK_QUESTIONS.map((q, i) => (
                  <TouchableOpacity
                    key={i}
                    style={styles.quickBtn}
                    onPress={() => sendMessage(q)}
                  >
                    <Text style={styles.quickBtnText}>{q}</Text>
                    <Ionicons name="chevron-forward" size={14} color="#1a7a4a" />
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
            placeholderTextColor="#aaa"
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
  container: { flex: 1, backgroundColor: '#f5f7fa' },
  flex: { flex: 1 },
  messageList: { padding: 16, paddingBottom: 8 },

  // Quick questions
  quickBox: {
    backgroundColor: '#fff', borderRadius: 14, padding: 16,
    marginBottom: 16,
    shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 }, elevation: 2,
  },
  quickTitle: { fontSize: 13, fontWeight: '700', color: '#888', marginBottom: 10 },
  quickBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#f0f0f0',
  },
  quickBtnText: { fontSize: 14, color: '#333', flex: 1 },

  // Messages
  messageRow: { flexDirection: 'row', alignItems: 'flex-end', marginBottom: 12, gap: 8 },
  messageRowUser: { flexDirection: 'row-reverse' },
  avatar: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: '#1a7a4a',
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
    backgroundColor: '#1a7a4a',
    borderBottomRightRadius: 4,
  },
  bubbleText: { fontSize: 15, color: '#1a1a1a', lineHeight: 22 },
  bubbleTextUser: { color: '#fff' },

  // Typing
  typingIndicator: { flexDirection: 'row', alignItems: 'flex-end', marginBottom: 12, gap: 8 },

  // Input bar
  inputBar: {
    flexDirection: 'row', alignItems: 'flex-end',
    backgroundColor: '#fff', paddingHorizontal: 12, paddingVertical: 10,
    borderTopWidth: 1, borderTopColor: '#eee', gap: 8,
  },
  input: {
    flex: 1, fontSize: 15, color: '#1a1a1a',
    backgroundColor: '#f5f7fa', borderRadius: 20,
    paddingHorizontal: 16, paddingVertical: 10,
    maxHeight: 100, lineHeight: 20,
  },
  sendBtn: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: '#1a7a4a',
    justifyContent: 'center', alignItems: 'center',
  },
  sendBtnDisabled: { backgroundColor: '#ccc' },
});
