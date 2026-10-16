import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { GoogleGenAI } from '@google/genai';
import {
  GeminiAIService,
  geminiAIService,
  sharedAIService,
} from '../services/ai/GeminiAIService';
import {
  GeminiAIQuestionGenerationProvider,
  VertexAIQuestionGenerationProvider,
  MockAIQuestionGenerationProvider,
} from '../services/ai/AIQuestionGenerationProvider';
import { HttpError } from '../lib/errors';

describe('Shared Gemini AI Service Layer (@google/genai)', () => {
  const origEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...origEnv };
    delete process.env['assignment-eval-gemini-api-key'];
    delete process.env.ASSIGNMENT_EVAL_GEMINI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_MODEL;
    delete process.env.GEMINI_EMBEDDING_MODEL;
    delete process.env.AI_MODEL;
    delete process.env.VERTEX_AI_MODEL;
    delete process.env.GEMINI_PERSONALIZED_MODEL;
    delete process.env.GEMINI_CLASSROOM_MODEL;
    delete process.env.GEMINI_TIER;
    delete process.env.GEMINI_PAID_TIER;
    delete process.env.ASSIGNMENT_EVAL_GEMINI_TIER;

    geminiAIService.setCustomCaller(null);
    geminiAIService.setClient(null);
    geminiAIService.setPaidTier(null);
  });

  afterEach(() => {
    process.env = { ...origEnv };
    geminiAIService.setCustomCaller(null);
    geminiAIService.setClient(null);
    geminiAIService.setPaidTier(null);
    vi.restoreAllMocks();
  });

  describe('Configuration & Secret Resolution', () => {
    it('uses the mentor-specified secret name assignment-eval-gemini-api-key', () => {
      const service = new GeminiAIService();
      expect(service.getSecretName()).toBe('assignment-eval-gemini-api-key');
      expect(GeminiAIService.SECRET_NAME).toBe('assignment-eval-gemini-api-key');
    });

    it('reads the API key from assignment-eval-gemini-api-key environment secret', () => {
      process.env['assignment-eval-gemini-api-key'] = 'mentor-assigned-secret-test-key-123';
      const service = new GeminiAIService();
      expect(service.getApiKey()).toBe('mentor-assigned-secret-test-key-123');
      expect(service.isConfigured()).toBe(true);
    });

    it('falls back to POSIX aliases ASSIGNMENT_EVAL_GEMINI_API_KEY or GEMINI_API_KEY if primary secret is absent', () => {
      process.env.ASSIGNMENT_EVAL_GEMINI_API_KEY = 'posix-gemini-key-456';
      const service1 = new GeminiAIService();
      expect(service1.getApiKey()).toBe('posix-gemini-key-456');

      delete process.env.ASSIGNMENT_EVAL_GEMINI_API_KEY;
      process.env.GEMINI_API_KEY = 'gemini-fallback-key-789';
      const service2 = new GeminiAIService();
      expect(service2.getApiKey()).toBe('gemini-fallback-key-789');
    });

    it('never exposes credentials in public config or serialized representations', () => {
      process.env['assignment-eval-gemini-api-key'] = 'super-sensitive-secret-token-do-not-leak';
      process.env.GEMINI_MODEL = 'gemini-test-model';
      process.env.GEMINI_EMBEDDING_MODEL = 'gemini-test-embedding';

      const service = new GeminiAIService();
      const config = service.getConfig();
      const embedConfig = service.getEmbeddingConfig();

      expect(config.secretName).toBe('assignment-eval-gemini-api-key');
      expect(config.isConfigured).toBe(true);
      expect(JSON.stringify(config)).not.toContain('super-sensitive-secret-token-do-not-leak');
      expect(JSON.stringify(embedConfig)).not.toContain('super-sensitive-secret-token-do-not-leak');
      expect(Object.keys(config)).not.toContain('apiKey');
    });

    it('maintains singleton instances', () => {
      const gInstance = GeminiAIService.getInstance();
      expect(gInstance).toBe(geminiAIService);
      expect(sharedAIService).toBe(geminiAIService);
    });
  });

  describe('1. Missing or blank generation-model configuration produces HTTP 503', () => {
    it('throws 503 HttpError when GEMINI_MODEL is completely unset', () => {
      delete process.env.GEMINI_MODEL;
      const service = new GeminiAIService();

      expect(() => service.getModelName()).toThrow(HttpError);
      try {
        service.getModelName();
      } catch (err) {
        expect(err).toBeInstanceOf(HttpError);
        expect((err as HttpError).statusCode).toBe(503);
        expect((err as HttpError).message).toContain('GEMINI_MODEL');
      }
    });

    it('throws 503 HttpError when GEMINI_MODEL is blank whitespace', () => {
      process.env.GEMINI_MODEL = '   ';
      const service = new GeminiAIService();

      expect(() => service.getModelName()).toThrow(HttpError);
      try {
        service.getModelName();
      } catch (err) {
        expect(err).toBeInstanceOf(HttpError);
        expect((err as HttpError).statusCode).toBe(503);
        expect((err as HttpError).message).toContain('GEMINI_MODEL');
      }
    });

    it('throws 503 HttpError when getConfig() is called without GEMINI_MODEL', () => {
      delete process.env.GEMINI_MODEL;
      const service = new GeminiAIService();

      expect(() => service.getConfig()).toThrow(HttpError);
      try {
        service.getConfig();
      } catch (err) {
        expect((err as HttpError).statusCode).toBe(503);
      }
    });

    it('throws 503 HttpError on generateContent call when GEMINI_MODEL is missing', async () => {
      delete process.env.GEMINI_MODEL;
      process.env['assignment-eval-gemini-api-key'] = 'mock-key';
      const service = new GeminiAIService();

      await expect(
        service.generateContent({ promptText: 'Test prompt' })
      ).rejects.toThrow(HttpError);

      try {
        await service.generateContent({ promptText: 'Test prompt' });
      } catch (err) {
        expect((err as HttpError).statusCode).toBe(503);
      }
    });
  });

  describe('2. Configured generation model ID is passed verbatim', () => {
    it('passes configured GEMINI_MODEL verbatim to GoogleGenAI client', async () => {
      const customModelId = 'gemini-custom-generation-model-id-verbatim';
      process.env.GEMINI_MODEL = customModelId;
      process.env['assignment-eval-gemini-api-key'] = 'test-key';

      const service = new GeminiAIService();
      let capturedArgs: unknown = null;

      const mockClient = {
        models: {
          generateContent: vi.fn().mockImplementation(async (args) => {
            capturedArgs = args;
            return { text: JSON.stringify({ result: 'ok' }) };
          }),
        },
      } as unknown as GoogleGenAI;

      service.setClient(mockClient);

      const result = await service.generateContent({
        promptText: 'Evaluate question',
        systemInstruction: 'Act as reviewer',
        temperature: 0.3,
      });

      expect(result).toBe(JSON.stringify({ result: 'ok' }));
      expect(mockClient.models.generateContent).toHaveBeenCalledTimes(1);
      expect((capturedArgs as { model: string }).model).toBe(customModelId);
    });

    it('passes configured GEMINI_MODEL verbatim to custom caller for text generation', async () => {
      const customModelId = 'gemini-model-caller-text-verbatim';
      process.env.GEMINI_MODEL = customModelId;

      const service = new GeminiAIService();
      let receivedModel = '';

      service.setCustomCaller(async (payload) => {
        receivedModel = payload.model;
        return 'custom response';
      });

      const result = await service.generateContent({ promptText: 'Hello' });
      expect(result).toBe('custom response');
      expect(receivedModel).toBe(customModelId);
    });

    it('passes configured GEMINI_MODEL verbatim to custom caller for multimodal generation', async () => {
      const customModelId = 'gemini-model-caller-multimodal-verbatim';
      process.env.GEMINI_MODEL = customModelId;

      const service = new GeminiAIService();
      let receivedModel = '';

      service.setCustomCaller(async (payload) => {
        receivedModel = payload.model;
        return 'multimodal response';
      });

      const result = await service.generateMultimodalContent({
        promptText: 'Inspect canvas',
        imageBase64: 'synthetic-base64',
        mimeType: 'image/png',
      });

      expect(result).toBe('multimodal response');
      expect(receivedModel).toBe(customModelId);
    });
  });

  describe('3. Missing embedding-model configuration is rejected with 503', () => {
    it('throws 503 HttpError when GEMINI_EMBEDDING_MODEL is unset and accessed', () => {
      delete process.env.GEMINI_EMBEDDING_MODEL;
      const service = new GeminiAIService();

      expect(() => service.getEmbeddingModelName()).toThrow(HttpError);
      try {
        service.getEmbeddingModelName();
      } catch (err) {
        expect(err).toBeInstanceOf(HttpError);
        expect((err as HttpError).statusCode).toBe(503);
        expect((err as HttpError).message).toContain('GEMINI_EMBEDDING_MODEL');
      }
    });

    it('throws 503 HttpError when GEMINI_EMBEDDING_MODEL is blank whitespace and accessed', () => {
      process.env.GEMINI_EMBEDDING_MODEL = '   ';
      const service = new GeminiAIService();

      expect(() => service.getEmbeddingModelName()).toThrow(HttpError);
      try {
        service.getEmbeddingModelName();
      } catch (err) {
        expect(err).toBeInstanceOf(HttpError);
        expect((err as HttpError).statusCode).toBe(503);
        expect((err as HttpError).message).toContain('GEMINI_EMBEDDING_MODEL');
      }
    });

    it('throws 503 HttpError when getEmbeddingConfig() is called with missing GEMINI_EMBEDDING_MODEL', () => {
      delete process.env.GEMINI_EMBEDDING_MODEL;
      const service = new GeminiAIService();

      expect(() => service.getEmbeddingConfig()).toThrow(HttpError);
      try {
        service.getEmbeddingConfig();
      } catch (err) {
        expect((err as HttpError).statusCode).toBe(503);
      }
    });
  });

  describe('4. Configured embedding model ID is returned verbatim', () => {
    it('returns the configured GEMINI_EMBEDDING_MODEL verbatim', () => {
      const customEmbeddingModel = 'gemini-custom-embedding-002-verbatim';
      process.env.GEMINI_EMBEDDING_MODEL = customEmbeddingModel;
      const service = new GeminiAIService();

      expect(service.getEmbeddingModelName()).toBe(customEmbeddingModel);
    });

    it('returns embedding config with verbatim embeddingModel and safe metadata', () => {
      const customEmbeddingModel = 'gemini-custom-embedding-prod-verbatim';
      process.env.GEMINI_EMBEDDING_MODEL = customEmbeddingModel;
      process.env['assignment-eval-gemini-api-key'] = 'secret-api-key';

      const service = new GeminiAIService();
      const config = service.getEmbeddingConfig();

      expect(config.embeddingModel).toBe(customEmbeddingModel);
      expect(config.secretName).toBe('assignment-eval-gemini-api-key');
      expect(config.isConfigured).toBe(true);
    });
  });

  describe('5. All generation callers use shared service with no per-feature model fallback', () => {
    it('GeminiAIQuestionGenerationProvider respects shared GEMINI_MODEL and ignores per-feature overrides', async () => {
      const sharedModel = 'gemini-shared-unified-model';
      process.env.GEMINI_MODEL = sharedModel;
      process.env.GEMINI_PERSONALIZED_MODEL = 'legacy-personalized-override';
      process.env.GEMINI_CLASSROOM_MODEL = 'legacy-classroom-override';
      process.env.AI_MODEL = 'legacy-ai-override';

      const provider = new GeminiAIQuestionGenerationProvider(geminiAIService);

      // Model name should come strictly from shared GEMINI_MODEL
      expect(provider.getModelName()).toBe(sharedModel);

      let capturedModelInSharedService = '';
      geminiAIService.setCustomCaller(async (payload) => {
        capturedModelInSharedService = payload.model;
        return JSON.stringify({
          questions: [
            {
              title: 'Algorithms Exercise',
              topic: 'Graph Algorithms',
              unit: 'Unit 2: Graphs',
              difficulty: 'MEDIUM',
              questionPrompt: 'Explain Dijkstra shortest path algorithm.',
              expectedConcepts: ['Shortest Path', 'Priority Queue'],
              maxMarks: 10,
            },
          ],
        });
      });

      const questions = await provider.generateQuestions({
        courseTitle: 'Data Structures',
        syllabusUnits: [
          {
            unitNumber: 2,
            unitTitle: 'Unit 2: Graphs',
            topics: ['Graph Algorithms', 'Trees'],
          },
        ],
        targetCount: 1,
      });

      expect(questions).toHaveLength(1);
      expect(questions[0].topic).toBe('Graph Algorithms');
      expect(capturedModelInSharedService).toBe(sharedModel);
    });

    it('VertexAIQuestionGenerationProvider delegates to shared service without fallback chains', async () => {
      const sharedModel = 'gemini-shared-vertex-provider-model';
      process.env.GEMINI_MODEL = sharedModel;

      const provider = new VertexAIQuestionGenerationProvider(geminiAIService);
      expect(provider.getModelName()).toBe(sharedModel);

      let callerInvoked = false;
      geminiAIService.setCustomCaller(async (payload) => {
        callerInvoked = true;
        expect(payload.model).toBe(sharedModel);
        return JSON.stringify({
          questions: [
            {
              title: 'Sorting Problem',
              topic: 'Sorting',
              unit: 'Unit 1: Sorting',
              difficulty: 'EASY',
              questionPrompt: 'Describe QuickSort average case complexity.',
              maxMarks: 10,
            },
          ],
        });
      });

      const questions = await provider.generateQuestions({
        courseTitle: 'Algorithms',
        syllabusUnits: [
          {
            unitNumber: 1,
            unitTitle: 'Unit 1: Sorting',
            topics: ['Sorting'],
          },
        ],
        targetCount: 1,
      });

      expect(callerInvoked).toBe(true);
      expect(questions).toHaveLength(1);
    });

    it('MockAIQuestionGenerationProvider operates deterministically without external calls', async () => {
      const mockProvider = new MockAIQuestionGenerationProvider();
      expect(mockProvider.isConfigured()).toBe(true);

      const questions = await mockProvider.generateQuestions({
        courseTitle: 'Operating Systems',
        syllabusUnits: [
          {
            unitNumber: 1,
            unitTitle: 'Process Management',
            topics: ['Deadlocks', 'Semaphores'],
          },
        ],
        targetCount: 2,
      });

      expect(questions).toHaveLength(2);
      expect(questions[0].topic).toBe('Deadlocks');
      expect(questions[1].topic).toBe('Semaphores');
    });
  });

  describe('Retry logic preserves model without fallback switching', () => {
    it('retries transient 429 errors using the same configured model without switching', async () => {
      const configuredModel = 'gemini-strict-retry-model';
      process.env.GEMINI_MODEL = configuredModel;
      process.env['assignment-eval-gemini-api-key'] = 'mock-key';

      const service = new GeminiAIService();
      let attempts = 0;
      const invokedModels: string[] = [];

      const mockGenerateContent = vi.fn().mockImplementation(async (args) => {
        attempts++;
        invokedModels.push(args.model);
        if (attempts === 1) {
          throw new Error('429 RESOURCE_EXHAUSTED: Rate limit exceeded');
        }
        return { text: JSON.stringify({ status: 'recovered' }) };
      });

      const mockClient = {
        models: {
          generateContent: mockGenerateContent,
        },
      } as unknown as GoogleGenAI;

      service.setClient(mockClient);

      const result = await service.generateContent({ promptText: 'Retry test' });
      expect(result).toBe(JSON.stringify({ status: 'recovered' }));
      expect(attempts).toBe(2);
      expect(invokedModels).toEqual([configuredModel, configuredModel]);
    });
  });

  describe('6. Source-scan regression test detects hard-coded legacy model IDs across src', () => {
    /**
     * Builds forbidden legacy model string fragments dynamically so this test
     * does not trigger false positives on its own source literals.
     */
    function buildLegacyModelPatterns(): string[] {
      const g = 'gem';
      const em = 'ini';
      const dash = '-';
      return [
        [g, em, dash, '1.5', dash, 'flash'].join(''),
        [g, em, dash, '1.5', dash, 'pro'].join(''),
        [g, em, dash, '1.0', dash, 'pro'].join(''),
        ['text', dash, 'embedding', dash, '004'].join(''),
        [g, em, dash, 'pro'].join(''),
      ];
    }

    function getAllSourceFiles(dir: string, fileList: string[] = []): string[] {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          // Exclude test directories and hidden folders from source production check
          if (entry.name === '__tests__' || entry.name.startsWith('.')) {
            continue;
          }
          getAllSourceFiles(fullPath, fileList);
        } else if (entry.isFile()) {
          // Include typescript and javascript source files, excluding test files
          if (
            (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx') || entry.name.endsWith('.js')) &&
            !entry.name.includes('.test.') &&
            !entry.name.includes('.spec.')
          ) {
            fileList.push(fullPath);
          }
        }
      }
      return fileList;
    }

    it('confirms 0 hard-coded legacy model IDs exist across non-test production src', () => {
      const srcDir = path.resolve(__dirname, '..');
      const sourceFiles = getAllSourceFiles(srcDir);
      const legacyPatterns = buildLegacyModelPatterns();

      const violations: Array<{ file: string; line: number; matchedPattern: string; lineContent: string }> = [];

      for (const filePath of sourceFiles) {
        const content = fs.readFileSync(filePath, 'utf-8');
        const lines = content.split(/\r?\n/);

        lines.forEach((lineText, idx) => {
          for (const pattern of legacyPatterns) {
            if (lineText.includes(pattern)) {
              violations.push({
                file: path.relative(srcDir, filePath),
                line: idx + 1,
                matchedPattern: pattern,
                lineContent: lineText.trim(),
              });
            }
          }
        });
      }

      expect(violations).toEqual([]);
    });

    it('verifies the scanner correctly catches simulated legacy patterns', () => {
      const legacyPatterns = buildLegacyModelPatterns();
      const fakeSource = `const defaultModel = '${legacyPatterns[0]}';`;
      const detected = legacyPatterns.some((pattern) => fakeSource.includes(pattern));
      expect(detected).toBe(true);
    });
  });
});
