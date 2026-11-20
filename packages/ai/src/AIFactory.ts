import { AIProvider, AIModelConfig, AIProviderType } from './interfaces';
import { GeminiProvider } from './providers/GeminiProvider';
import { LocalLLMProvider } from './providers/LocalLLMProvider';
import { StubAIProvider } from './providers/StubAIProvider';

export class AIFactory {
  private static defaultProvider: AIProvider | null = null;

  /**
   * Creates an AI provider instance based on provided config or environment variables.
   * Priority of environment selection:
   * 1. AI_PROVIDER ('gemini' | 'local_llm' | 'ollama' | 'stub')
   * 2. If LOCAL_LLM_ENDPOINT is set -> 'local_llm'
   * 3. If GEMINI_API_KEY / ASSIGNMENT_EVAL_GEMINI_API_KEY is set -> 'gemini'
   * 4. Fallback to 'stub' in test/dev when no keys are provided
   */
  public static createProvider(config?: Partial<AIModelConfig>): AIProvider {
    const providerType: AIProviderType =
      config?.provider ||
      (process.env.AI_PROVIDER?.trim().toLowerCase() as AIProviderType) ||
      (process.env.LOCAL_LLM_ENDPOINT ? 'local_llm' : undefined) ||
      (process.env.GEMINI_API_KEY || process.env.ASSIGNMENT_EVAL_GEMINI_API_KEY ? 'gemini' : 'stub');

    switch (providerType) {
      case 'gemini':
        return new GeminiProvider({
          apiKey: config?.apiKey,
          model: config?.model,
          region: config?.region,
          isPaidTier: config?.isPaidTier,
        });

      case 'local_llm':
      case 'ollama':
      case 'openai_compatible':
        return new LocalLLMProvider({
          endpoint: config?.endpoint,
          model: config?.model,
          timeoutMs: config?.timeoutMs,
          apiKey: config?.apiKey,
        });

      case 'stub':
      default:
        return new StubAIProvider();
    }
  }

  /**
   * Gets or initializes the shared singleton provider.
   */
  public static getDefaultProvider(): AIProvider {
    if (!AIFactory.defaultProvider) {
      AIFactory.defaultProvider = AIFactory.createProvider();
    }
    return AIFactory.defaultProvider;
  }

  /**
   * Overrides the default provider (useful for testing or switching models at runtime).
   */
  public static setDefaultProvider(provider: AIProvider | null): void {
    AIFactory.defaultProvider = provider;
  }
}
