import { AIModelConfig, AIProviderType, AIResponse } from './interfaces';

export class AIPrivacyViolationError extends Error {
  public readonly statusCode = 403;
  constructor(message: string) {
    super(message);
    this.name = 'AIPrivacyViolationError';
  }
}

export class AIServiceUnavailableError extends Error {
  public readonly statusCode = 503;
  constructor(message: string) {
    super(message);
    this.name = 'AIServiceUnavailableError';
  }
}

export class AIStructuredOutputError extends Error {
  public readonly statusCode = 502;
  constructor(message: string, public readonly rawOutput?: string) {
    super(message);
    this.name = 'AIStructuredOutputError';
  }
}

/**
 * Enforces institutional data privacy policies per Architecture Note v2:
 * 1. Real student data (handwritten scripts, names, roll numbers) MUST NOT be sent
 *    to unapproved or free-tier public cloud AI providers.
 * 2. Enterprise Vertex AI in the institute tenant or self-hosted local LLMs (Ollama, vLLM)
 *    are authorized for student data processing under affirmative consent.
 */
export function validateDataPrivacy(params: {
  isRealStudentData?: boolean;
  providerType: AIProviderType;
  isPaidTier?: boolean;
  endpoint?: string;
}): void {
  if (!params.isRealStudentData) {
    return;
  }

  // Allowed: Local LLM, Ollama, internal endpoints, or enterprise paid cloud tier
  const isLocal =
    params.providerType === 'local_llm' ||
    params.providerType === 'ollama' ||
    (params.endpoint && (params.endpoint.includes('localhost') || params.endpoint.includes('127.0.0.1')));

  if (isLocal) {
    return;
  }

  if (params.providerType === 'stub') {
    return;
  }

  if (params.providerType === 'gemini' && !params.isPaidTier) {
    throw new AIPrivacyViolationError(
      'Privacy Policy Violation: Real student data cannot be processed using free-tier public AI providers. ' +
      'An enterprise Vertex AI tier or internal local LLM instance is required.'
    );
  }
}

/**
 * Executes an async task with configurable exponential backoff retries.
 */
export async function withExponentialBackoff<T>(
  fn: () => Promise<T>,
  options: { maxRetries?: number; initialDelayMs?: number; backoffFactor?: number } = {}
): Promise<T> {
  const maxRetries = options.maxRetries ?? 2;
  const initialDelayMs = options.initialDelayMs ?? 500;
  const backoffFactor = options.backoffFactor ?? 2;

  let attempt = 0;
  let delay = initialDelayMs;

  while (true) {
    try {
      return await fn();
    } catch (err: unknown) {
      attempt++;
      if (attempt > maxRetries) {
        throw err;
      }
      // If error is an explicit privacy violation, do not retry
      if (err instanceof AIPrivacyViolationError) {
        throw err;
      }
      await new Promise((resolve) => setTimeout(resolve, delay));
      delay *= backoffFactor;
    }
  }
}

/**
 * Validates and extracts JSON output from AI text response.
 */
export function extractAndValidateJson<T>(rawText: string, schemaValidator?: (data: unknown) => boolean): T {
  let cleaned = rawText.trim();
  // Strip markdown code fences if model returned ```json ... ```
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```[a-z]*\s*/i, '').replace(/\s*```$/, '').trim();
  }

  try {
    const parsed = JSON.parse(cleaned);
    if (schemaValidator && !schemaValidator(parsed)) {
      throw new AIStructuredOutputError('AI response did not conform to required validation schema', rawText);
    }
    return parsed as T;
  } catch (err: unknown) {
    if (err instanceof AIStructuredOutputError) throw err;
    throw new AIStructuredOutputError(`Failed to parse AI output as JSON: ${(err as Error).message}`, rawText);
  }
}
