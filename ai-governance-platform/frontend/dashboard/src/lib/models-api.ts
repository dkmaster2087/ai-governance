import { createModelConfig, deleteModelConfig, fetchModelConfigs, testModelConfig, updateModelConfig } from './api';

/** Providers the gateway can call today. */
export type ModelProvider = 'bedrock' | 'openai';

export interface ModelConfig {
  modelConfigId: string;
  name: string;
  provider: string;
  modelId: string;
  status: 'active' | 'inactive' | 'testing';
  apiKeyHint?: string;
  inputCostPer1kTokens: number;
  outputCostPer1kTokens: number;
  maxTokensPerRequest?: number;
  allowedKeyIds?: string[];
  lastTestedAt?: string;
  lastTestStatus?: 'pass' | 'fail';
}

export interface ModelInput {
  name: string;
  provider: ModelProvider;
  modelId: string;
  status: 'active' | 'inactive';
  apiKey?: string;
  inputCostPer1kTokens: number;
  outputCostPer1kTokens: number;
  /** The longest answer an app may ask for; larger requests are capped. */
  maxTokensPerRequest: number;
  /** API keys that may use the model; empty means every key. */
  allowedKeyIds: string[];
}

export interface ModelTestResult {
  success: boolean;
  latencyMs: number;
  error?: string;
}

export const PROVIDER_LABEL: Record<string, string> = {
  bedrock: 'Amazon Bedrock',
  openai: 'OpenAI',
};

/** Suggestions only; any model ID the provider accepts works. */
export const MODEL_SUGGESTIONS: Record<ModelProvider, string[]> = {
  // Any model Bedrock hosts works (the gateway uses Bedrock's Converse API). Cross-region inference profiles
  // (us.…) are what most accounts have access to; the account must have the model enabled in Bedrock.
  bedrock: [
    'us.anthropic.claude-sonnet-5',
    'us.anthropic.claude-fable-5',
    'us.amazon.nova-2-lite-v1:0',
    'us.amazon.nova-micro-v1:0',
    'us.amazon.nova-premier-v1:0',
  ],
  openai: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'o3-mini'],
};

export const listModels = async (): Promise<ModelConfig[]> => {
  const data = await fetchModelConfigs();
  return Array.isArray(data) ? data : [];
};

export const saveModel = (input: ModelInput, id?: string) => {
  const payload = { ...input, apiKey: input.apiKey || undefined };
  return id ? updateModelConfig(id, payload) : createModelConfig(payload);
};

export const removeModel = (id: string) => deleteModelConfig(id);
export const testModel = (id: string): Promise<ModelTestResult> => testModelConfig(id);
