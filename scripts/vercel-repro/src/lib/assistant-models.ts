"use client";

/** T68 — the AI assistant popup's brain registry, PUTER-FREE.
 *
 *  The user asked for Puter to be removed from the app's AI surfaces, and
 *  the T67 removal only covered the AGENT view — this module still shipped
 *  the whole client-side Puter.js ladder (script injection, first-party
 *  sign-in popup, 1,000-model catalog) behind the Ctrl+K assistant. All of
 *  it is gone now. What remains is the honest two-brain ladder:
 *
 *  - Instant — the built-in bilingual regex router (zero network, runs the
 *    command tools locally against the live app).
 *  - Cloud   — /api/assistant: the server-side layered GLM brain (direct
 *    Z.AI key → sandbox SDK → keyless GLM-5.3-Flash → Pollinations), works
 *    in any browser with zero sign-in and zero keys.
 *
 *  Old persisted "puter:…" ids migrate to the cloud brain silently. */

export type AssistantModelId = string; // "instant" | "cloud"

export const MODEL_INSTANT = "instant";
export const MODEL_CLOUD = "cloud";

/** Pretty label for the model chip. */
export function modelChipLabel(id: AssistantModelId): string {
  if (id === MODEL_INSTANT) return "Instant";
  if (id === MODEL_CLOUD) return "Cloud · GLM";
  return id;
}

/** Is a persisted id a VALID brain? (stale "puter:…" picks → false, so the
 *  restore effect resets them to the cloud brain.) */
export function isValidAssistantModel(id: string | null): boolean {
  return id === MODEL_INSTANT || id === MODEL_CLOUD;
}
