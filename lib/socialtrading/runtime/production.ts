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
  return { store: supabaseRuntimeStore, model: openRouterModel(), registry: capabilities, services: agentServices, ledger: supabaseLedger, ...overrides };
}
export const runtimeStore = supabaseRuntimeStore;
export function executeRun(job: RunJob, signal?: AbortSignal, overrides: Partial<BackgroundAgentDeps<AgentServices>> = {}): Promise<RunOutcome> {
  return runBackgroundAgent(job, productionDeps({ signal, ...overrides }));
}
