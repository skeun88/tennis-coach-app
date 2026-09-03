import { useState, useEffect, useCallback, useRef } from 'react';
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
import { IS_BETA } from '../lib/beta';

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
  if (IS_BETA) {
    const betaSub: Subscription = { status: 'active', plan_id: 'pro' } as Subscription;
    return {
      subscription: betaSub,
      loading: false,
      isActive: true,
      isBlocked: false,
      isTrial: false,
      trialDaysLeft: 0,
      canUse: () => true,
      refresh: async () => {},
    };
  }

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

    // Realtime 구독: 플랜 변경 즉시 반영 (채널명 고유화 — 동일 이름 중복 subscribe 방지)
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
