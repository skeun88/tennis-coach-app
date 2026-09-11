import { useState, useEffect, useCallback, useRef } from 'react';
import Purchases from 'react-native-purchases';
import { supabase } from '../lib/supabase';
import {
  Subscription,
  PlanFeatures,
  canUseFeature,
  isSubscriptionActive,
  getTrialDaysLeft,
  getCurrentSubscription,
} from '../lib/subscription';
import { syncRevenueCatToDb } from '../lib/purchases';

interface UseSubscriptionResult {
  subscription: Subscription | null;
  loading: boolean;
  isActive: boolean;
  isBlocked: boolean;
  isTrial: boolean;
  trialDaysLeft: number;
  canUse: (feature: keyof PlanFeatures) => boolean;
  refresh: () => Promise<void>;
}

export function useSubscription(): UseSubscriptionResult {
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [loading, setLoading] = useState(true);
  const channelIdRef = useRef(`${Date.now()}-${Math.random().toString(36).slice(2)}`);

  const refresh = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (user) await syncRevenueCatToDb(user.id);
    const sub = await getCurrentSubscription();
    setSubscription(sub);
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();

    // RevenueCat entitlement 변경 즉시 반영 (구매·변경·복원 직후)
    const rcListener = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) await syncRevenueCatToDb(user.id);
      const sub = await getCurrentSubscription();
      setSubscription(sub);
    };
    Purchases.addCustomerInfoUpdateListener(rcListener);

    // Supabase Realtime: DB 직접 변경 시 즉시 반영 (채널명 고유화)
    const channelName = `subscription-changes-${channelIdRef.current}`;
    const channel = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'subscriptions',
        },
        () => {
          refresh();
        }
      )
      .subscribe();

    return () => {
      Purchases.removeCustomerInfoUpdateListener(rcListener);
      supabase.removeChannel(channel);
    };
  }, [refresh]);

  const canUse = useCallback(
    (feature: keyof PlanFeatures) => canUseFeature(subscription, feature),
    [subscription]
  );

  const isBlocked =
    subscription?.status === 'blocked' || subscription?.status === 'cancelled';
  const isTrial = subscription?.status === 'trial';
  const trialDaysLeft = subscription && isTrial ? getTrialDaysLeft(subscription) : 0;

  return {
    subscription,
    loading,
    isActive: isSubscriptionActive(subscription),
    isBlocked,
    isTrial,
    trialDaysLeft,
    canUse,
    refresh,
  };
}
