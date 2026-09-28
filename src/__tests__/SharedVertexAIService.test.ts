import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { VertexAIService, vertexAIService } from '../services/ai/VertexAIService';
import { VertexAIQuestionGenerationProvider } from '../services/ai/AIQuestionGenerationProvider';
import { ClassroomEvaluationService } from '../services/ClassroomEvaluationService';
import { VertexAICaller } from '../services/ai/types';
import { HttpError } from '../lib/errors';
import crypto from 'crypto';

describe('Shared Vertex AI Service Layer', () => {
  const origEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...origEnv };
    delete process.env.VERTEX_AI_MODEL;
    delete process.env.VERTEX_AI_REGION;
    delete process.env.GOOGLE_CLOUD_PROJECT;
    delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
    delete process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
    delete process.env.GOOGLE_ACCESS_TOKEN;
    delete process.env.GEMINI_API_KEY;
    delete process.env.GOOGLE_AI_API_KEY;
    delete process.env.GOOGLE_API_KEY;
    vertexAIService.setCustomCaller(null);
  });

  afterEach(() => {
    process.env = { ...origEnv };
    vertexAIService.setCustomCaller(null);
  });

  describe('Configuration & Default Invariants', () => {
    it('defaults model to gemini-3.5-flash and region to asia-south1', () => {
      const service = new VertexAIService();
      expect(service.getModelName()).toBe('gemini-3.5-flash');
      expect(service.getRegion()).toBe('asia-south1');
      expect(service.getProjectId()).toBe('assignment-evaluator-iiith');
    });

    it('respects environment overrides for model, region, and project', () => {
      process.env.VERTEX_AI_MODEL = 'gemini-pro-vision-custom';
      process.env.VERTEX_AI_REGION = 'us-central1';
      process.env.GOOGLE_CLOUD_PROJECT = 'my-custom-gcp-project';

      const service = new VertexAIService();
      expect(service.getModelName()).toBe('gemini-pro-vision-custom');
      expect(service.getRegion()).toBe('us-central1');
      expect(service.getProjectId()).toBe('my-custom-gcp-project');
    });

    it('does NOT read or require GEMINI_API_KEY', () => {
      process.env.GEMINI_API_KEY = 'invalid-secret-key-that-should-not-be-read';
      const service = new VertexAIService();
      // Neither getModelName, getRegion, nor getConfig should expose or read GEMINI_API_KEY
      const config = service.getConfig();
      expect(config).toEqual({
        model: 'gemini-3.5-flash',
        region: 'asia-south1',
        projectId: 'assignment-evaluator-iiith'
      });
      expect(JSON.stringify(config)).not.toContain('GEMINI_API_KEY');
    });

    it('provides a singleton instance via getInstance()', () => {
      const instance1 = VertexAIService.getInstance();
      const instance2 = VertexAIService.getInstance();
      expect(instance1).toBe(instance2);
      expect(instance1).toBe(vertexAIService);
    });
  });

  describe('Authentication & Service Account Credentials', () => {
    it('detects unconfigured state and throws HttpError 503 without fake fallbacks', async () => {
      const service = new VertexAIService();
      expect(service.isConfigured()).toBe(false);

      await expect(
        service.generateContent({ promptText: 'Hello' })
      ).rejects.toThrow(HttpError);

      try {
        await service.generateContent({ promptText: 'Hello' });
      } catch (err) {
        expect(err).toBeInstanceOf(HttpError);
        expect((err as HttpError).statusCode).toBe(503);
        expect((err as HttpError).message).toContain('Google Cloud service account credentials');
      }
    });

    it('detects configured state when GOOGLE_ACCESS_TOKEN is provided', () => {
      process.env.GOOGLE_ACCESS_TOKEN = 'mock-oauth2-access-token';
      const service = new VertexAIService();
      expect(service.isConfigured()).toBe(true);
    });

    it('detects configured state when valid GOOGLE_SERVICE_ACCOUNT_KEY JSON is provided', () => {
      const { privateKey } = crypto.generateKeyPairSync('rsa', {
        modulusLength: 2048,
        publicKeyEncoding: { type: 'spki', format: 'pem' },
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
      });

      const keyJson = JSON.stringify({
        client_email: 'evaluator-sa@assignment-evaluator-iiith.iam.gserviceaccount.com',
        private_key: privateKey,
        project_id: 'assignment-evaluator-iiith'
      });

      process.env.GOOGLE_SERVICE_ACCOUNT_KEY = keyJson;
      const service = new VertexAIService();
      expect(service.isConfigured()).toBe(true);
      expect(service.getProjectId()).toBe('assignment-evaluator-iiith');
    });
  });

  describe('Dependency Injection & Custom Caller', () => {
    it('invokes custom caller for multimodal content when set', async () => {
      const service = new VertexAIService();
      let capturedPayload: Parameters<VertexAICaller>[0] | null = null;

      service.setCustomCaller(async (payload) => {
        capturedPayload = payload;
        return JSON.stringify({
          criteria: [{ criterion: 'Analysis', maxMarks: 10, awardedMarks: 8, feedback: 'Solid work' }],
          overallFeedback: 'Well done',
          confidence: 0.95
        });
      });

      expect(service.hasCustomCaller()).toBe(true);

      const result = await service.generateMultimodalContent({
        promptText: 'Evaluate student work',
        imageBase64: 'dGVzdA==',
        mimeType: 'image/png',
        systemInstruction: 'Act as professor'
      });

      expect(capturedPayload).not.toBeNull();
      expect(capturedPayload!.model).toBe('gemini-3.5-flash');
      expect(capturedPayload!.region).toBe('asia-south1');
      expect(capturedPayload!.promptText).toBe('Evaluate student work');
      expect(capturedPayload!.imageBase64).toBe('dGVzdA==');
      expect(capturedPayload!.mimeType).toBe('image/png');
      expect(capturedPayload!.systemInstruction).toBe('Act as professor');
      expect(result).toContain('Solid work');
    });
  });

  describe('Classroom Assessment Integration with Shared AI Layer', () => {
    it('uses the shared Vertex AI service instance and preserves scoring behavior', async () => {
      const classroomService = new ClassroomEvaluationService(vertexAIService);

      expect(classroomService.getModelName()).toBe('gemini-3.5-flash');
      expect(classroomService.getRegion()).toBe('asia-south1');

      // Inject mock output into shared VertexAIService
      vertexAIService.setCustomCaller(async () => {
        return JSON.stringify({
          criteria: [
            {
              criterion: 'Base Case Definition',
              maxMarks: 4,
              awardedMarks: 3.2, // Will be quantized to 3.0 (0.5 steps)
              evidence: 'Base cases defined for n=0 and n=1',
              feedback: 'Clear and correct'
            },
            {
              criterion: 'Recursive Step',
              maxMarks: 6,
              awardedMarks: 5.4, // Will be quantized to 5.5
              evidence: 'Recursive call T(n) = 2T(n/2) + O(n)',
              feedback: 'Minor notation slip'
            }
          ],
          overallFeedback: 'Demonstrates good understanding of recurrence relations.',
          confidence: 0.92
        });
      });

      const outcome = await classroomService.evaluateHandwrittenAnswer({
        questionPrompt: 'Solve the recurrence relation T(n) = 2T(n/2) + n using Master Theorem.',
        maxMarks: 10,
        rubricCriteria: [
          { criterionName: 'Base Case Definition', points: 4 },
          { criterionName: 'Recursive Step', points: 6 }
        ],
        imageBuffer: Buffer.from('mock-handwritten-image-bytes'),
        mimeType: 'image/png'
      });

      expect(outcome.score).toBe(8.5); // 3.0 + 5.5 = 8.5
      expect(outcome.maxMarks).toBe(10);
      expect(outcome.confidence).toBe(0.92);
      expect(outcome.criterionScores).toHaveLength(2);
      expect(outcome.criterionScores[0].marksAwarded).toBe(3);
      expect(outcome.criterionScores[1].marksAwarded).toBe(5.5);
    });

    it('rejects invalid inputs before calling AI', async () => {
      const classroomService = new ClassroomEvaluationService(vertexAIService);

      await expect(
        classroomService.evaluateHandwrittenAnswer({
          questionPrompt: '',
          maxMarks: 10,
          imageBuffer: Buffer.from('test'),
          mimeType: 'image/png'
        })
      ).rejects.toThrow('Question prompt is required for evaluation');

      await expect(
        classroomService.evaluateHandwrittenAnswer({
          questionPrompt: 'Valid prompt',
          maxMarks: 0,
          imageBuffer: Buffer.from('test'),
          mimeType: 'image/png'
        })
      ).rejects.toThrow('Question max marks must be greater than 0');

      await expect(
        classroomService.evaluateHandwrittenAnswer({
          questionPrompt: 'Valid prompt',
          maxMarks: 10,
          imageBuffer: Buffer.alloc(0),
          mimeType: 'image/png'
        })
      ).rejects.toThrow('Invalid upload: Image buffer is empty');
    });
  });

  describe('Personalized Assessment Integration with Shared AI Layer', () => {
    it('uses the shared VertexAIService and returns structured generated questions', async () => {
      const provider = new VertexAIQuestionGenerationProvider(vertexAIService);

      expect(provider.providerName).toBe('VertexAI');
      expect(provider.getModelName()).toBe('gemini-3.5-flash');
      expect(provider.getRegion()).toBe('asia-south1');

      vertexAIService.setCustomCaller(async () => {
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
                { criterionName: 'Complexity Analysis', points: 5 }
              ]
            }
          ]
        });
      });

      const questions = await provider.generateQuestions({
        courseTitle: 'Design and Analysis of Algorithms',
        syllabusUnits: [
          {
            unitNumber: 3,
            unitTitle: 'Advanced Algorithm Design',
            topics: ['Dynamic Programming', 'Greedy Algorithms']
          }
        ],
        targetCount: 1,
        difficultyDistribution: { EASY: 0, MEDIUM: 1, HARD: 0 }
      });

      expect(questions).toHaveLength(1);
      expect(questions[0].title).toBe('Dynamic Programming - Knapsack');
      expect(questions[0].difficulty).toBe('MEDIUM');
      expect(questions[0].maxMarks).toBe(10);
      expect(questions[0].rubricCriteria).toHaveLength(2);
    });

    it('throws 503 HttpError when Vertex AI credentials are missing', async () => {
      const provider = new VertexAIQuestionGenerationProvider(vertexAIService);

      await expect(
        provider.generateQuestions({
          courseTitle: 'Data Structures',
          syllabusUnits: [{ unitNumber: 1, unitTitle: 'Lists', topics: ['Linked Lists'] }],
          targetCount: 1
        })
      ).rejects.toThrow(HttpError);

      try {
        await provider.generateQuestions({
          courseTitle: 'Data Structures',
          syllabusUnits: [{ unitNumber: 1, unitTitle: 'Lists', topics: ['Linked Lists'] }],
          targetCount: 1
        });
      } catch (err) {
        expect(err).toBeInstanceOf(HttpError);
        expect((err as HttpError).statusCode).toBe(503);
        expect((err as HttpError).message).toContain('Vertex AI question generation is not configured');
      }
    });
  });
});
