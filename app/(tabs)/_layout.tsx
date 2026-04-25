import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: '#1a7a4a',
        tabBarInactiveTintColor: '#999',
        tabBarStyle: {
          borderTopWidth: 1,
          borderTopColor: '#eee',
          paddingBottom: 4,
        },
        headerStyle: { backgroundColor: '#1a7a4a' },
        headerTintColor: '#fff',
        headerTitleStyle: { fontWeight: '700' },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: '홈',
          tabBarLabel: '홈',
          tabBarIcon: ({ color, size }) => <Ionicons name="home" size={size} color={color} />,
          headerTitle: '테니스 코치',
        }}
      />
      <Tabs.Screen
        name="members"
        options={{
          title: '회원',
          tabBarLabel: '회원',
          tabBarIcon: ({ color, size }) => <Ionicons name="people" size={size} color={color} />,
          headerTitle: '회원 관리',
        }}
      />
      <Tabs.Screen
        name="schedule"
        options={{
          title: '스케줄',
          tabBarLabel: '스케줄',
          tabBarIcon: ({ color, size }) => <Ionicons name="calendar" size={size} color={color} />,
          headerTitle: '레슨 스케줄',
        }}
      />
      <Tabs.Screen
        name="payments"
        options={{
          title: '결제',
          tabBarLabel: '결제',
          tabBarIcon: ({ color, size }) => <Ionicons name="card" size={size} color={color} />,
          headerTitle: '결제 관리',
        }}
      />
      <Tabs.Screen
        name="chat"
        options={{
          title: '도움말',
          tabBarLabel: '도움말',
          tabBarIcon: ({ color, size }) => <Ionicons name="chatbubble-ellipses" size={size} color={color} />,
          headerTitle: 'KERRI 도우미',
        }}
      />
    </Tabs>
  );
}
