export type QuestionDifficulty = 'EASY' | 'MEDIUM' | 'HARD';

export interface GeminiAIConfig {
  model: string;
  secretName: string;
  isConfigured: boolean;
  isPaidTier: boolean;
  region: string;
}

export interface GeminiEmbeddingConfig {
  embeddingModel: string;
  secretName: string;
  isConfigured: boolean;
}

export interface GenerateContentParams {
  systemInstruction?: string;
  promptText: string;
  temperature?: number;
  responseMimeType?: string;
  isRealStudentData?: boolean;
}

export interface GenerateMultimodalContentParams extends GenerateContentParams {
  imageBase64: string;
  mimeType: string;
}

export type GeminiAICaller = (payload: {
  model: string;
  region?: string;
  systemInstruction?: string;
  promptText: string;
  imageBase64?: string;
  mimeType?: string;
}) => Promise<string>;
