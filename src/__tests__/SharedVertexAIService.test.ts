import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  GeminiAIService,
  geminiAIService,
  VertexAIService,
  vertexAIService,
  sharedAIService,
} from '../services/ai/GeminiAIService';
import { VertexAIQuestionGenerationProvider } from '../services/ai/AIQuestionGenerationProvider';
import { ClassroomEvaluationService } from '../services/ClassroomEvaluationService';
import { GeminiAICaller } from '../services/ai/types';
import { HttpError } from '../lib/errors';
import { GoogleGenAI } from '@google/genai';

describe('Shared Gemini AI Service Layer (@google/genai)', () => {
  const origEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...origEnv };
    delete process.env['assignment-eval-gemini-api-key'];
    delete process.env.ASSIGNMENT_EVAL_GEMINI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_MODEL;
    delete process.env.AI_MODEL;
    delete process.env.VERTEX_AI_MODEL;
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

  describe('Configuration & Secret Resolution (assignment-eval-gemini-api-key)', () => {
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

    it('never exposes the raw API key in public config object or stringified representations', () => {
      process.env['assignment-eval-gemini-api-key'] = 'super-sensitive-secret-token-do-not-leak';
      const service = new GeminiAIService();
      const config = service.getConfig();

      expect(config.secretName).toBe('assignment-eval-gemini-api-key');
      expect(config.isConfigured).toBe(true);
      expect(JSON.stringify(config)).not.toContain('super-sensitive-secret-token-do-not-leak');
      expect(Object.keys(config)).not.toContain('apiKey');
    });

    it('defaults model to gemini-3.5-flash and supports environment override', () => {
      const service = new GeminiAIService();
      expect(service.getModelName()).toBe('gemini-3.5-flash');

      process.env.GEMINI_MODEL = 'gemini-2.0-flash';
      expect(service.getModelName()).toBe('gemini-2.0-flash');
    });

    it('maintains backward-compatible singleton instances across aliases', () => {
      const gInstance = GeminiAIService.getInstance();
      const vInstance = VertexAIService.getInstance();

      expect(gInstance).toBe(geminiAIService);
      expect(vInstance).toBe(vertexAIService);
      expect(gInstance).toBe(vInstance);
      expect(sharedAIService).toBe(geminiAIService);
    });
  });

  describe('Free Tier vs Paid Tier Policy Validation', () => {
    it('defaults to free tier initially for test images', () => {
      const service = new GeminiAIService();
      expect(service.isPaidTier()).toBe(false);
    });

    it('allows multimodal evaluation on free tier when processing test images', async () => {
      const service = new GeminiAIService();
      service.setCustomCaller(async () => JSON.stringify({ score: 10, overallFeedback: 'Pass' }));

      // Without isRealStudentData (synthetic test image), request succeeds
      const result = await service.generateMultimodalContent({
        promptText: 'Test prompt',
        imageBase64: 'synthetic-test-base64',
        mimeType: 'image/png',
        isRealStudentData: false,
      });

      expect(result).toContain('Pass');
    });

    it('blocks real student data processing on free tier with HttpError 403', async () => {
      const service = new GeminiAIService();
      service.setCustomCaller(async () => JSON.stringify({ score: 10 }));

      // Processing real student data without paid tier throws 403
      await expect(
        service.generateMultimodalContent({
          promptText: 'Real student submission evaluation',
          imageBase64: 'synthetic-test-base64',
          mimeType: 'image/png',
          isRealStudentData: true,
        })
      ).rejects.toThrow(HttpError);

      try {
        await service.generateMultimodalContent({
          promptText: 'Real student submission evaluation',
          imageBase64: 'synthetic-test-base64',
          mimeType: 'image/png',
          isRealStudentData: true,
        });
      } catch (err) {
        expect(err).toBeInstanceOf(HttpError);
        expect((err as HttpError).statusCode).toBe(403);
        expect((err as HttpError).message).toContain('paid Gemini API key must be used before any real student data');
      }
    });

    it('permits real student data when paid tier is enabled via environment or setting', async () => {
      process.env.GEMINI_PAID_TIER = 'true';
      const service = new GeminiAIService();
      expect(service.isPaidTier()).toBe(true);

      service.setCustomCaller(async () => JSON.stringify({ score: 9, overallFeedback: 'Evaluated' }));

      const result = await service.generateMultimodalContent({
        promptText: 'Student submission evaluation with paid tier key',
        imageBase64: 'synthetic-test-base64',
        mimeType: 'image/png',
        isRealStudentData: true,
      });

      expect(result).toContain('Evaluated');
    });
  });

  describe('Unconfigured State & Error Handling', () => {
    it('detects unconfigured state and throws HttpError 503 referencing assignment-eval-gemini-api-key', async () => {
      const service = new GeminiAIService();
      expect(service.isConfigured()).toBe(false);

      await expect(
        service.generateContent({ promptText: 'Test prompt' })
      ).rejects.toThrow(HttpError);

      try {
        await service.generateContent({ promptText: 'Test prompt' });
      } catch (err) {
        expect(err).toBeInstanceOf(HttpError);
        expect((err as HttpError).statusCode).toBe(503);
        expect((err as HttpError).message).toContain('assignment-eval-gemini-api-key');
      }
    });
  });

  describe('Mocked @google/genai Client Execution', () => {
    it('calls client.models.generateContent with text prompt and generation config', async () => {
      process.env['assignment-eval-gemini-api-key'] = 'mock-key-for-test';
      const service = new GeminiAIService();

      let capturedArgs: unknown = null;
      const mockGenerateContent = vi.fn().mockImplementation(async (args) => {
        capturedArgs = args;
        return { text: JSON.stringify({ answer: 'Mocked Gemini GenAI output' }) };
      });

      const mockClient = {
        models: {
          generateContent: mockGenerateContent,
        },
      } as unknown as GoogleGenAI;

      service.setClient(mockClient);

      const result = await service.generateContent({
        systemInstruction: 'Act as expert grader',
        promptText: 'Evaluate question 1',
        temperature: 0.2,
      });

      expect(result).toContain('Mocked Gemini GenAI output');
      expect(mockGenerateContent).toHaveBeenCalledTimes(1);
      expect(capturedArgs).toEqual({
        model: 'gemini-3.5-flash',
        contents: 'Evaluate question 1',
        config: {
          systemInstruction: 'Act as expert grader',
          temperature: 0.2,
          responseMimeType: 'application/json',
        },
      });
    });

    it('calls client.models.generateContent with multimodal inlineData for handwritten answer images', async () => {
      process.env['assignment-eval-gemini-api-key'] = 'mock-key-for-test';
      const service = new GeminiAIService();

      let capturedArgs: unknown = null;
      const mockGenerateContent = vi.fn().mockImplementation(async (args) => {
        capturedArgs = args;
        return {
          text: JSON.stringify({
            criteria: [{ criterion: 'Grammar', maxMarks: 5, awardedMarks: 4 }],
            overallFeedback: 'Good handwritten response',
          }),
        };
      });

      const mockClient = {
        models: {
          generateContent: mockGenerateContent,
        },
      } as unknown as GoogleGenAI;

      service.setClient(mockClient);

      const result = await service.generateMultimodalContent({
        systemInstruction: 'Inspect handwritten image',
        promptText: 'Grade this handwritten solution',
        imageBase64: 'synthetic-base64-content',
        mimeType: 'image/png',
        temperature: 0.1,
      });

      expect(result).toContain('Good handwritten response');
      expect(mockGenerateContent).toHaveBeenCalledTimes(1);
      expect(capturedArgs).toEqual({
        model: 'gemini-3.5-flash',
        contents: [
          { text: 'Grade this handwritten solution' },
          {
            inlineData: {
              mimeType: 'image/png',
              data: 'synthetic-base64-content',
            },
          },
        ],
        config: {
          systemInstruction: 'Inspect handwritten image',
          temperature: 0.1,
          responseMimeType: 'application/json',
        },
      });
    });

    it('throws HttpError 502 when @google/genai returns empty text', async () => {
      process.env['assignment-eval-gemini-api-key'] = 'mock-key-for-test';
      const service = new GeminiAIService();

      const mockClient = {
        models: {
          generateContent: vi.fn().mockResolvedValue({ text: '' }),
        },
      } as unknown as GoogleGenAI;

      service.setClient(mockClient);

      await expect(
        service.generateContent({ promptText: 'Hello' })
      ).rejects.toThrow(HttpError);

      try {
        await service.generateContent({ promptText: 'Hello' });
      } catch (err) {
        expect(err).toBeInstanceOf(HttpError);
        expect((err as HttpError).statusCode).toBe(502);
        expect((err as HttpError).message).toContain('empty response candidate');
      }
    });

    it('retries on transient rate limits (429) and succeeds on subsequent attempt', async () => {
      process.env['assignment-eval-gemini-api-key'] = 'mock-key-for-test';
      const service = new GeminiAIService();

      let attempts = 0;
      const mockGenerateContent = vi.fn().mockImplementation(async () => {
        attempts++;
        if (attempts === 1) {
          throw new Error('429 RESOURCE_EXHAUSTED: Rate limit exceeded');
        }
        return { text: JSON.stringify({ status: 'recovered after backoff' }) };
      });

      const mockClient = {
        models: {
          generateContent: mockGenerateContent,
        },
      } as unknown as GoogleGenAI;

      service.setClient(mockClient);

      const result = await service.generateContent({ promptText: 'Retry test' });
      expect(result).toContain('recovered after backoff');
      expect(attempts).toBe(2);
    });
  });

  describe('Dependency Injection & Custom Caller', () => {
    it('invokes custom caller for multimodal content when set', async () => {
      const service = new GeminiAIService();
      let capturedPayload: Parameters<GeminiAICaller>[0] | null = null;

      service.setCustomCaller(async (payload) => {
        capturedPayload = payload;
        return JSON.stringify({
          criteria: [{ criterion: 'Analysis', maxMarks: 10, awardedMarks: 8, feedback: 'Solid work' }],
          overallFeedback: 'Well done',
          confidence: 0.95,
        });
      });

      expect(service.hasCustomCaller()).toBe(true);

      const result = await service.generateMultimodalContent({
        promptText: 'Evaluate synthetic test work',
        imageBase64: 'dGVzdA==',
        mimeType: 'image/png',
        systemInstruction: 'Act as professor',
      });

      expect(capturedPayload).not.toBeNull();
      expect(capturedPayload!.model).toBe('gemini-3.5-flash');
      expect(capturedPayload!.promptText).toBe('Evaluate synthetic test work');
      expect(capturedPayload!.imageBase64).toBe('dGVzdA==');
      expect(capturedPayload!.mimeType).toBe('image/png');
      expect(capturedPayload!.systemInstruction).toBe('Act as professor');
      expect(result).toContain('Solid work');
    });
  });

  describe('Classroom Assessment Integration with Shared AI Layer', () => {
    it('uses the shared Gemini AI service instance and preserves scoring behavior without rewrites', async () => {
      const classroomService = new ClassroomEvaluationService(geminiAIService);

      expect(classroomService.getModelName()).toBe('gemini-3.5-flash');

      geminiAIService.setCustomCaller(async () => {
        return JSON.stringify({
          criteria: [
            {
              criterion: 'Base Case Definition',
              maxMarks: 4,
              awardedMarks: 3.2, // Quantized to 3.0 (0.5 steps)
              evidence: 'Base cases defined for n=0 and n=1',
              feedback: 'Clear and correct',
            },
            {
              criterion: 'Recursive Step',
              maxMarks: 6,
              awardedMarks: 5.4, // Quantized to 5.5
              evidence: 'Recursive call T(n) = 2T(n/2) + O(n)',
              feedback: 'Minor notation slip',
            },
          ],
          overallFeedback: 'Demonstrates good understanding of recurrence relations.',
          confidence: 0.92,
        });
      });

      const outcome = await classroomService.evaluateHandwrittenAnswer({
        questionPrompt: 'Solve the recurrence relation T(n) = 2T(n/2) + n using Master Theorem.',
        maxMarks: 10,
        rubricCriteria: [
          { criterionName: 'Base Case Definition', points: 4 },
          { criterionName: 'Recursive Step', points: 6 },
        ],
        imageBuffer: Buffer.from('synthetic-handwritten-image-test-bytes'),
        mimeType: 'image/png',
      });

      expect(outcome.score).toBe(8.5); // 3.0 + 5.5 = 8.5
      expect(outcome.maxMarks).toBe(10);
      expect(outcome.confidence).toBe(0.92);
      expect(outcome.criterionScores).toHaveLength(2);
      expect(outcome.criterionScores[0].marksAwarded).toBe(3);
      expect(outcome.criterionScores[1].marksAwarded).toBe(5.5);
    });

    it('works identically when initialized with vertexAIService alias', async () => {
      const classroomService = new ClassroomEvaluationService(vertexAIService);
      expect(classroomService.getModelName()).toBe('gemini-3.5-flash');
    });
  });

  describe('Personalized Assessment Integration with Shared AI Layer', () => {
    it('uses the shared Gemini service and returns structured generated questions', async () => {
      const provider = new VertexAIQuestionGenerationProvider(geminiAIService);

      expect(provider.providerName).toBe('VertexAI');
      expect(provider.getModelName()).toBe('gemini-3.5-flash');

      geminiAIService.setCustomCaller(async () => {
        return JSON.stringify({
          questions: [
            {
              title: 'Dynamic Programming - Knapsack',
              topic: 'Dynamic Programming',
              unit: 'Unit 3: Advanced Algorithm Design',
              difficulty: 'MEDIUM',
              questionPrompt: 'Explain the recurrence for 0/1 Knapsack with memoization table.',
              expectedConcepts: ['Optimal Substructure', 'Overlapping Subproblems'],
              maxMarks: 10,
              hints: ['Consider weight capacity w as a subproblem state'],
              rubricCriteria: [
                { criterionName: 'Recurrence Equation', points: 5 },
                { criterionName: 'Complexity Analysis', points: 5 },
              ],
            },
          ],
        });
      });

      const questions = await provider.generateQuestions({
        courseTitle: 'Design and Analysis of Algorithms',
        syllabusUnits: [
          {
            unitNumber: 3,
            unitTitle: 'Advanced Algorithm Design',
            topics: ['Dynamic Programming', 'Greedy Algorithms'],
          },
        ],
        targetCount: 1,
        difficultyDistribution: { EASY: 0, MEDIUM: 1, HARD: 0 },
      });

      expect(questions).toHaveLength(1);
      expect(questions[0].title).toBe('Dynamic Programming - Knapsack');
      expect(questions[0].difficulty).toBe('MEDIUM');
      expect(questions[0].maxMarks).toBe(10);
      expect(questions[0].rubricCriteria).toHaveLength(2);
    });

    it('throws 503 HttpError when Gemini AI credentials are missing', async () => {
      const provider = new VertexAIQuestionGenerationProvider(geminiAIService);

      await expect(
        provider.generateQuestions({
          courseTitle: 'Data Structures',
          syllabusUnits: [{ unitNumber: 1, unitTitle: 'Lists', topics: ['Linked Lists'] }],
          targetCount: 1,
        })
      ).rejects.toThrow(HttpError);
    });
  });
});
