import "server-only";
import { parseOpenRouterUsage, USAGE_ACCOUNTING } from "../credits";
import type { ModelClient, ModelToolCall } from "./types";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

/** Non-streaming OpenRouter completion. Same credentials and model selection as the chat runner. */
export function openRouterModel(): ModelClient {
  return {
    async complete({ messages, tools, toolChoice, signal }) {
      const apiKey = process.env.OPENROUTER_API_KEY;
      if (!apiKey) throw new Error("The agent model is not configured on this deployment.");
      const model = process.env.SOCIALTRADING_MODEL || "openai/gpt-4.1-mini";
      const response = await fetch(OPENROUTER_URL, {
        method: "POST", signal,
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", "HTTP-Referer": "https://rubiconpay.xyz", "X-Title": "Rubicon background agent" },
        body: JSON.stringify({ model, messages, ...(tools.length ? { tools, tool_choice: toolChoice } : {}), temperature: .3, max_tokens: 900, ...USAGE_ACCOUNTING }),
      });
      if (!response.ok) { const detail = await response.text().catch(() => ""); console.error("[runtime/model] upstream", response.status, detail.slice(0, 300)); throw new Error("The model is unavailable right now."); }
      const body = await response.json() as { id?: string; model?: string; usage?: unknown; choices?: { message?: { content?: string | null; tool_calls?: ModelToolCall[] } }[] };
      const message = body.choices?.[0]?.message;
      return { content: message?.content ?? "", toolCalls: (message?.tool_calls ?? []).filter(c => c?.function?.name).map(c => ({ id: c.id, type: "function" as const, function: { name: c.function.name, arguments: c.function.arguments ?? "{}" } })), usage: parseOpenRouterUsage({ ...body, model: body.model ?? model }) ?? undefined };
    },
  };
}
