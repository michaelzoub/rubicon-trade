import "server-only";
import { cryptoServices } from "@/lib/crypto/services";
import { marketData } from "../providers/market-data";
import { cryptoData } from "../providers/crypto-data";
import type { Asset } from "../types";
export interface AssetProvider {
  search(query: string): Promise<Asset[]>;
  detail(id: string, days?: number): Promise<Asset>;
}
export interface AgentServices {
  onchain?: typeof cryptoServices;
  stocks: AssetProvider & { ipos(): Promise<Asset[]>; trending?(): Promise<Asset[]> };
  crypto: AssetProvider & { trending(): Promise<Asset[]> };
}
/** Composition root: replace adapters here or inject services into a capability. */
export const agentServices: AgentServices = { stocks: marketData, crypto: cryptoData, onchain: cryptoServices };
