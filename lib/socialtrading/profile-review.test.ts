import { expect, it, vi } from "vitest";
import { PREVIEW_ACCOUNT, PREVIEW_STATE } from "@/app/preview/fixture";
import { reviewProfile } from "./profile-review";
import { defaultAgent } from "./agents/config";
import type { ModelClient } from "./runtime/types";

function setup() {
  const state = structuredClone(PREVIEW_STATE);
  state.agent = defaultAgent(); state.inferred = []; state.signals = []; state.events = [];
  state.chats[0].messages = [0, 1, 2].map(n => ({ id: `m${n}`, role: "user" as const, at: new Date(Date.now() - 1000 + n).toISOString(),
    parts: [{ type: "text" as const, text: "Interested in the AI infrastructure theme" }] }));
  const complete = vi.fn(async () => ({ content: JSON.stringify({ observations: [{ id: "ai", direction: 1, reason: "You keep exploring AI infrastructure.", evidenceIds: ["m0", "m1"] }] }), toolCalls: [] }));
  return { state, complete, model: { complete } as ModelClient };
}

it("reviews repeated chat evidence, leaves explicit choices intact, and does not reprocess evidence", async () => {
  const { state, model, complete } = setup();
  const explicit = structuredClone(state.profile);
  await reviewProfile(state, "owner", PREVIEW_ACCOUNT, model);
  expect(state.inferred).toContainEqual(expect.objectContaining({ id: "ai", weight: .12, confidence: .4, count: 2 }));
  expect(state.profile).toEqual(explicit);
  expect(state.events[0]).toMatchObject({ kind: "learning", detail: expect.stringContaining("tentative") });
  await reviewProfile(state, "owner", PREVIEW_ACCOUNT, model);
  state.profileReview!.attemptedAt = new Date(Date.now() - 16 * 60_000).toISOString();
  await reviewProfile(state, "owner", PREVIEW_ACCOUNT, model);
  expect(complete).toHaveBeenCalledTimes(1);
});

it("requires sufficient activity and honors the profile capability", async () => {
  const { state, model, complete } = setup();
  state.chats[0].messages = state.chats[0].messages.slice(0, 2);
  await reviewProfile(state, "owner", PREVIEW_ACCOUNT, model);
  expect(complete).not.toHaveBeenCalled();
  state.agent!.capabilities = [];
  state.signals = Array.from({ length: 5 }, (_, n) => ({ id: `s${n}`, action: "opened", target: "solana", at: new Date().toISOString() }));
  await reviewProfile(state, "owner", PREVIEW_ACCOUNT, model);
  expect(complete).not.toHaveBeenCalled();
});

it("rejects fabricated evidence, unknown assets, and permission changes", async () => {
  const { state, model, complete } = setup();
  complete.mockResolvedValue({ content: JSON.stringify({ observations: [
    { id: "ai", direction: 1, reason: "guess", evidenceIds: ["fake", "m0"] },
    { id: "automatic", direction: 1, reason: "guess", evidenceIds: ["m0", "m1"] },
    { id: "FAKE", direction: 1, reason: "guess", evidenceIds: ["m0", "m1"] },
  ] }), toolCalls: [] });
  await reviewProfile(state, "owner", PREVIEW_ACCOUNT, model);
  expect(state.inferred).toEqual([]);
  expect(state.events).toEqual([]);
});

it("preserves evidence on model failure and retries only after cooldown", async () => {
  const { state, model, complete } = setup();
  complete.mockRejectedValueOnce(new Error("offline"));
  await reviewProfile(state, "owner", PREVIEW_ACCOUNT, model);
  expect(state.profileReview?.reviewedThrough).toBeUndefined();
  await reviewProfile(state, "owner", PREVIEW_ACCOUNT, model);
  expect(complete).toHaveBeenCalledTimes(1);
  state.profileReview!.attemptedAt = new Date(Date.now() - 16 * 60_000).toISOString();
  await reviewProfile(state, "owner", PREVIEW_ACCOUNT, model);
  expect(state.inferred).toHaveLength(1);
});

it("reviews repeated token visits but cannot restore forgotten themes from old evidence", async () => {
  const { state, model, complete } = setup();
  state.chats[0].messages = [];
  state.inferred = [{ id: "solana", weight: .4, confidence: .5, count: 5, updatedAt: new Date().toISOString() }];
  state.signals = Array.from({ length: 5 }, (_, n) => ({ id: `s${n}`, action: "opened", target: "solana", at: new Date(Date.now() - 1000 + n).toISOString() }));
  complete.mockResolvedValue({ content: JSON.stringify({ observations: [{ id: "solana", direction: 1, reason: "Repeated visits", evidenceIds: ["s0", "s1"] }] }), toolCalls: [] });
  await reviewProfile(state, "owner", PREVIEW_ACCOUNT, model);
  expect(state.inferred[0].weight).toBe(.52);
  const fresh = setup();
  fresh.state.profileReview = { attemptedAt: new Date(0).toISOString(), forgotten: { ai: new Date().toISOString() } };
  await reviewProfile(fresh.state, "owner", PREVIEW_ACCOUNT, fresh.model);
  expect(fresh.state.inferred).toEqual([]);
});
