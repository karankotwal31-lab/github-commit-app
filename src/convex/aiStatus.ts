import { getAuthUserId } from "@convex-dev/auth/server";
import { query } from "./_generated/server";

/**
 * AI provider status for the client — which providers are configured and
 * which model each would use. Booleans and model names only; keys never
 * leave the server (they are read straight from process.env, never echoed).
 *
 * Providers are configured purely through project keys:
 *   OPENROUTER_API_KEY + OPENROUTER_MODEL
 *   OPENAI_API_KEY     + OPENAI_MODEL     (default gpt-4o-mini)
 *   ANTHROPIC_API_KEY  + ANTHROPIC_MODEL  (default claude-3-5-haiku-latest)
 *   AI_PROVIDER_ORDER  = "openrouter,openai,anthropic" (first configured wins)
 */

const PROVIDER_DEFS = [
  {
    id: "openrouter",
    label: "OpenRouter",
    key: "OPENROUTER_API_KEY",
    model: process.env.OPENROUTER_MODEL ?? "default",
  },
  {
    id: "openai",
    label: "OpenAI",
    key: "OPENAI_API_KEY",
    model: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
  },
  {
    id: "anthropic",
    label: "Anthropic",
    key: "ANTHROPIC_API_KEY",
    model: process.env.ANTHROPIC_MODEL ?? "claude-3-5-haiku-latest",
  },
] as const;

export const status = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      return { configured: false, order: [], providers: [] };
    }
    const order = (process.env.AI_PROVIDER_ORDER ?? "openrouter,openai,anthropic")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter((s) => PROVIDER_DEFS.some((p) => p.id === s));
    const providers = PROVIDER_DEFS.map((p) => ({
      id: p.id,
      label: p.label,
      key: p.key,
      model: p.model,
      configured: Boolean(process.env[p.key]),
    }));
    return {
      configured: providers.some((p) => p.configured),
      order,
      providers,
    };
  },
});
