import fs from 'fs';
import crypto from 'crypto';
import { HttpError } from '../../lib/errors';
import {
  VertexAIConfig,
  ServiceAccountCredentials,
  GenerateContentParams,
  GenerateMultimodalContentParams,
  VertexAICaller,
} from './types';

function base64UrlEncode(input: string | Buffer): string {
  const buf = typeof input === 'string' ? Buffer.from(input, 'utf8') : input;
  return buf
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

export class VertexAIService {
  private static instance: VertexAIService | null = null;
  private customCaller: VertexAICaller | null = null;

  // Cached OAuth2 token and expiry timestamp (in ms)
  private cachedToken: string | null = null;
  private tokenExpiryTime: number = 0;

  /**
   * Singleton accessor for the shared Vertex AI service instance.
   */
  public static getInstance(): VertexAIService {
    if (!VertexAIService.instance) {
      VertexAIService.instance = new VertexAIService();
    }
    return VertexAIService.instance;
  }

  /**
   * Dependency injection hook for testing without live Vertex AI network requests.
   */
  public setCustomCaller(caller: VertexAICaller | null): void {
    this.customCaller = caller;
  }

  /**
   * Returns whether a custom caller has been injected.
   */
  public hasCustomCaller(): boolean {
    return this.customCaller !== null;
  }

  /**
   * Returns the current model configuration.
   * Defaults to 'gemini-3.5-flash'.
   */
  public getModelName(): string {
    return (
      process.env.VERTEX_AI_MODEL?.trim() ||
      process.env.AI_MODEL?.trim() ||
      'gemini-3.5-flash'
    );
  }

  /**
   * Returns the current Google Cloud region.
   * Defaults to 'asia-south1'.
   */
  public getRegion(): string {
    return (
      process.env.VERTEX_AI_REGION?.trim() ||
      process.env.GOOGLE_CLOUD_REGION?.trim() ||
      'asia-south1'
    );
  }

  /**
   * Returns the Google Cloud project ID.
   */
  public getProjectId(): string {
    return (
      process.env.GOOGLE_CLOUD_PROJECT?.trim() ||
      process.env.GCP_PROJECT?.trim() ||
      process.env.GCLOUD_PROJECT?.trim() ||
      'assignment-evaluator-iiith'
    );
  }

  /**
   * Returns the combined configuration object for Vertex AI.
   */
  public getConfig(): VertexAIConfig {
    return {
      model: this.getModelName(),
      region: this.getRegion(),
      projectId: this.getProjectId(),
    };
  }

  /**
   * Checks whether Vertex AI credentials (service account or access token)
   * or a custom caller are available.
   */
  public isConfigured(): boolean {
    if (this.customCaller) return true;
    if (process.env.GOOGLE_ACCESS_TOKEN || process.env.VERTEX_AI_ACCESS_TOKEN) return true;
    if (process.env.GOOGLE_SERVICE_ACCOUNT_KEY || process.env.GCP_SERVICE_ACCOUNT_KEY) return true;
    if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      try {
        return fs.existsSync(process.env.GOOGLE_APPLICATION_CREDENTIALS);
      } catch {
        return false;
      }
    }
    return false;
  }

  /**
   * Loads service account credentials from environment variables or file.
   */
  private loadServiceAccountCredentials(): ServiceAccountCredentials | null {
    // 1. Raw JSON string in environment variable
    const rawKey =
      process.env.GOOGLE_SERVICE_ACCOUNT_KEY || process.env.GCP_SERVICE_ACCOUNT_KEY;
    if (rawKey && rawKey.trim()) {
      try {
        const parsed = JSON.parse(rawKey.trim());
        if (parsed.client_email && parsed.private_key) {
          return {
            client_email: parsed.client_email,
            private_key: parsed.private_key,
            project_id: parsed.project_id,
          };
        }
      } catch (err) {
        console.error('Failed to parse GOOGLE_SERVICE_ACCOUNT_KEY JSON:', err);
      }
    }

    // 2. File path in GOOGLE_APPLICATION_CREDENTIALS
    const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    if (credPath && credPath.trim()) {
      try {
        if (fs.existsSync(credPath.trim())) {
          const content = fs.readFileSync(credPath.trim(), 'utf8');
          const parsed = JSON.parse(content);
          if (parsed.client_email && parsed.private_key) {
            return {
              client_email: parsed.client_email,
              private_key: parsed.private_key,
              project_id: parsed.project_id,
            };
          }
        }
      } catch (err) {
        console.error('Failed to read GOOGLE_APPLICATION_CREDENTIALS file:', err);
      }
    }

    return null;
  }

  /**
   * Retrieves an OAuth2 Bearer access token for Vertex AI calls using
   * the configured service account credentials, direct token, or metadata server.
   */
  public async getAccessToken(): Promise<string> {
    // 1. Check in-memory cached token
    if (this.cachedToken && Date.now() < this.tokenExpiryTime) {
      return this.cachedToken;
    }

    // 2. Direct token supplied in environment (e.g., CI/CD or local test tokens)
    const directToken =
      process.env.GOOGLE_ACCESS_TOKEN?.trim() ||
      process.env.VERTEX_AI_ACCESS_TOKEN?.trim();
    if (directToken) {
      this.cachedToken = directToken;
      this.tokenExpiryTime = Date.now() + 3000 * 1000;
      return directToken;
    }

    // 3. Service account JSON credentials (file or environment)
    const credentials = this.loadServiceAccountCredentials();
    if (credentials) {
      try {
        const now = Math.floor(Date.now() / 1000);
        const header = { alg: 'RS256', typ: 'JWT' };
        const payload = {
          iss: credentials.client_email,
          sub: credentials.client_email,
          aud: 'https://oauth2.googleapis.com/token',
          iat: now,
          exp: now + 3600,
          scope: 'https://www.googleapis.com/auth/cloud-platform',
        };

        const encodedHeader = base64UrlEncode(JSON.stringify(header));
        const encodedPayload = base64UrlEncode(JSON.stringify(payload));
        const unsignedJwt = `${encodedHeader}.${encodedPayload}`;

        const signer = crypto.createSign('RSA-SHA256');
        signer.update(unsignedJwt);
        signer.end();
        const signature = signer.sign(credentials.private_key);
        const signedJwt = `${unsignedJwt}.${base64UrlEncode(signature)}`;

        const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
            assertion: signedJwt,
          }).toString(),
        });

        if (!tokenResponse.ok) {
          const errText = await tokenResponse.text();
          throw new HttpError(
            `Failed to authenticate with Google OAuth2: ${tokenResponse.status} ${errText}`,
            502
          );
        }

        const tokenData = (await tokenResponse.json()) as {
          access_token: string;
          expires_in: number;
        };

        this.cachedToken = tokenData.access_token;
        // Cache with 5 minute buffer before expiry
        this.tokenExpiryTime = Date.now() + Math.max(60, tokenData.expires_in - 300) * 1000;
        return this.cachedToken;
      } catch (err: unknown) {
        if (err instanceof HttpError) throw err;
        const msg = err instanceof Error ? err.message : String(err);
        throw new HttpError(`Google service account authentication failed: ${msg}`, 502);
      }
    }

    // 4. Fallback to Google Cloud Metadata Server (Cloud Run / GCE)
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 1200);
      const metaRes = await fetch(
        'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token',
        {
          headers: { 'Metadata-Flavor': 'Google' },
          signal: controller.signal,
        }
      );
      clearTimeout(timeoutId);

      if (metaRes.ok) {
        const metaData = (await metaRes.json()) as {
          access_token: string;
          expires_in: number;
        };
        this.cachedToken = metaData.access_token;
        this.tokenExpiryTime = Date.now() + Math.max(60, metaData.expires_in - 300) * 1000;
        return this.cachedToken;
      }
    } catch {
      // Metadata server not reachable in local/test environment
    }

    throw new HttpError(
      'Vertex AI credentials are not configured. Please configure Google Cloud service account credentials via GOOGLE_APPLICATION_CREDENTIALS or GOOGLE_SERVICE_ACCOUNT_KEY.',
      503
    );
  }

  /**
   * Constructs the full Vertex AI REST endpoint URL.
   */
  public buildEndpointUrl(model: string, region: string, projectId: string): string {
    const resolvedRegion = region.trim();
    const resolvedModel = model.trim();
    const resolvedProject = projectId.trim();

    return `https://${resolvedRegion}-aiplatform.googleapis.com/v1/projects/${resolvedProject}/locations/${resolvedRegion}/publishers/google/models/${encodeURIComponent(
      resolvedModel
    )}:generateContent`;
  }

  /**
   * Executes a text-only generation request against Vertex AI.
   * Used by Personalized Assessment for syllabus parsing and question generation.
   */
  public async generateContent(params: GenerateContentParams): Promise<string> {
    const {
      systemInstruction = '',
      promptText,
      model = this.getModelName(),
      temperature = 0.2,
      responseMimeType = 'application/json',
    } = params;

    const region = this.getRegion();

    // 1. Dependency injection hook for unit tests
    if (this.customCaller) {
      return this.customCaller({
        model,
        region,
        systemInstruction,
        promptText,
      });
    }

    // 2. Authentication check
    const accessToken = await this.getAccessToken();
    const projectId = this.getProjectId();
    const url = this.buildEndpointUrl(model, region, projectId);

    const requestBody: Record<string, unknown> = {
      contents: [
        {
          role: 'user',
          parts: [{ text: promptText }],
        },
      ],
      generationConfig: {
        temperature,
      },
    };

    if (systemInstruction && systemInstruction.trim()) {
      requestBody.systemInstruction = {
        parts: [{ text: systemInstruction.trim() }],
      };
    }

    if (responseMimeType) {
      (requestBody.generationConfig as Record<string, unknown>).responseMimeType = responseMimeType;
    }

    return this.executeWithRetry(url, accessToken, requestBody, model);
  }

  /**
   * Executes a multimodal generation request against Vertex AI (Text + Handwritten Image).
   * Used by Classroom Assessment for answer evaluation.
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
    } = params;

    const region = this.getRegion();

    // 1. Dependency injection hook for unit tests
    if (this.customCaller) {
      return this.customCaller({
        model,
        region,
        systemInstruction,
        promptText,
        imageBase64,
        mimeType,
      });
    }

    // 2. Authentication check
    const accessToken = await this.getAccessToken();
    const projectId = this.getProjectId();
    const url = this.buildEndpointUrl(model, region, projectId);

    const requestBody: Record<string, unknown> = {
      contents: [
        {
          role: 'user',
          parts: [
            { text: promptText },
            {
              inlineData: {
                mimeType,
                data: imageBase64,
              },
            },
          ],
        },
      ],
      generationConfig: {
        temperature,
      },
    };

    if (systemInstruction && systemInstruction.trim()) {
      requestBody.systemInstruction = {
        parts: [{ text: systemInstruction.trim() }],
      };
    }

    if (responseMimeType) {
      (requestBody.generationConfig as Record<string, unknown>).responseMimeType = responseMimeType;
    }

    return this.executeWithRetry(url, accessToken, requestBody, model);
  }

  /**
   * Executes the HTTP POST request to Vertex AI with automatic transient retry (503 / 429).
   */
  private async executeWithRetry(
    url: string,
    accessToken: string,
    body: Record<string, unknown>,
    model: string
  ): Promise<string> {
    const maxRetries = 2;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      let response: Response;
      try {
        response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify(body),
        });
      } catch (networkErr: unknown) {
        const msg = networkErr instanceof Error ? networkErr.message : String(networkErr);
        lastError = new HttpError(`Network request to Vertex AI failed: ${msg}`, 502);
        if (attempt < maxRetries) {
          await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
          continue;
        }
        break;
      }

      if (!response.ok) {
        let errDetails = '';
        try {
          const errJson = await response.json();
          errDetails = JSON.stringify(errJson);
        } catch {
          errDetails = await response.text();
        }

        // Transient high demand or rate limits: retry with exponential backoff
        if ((response.status === 503 || response.status === 429) && attempt < maxRetries) {
          await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
          continue;
        }

        throw new HttpError(
          `Vertex AI model ${model} returned HTTP ${response.status}: ${errDetails}`,
          502
        );
      }

      const json = (await response.json()) as {
        candidates?: Array<{
          content?: {
            parts?: Array<{ text?: string }>;
          };
          finishReason?: string;
        }>;
      };

      const candidate = json.candidates?.[0];
      const rawText = candidate?.content?.parts
        ?.map((p) => p.text)
        .filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
        .join('\n');

      if (!rawText || rawText.trim().length === 0) {
        throw new HttpError('Vertex AI returned an empty response candidate', 502);
      }

      return rawText;
    }

    throw lastError || new HttpError('Vertex AI request failed after retries', 502);
  }
}

export const vertexAIService = VertexAIService.getInstance();
export const sharedAIService = vertexAIService;
