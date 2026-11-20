import {
  AIProvider,
  AIProviderType,
  GenerateTextParams,
  GenerateMultimodalParams,
  AIResponse,
} from '../interfaces';
import { validateDataPrivacy, withExponentialBackoff } from '../governance';

export interface LocalLLMConfig {
  endpoint?: string; // Default: http://localhost:11434 (Ollama) or http://localhost:8000/v1
  model?: string;    // Default: 'llama3:8b' or 'mistral'
  timeoutMs?: number;
  apiKey?: string;
}

export class LocalLLMProvider implements AIProvider {
  public readonly providerType: AIProviderType = 'local_llm';
  private readonly endpoint: string;
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly apiKey?: string;

  constructor(config: LocalLLMConfig = {}) {
    this.endpoint = config.endpoint || process.env.LOCAL_LLM_ENDPOINT || 'http://localhost:11434';
    this.model = config.model || process.env.LOCAL_LLM_MODEL || 'llama3:8b';
    this.timeoutMs = config.timeoutMs || 30000;
    this.apiKey = config.apiKey || process.env.LOCAL_LLM_API_KEY;
  }

  public isConfigured(): boolean {
    return Boolean(this.endpoint);
  }

  public async generateText(params: GenerateTextParams): Promise<AIResponse> {
    validateDataPrivacy({
      isRealStudentData: params.isRealStudentData,
      providerType: this.providerType,
      endpoint: this.endpoint,
    });

    const start = Date.now();
    const modelToUse = params.model || this.model;

    return await withExponentialBackoff(async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), params.timeoutMs || this.timeoutMs);

      try {
        const isOllamaNative = this.endpoint.includes(':11434') && !this.endpoint.includes('/v1');
        let requestUrl = this.endpoint;
        let requestBody: unknown;

        if (isOllamaNative) {
          requestUrl = `${this.endpoint.replace(/\/$/, '')}/api/generate`;
          requestBody = {
            model: modelToUse,
            system: params.systemInstruction,
            prompt: params.promptText,
            stream: false,
            format: params.responseMimeType === 'application/json' ? 'json' : undefined,
            options: {
              temperature: params.temperature ?? 0.2,
            },
          };
        } else {
          // OpenAI-compatible /v1/chat/completions (vLLM, Ollama v1, LocalAI, LM Studio)
          requestUrl = `${this.endpoint.replace(/\/$/, '')}/chat/completions`;
          const messages = [];
          if (params.systemInstruction) {
            messages.push({ role: 'system', content: params.systemInstruction });
          }
          messages.push({ role: 'user', content: params.promptText });

          requestBody = {
            model: modelToUse,
            messages,
            temperature: params.temperature ?? 0.2,
            response_format: params.responseMimeType === 'application/json' ? { type: 'json_object' } : undefined,
          };
        }

        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
        };
        if (this.apiKey) {
          headers['Authorization'] = `Bearer ${this.apiKey}`;
        }

        const res = await fetch(requestUrl, {
          method: 'POST',
          headers,
          body: JSON.stringify(requestBody),
          signal: controller.signal,
        });

        if (!res.ok) {
          const errText = await res.text();
          throw new Error(`Local LLM provider error (${res.status}): ${errText}`);
        }

        const data = await res.json();
        let text = '';
        let promptTokens = 0;
        let completionTokens = 0;

        if (isOllamaNative) {
          text = data.response || '';
          promptTokens = data.prompt_eval_count || 0;
          completionTokens = data.eval_count || 0;
        } else {
          text = data.choices?.[0]?.message?.content || '';
          promptTokens = data.usage?.prompt_tokens || 0;
          completionTokens = data.usage?.completion_tokens || 0;
        }

        let json: unknown = undefined;
        if (params.responseMimeType === 'application/json') {
          try {
            json = JSON.parse(text);
          } catch {
            json = undefined;
          }
        }

        return {
          text,
          json,
          usage: {
            promptTokens,
            completionTokens,
            totalTokens: promptTokens + completionTokens,
            estimatedCostUsd: 0, // Local inference costs $0 API charges
          },
          modelUsed: modelToUse,
          provider: 'local_llm',
          latencyMs: Date.now() - start,
          draftStatus: 'DRAFT_GENERATED',
        };
      } finally {
        clearTimeout(timeout);
      }
    });
  }

  public async generateMultimodal(params: GenerateMultimodalParams): Promise<AIResponse> {
    validateDataPrivacy({
      isRealStudentData: params.isRealStudentData,
      providerType: this.providerType,
      endpoint: this.endpoint,
    });

    const start = Date.now();
    const modelToUse = params.model || this.model;

    // Use vision endpoint (Ollama /api/generate with images array or OpenAI vision format)
    const isOllamaNative = this.endpoint.includes(':11434') && !this.endpoint.includes('/v1');
    const requestUrl = isOllamaNative
      ? `${this.endpoint.replace(/\/$/, '')}/api/generate`
      : `${this.endpoint.replace(/\/$/, '')}/chat/completions`;

    let requestBody: unknown;
    if (isOllamaNative) {
      requestBody = {
        model: modelToUse,
        system: params.systemInstruction,
        prompt: params.promptText,
        stream: false,
        images: [params.imageBase64],
        format: params.responseMimeType === 'application/json' ? 'json' : undefined,
      };
    } else {
      requestBody = {
        model: modelToUse,
        messages: [
          ...(params.systemInstruction ? [{ role: 'system', content: params.systemInstruction }] : []),
          {
            role: 'user',
            content: [
              { type: 'text', text: params.promptText },
              {
                type: 'image_url',
                image_url: {
                  url: `data:${params.mimeType};base64,${params.imageBase64}`,
                },
              },
            ],
          },
        ],
      };
    }

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }

    const res = await fetch(requestUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(requestBody),
    });

    if (!res.ok) {
      throw new Error(`Local LLM Multimodal error (${res.status}): ${await res.text()}`);
    }

    const data = await res.json();
    const text = isOllamaNative ? data.response || '' : data.choices?.[0]?.message?.content || '';

    let json: unknown = undefined;
    if (params.responseMimeType === 'application/json') {
      try {
        json = JSON.parse(text);
      } catch {
        json = undefined;
      }
    }

    return {
      text,
      json,
      usage: {
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        estimatedCostUsd: 0,
      },
      modelUsed: modelToUse,
      provider: 'local_llm',
      latencyMs: Date.now() - start,
      draftStatus: 'DRAFT_EVALUATED',
    };
  }
}
