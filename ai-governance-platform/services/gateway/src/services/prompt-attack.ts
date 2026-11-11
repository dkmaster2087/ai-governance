import { BedrockRuntimeClient, ApplyGuardrailCommand } from '@aws-sdk/client-bedrock-runtime';
import { createLogger } from '@ai-governance/utils';

/**
 * Check 4 (Beta): text that tries to take over the AI, such as "ignore your instructions" typed by a user
 * or hidden inside a pasted email, web page or document.
 *
 * Two layers. A short list of precise phrases runs in-process on the text and on an un-disguised copy of
 * it (spacing, look-alike digits, invisible characters and base64 undone). When the deployment has a
 * Bedrock guardrail with the prompt-attack filter, its verdict is added: it catches rephrased and
 * hidden attacks the phrases can't. Measured on the set in __tests__/prompt-attack-corpus.ts.
 *
 * Only the latest turn is checked (everything after the last answer): the company's own system prompt
 * is trusted, and earlier turns were checked when they were sent.
 */

const logger = createLogger('gateway:prompt-attack');

export type PromptAttackAction = 'off' | 'flag' | 'block';

/** Phrases that are almost never innocent. Broad ones ("urgent", "act as", "verbatim") stop real work, so they're left out. */
const PHRASES: Array<{ re: RegExp; why: string }> = [
  { re: /\b(ignore|disregard|forget|override|bypass)\b[^.\n]{0,40}\b(all |any |the |your |my )?(previous|prior|above|earlier|preceding|original|system|initial|safety)\b[^.\n]{0,20}\b(instructions?|prompts?|rules|guidelines|directions)\b/i, why: 'asks the AI to ignore its instructions' },
  { re: /\b(ignore|disregard|forget|set aside)\b[^.\n]{0,25}\b(everything|whatever|all|the (instructions|rules|guidelines))\b[^.\n]{0,15}\byou (were|have been|'ve been) (told|given|instructed)\b/i, why: 'asks the AI to ignore its instructions' },
  { re: /\b(rules|instructions|guidelines|constraints)( that)? you (were|have been) given (no longer|don't|do not) apply\b|\b(previous|prior) (constraints|instructions|rules) (are )?(void|cancelled|no longer apply)\b|\bsystem override\b/i, why: 'declares the AI’s rules cancelled' },
  { re: /\b(ignorez|oubliez) (toutes )?(les |vos )?instructions|\bvergiss (alle )?(vorherigen |deine )?anweisungen|\bignora (todas )?(las |tus )?instrucciones/i, why: 'asks the AI to ignore its instructions (other language)' },
  { re: /\b(what('s| is| are| were)|show|reveal|print|repeat|translate|output|display|tell me|leak)\b[^.\n]{0,25}\byour (system prompt|initial instructions|original instructions|hidden (instructions|prompt|configuration))\b/i, why: 'asks for the hidden system prompt' },
  { re: /\b(reveal|print|show|output|repeat|display|leak|quote)\b[^.\n]{0,30}\b(the )?hidden (developer |system )?(message|prompt|instructions)\b|\b(repeat|print|output)\b[^.\n]{0,15}\beverything (above|before) (this|my)\b|\b(before|above) my first message\b/i, why: 'asks for the hidden system prompt' },
  { re: /\b(output|print|repeat|regurgitate|dump|reveal|recite)\b[^.\n]{0,40}\b(your training data|(you were|you've been) trained on)\b/i, why: 'asks for training data' },
  { re: /\b(developer|god|jailbreak|dan) mode\b[^.\n]{0,20}\b(enabled|activated|on)\b|\bdo anything now\b|\bevil (version|twin) of yourself\b/i, why: 'a known jailbreak phrase' },
  { re: /\byou (have|possess) no (ethical|moral|content) (guidelines|boundaries|constraints|policy|policies)\b|\b(model|ai|assistant|chatbot) (with|that has) no (content policy|restrictions|filters|guidelines)\b|\b(unrestricted|uncensored|unfiltered),? (and )?(uncensored |unfiltered )?(ai|model|assistant)\b/i, why: 'tells the AI it has no rules' },
  { re: /\b(bypass|disable|switch off|turn off)\b[^.\n]{0,15}\b(safety|content) (filters|guidelines|restrictions)\b|\byour (safety|content) (guidelines|filters|rules|restrictions)\b[^.\n]{0,20}\b(switched off|turned off|disabled|removed)\b/i, why: 'asks the AI to drop its safety rules' },
  { re: /<\|im_start\|>\s*system|^\s*(system|assistant)\s*:\s*(ignore|disregard|new instructions)/im, why: 'a fake system message' },
  // Instructions aimed at the AI from inside a pasted email, page or document.
  { re: /\b(ai|assistant|asistente|chatbot|llm)( reviewers?)?\s*[:,]\s*(stop|ignore|ignora|disregard|forget|instead|do not|don't)\b|\bnote to (the )?ai( \w+)?\s*[:,]|\bthe (assistant|ai|model) must now\b/i, why: 'instructions aimed at the AI inside the text' },
];

const LEET: Record<string, string> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', '$': 's' };

/** The text with common disguises undone, or null if there was nothing to undo. */
export function undisguise(text: string): string | null {
  let t = text.replace(/[​-‏‪-‮⁠﻿]/g, '');
  t = t.replace(/(?:\b\w\s{1,3}){3,}\w\b/g, (m) => m.replace(/\s+/g, ''));
  // "i g n o r e   a l l" becomes "ignoreall": put spaces back between known words so phrases can match.
  t = t.replace(/(ignore|disregard|forget|all|previous|prior|instructions?|reveal|system|prompt)(?=[a-z])/gi, '$1 ');
  t = t.replace(/[01345@$7](?=[a-z])|(?<=[a-z])[01345@$7]/gi, (c) => LEET[c] ?? c);
  const decoded: string[] = [];
  for (const m of text.matchAll(/[A-Za-z0-9+/]{24,}={0,2}/g)) {
    const s = Buffer.from(m[0], 'base64').toString('utf8');
    if (/^[\x20-\x7E\s]{12,}$/.test(s) && /[a-z]{3,} [a-z]{3,}/i.test(s)) decoded.push(s);
  }
  const out = [t, ...decoded].join('\n');
  return out === text ? null : out;
}

/** The first precise phrase found, and whether it only showed up once disguises were undone. */
export function matchPhrases(text: string): { why: string; disguised: boolean } | null {
  const scan = text.slice(0, 200_000);
  for (const p of PHRASES) if (p.re.test(scan)) return { why: p.why, disguised: false };
  const plain = undisguise(scan);
  if (plain) for (const p of PHRASES) if (p.re.test(plain)) return { why: `${p.why} (disguised)`, disguised: true };
  return null;
}

/** The turn being sent now: every message after the last answer, except the company's own system prompt. */
export function latestTurn(messages: Array<{ role: string; content: string }>): string {
  let i = messages.length;
  while (i > 0 && messages[i - 1].role !== 'assistant') i--;
  return messages.slice(i).filter((m) => m.role !== 'system').map((m) => m.content).join('\n\n');
}

export type BedrockVerdict = { confidence: 'NONE' | 'LOW' | 'MEDIUM' | 'HIGH' } | { unavailable: string };

/** Bedrock's prompt-attack filter. Long text is checked at both ends, where hidden instructions usually sit. */
export class BedrockPromptAttack {
  private client: BedrockRuntimeClient;
  constructor(private guardrailId: string, private version = 'DRAFT', region = process.env.AWS_REGION || 'us-east-1', private timeoutMs = 2500) {
    this.client = new BedrockRuntimeClient({ region });
  }
  static fromEnv(): BedrockPromptAttack | null {
    const id = process.env.PROMPT_ATTACK_GUARDRAIL_ID?.trim();
    return id ? new BedrockPromptAttack(id, process.env.PROMPT_ATTACK_GUARDRAIL_VERSION?.trim() || 'DRAFT') : null;
  }
  async check(text: string): Promise<BedrockVerdict> {
    const sample = text.length > 20_000 ? `${text.slice(0, 10_000)}\n…\n${text.slice(-10_000)}` : text;
    try {
      const r = await this.client.send(new ApplyGuardrailCommand({
        guardrailIdentifier: this.guardrailId, guardrailVersion: this.version, source: 'INPUT', content: [{ text: { text: sample } }],
      }), { abortSignal: AbortSignal.timeout(this.timeoutMs) });
      const f = r.assessments?.flatMap((a) => a.contentPolicy?.filters ?? []).find((x) => x.type === 'PROMPT_ATTACK');
      return { confidence: (f?.confidence as 'LOW' | 'MEDIUM' | 'HIGH' | undefined) ?? 'NONE' };
    } catch (err) {
      logger.warn('Bedrock prompt-attack check unavailable', { error: (err as Error).name });
      return { unavailable: (err as Error).name || 'error' };
    }
  }
}

export interface PromptAttackResult {
  found: boolean;
  /** Strong enough to stop a request when the company chose "block". */
  strong: boolean;
  why?: string;
  metadata: Record<string, string>;
}

const RANK = { NONE: 0, LOW: 1, MEDIUM: 2, HIGH: 3 } as const;

/**
 * Check one turn. Any phrase or any Bedrock confidence flags it. Stopping needs more: Bedrock at medium
 * or higher, or a phrase that was disguised (hiding it is itself the tell). A plain phrase alone only
 * flags, because people quote attacks when they write about them.
 */
export async function checkPromptAttack(text: string, bedrock: BedrockPromptAttack | null): Promise<PromptAttackResult> {
  if (!text.trim()) return { found: false, strong: false, metadata: {} };
  const phrase = matchPhrases(text);
  const verdict = bedrock ? await bedrock.check(text) : null;
  const confidence = verdict && 'confidence' in verdict ? verdict.confidence : 'NONE';
  const byBedrock = RANK[confidence] >= RANK.LOW;
  const metadata: Record<string, string> = {
    promptAttackChecked: !bedrock ? 'phrases' : verdict && 'unavailable' in verdict ? 'phrases (Bedrock unavailable)' : 'phrases and Bedrock',
  };
  if (!phrase && !byBedrock) return { found: false, strong: false, metadata };
  const why = phrase?.why ?? `Bedrock rated it a likely prompt attack (${confidence.toLowerCase()} confidence)`;
  return {
    found: true,
    strong: RANK[confidence] >= RANK.MEDIUM || !!phrase?.disguised,
    why,
    metadata: {
      ...metadata,
      promptAttack: 'flagged',
      promptAttackWhy: why,
      promptAttackBy: phrase && byBedrock ? 'both' : phrase ? 'phrases' : 'bedrock',
      ...(byBedrock ? { promptAttackConfidence: confidence } : {}),
    },
  };
}

/** Rule name recorded in triggeredRules when this check stops a request. */
export const PROMPT_ATTACK_RULE = 'Prompt attacks';

let shared: BedrockPromptAttack | null | undefined;
/** The deployment's Bedrock layer, or null when no guardrail is configured (phrases only). */
export const promptAttackBedrock = () => (shared === undefined ? (shared = BedrockPromptAttack.fromEnv()) : shared);
export const setPromptAttackBedrock = (b: BedrockPromptAttack | null | undefined) => { shared = b; };
