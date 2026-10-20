import { GoogleGenAI } from '@google/genai';
import { HttpError } from '../../lib/errors';
import {
  GeminiAIConfig,
  GeminiEmbeddingConfig,
  GenerateContentParams,
  GenerateMultimodalContentParams,
  GeminiAICaller,
} from './types';

export class GeminiAIService {
  private static instance: GeminiAIService | null = null;
  public static readonly SECRET_NAME = 'GEMINI_API_KEY';

  private customCaller: GeminiAICaller | null = null;
  private client: GoogleGenAI | null = null;
  private lastApiKey: string | null = null;
  private isInjectedClient: boolean = false;
  private explicitPaidTier: boolean | null = null;

  public static getInstance(): GeminiAIService {
    if (!GeminiAIService.instance) {
      GeminiAIService.instance = new GeminiAIService();
    }
    return GeminiAIService.instance;
  }

  /**
   * Resets the singleton instance (useful for clean testing isolation).
   */
  public static resetInstance(): void {
    GeminiAIService.instance = null;
  }

  /**
   * Returns the secret configuration key name.
   */
  public getSecretName(): string {
    return GeminiAIService.SECRET_NAME;
  }

  /**
   * Reads the Gemini API key from environment configuration (GEMINI_API_KEY).
   * Note: The key value is never exposed in logs or publicly printed.
   */
  public getApiKey(): string | null {
    const key = process.env.GEMINI_API_KEY?.trim();
    return key && key.length > 0 ? key : null;
  }

  /**
   * Returns the configured generation model name verbatim.
   * Throws HttpError 503 if GEMINI_MODEL is missing or blank.
   */
  public getModelName(): string {
    const model = process.env.GEMINI_MODEL?.trim();
    if (!model) {
      throw new HttpError(
        'Gemini AI generation model is not configured. Please set GEMINI_MODEL in the environment.',
        503
      );
    }
    return model;
  }

  /**
   * Returns the configured embedding model name verbatim.
   * Throws HttpError 503 if GEMINI_EMBEDDING_MODEL is missing or blank.
   */
  public getEmbeddingModelName(): string {
    const embeddingModel = process.env.GEMINI_EMBEDDING_MODEL?.trim();
    if (!embeddingModel) {
      throw new HttpError(
        'Gemini AI embedding model is not configured. Please set GEMINI_EMBEDDING_MODEL in the environment.',
        503
      );
    }
    return embeddingModel;
  }

  /**
   * Checks whether the service is currently operating on a paid tier.
   * By default, the service starts in free tier (for test images).
   * A paid key/tier must be active before processing any real student data.
   */
  public isPaidTier(): boolean {
    if (this.explicitPaidTier !== null) {
      return this.explicitPaidTier;
    }
    const tierEnv = process.env.GEMINI_PAID_TIER?.trim().toLowerCase();
    return tierEnv === 'paid' || tierEnv === 'true';
  }

  /**
   * Allows setting the tier explicitly (e.g. for testing).
   */
  public setPaidTier(paid: boolean | null): void {
    this.explicitPaidTier = paid;
  }

  /**
   * Validates whether the current tier permits the payload.
   * Real student data requires a paid Gemini API key.
   * Free tier is allowed ONLY for test images.
   */
  public validateTierForPayload(params?: { isRealStudentData?: boolean }): void {
    if (params?.isRealStudentData && !this.isPaidTier()) {
      throw new HttpError(
        'A paid Gemini API key must be used before any real student data is processed. Initially, only the free tier with test images is permitted.',
        403
      );
    }
  }

  /**
   * Returns whether credentials or a custom caller are configured.
   */
  public isConfigured(): boolean {
    if (this.customCaller !== null) return true;
    return this.getApiKey() !== null;
  }

  /**
   * Returns the region configuration (defaults to 'global').
   */
  public getRegion(): string {
    return process.env.GEMINI_REGION?.trim() || 'global';
  }

  /**
   * Returns safe service configuration metadata without exposing secret values.
   */
  public getConfig(): GeminiAIConfig {
    return {
      model: this.getModelName(),
      secretName: this.getSecretName(),
      isConfigured: this.isConfigured(),
      isPaidTier: this.isPaidTier(),
      region: this.getRegion(),
    };
  }

  /**
   * Returns safe embedding configuration metadata without exposing secret values.
   */
  public getEmbeddingConfig(): GeminiEmbeddingConfig {
    return {
      embeddingModel: this.getEmbeddingModelName(),
      secretName: this.getSecretName(),
      isConfigured: this.isConfigured(),
    };
  }

  /**
   * Dependency injection hook for tests.
   */
  public setCustomCaller(caller: GeminiAICaller | null): void {
    this.customCaller = caller;
  }

  /**
   * Direct client injection hook for tests.
   * If options.isInjected is true (the default for tests), the client is treated as an intentional
   * dependency injection and preserved across calls.
   * If options.isInjected is false, the client is treated as an externally provided cached client
   * whose credential association is tracked via options.lastApiKey (or unknown if null).
   */
  public setClient(
    client: GoogleGenAI | null,
    options?: { isInjected?: boolean; lastApiKey?: string | null } | boolean
  ): void {
    this.client = client;
    if (client === null) {
      this.isInjectedClient = false;
      this.lastApiKey = null;
      return;
    }

    if (typeof options === 'boolean') {
      this.isInjectedClient = options;
      this.lastApiKey = options ? this.getApiKey() : null;
    } else {
      this.isInjectedClient = options?.isInjected ?? true;
      this.lastApiKey = options?.lastApiKey !== undefined
        ? options.lastApiKey
        : (this.isInjectedClient ? this.getApiKey() : null);
    }
  }

  public hasCustomCaller(): boolean {
    return this.customCaller !== null;
  }

  /**
   * Gets or initializes the shared @google/genai GoogleGenAI client instance.
   * Recreates the client whenever its credential association is unknown (null)
   * or differs from the current GEMINI_API_KEY, while preserving intentional dependency
   * injection in tests.
   */
  public getClient(): GoogleGenAI {
    const apiKey = this.getApiKey();
    if (!apiKey) {
      throw new HttpError(
        `Gemini AI credentials are not configured. Please configure the environment variable '${this.getSecretName()}'.`,
        503
      );
    }

    // Preserve intentional dependency injection in tests
    if (this.client && this.isInjectedClient) {
      return this.client;
    }

    // Recreate the client if missing, if its credential association is unknown (null),
    // or if the key has rotated (lastApiKey !== apiKey).
    if (!this.client || this.lastApiKey === null || this.lastApiKey !== apiKey) {
      this.client = new GoogleGenAI({ apiKey });
      this.lastApiKey = apiKey;
      this.isInjectedClient = false;
    }

    return this.client;
  }

  /**
   * Executes a text-only generation request against Gemini using @google/genai.
   * Model ID is read from the environment and passed verbatim.
   */
  public async generateContent(params: GenerateContentParams): Promise<string> {
    const model = this.getModelName();
    const {
      systemInstruction = '',
      promptText,
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
        `Gemini AI credentials are not configured. Please configure the environment variable '${this.getSecretName()}'.`,
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

  /**
   * Executes a multimodal generation request (Text + Handwritten image) using @google/genai.
   * Model ID is read from the environment and passed verbatim.
   */
  public async generateMultimodalContent(
    params: GenerateMultimodalContentParams
  ): Promise<string> {
    const model = this.getModelName();
    const {
      systemInstruction = '',
      promptText,
      imageBase64,
      mimeType,
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
        `Gemini AI credentials are not configured. Please configure the environment variable '${this.getSecretName()}'.`,
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

  /**
   * Executes an operation with automatic retry on transient errors (429 / 503).
   * Does NOT fallback or switch models on failure.
   */
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

        console.error(`[GeminiAIService] Request failed for model ${model}:`, errMsg);
        throw new HttpError(
          'Gemini AI service request failed. Please try again later.',
          502
        );
      }
    }

    throw lastError instanceof HttpError
      ? lastError
      : new HttpError('Gemini AI service request failed after retries. Please try again later.', 502);
  }
}

export const geminiAIService = GeminiAIService.getInstance();
export const sharedAIService = geminiAIService;
