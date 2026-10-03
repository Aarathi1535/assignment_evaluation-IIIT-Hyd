import type { Schema } from '@google/genai';

export interface GeminiAIConfig {
  model: string;
  secretName: string;
  isConfigured: boolean;
  isPaidTier: boolean;
  region: string;
}

export interface VertexAIConfig {
  model: string;
  region: string;
  projectId: string;
  secretName?: string;
  isConfigured?: boolean;
  isPaidTier?: boolean;
}

export interface ServiceAccountCredentials {
  client_email: string;
  private_key: string;
  project_id?: string;
}

export interface GenerateContentParams {
  systemInstruction?: string;
  promptText: string;
  model?: string;
  temperature?: number;
  responseMimeType?: string;
  responseSchema?: Schema;
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

export type VertexAICaller = GeminiAICaller;
