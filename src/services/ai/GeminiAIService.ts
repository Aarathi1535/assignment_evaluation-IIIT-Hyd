import { GoogleGenAI } from '@google/genai';
import { HttpError } from '../../lib/errors';
import {
  GeminiAIConfig,
  VertexAIConfig,
  GenerateContentParams,
  GenerateMultimodalContentParams,
  GeminiAICaller,
} from './types';

export class GeminiAIService {
  private static instance: GeminiAIService | null = null;
  public static readonly SECRET_NAME = 'assignment-eval-gemini-api-key';

  private customCaller: GeminiAICaller | null = null;
  private client: GoogleGenAI | null = null;
  private lastApiKey: string | null = null;
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
   * Reads the Gemini API key from environment / secrets configuration.
   * Priority:
   * 1. process.env['assignment-eval-gemini-api-key']
   * 2. process.env.ASSIGNMENT_EVAL_GEMINI_API_KEY
   * 3. process.env.GEMINI_API_KEY
   *
   * Note: The key value is never exposed in logs or publicly printed.
   */
  public getApiKey(): string | null {
    const key =
      process.env[GeminiAIService.SECRET_NAME]?.trim() ||
      process.env.ASSIGNMENT_EVAL_GEMINI_API_KEY?.trim() ||
      process.env.GEMINI_API_KEY?.trim();

    return key && key.length > 0 ? key : null;
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
    const tierEnv =
      process.env.GEMINI_TIER?.trim().toLowerCase() ||
      process.env.ASSIGNMENT_EVAL_GEMINI_TIER?.trim().toLowerCase() ||
      process.env.GEMINI_PAID_TIER?.trim().toLowerCase();

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
   * Returns the model name. Defaults to 'gemini-3.5-flash'.
   */
  public getModelName(): string {
    return (
      process.env.GEMINI_MODEL?.trim() ||
      process.env.AI_MODEL?.trim() ||
      process.env.VERTEX_AI_MODEL?.trim() ||
      'gemini-3.5-flash'
    );
  }

  /**
   * Returns the region configuration (defaults to 'global' / 'asia-south1' for backward compatibility).
   */
  public getRegion(): string {
    return (
      process.env.GEMINI_REGION?.trim() ||
      process.env.VERTEX_AI_REGION?.trim() ||
      process.env.GOOGLE_CLOUD_REGION?.trim() ||
      'global'
    );
  }

  /**
   * Returns the project ID for backward compatibility with Vertex AI consumers.
   */
  public getProjectId(): string {
    return (
      process.env.GOOGLE_CLOUD_PROJECT?.trim() ||
      process.env.GCP_PROJECT?.trim() ||
      'assignment-evaluator-iiith'
    );
  }

  /**
   * Returns safe service configuration metadata without exposing secret values.
   */
  public getConfig(): GeminiAIConfig & VertexAIConfig {
    return {
      model: this.getModelName(),
      secretName: this.getSecretName(),
      isConfigured: this.isConfigured(),
      isPaidTier: this.isPaidTier(),
      region: this.getRegion(),
      projectId: this.getProjectId(),
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
   */
  public setClient(client: GoogleGenAI | null): void {
    this.client = client;
  }

  public hasCustomCaller(): boolean {
    return this.customCaller !== null;
  }

  /**
   * Gets or initializes the shared @google/genai GoogleGenAI client instance.
   */
  public getClient(): GoogleGenAI {
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
      this.client = new GoogleGenAI({ apiKey });
      this.lastApiKey = apiKey;
    }

    return this.client;
  }

  /**
   * Executes a text-only generation request against Gemini using @google/genai.
   */
  public async generateContent(params: GenerateContentParams): Promise<string> {
    const {
      systemInstruction = '',
      promptText,
      model = this.getModelName(),
      temperature = 0.2,
      responseMimeType = 'application/json',
      responseSchema,
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
          ...(responseSchema ? { responseSchema } : {}),
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
   */
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

  /**
   * Executes an operation with automatic retry on transient errors (429 / 503).
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
export const VertexAIService = GeminiAIService;
export const vertexAIService = geminiAIService;
