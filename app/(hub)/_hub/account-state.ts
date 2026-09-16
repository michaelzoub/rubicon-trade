"use client";

import { atom, useAtom, useSetAtom } from "jotai";
import { useCallback, useEffect } from "react";
import type { AccountSummary } from "@/lib/socialtrading/plans";

/** Account data belongs to the signed-in user, not to an individual hub page or agent. */
const accountSummariesAtom = atom<Record<string, AccountSummary | undefined>>({});

export function useAccountSummary(userId: string, initial: AccountSummary | null = null) {
  const [summaries, setSummaries] = useAtom(accountSummariesAtom);
  const account = summaries[userId] ?? initial;
  const setAccount = useCallback((next: AccountSummary) => {
    setSummaries(current => current[userId] === next ? current : { ...current, [userId]: next });
  }, [setSummaries, userId]);

  useEffect(() => {
    if (initial) setAccount(initial);
  }, [initial, setAccount]);

  return [account, setAccount] as const;
}

/** What one connected wallet holds on its current network. Unavailable stays distinct from zero. */
export type WalletBalance =
  | { state: "ok"; network: string; usdc: string; native: string; symbol: string }
  | { state: "unavailable" };

export type WalletBalanceCache = {
  connectionKey: string;
  balances: Record<string, WalletBalance>;
  status: "loading" | "ready";
  updatedAt: number;
};

const walletBalanceCachesAtom = atom<Record<string, WalletBalanceCache | undefined>>({});

/** Claim a balance refresh synchronously so remounts and duplicate consumers share one request. */
const startWalletBalanceLoadAtom = atom(null, (get, set, input: { userId: string; connectionKey: string }) => {
  const caches = get(walletBalanceCachesAtom);
  const current = caches[input.userId];
  const fresh = current?.status === "ready" && Date.now() - current.updatedAt < 60_000;
  if (current?.connectionKey === input.connectionKey && (current.status === "loading" || fresh)) return false;
  set(walletBalanceCachesAtom, {
    ...caches,
    [input.userId]: { connectionKey: input.connectionKey, balances: {}, status: "loading", updatedAt: 0 },
  });
  return true;
});

const finishWalletBalanceLoadAtom = atom(null, (get, set, input: { userId: string; connectionKey: string; balances: Record<string, WalletBalance> }) => {
  const caches = get(walletBalanceCachesAtom);
  if (caches[input.userId]?.connectionKey !== input.connectionKey) return;
  set(walletBalanceCachesAtom, {
    ...caches,
    [input.userId]: { connectionKey: input.connectionKey, balances: input.balances, status: "ready", updatedAt: Date.now() },
  });
});

export function useWalletBalanceCache(userId: string) {
  const [caches] = useAtom(walletBalanceCachesAtom);
  const start = useSetAtom(startWalletBalanceLoadAtom);
  const finish = useSetAtom(finishWalletBalanceLoadAtom);
  return {
    cache: caches[userId],
    start: useCallback((connectionKey: string) => start({ userId, connectionKey }), [start, userId]),
    finish: useCallback((connectionKey: string, balances: Record<string, WalletBalance>) => finish({ userId, connectionKey, balances }), [finish, userId]),
  };
}
