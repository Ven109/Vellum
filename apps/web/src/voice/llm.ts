import { adapterFor } from "@vellum/ai";
import type { Llm } from "@vellum/voice";
import { activeProvider } from "../state/assistant.js";

/** The writer's own AI provider as a streaming completion for the voice loop, or null without one. */
export async function voiceModel(): Promise<{ llm: Llm; label: string; model: string } | null> {
  const target = await activeProvider();
  if (!target) return null;
  const adapter = adapterFor(target.provider.kind);
  const llm: Llm = async function* ({ system, messages, maxTokens, signal }) {
    for await (const ev of adapter.stream(target.provider, {
      model: target.model,
      system,
      messages,
      maxTokens,
      signal,
    }))
      if (ev.type === "text") yield ev.text;
  };
  return { llm, label: target.provider.label, model: target.model };
}
