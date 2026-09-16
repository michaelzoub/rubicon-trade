import "server-only";
import { supabaseLedger } from "../account";
import { capabilities } from "../agents/builtins";
import { agentServices, type AgentServices } from "../agents/services";
import { runBackgroundAgent, type BackgroundAgentDeps } from "./background-agent";
import { openRouterModel } from "./model";
import { supabaseRuntimeStore } from "./store";
import type { RunJob, RunOutcome } from "./types";

/** Composition root for the runtime. Cron, manual triggers, and future chat or event triggers all come through here. */
export function productionDeps(overrides: Partial<BackgroundAgentDeps<AgentServices>> = {}): BackgroundAgentDeps<AgentServices> {
  // Background runs use the free tier's model. The runtime reads the balance but not the plan, so
  // making wake-ups plan-aware needs an account load per run — worth doing once a user can actually
  // hold a paid plan. Chat already picks its model from `account.planId`.
  return { store: supabaseRuntimeStore, model: openRouterModel("free"), registry: capabilities, services: agentServices, ledger: supabaseLedger, ...overrides };
}
export const runtimeStore = supabaseRuntimeStore;
export function executeRun(job: RunJob, signal?: AbortSignal, overrides: Partial<BackgroundAgentDeps<AgentServices>> = {}): Promise<RunOutcome> {
  return runBackgroundAgent(job, productionDeps({ signal, ...overrides }));
}
