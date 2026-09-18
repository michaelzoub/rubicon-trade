import type { Asset } from '@/lib/socialtrading/types';
export type PurchaseRequest = { side?: "buy" | "sell"; holding?: Pick<import("@/lib/crypto/recovery").Holding, "chainId" | "wallet" | "token">; asset?: Pick<Asset, 'symbol' | 'name' | 'contracts' | 'kind'>; query?: string; amount?: string };
export function openPurchase(request: PurchaseRequest = {}) {
  window.dispatchEvent(new CustomEvent<PurchaseRequest>('rubicon:purchase', { detail: request }));
}
