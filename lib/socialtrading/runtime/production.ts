import "server-only";
import { supabaseLedger } from "../account";
import { capabilities } from "../agents/builtins";
import { agentServices, type AgentServices } from "../agents/services";
import { runBackgroundAgent, type BackgroundAgentDeps } from "./background-agent";
import { openRouterModel } from "./model";
import { supabaseRuntimeStore } from "./store";
import type { RunJob, RunOutcome } from "./types";
import { autonomyState } from "@/lib/crypto/autonomous";
import { firstDelegatedWallet } from "@/lib/crypto/wallet";

/** Composition root for the runtime. Cron, manual triggers, and future chat or event triggers all come through here. */
export function productionDeps(overrides: Partial<BackgroundAgentDeps<AgentServices>> = {}): BackgroundAgentDeps<AgentServices> {
  // Background runs use the free tier's model. The runtime reads the balance but not the plan, so
  // making wake-ups plan-aware needs an account load per run — worth doing once a user can actually
  // hold a paid plan. Chat already picks its model from `account.planId`.
  return {
    store: supabaseRuntimeStore, model: openRouterModel("free"), registry: capabilities,
    services: agentServices, ledger: supabaseLedger,
    /** Resolved per run, from the profile and from Privy. Both have to agree, and
     * a failure to reach Privy reads as "not delegated" rather than as consent. */
    buyUnattended: async state => {
      // Cheap checks first: no point asking Privy when the person has not opted in.
      const local = autonomyState(state, "pending");
      if (!local.allowed) return local;
      const userId = state.profile.userId;
      if (!userId) return autonomyState(state, null);
      const wallet = await firstDelegatedWallet(userId).catch(() => null);
      // The address travels with the verdict: scheduled runs are not offered
      // get_crypto_wallets, so this is the only way the agent learns where a
      // purchase settles from.
      return { ...autonomyState(state, wallet?.id ?? null), wallet: wallet?.address };
    },
    ...overrides,
  };
}
export const runtimeStore = supabaseRuntimeStore;
export function executeRun(job: RunJob, signal?: AbortSignal, overrides: Partial<BackgroundAgentDeps<AgentServices>> = {}): Promise<RunOutcome> {
  return runBackgroundAgent(job, productionDeps({ signal, ...overrides }));
}
