/**
 * Check 3 (personal data) for proxy mode, where IDEs and tools send the provider's own request format and
 * Probaline forwards it. Only the fields that carry prompt text are changed: system prompts, message contents
 * (plain strings, text blocks, tool results) and the single-field formats. Model names, IDs, tool definitions,
 * images and the assistant's own tool calls are left exactly as sent, so the provider still accepts the request.
 */

type Mask = (text: string) => Promise<string>;

/** Top-level fields that hold a prompt, by provider: OpenAI and Mistral `messages`, Anthropic `system` + `messages`,
 * Cohere `message`, `preamble` and `chat_history`, older completion APIs `prompt` / `input`. */
const TEXT_FIELDS = ['system', 'prompt', 'input', 'content', 'message', 'preamble'] as const;

async function maskContent(v: unknown, mask: Mask, changed: { any: boolean }): Promise<unknown> {
  if (typeof v === 'string') {
    const m = await mask(v);
    if (m !== v) changed.any = true;
    return m;
  }
  if (Array.isArray(v)) return Promise.all(v.map((x) => maskContent(x, mask, changed)));
  if (v && typeof v === 'object') {
    const block = v as Record<string, unknown>;
    // The assistant's own tool calls (tool_use / function calls) are what the model said; leave them be.
    if (block.type === 'tool_use' || block.type === 'image' || block.type === 'image_url' || block.type === 'input_audio') return v;
    const out: Record<string, unknown> = { ...block };
    if (typeof block.text === 'string') out.text = await maskContent(block.text, mask, changed);
    if (block.content !== undefined) out.content = await maskContent(block.content, mask, changed);
    return out;
  }
  return v;
}

/** The request body with personal data removed from its prompt text, and whether anything was removed. */
export async function maskPromptFields<T>(body: T, mask: Mask): Promise<{ body: T; changed: boolean }> {
  if (!body || typeof body !== 'object') return { body, changed: false };
  const changed = { any: false };
  const src = body as Record<string, unknown>;
  const out: Record<string, unknown> = { ...src };
  for (const f of TEXT_FIELDS) if (src[f] !== undefined) out[f] = await maskContent(src[f], mask, changed);
  if (Array.isArray(src.messages)) {
    out.messages = await Promise.all(src.messages.map(async (m) => {
      if (!m || typeof m !== 'object') return m;
      const msg = m as Record<string, unknown>;
      // Assistant turns are earlier answers: they're part of the prompt sent now, so they're cleaned too.
      return msg.content === undefined ? msg : { ...msg, content: await maskContent(msg.content, mask, changed) };
    }));
  }
  if (Array.isArray(src.chat_history)) {
    out.chat_history = await Promise.all(src.chat_history.map(async (m) => {
      if (!m || typeof m !== 'object') return m;
      const msg = m as Record<string, unknown>;
      return { ...msg, ...(msg.message !== undefined ? { message: await maskContent(msg.message, mask, changed) } : {}) };
    }));
  }
  return { body: out as T, changed: changed.any };
}
