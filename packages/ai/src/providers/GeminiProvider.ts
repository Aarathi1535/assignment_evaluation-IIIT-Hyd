import { GoogleGenAI } from '@google/genai';
import {
  AIProvider,
  AIProviderType,
  GenerateTextParams,
  GenerateMultimodalParams,
  AIResponse,
} from '../interfaces';
import { validateDataPrivacy, withExponentialBackoff } from '../governance';

export interface GeminiConfig {
  apiKey?: string;
  model?: string;
  region?: string;
  isPaidTier?: boolean;
}

export class GeminiProvider implements AIProvider {
  public readonly providerType: AIProviderType = 'gemini';
  private client: GoogleGenAI | null = null;
  private readonly defaultModel: string;
  private readonly isPaidTier: boolean;
  private readonly apiKey: string | null;

  constructor(config: GeminiConfig = {}) {
    this.apiKey =
      config.apiKey ||
      process.env['assignment-eval-gemini-api-key']?.trim() ||
      process.env.ASSIGNMENT_EVAL_GEMINI_API_KEY?.trim() ||
      process.env.GEMINI_API_KEY?.trim() ||
      null;

    this.defaultModel = config.model || process.env.GEMINI_MODEL || 'gemini-2.5-flash';
    this.isPaidTier =
      config.isPaidTier ??
      (process.env.GEMINI_TIER?.trim().toLowerCase() === 'paid' ||
        process.env.ASSIGNMENT_EVAL_GEMINI_TIER?.trim().toLowerCase() === 'paid');

    if (this.apiKey) {
      this.client = new GoogleGenAI({ apiKey: this.apiKey });
    }
  }

  public isConfigured(): boolean {
    return Boolean(this.apiKey && this.client);
  }

  public async generateText(params: GenerateTextParams): Promise<AIResponse> {
    validateDataPrivacy({
      isRealStudentData: params.isRealStudentData,
      providerType: this.providerType,
      isPaidTier: this.isPaidTier,
    });

    if (!this.client) {
      throw new Error('Gemini API client is not configured. Missing API key.');
    }

    const start = Date.now();
    const modelToUse = params.model || this.defaultModel;

    return await withExponentialBackoff(async () => {
      const config: {
        systemInstruction?: string;
        temperature?: number;
        responseMimeType?: string;
        responseSchema?: unknown;
      } = {};

      if (params.systemInstruction) config.systemInstruction = params.systemInstruction;
      if (params.temperature !== undefined) config.temperature = params.temperature;
      if (params.responseMimeType) config.responseMimeType = params.responseMimeType;
      if (params.responseSchema) config.responseSchema = params.responseSchema;

      const response = await this.client!.models.generateContent({
        model: modelToUse,
        contents: [params.promptText],
        config: Object.keys(config).length > 0 ? config : undefined,
      });

      const text = response.text || '';
      let json: unknown = undefined;
      if (params.responseMimeType === 'application/json') {
        try {
          json = JSON.parse(text);
        } catch {
          json = undefined;
        }
      }

      const promptTokens = response.usageMetadata?.promptTokenCount || 0;
      const candidatesTokens = response.usageMetadata?.candidatesTokenCount || 0;
      const totalTokens = response.usageMetadata?.totalTokenCount || promptTokens + candidatesTokens;

      return {
        text,
        json,
        usage: {
          promptTokens,
          completionTokens: candidatesTokens,
          totalTokens,
          estimatedCostUsd: (totalTokens / 1_000_000) * 0.15, // Approximate flash rate
        },
        modelUsed: modelToUse,
        provider: 'gemini',
        latencyMs: Date.now() - start,
        draftStatus: 'DRAFT_GENERATED',
      };
    });
  }

  public async generateMultimodal(params: GenerateMultimodalParams): Promise<AIResponse> {
    validateDataPrivacy({
      isRealStudentData: params.isRealStudentData,
      providerType: this.providerType,
      isPaidTier: this.isPaidTier,
    });

    if (!this.client) {
      throw new Error('Gemini API client is not configured. Missing API key.');
    }

    const start = Date.now();
    const modelToUse = params.model || this.defaultModel;

    return await withExponentialBackoff(async () => {
      const inlineData = {
        inlineData: {
          mimeType: params.mimeType,
          data: params.imageBase64,
        },
      };

      const contents = [inlineData, params.promptText];

      const config: {
        systemInstruction?: string;
        temperature?: number;
        responseMimeType?: string;
        responseSchema?: unknown;
      } = {};

      if (params.systemInstruction) config.systemInstruction = params.systemInstruction;
      if (params.temperature !== undefined) config.temperature = params.temperature;
      if (params.responseMimeType) config.responseMimeType = params.responseMimeType;
      if (params.responseSchema) config.responseSchema = params.responseSchema;

      const response = await this.client!.models.generateContent({
        model: modelToUse,
        contents,
        config: Object.keys(config).length > 0 ? config : undefined,
      });

      const text = response.text || '';
      let json: unknown = undefined;
      if (params.responseMimeType === 'application/json') {
        try {
          json = JSON.parse(text);
        } catch {
          json = undefined;
        }
      }

      const promptTokens = response.usageMetadata?.promptTokenCount || 0;
      const candidatesTokens = response.usageMetadata?.candidatesTokenCount || 0;
      const totalTokens = response.usageMetadata?.totalTokenCount || promptTokens + candidatesTokens;

      return {
        text,
        json,
        usage: {
          promptTokens,
          completionTokens: candidatesTokens,
          totalTokens,
        },
        modelUsed: modelToUse,
        provider: 'gemini',
        latencyMs: Date.now() - start,
        draftStatus: 'DRAFT_EVALUATED',
      };
    });
  }
}
