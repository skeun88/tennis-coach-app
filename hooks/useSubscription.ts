import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import {
  Subscription,
  PlanFeatures,
  canUseFeature,
  isSubscriptionActive,
  getTrialDaysLeft,
  getCurrentSubscription,
} from '../lib/subscription';

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

  const refresh = useCallback(async () => {
    const sub = await getCurrentSubscription();
    setSubscription(sub);
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();

    // Realtime 구독: 플랜 변경 즉시 반영
    const channel = supabase
      .channel('subscription-changes')
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
