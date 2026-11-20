/**
 * Model-agnostic AI provider interfaces for CVIT Learning Platform.
 *
 * Supports interchangeable integration of cloud foundation models (Gemini, OpenAI)
 * and locally hosted LLMs (Ollama, vLLM, HuggingFace TGI).
 */

export type AIProviderType = 'gemini' | 'local_llm' | 'ollama' | 'openai_compatible' | 'stub';

export interface AIModelConfig {
  provider: AIProviderType;
  model: string;
  endpoint?: string;
  apiKey?: string;
  region?: string;
  timeoutMs?: number;
  maxRetries?: number;
  temperature?: number;
  topP?: number;
  isPaidTier?: boolean;
}

export interface GenerateTextParams {
  systemInstruction?: string;
  promptText: string;
  model?: string;
  temperature?: number;
  responseMimeType?: 'text/plain' | 'application/json';
  responseSchema?: unknown;
  isRealStudentData?: boolean;
  timeoutMs?: number;
}

export interface GenerateMultimodalParams extends GenerateTextParams {
  imageBase64: string;
  mimeType: string;
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedCostUsd?: number;
}

export interface AIResponse {
  text: string;
  json?: unknown;
  usage?: TokenUsage;
  modelUsed: string;
  provider: AIProviderType;
  latencyMs: number;
  draftStatus: 'DRAFT_EVALUATED' | 'DRAFT_GENERATED' | 'FINAL';
}

export interface AIProvider {
  readonly providerType: AIProviderType;
  isConfigured(): boolean;
  generateText(params: GenerateTextParams): Promise<AIResponse>;
  generateMultimodal(params: GenerateMultimodalParams): Promise<AIResponse>;
}
