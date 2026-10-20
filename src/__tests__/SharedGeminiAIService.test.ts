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
  MockAIQuestionGenerationProvider,
  parseGeneratedQuestions,
} from '../services/ai/AIQuestionGenerationProvider';
import { HttpError } from '../lib/errors';

describe('Shared Gemini AI Service Layer (@google/genai)', () => {
  const origEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...origEnv };
    delete process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_MODEL;
    delete process.env.GEMINI_EMBEDDING_MODEL;
    delete process.env.AI_MODEL;
    delete process.env.VERTEX_AI_MODEL;
    delete process.env.GEMINI_PERSONALIZED_MODEL;
    delete process.env.GEMINI_CLASSROOM_MODEL;
    delete process.env.GEMINI_TIER;
    delete process.env.GEMINI_PAID_TIER;

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
    it('uses the canonical secret name GEMINI_API_KEY', () => {
      const service = new GeminiAIService();
      expect(service.getSecretName()).toBe('GEMINI_API_KEY');
      expect(GeminiAIService.SECRET_NAME).toBe('GEMINI_API_KEY');
    });

    it('reads the API key from GEMINI_API_KEY environment variable', () => {
      process.env.GEMINI_API_KEY = 'gemini-secret-test-key-123';
      const service = new GeminiAIService();
      expect(service.getApiKey()).toBe('gemini-secret-test-key-123');
      expect(service.isConfigured()).toBe(true);
    });

    it('reinitializes client when API key is rotated in environment', () => {
      process.env.GEMINI_API_KEY = 'initial-api-key';
      const service = new GeminiAIService();
      const client1 = service.getClient();
      expect(client1).toBeDefined();

      // Rotate API key
      process.env.GEMINI_API_KEY = 'rotated-api-key-new';
      const client2 = service.getClient();
      expect(client2).toBeDefined();
      expect(client2).not.toBe(client1);
    });

    it('never exposes credentials in public config or serialized representations', () => {
      process.env.GEMINI_API_KEY = 'super-sensitive-secret-token-do-not-leak';
      process.env.GEMINI_MODEL = 'gemini-test-model';
      process.env.GEMINI_EMBEDDING_MODEL = 'gemini-test-embedding';

      const service = new GeminiAIService();
      const config = service.getConfig();
      const embedConfig = service.getEmbeddingConfig();

      expect(config.secretName).toBe('GEMINI_API_KEY');
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
      process.env.GEMINI_API_KEY = 'mock-key';
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
      process.env.GEMINI_API_KEY = 'test-key';

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
      process.env.GEMINI_API_KEY = 'secret-api-key';

      const service = new GeminiAIService();
      const config = service.getEmbeddingConfig();

      expect(config.embeddingModel).toBe(customEmbeddingModel);
      expect(config.secretName).toBe('GEMINI_API_KEY');
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

  describe('Tier enforcement using GEMINI_PAID_TIER', () => {
    it('checks GEMINI_PAID_TIER for paid tier activation', () => {
      process.env.GEMINI_PAID_TIER = 'true';
      const service1 = new GeminiAIService();
      expect(service1.isPaidTier()).toBe(true);

      process.env.GEMINI_PAID_TIER = 'paid';
      const service2 = new GeminiAIService();
      expect(service2.isPaidTier()).toBe(true);

      process.env.GEMINI_PAID_TIER = 'false';
      const service3 = new GeminiAIService();
      expect(service3.isPaidTier()).toBe(false);
    });

    it('rejects real student data when GEMINI_PAID_TIER is not active', () => {
      process.env.GEMINI_PAID_TIER = 'false';
      const service = new GeminiAIService();
      expect(() => service.validateTierForPayload({ isRealStudentData: true })).toThrow(HttpError);
    });
  });

  describe('Retry logic & safe error reporting', () => {
    it('retries transient 429 errors using fake timers without real sleeping', async () => {
      vi.useFakeTimers();
      try {
        const configuredModel = 'gemini-strict-retry-model';
        process.env.GEMINI_MODEL = configuredModel;
        process.env.GEMINI_API_KEY = 'mock-key';

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

        const promise = service.generateContent({ promptText: 'Retry test' });
        await vi.runAllTimersAsync();
        const result = await promise;

        expect(result).toBe(JSON.stringify({ status: 'recovered' }));
        expect(attempts).toBe(2);
        expect(invokedModels).toEqual([configuredModel, configuredModel]);
      } finally {
        vi.useRealTimers();
      }
    });

    it('returns a safe stable error message without raw upstream error text', async () => {
      process.env.GEMINI_MODEL = 'gemini-model';
      process.env.GEMINI_API_KEY = 'mock-key';

      const service = new GeminiAIService();
      const mockClient = {
        models: {
          generateContent: vi.fn().mockRejectedValue(new Error('Internal raw upstream credential detail: token_abc_123 failed')),
        },
      } as unknown as GoogleGenAI;
      service.setClient(mockClient);

      await expect(service.generateContent({ promptText: 'test' })).rejects.toThrow(
        'Gemini AI service request failed. Please try again later.'
      );
    });
  });

  describe('Client caching and key rotation', () => {
    it('creates and caches a client when key is configured', () => {
      process.env.GEMINI_API_KEY = 'key-initial';
      const service = new GeminiAIService();
      const client1 = service.getClient();
      expect(client1).toBeDefined();
    });

    it('reuses cached client when API key is unchanged (unchanged-key reuse)', () => {
      process.env.GEMINI_API_KEY = 'key-unchanged';
      const service = new GeminiAIService();
      const client1 = service.getClient();
      const client2 = service.getClient();
      expect(client2).toBe(client1);
    });

    it('recreates client when GEMINI_API_KEY rotates (key rotation)', () => {
      process.env.GEMINI_API_KEY = 'key-1';
      const service = new GeminiAIService();
      const client1 = service.getClient();

      process.env.GEMINI_API_KEY = 'key-2';
      const client2 = service.getClient();
      expect(client2).not.toBe(client1);
    });

    it('recreates client when cached client has unknown credential association (the unknown-key case)', () => {
      process.env.GEMINI_API_KEY = 'key-active';
      const service = new GeminiAIService();
      const mockUnknownClient = {} as unknown as GoogleGenAI;
      // Simulate a cached client whose credential association is unknown (isInjected: false, lastApiKey: null)
      service.setClient(mockUnknownClient, { isInjected: false, lastApiKey: null });
      const client = service.getClient();
      expect(client).not.toBe(mockUnknownClient);
    });

    it('preserves intentional dependency injection in tests', () => {
      process.env.GEMINI_API_KEY = 'key-injected';
      const service = new GeminiAIService();
      const mockInjectedClient = {
        models: { generateContent: vi.fn() },
      } as unknown as GoogleGenAI;
      service.setClient(mockInjectedClient);
      const client = service.getClient();
      expect(client).toBe(mockInjectedClient);
    });
  });

  describe('Syllabus grounding and off-syllabus question rejection', () => {
    it('drops off-syllabus questions, reports rejectedOffSyllabusCount, and never silently reassigns them (partial rejection)', () => {
      const syllabusUnits = [
        {
          unitNumber: 1,
          unitTitle: 'Unit 1: Sorting',
          topics: ['MergeSort', 'QuickSort'],
        },
      ];

      const mockRawResponse = JSON.stringify({
        questions: [
          {
            title: 'MergeSort Analysis',
            topic: 'MergeSort',
            unit: 'Unit 1: Sorting',
            difficulty: 'EASY',
            questionPrompt: 'Explain MergeSort recursion tree and recurrence relation.',
            maxMarks: 10,
          },
          {
            title: 'Quantum Computing Intro',
            topic: 'Quantum Computing', // Completely off-syllabus!
            unit: 'Random Unit',
            difficulty: 'HARD',
            questionPrompt: 'Explain quantum superposition.',
            maxMarks: 10,
          },
        ],
      });

      let callbackReportedCount = -1;
      const parsed = parseGeneratedQuestions(mockRawResponse, syllabusUnits, (count) => {
        callbackReportedCount = count;
      });

      expect(parsed).toHaveLength(1);
      expect(parsed[0].topic).toBe('MergeSort');
      expect(parsed.rejectedOffSyllabusCount).toBe(1);
      expect(callbackReportedCount).toBe(1);

      const topics = parsed.map((q) => q.topic);
      expect(topics).not.toContain('Quantum Computing');
      // Verify off-syllabus question was not reassigned to QuickSort
      expect(topics.filter((t) => t === 'QuickSort')).toHaveLength(0);
    });

    it('throws 502 error when all generated questions are off-syllabus (complete rejection)', () => {
      const syllabusUnits = [
        {
          unitNumber: 1,
          unitTitle: 'Unit 1: Data Structures',
          topics: ['Binary Search Trees'],
        },
      ];

      const mockRawResponse = JSON.stringify({
        questions: [
          {
            title: 'Astrophysics Intro',
            topic: 'Astrophysics',
            difficulty: 'MEDIUM',
            questionPrompt: 'Describe stellar nucleosynthesis.',
            maxMarks: 5,
          },
        ],
      });

      expect(() => parseGeneratedQuestions(mockRawResponse, syllabusUnits)).toThrow(
        /rejected count: 1/i
      );
    });

    it('reports rejectedOffSyllabusCount via server-side structured log and callback even when JSON.stringify omits named array properties', () => {
      const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
      try {
        const syllabusUnits = [
          {
            unitNumber: 1,
            unitTitle: 'Unit 1: Sorting',
            topics: ['MergeSort'],
          },
        ];

        const mockRawResponse = JSON.stringify({
          questions: [
            {
              title: 'MergeSort Analysis',
              topic: 'MergeSort',
              difficulty: 'EASY',
              questionPrompt: 'Explain MergeSort.',
              maxMarks: 10,
            },
            {
              title: 'Off Syllabus Item',
              topic: 'Rocket Science',
              difficulty: 'HARD',
              questionPrompt: 'Explain propulsion.',
              maxMarks: 10,
            },
          ],
        });

        let callbackCount = -1;
        const result = parseGeneratedQuestions(mockRawResponse, syllabusUnits, {
          onRejected: (c) => {
            callbackCount = c;
          },
        });

        // 1. Verify in-memory TypeScript property is accessible
        expect(result.rejectedOffSyllabusCount).toBe(1);
        expect(callbackCount).toBe(1);

        // 2. Verify JSON.stringify omits named array properties per ECMAScript specification
        const serialized = JSON.stringify(result);
        const deserialized = JSON.parse(serialized);
        expect(Array.isArray(deserialized)).toBe(true);
        expect(deserialized[0].topic).toBe('MergeSort');
        expect((deserialized as { rejectedOffSyllabusCount?: number }).rejectedOffSyllabusCount).toBeUndefined();

        // 3. Verify server-side structured log was emitted with the exact rejection summary
        expect(infoSpy).toHaveBeenCalled();
        const loggedCall = infoSpy.mock.calls.find((call) => {
          try {
            const data = JSON.parse(call[0] as string);
            return data.event === 'off_syllabus_rejection_summary';
          } catch {
            return false;
          }
        });
        expect(loggedCall).toBeDefined();
        const payload = JSON.parse(loggedCall![0] as string);
        expect(payload).toEqual({
          event: 'off_syllabus_rejection_summary',
          rejectedOffSyllabusCount: 1,
          acceptedCount: 1,
          totalParsed: 2,
        });
      } finally {
        infoSpy.mockRestore();
      }
    });

    it('distinguishes empty responses from off-syllabus rejections with a 502 empty-response error', () => {
      const syllabusUnits = [{ unitNumber: 1, unitTitle: 'Unit 1', topics: ['Trees'] }];
      expect(() => parseGeneratedQuestions('', syllabusUnits)).toThrow(
        /Gemini question generation returned an empty response/i
      );
      expect(() => parseGeneratedQuestions('   ', syllabusUnits)).toThrow(
        /Gemini question generation returned an empty response/i
      );
    });

    it('distinguishes malformed JSON from off-syllabus rejections with a 502 malformed-JSON error', () => {
      const syllabusUnits = [{ unitNumber: 1, unitTitle: 'Unit 1', topics: ['Trees'] }];
      expect(() => parseGeneratedQuestions('not valid json syntax', syllabusUnits)).toThrow(
        /Gemini question generation returned malformed JSON/i
      );
    });

    it('distinguishes schema-invalid questions from off-syllabus rejections with a 502 schema-validation error', () => {
      const syllabusUnits = [{ unitNumber: 1, unitTitle: 'Unit 1', topics: ['Trees'] }];
      // Missing required fields like difficulty, questionPrompt, maxMarks
      const invalidQuestion = JSON.stringify({
        questions: [{ title: 'Incomplete Question', topic: 'Trees' }],
      });
      expect(() => parseGeneratedQuestions(invalidQuestion, syllabusUnits)).toThrow(
        /Gemini question generation response failed schema validation/i
      );
    });

    it('distinguishes empty questions array from off-syllabus rejections with a 502 schema-validation error', () => {
      const syllabusUnits = [{ unitNumber: 1, unitTitle: 'Unit 1', topics: ['Trees'] }];
      const emptyQuestions = JSON.stringify({ questions: [] });
      expect(() => parseGeneratedQuestions(emptyQuestions, syllabusUnits)).toThrow(
        /Gemini question generation response failed schema validation/i
      );
    });

    it('GeminiAIQuestionGenerationProvider tracks and exposes partial rejection count through provider methods and params', async () => {
      process.env.GEMINI_MODEL = 'gemini-test-model';
      process.env.GEMINI_API_KEY = 'mock-key';
      const mockService = new GeminiAIService();
      const provider = new GeminiAIQuestionGenerationProvider(mockService);

      const syllabusUnits = [
        {
          unitNumber: 1,
          unitTitle: 'Unit 1: Sorting',
          topics: ['MergeSort'],
        },
      ];

      const mockRawResponse = JSON.stringify({
        questions: [
          {
            title: 'MergeSort Analysis',
            topic: 'MergeSort',
            difficulty: 'EASY',
            questionPrompt: 'Explain MergeSort.',
            maxMarks: 10,
          },
          {
            title: 'Off Syllabus Item',
            topic: 'Rocket Science',
            difficulty: 'HARD',
            questionPrompt: 'Explain propulsion.',
            maxMarks: 10,
          },
        ],
      });

      provider.setGeminiCaller(async () => mockRawResponse);

      let paramCallbackCount = -1;
      const result = await provider.generateQuestions({
        courseTitle: 'Algorithms',
        syllabusUnits,
        targetCount: 1,
        onRejected: (count) => {
          paramCallbackCount = count;
        },
      });

      expect(result).toHaveLength(1);
      expect(result.rejectedOffSyllabusCount).toBe(1);
      expect(provider.getLastRejectedCount()).toBe(1);
      expect(provider.getLastRejectedOffSyllabusCount()).toBe(1);
      expect(paramCallbackCount).toBe(1);
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
        [g, em, dash, '1.5'].join(''),
        [g, em, dash, '2.0'].join(''),
        [g, em, dash, '2.5'].join(''),
        [g, em, dash, 'flash', dash, 'latest'].join(''),
        [g, em, dash, 'pro', dash, 'latest'].join(''),
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
          // Include typescript, javascript, mjs, and cjs source files, excluding test files
          const extMatches =
            entry.name.endsWith('.ts') ||
            entry.name.endsWith('.tsx') ||
            entry.name.endsWith('.js') ||
            entry.name.endsWith('.jsx') ||
            entry.name.endsWith('.mjs') ||
            entry.name.endsWith('.cjs');
          if (extMatches && !entry.name.includes('.test.') && !entry.name.includes('.spec.')) {
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

    it('proves each forbidden pattern is detected by scanner', () => {
      const legacyPatterns = buildLegacyModelPatterns();
      const forbiddenSamples = [
        'gemini-1.5',
        'gemini-1.5-flash',
        'gemini-1.5-pro',
        'gemini-2.0',
        'gemini-2.0-flash',
        'gemini-2.5',
        'gemini-2.5-flash',
        'gemini-flash-latest',
        'gemini-pro-latest',
      ];
      for (const sample of forbiddenSamples) {
        const detected = legacyPatterns.some((pattern) => sample.includes(pattern));
        expect(detected, `Sample ${sample} should be detected`).toBe(true);
      }
    });

    it('proves valid configured model IDs are not incorrectly flagged as legacy patterns', () => {
      const legacyPatterns = buildLegacyModelPatterns();
      const validModels = [
        'gemini-3.5-flash',
        'gemini-3.1-flash-lite',
        'gemini-3.7-flash',
        'gemini-3.8-flash',
        'gemini-embedding-2',
        'gemini-embedding-001',
      ];
      for (const validModel of validModels) {
        const falsePositive = legacyPatterns.some((pattern) => validModel.includes(pattern));
        expect(falsePositive, `Valid model ${validModel} should not be flagged`).toBe(false);
      }
    });
  });
});
