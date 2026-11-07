export type ModelProvider = 'bedrock' | 'openai' | 'anthropic' | 'azure-openai' | 'google-vertex' | 'custom';
export type ModelStatus = 'active' | 'inactive' | 'testing';

export interface ModelConfig {
  modelConfigId: string;
  tenantId: string;
  name: string;                    // Display name e.g. "Our GPT-4 Instance"
  provider: ModelProvider;
  modelId: string;                 // Provider-specific model ID
  status: ModelStatus;
  isDefault: boolean;

  // Connection
  endpoint?: string;               // Custom endpoint URL (for Azure, custom)
  region?: string;                 // AWS region for Bedrock
  apiKeySecretArn?: string;        // ARN of secret in Secrets Manager (never stored in plain text)
  apiKeyHint?: string;             // Last 4 chars of key for display only e.g. "...k3f9"
  deploymentName?: string;         // Azure OpenAI deployment name

  // Limits & cost
  /** The longest answer an app may ask for, in tokens; larger requests are capped to it. */
  maxTokensPerRequest: number;
  inputCostPer1kTokens: number;
  outputCostPer1kTokens: number;

  // Governance
  /** API keys that may use this model; empty means every key of the company. */
  allowedKeyIds?: string[];
  tags: string[];

  createdAt: string;
  updatedAt: string;
  createdBy: string;
  lastTestedAt?: string;
  lastTestStatus?: 'pass' | 'fail';
}

export interface ModelTestResult {
  modelConfigId: string;
  success: boolean;
  latencyMs: number;
  error?: string;
  testedAt: string;
}
