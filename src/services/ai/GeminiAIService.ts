import { HttpError } from '../../lib/errors';
import {
  GeminiAIConfig,
  GenerateContentParams,
  GenerateMultimodalContentParams,
  GeminiAICaller,
} from './types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type GoogleGenAIClient = any;

export class GeminiAIService {
  private static instance: GeminiAIService | null = null;
  public static readonly SECRET_NAME = 'assignment-eval-gemini-api-key';

  private customCaller: GeminiAICaller | null = null;
  private client: GoogleGenAIClient | null = null;
  private lastApiKey: string | null = null;
  private explicitPaidTier: boolean | null = null;

  public static getInstance(): GeminiAIService {
    if (!GeminiAIService.instance) {
      GeminiAIService.instance = new GeminiAIService();
    }
    return GeminiAIService.instance;
  }

  public static resetInstance(): void {
    GeminiAIService.instance = null;
  }

  public getSecretName(): string {
    return GeminiAIService.SECRET_NAME;
  }

  public getApiKey(): string | null {
    const key =
      process.env[GeminiAIService.SECRET_NAME]?.trim() ||
      process.env.ASSIGNMENT_EVAL_GEMINI_API_KEY?.trim() ||
      process.env.GEMINI_API_KEY?.trim() ||
      process.env.GOOGLE_API_KEY?.trim() ||
      process.env.GOOGLE_GENAI_API_KEY?.trim() ||
      null;

    return key && key.length > 0 ? key : null;
  }

  public isPaidTier(): boolean {
    if (this.explicitPaidTier !== null) {
      return this.explicitPaidTier;
    }
    const tierEnv =
      process.env.GEMINI_TIER?.trim().toLowerCase() ||
      process.env.ASSIGNMENT_EVAL_GEMINI_TIER?.trim().toLowerCase() ||
      process.env.GEMINI_PAID_TIER?.trim().toLowerCase();

    return tierEnv === 'paid' || tierEnv === 'true';
  }

  public setPaidTier(paid: boolean | null): void {
    this.explicitPaidTier = paid;
  }

  public validateTierForPayload(params?: { isRealStudentData?: boolean }): void {
    if (params?.isRealStudentData && !this.isPaidTier()) {
      throw new HttpError(
        'A paid Gemini API key must be used before any real student data is processed. Initially, only the free tier with test images is permitted.',
        403
      );
    }
  }

  public isConfigured(): boolean {
    if (this.customCaller !== null) return true;
    return this.getApiKey() !== null;
  }

  public getModelName(): string {
    return process.env.GEMINI_MODEL?.trim() || 'gemini-1.5-flash';
  }

  public getRegion(): string {
    return (
      process.env.GEMINI_REGION?.trim() ||
      process.env.GOOGLE_CLOUD_REGION?.trim() ||
      'global'
    );
  }

  public getProjectId(): string {
    return (
      process.env.GOOGLE_CLOUD_PROJECT?.trim() ||
      process.env.GCP_PROJECT?.trim() ||
      'assignment-evaluator-iiith'
    );
  }

  public getConfig(): GeminiAIConfig {
    return {
      model: this.getModelName(),
      secretName: this.getSecretName(),
      isConfigured: this.isConfigured(),
      isPaidTier: this.isPaidTier(),
      region: this.getRegion(),
    };
  }

  public setCustomCaller(caller: GeminiAICaller | null): void {
    this.customCaller = caller;
  }

  public setClient(client: GoogleGenAIClient | null): void {
    this.client = client;
  }

  public hasCustomCaller(): boolean {
    return this.customCaller !== null;
  }

  public getClient(): GoogleGenAIClient {
    if (this.client) {
      return this.client;
    }

    const apiKey = this.getApiKey();
    if (!apiKey) {
      throw new HttpError(
        `Gemini AI credentials are not configured. Please configure the secret '${this.getSecretName()}'.`,
        503
      );
    }

    if (!this.client || this.lastApiKey !== apiKey) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { GoogleGenAI } = require('@google/genai');
        this.client = new GoogleGenAI({ apiKey });
      } catch {
        throw new HttpError('@google/genai client is not available in environment', 503);
      }
      this.lastApiKey = apiKey;
    }

    return this.client;
  }

  public async generateContent(params: GenerateContentParams): Promise<string> {
    const {
      systemInstruction = '',
      promptText,
      model = this.getModelName(),
      temperature = 0.2,
      responseMimeType = 'application/json',
      isRealStudentData = false,
    } = params;

    this.validateTierForPayload({ isRealStudentData });

    if (this.customCaller) {
      return this.customCaller({
        model,
        region: this.getRegion(),
        systemInstruction,
        promptText,
      });
    }

    if (!this.isConfigured()) {
      throw new HttpError(
        `Gemini AI credentials are not configured. Please configure the secret '${this.getSecretName()}'.`,
        503
      );
    }

    const client = this.getClient();
    return this.executeWithRetry(async () => {
      const response = await client.models.generateContent({
        model,
        contents: promptText,
        config: {
          systemInstruction: systemInstruction.trim() || undefined,
          temperature,
          responseMimeType: responseMimeType || undefined,
        },
      });

      const rawText = response.text;
      if (!rawText || rawText.trim().length === 0) {
        throw new HttpError('Gemini AI returned an empty response candidate', 502);
      }
      return rawText;
    }, model);
  }

  public async generateMultimodalContent(
    params: GenerateMultimodalContentParams
  ): Promise<string> {
    const {
      systemInstruction = '',
      promptText,
      imageBase64,
      mimeType,
      model = this.getModelName(),
      temperature = 0.1,
      responseMimeType = 'application/json',
      isRealStudentData = false,
    } = params;

    this.validateTierForPayload({ isRealStudentData });

    if (this.customCaller) {
      return this.customCaller({
        model,
        region: this.getRegion(),
        systemInstruction,
        promptText,
        imageBase64,
        mimeType,
      });
    }

    if (!this.isConfigured()) {
      throw new HttpError(
        `Gemini AI credentials are not configured. Please configure the secret '${this.getSecretName()}'.`,
        503
      );
    }

    const client = this.getClient();
    return this.executeWithRetry(async () => {
      const response = await client.models.generateContent({
        model,
        contents: [
          { text: promptText },
          {
            inlineData: {
              mimeType,
              data: imageBase64,
            },
          },
        ],
        config: {
          systemInstruction: systemInstruction.trim() || undefined,
          temperature,
          responseMimeType: responseMimeType || undefined,
        },
      });

      const rawText = response.text;
      if (!rawText || rawText.trim().length === 0) {
        throw new HttpError('Gemini AI returned an empty response candidate', 502);
      }
      return rawText;
    }, model);
  }

  private async executeWithRetry(
    operation: () => Promise<string>,
    model: string
  ): Promise<string> {
    const maxRetries = 2;
    let lastError: unknown = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await operation();
      } catch (err: unknown) {
        lastError = err;
        if (
          err instanceof HttpError &&
          (err.statusCode === 400 || err.statusCode === 403 || err.statusCode === 503)
        ) {
          throw err;
        }

        const errMsg = err instanceof Error ? err.message : String(err);
        const isTransient =
          errMsg.includes('429') ||
          errMsg.includes('503') ||
          errMsg.includes('RESOURCE_EXHAUSTED') ||
          errMsg.includes('UNAVAILABLE');

        if (isTransient && attempt < maxRetries) {
          await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
          continue;
        }

        throw new HttpError(
          `Gemini AI model ${model} request failed: ${errMsg}`,
          502
        );
      }
    }

    throw lastError instanceof HttpError
      ? lastError
      : new HttpError(`Gemini AI model ${model} request failed after retries`, 502);
  }
}

export const geminiAIService = GeminiAIService.getInstance();
export const sharedAIService = geminiAIService;
