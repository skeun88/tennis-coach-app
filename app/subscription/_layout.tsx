import { Stack } from 'expo-router';

export default function SubscriptionLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="select-plan" />
      <Stack.Screen name="register-card" />
      <Stack.Screen name="trial-started" />
      <Stack.Screen name="blocked" />
      <Stack.Screen name="manage" />
      <Stack.Screen name="upgrade" />
      <Stack.Screen name="topup" />
    </Stack>
  );
}
