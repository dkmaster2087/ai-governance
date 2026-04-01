/**
 * Rough token estimation (GPT-style: ~4 chars per token).
 * For production use tiktoken or provider-specific counters.
 */
export function estimateTokenCount(text: string): number {
  return Math.ceil(text.length / 4);
}

export function estimateCost(
  inputTokens: number,
  outputTokens: number,
  inputCostPer1k: number,
  outputCostPer1k: number
): number {
  return (inputTokens / 1000) * inputCostPer1k + (outputTokens / 1000) * outputCostPer1k;
}
