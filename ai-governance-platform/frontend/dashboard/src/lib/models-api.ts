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
  bedrock: [
    'anthropic.claude-3-5-sonnet-20241022-v2:0',
    'anthropic.claude-3-haiku-20240307-v1:0',
    'amazon.titan-text-express-v1',
    'meta.llama3-70b-instruct-v1:0',
    'mistral.mistral-large-2402-v1:0',
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
