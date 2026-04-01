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
  maxTokensPerRequest: number;
  inputCostPer1kTokens: number;
  outputCostPer1kTokens: number;
  maxContextTokens: number;

  // Governance
  allowedForRoles: string[];       // Which user roles can use this model
  allowedForApps: string[];        // Which app IDs can use this model (empty = all)
  requiresApproval: boolean;       // High-risk models need explicit approval per request
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
