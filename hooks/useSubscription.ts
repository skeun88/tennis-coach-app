import { useState, useEffect, useCallback, useRef } from 'react';
import Purchases from 'react-native-purchases';
import { supabase } from '../lib/supabase';
import {
  Subscription,
  PlanFeatures,
  canUseFeature,
  isSubscriptionActive,
  getCurrentSubscription,
} from '../lib/subscription';
import { syncRevenueCatToDb, ENTITLEMENT_IDS } from '../lib/purchases';

interface UseSubscriptionResult {
  subscription: Subscription | null;
  loading: boolean;
  isActive: boolean;
  isBlocked: boolean;
  isTrial: boolean;
  trialDaysLeft: number;
  trialEndsAt: string | null;
  canUse: (feature: keyof PlanFeatures) => boolean;
  refresh: () => Promise<void>;
}

export function useSubscription(): UseSubscriptionResult {
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [loading, setLoading] = useState(true);
  const [trialEndsAt, setTrialEndsAt] = useState<string | null>(null);
  const channelIdRef = useRef(`${Date.now()}-${Math.random().toString(36).slice(2)}`);

  const refresh = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (user) await syncRevenueCatToDb(user.id);
    const sub = await getCurrentSubscription();
    setSubscription(sub);

    // RC에서 직접 trial 만료일 조회 (DB trial_ends_at은 stale할 수 있음)
    try {
      const customerInfo = await Purchases.getCustomerInfo();
      const active = customerInfo.entitlements.active;
      const ent = active[ENTITLEMENT_IDS.PRO] ?? active[ENTITLEMENT_IDS.BASIC] ?? null;
      const periodType: string = (ent as any)?.periodType ?? '';
      if (periodType === 'TRIAL') {
        setTrialEndsAt((ent?.expirationDate as string | null | undefined) ?? null);
      } else {
        setTrialEndsAt(null);
      }
    } catch {
      setTrialEndsAt(null);
    }

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

  // RC 기반 남은 일수 (trialEndsAt이 있으면 사용, 없으면 0)
  const trialDaysLeft = (() => {
    if (!isTrial || !trialEndsAt) return 0;
    const ms = new Date(trialEndsAt).getTime() - Date.now();
    return Math.max(0, Math.ceil(ms / (1000 * 60 * 60 * 24)));
  })();

  return {
    subscription,
    loading,
    isActive: isSubscriptionActive(subscription),
    isBlocked,
    isTrial,
    trialDaysLeft,
    trialEndsAt,
    canUse,
    refresh,
  };
}
