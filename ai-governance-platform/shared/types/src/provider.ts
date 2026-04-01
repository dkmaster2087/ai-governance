export type AIProvider = 'bedrock' | 'openai' | 'anthropic' | 'azure-openai' | 'google-vertex';

export interface AIModel {
  modelId: string;
  provider: AIProvider;
  name: string;
  inputCostPer1kTokens: number;
  outputCostPer1kTokens: number;
  maxContextTokens: number;
  capabilities: string[];
}

export interface NormalizedAIRequest {
  requestId: string;
  tenantId: string;
  userId: string;
  appId: string;
  provider: AIProvider;
  modelId: string;
  messages: ChatMessage[];
  systemPrompt?: string;
  maxTokens?: number;
  temperature?: number;
  metadata: Record<string, string>;
  timestamp: string;
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface NormalizedAIResponse {
  requestId: string;
  provider: AIProvider;
  modelId: string;
  content: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  finishReason: string;
  timestamp: string;
}
