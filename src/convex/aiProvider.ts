"use node";

import { fetchWithRetry } from "./net";

/**
 * Phase 4 K — Multi-provider AI abstraction.
 *
 * Aria no longer hard-codes one LLM provider. Providers are configured purely
 * through project keys (never exposed to the client):
 *
 *   AI_PROVIDER_ORDER   = "openrouter,openai,anthropic" (default; comma list,
 *                         first configured provider wins)
 *   OPENROUTER_API_KEY  + OPENROUTER_MODEL   (existing keys)
 *   OPENAI_API_KEY      + OPENAI_MODEL       (default gpt-4o-mini)
 *   ANTHROPIC_API_KEY   + ANTHROPIC_MODEL    (default claude-3-5-haiku-latest)
 *
 * chatCompletion() normalizes every provider's response to
 * { content } / { error }, tries the configured providers in order, and only
 * reports failure when every configured provider failed (fallback where
 * configured). Keys never leave the server.
 */

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface NormalizedResult {
  content?: string;
  error?: string;
}

interface Provider {
  id: string;
  label: string;
  configured: () => boolean;
  call: (opts: {
    messages: ChatMessage[];
    temperature: number;
  }) => Promise<NormalizedResult>;
}

const OPENROUTER_MODEL_DEFAULT = "nvidia/nemotron-3-super-120b-a12b:free";

function providerList(): string[] {
  const order = (process.env.AI_PROVIDER_ORDER ?? "openrouter,openai,anthropic")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const known = new Set(["openrouter", "openai", "anthropic"]);
  return [...new Set(order.filter((p) => known.has(p)))];
}

const providers: Provider[] = [
  {
    id: "openrouter",
    label: "OpenRouter",
    configured: () => Boolean(process.env.OPENROUTER_API_KEY),
    call: async ({ messages, temperature }) => {
      const res = await fetchWithRetry(
        "https://openrouter.ai/api/v1/chat/completions",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
            "Content-Type": "application/json",
            "X-Title": "Aria",
          },
          body: JSON.stringify({
            model: process.env.OPENROUTER_MODEL ?? OPENROUTER_MODEL_DEFAULT,
            temperature,
            messages,
          }),
        },
      );
      const data = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
        error?: { message?: string };
      };
      if (!res.ok) {
        return { error: data?.error?.message ?? `HTTP ${res.status}` };
      }
      return { content: data?.choices?.[0]?.message?.content };
    },
  },
  {
    id: "openai",
    label: "OpenAI",
    configured: () => Boolean(process.env.OPENAI_API_KEY),
    call: async ({ messages, temperature }) => {
      const res = await fetchWithRetry("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
          temperature,
          messages,
        }),
      });
      const data = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
        error?: { message?: string };
      };
      if (!res.ok) {
        return { error: data?.error?.message ?? `HTTP ${res.status}` };
      }
      return { content: data?.choices?.[0]?.message?.content };
    },
  },
  {
    id: "anthropic",
    label: "Anthropic",
    configured: () => Boolean(process.env.ANTHROPIC_API_KEY),
    call: async ({ messages, temperature }) => {
      const system = messages
        .filter((m) => m.role === "system")
        .map((m) => m.content)
        .join("\n\n");
      const res = await fetchWithRetry(
        "https://api.anthropic.com/v1/messages",
        {
          method: "POST",
          headers: {
            "x-api-key": process.env.ANTHROPIC_API_KEY!,
            "anthropic-version": "2023-06-01",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: process.env.ANTHROPIC_MODEL ?? "claude-3-5-haiku-latest",
            max_tokens: 4096,
            temperature,
            system: system || undefined,
            messages: messages
              .filter((m) => m.role !== "system")
              .map((m) => ({
                role: m.role === "assistant" ? "assistant" : "user",
                content: m.content,
              })),
          }),
        },
      );
      const data = (await res.json()) as {
        content?: Array<{ type?: string; text?: string }>;
        error?: { message?: string };
      };
      if (!res.ok) {
        return { error: data?.error?.message ?? `HTTP ${res.status}` };
      }
      const text = (data?.content ?? [])
        .filter((b) => b.type === "text" && b.text)
        .map((b) => b.text!)
        .join("");
      return { content: text };
    },
  },
];

/** Human-readable status for the runtime center / admin console. */
export function aiProviderStatus(): Array<{
  id: string;
  label: string;
  configured: boolean;
  model: string;
}> {
  return providers.map((p) => ({
    id: p.id,
    label: p.label,
    configured: p.configured(),
    model:
      p.id === "openrouter"
        ? process.env.OPENROUTER_MODEL ?? OPENROUTER_MODEL_DEFAULT
        : p.id === "openai"
          ? process.env.OPENAI_MODEL ?? "gpt-4o-mini"
          : process.env.ANTHROPIC_MODEL ?? "claude-3-5-haiku-latest",
  }));
}

export function hasAnyAiProvider(): boolean {
  return providers.some((p) => p.configured());
}

export function configuredProviderIds(): string[] {
  return providerList().filter((id) => {
    const p = providers.find((x) => x.id === id);
    return p?.configured();
  });
}

export type ChatCompletionResult =
  | { ok: true; content: string; provider: string }
  | { ok: false; error: string; provider: string };

/**
 * Send a chat completion through the first *configured* provider in
 * AI_PROVIDER_ORDER, falling back to the next configured provider when a
 * call fails. Only fails when every configured provider failed.
 */
export async function chatCompletion(opts: {
  messages: ChatMessage[];
  temperature?: number;
}): Promise<ChatCompletionResult> {
  const temperature = opts.temperature ?? 0.2;
  const order = providerList().filter((id) =>
    providers.some((p) => p.id === id && p.configured()),
  );
  const candidates = order.length > 0 ? order : providers.filter((p) => p.configured()).map((p) => p.id);
  if (candidates.length === 0) {
    return {
      ok: false,
      error:
        "No AI provider is configured — add OPENROUTER_API_KEY (or OPENAI_API_KEY / ANTHROPIC_API_KEY) to your project keys.",
      provider: "none",
    };
  }
  let lastError = "No provider responded.";
  for (const id of candidates) {
    const provider = providers.find((p) => p.id === id);
    if (!provider) continue;
    try {
      const result = await provider.call({ messages: opts.messages, temperature });
      if (result.error) {
        lastError = `${provider.label}: ${result.error}`;
        continue;
      }
      if (!result.content || !result.content.trim()) {
        lastError = `${provider.label}: returned an empty reply`;
        continue;
      }
      return { ok: true, content: result.content, provider: id };
    } catch (e) {
      lastError = `${provider.label}: ${
        e instanceof Error ? e.message : "network error"
      }`;
    }
  }
  return { ok: false, error: lastError, provider: candidates[candidates.length - 1] ?? "none" };
}
