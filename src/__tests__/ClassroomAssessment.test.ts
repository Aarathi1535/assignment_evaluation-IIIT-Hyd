/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import mongoose from 'mongoose';
import ClassroomQuestion from '../models/ClassroomQuestion';
import ClassroomSubmission from '../models/ClassroomSubmission';
import ClassroomAssessmentService from '../services/ClassroomAssessmentService';
import classroomEvaluationService from '../services/ClassroomEvaluationService';
import { UserRole } from '../constants/permissions';

let mockSessionUser: any = null;

vi.mock('next-auth', async (importOriginal) => {
  const original = await importOriginal<typeof import('next-auth')>();
  return {
    ...original,
    getServerSession: vi.fn().mockImplementation(() => {
      if (!mockSessionUser) return Promise.resolve(null);
      return Promise.resolve({ user: mockSessionUser });
    }),
  };
});

describe('Interactive Classroom Assessment Flow (Research Direction 1)', () => {
  let questionsGET: any;
  let questionsPOST: any;
  let activeQuestionGET: any;
  let questionDetailGET: any;
  let questionDetailPATCH: any;
  let submitPOST: any;
  let questionSubmissionsGET: any;
  let studentSubmissionsGET: any;
  let singleSubmissionGET: any;

  let professorId: mongoose.Types.ObjectId;
  let otherProfessorId: mongoose.Types.ObjectId;
  let studentId: mongoose.Types.ObjectId;
  let otherStudentId: mongoose.Types.ObjectId;

  beforeAll(async () => {
    questionsGET = (await import('../app/api/classroom/questions/route')).GET;
    questionsPOST = (await import('../app/api/classroom/questions/route')).POST;
    activeQuestionGET = (await import('../app/api/classroom/questions/active/route')).GET;
    questionDetailGET = (await import('../app/api/classroom/questions/[id]/route')).GET;
    questionDetailPATCH = (await import('../app/api/classroom/questions/[id]/route')).PATCH;
    submitPOST = (await import('../app/api/classroom/submit/route')).POST;
    questionSubmissionsGET = (await import('../app/api/classroom/questions/[id]/submissions/route')).GET;
    studentSubmissionsGET = (await import('../app/api/classroom/submissions/route')).GET;
    singleSubmissionGET = (await import('../app/api/classroom/submissions/[id]/route')).GET;

    professorId = new mongoose.Types.ObjectId('000000000000000000000201');
    otherProfessorId = new mongoose.Types.ObjectId('000000000000000000000202');
    studentId = new mongoose.Types.ObjectId('000000000000000000000203');
    otherStudentId = new mongoose.Types.ObjectId('000000000000000000000204');
  });

  beforeEach(async () => {
    mockSessionUser = null;
    await ClassroomQuestion.deleteMany({});
    await ClassroomSubmission.deleteMany({});
    classroomEvaluationService.setGeminiCaller(null);
  });

  afterEach(() => {
    classroomEvaluationService.setGeminiCaller(null);
  });

  describe('1. Authentication & Authorization Access Control', () => {
    it('returns 401 Unauthorized when unauthenticated user tries to get questions', async () => {
      mockSessionUser = null;
      const res = await questionsGET();
      const body = await res.json();
      expect(res.status).toBe(401);
      expect(body.success).toBe(false);
    });

    it('returns 403 Forbidden when student tries to create a classroom question', async () => {
      mockSessionUser = {
        id: studentId.toString(),
        email: 'student@iiit.ac.in',
        name: 'Student One',
        role: UserRole.STUDENT,
      };

      const req = {
        json: async () => ({
          title: 'Math Quiz',
          questionPrompt: 'Solve x^2 = 4',
          maxMarks: 5,
        }),
        headers: new Headers(),
      } as any;

      const res = await questionsPOST(req);
      const body = await res.json();
      expect(res.status).toBe(403);
      expect(body.message).toContain('Forbidden');
    });

    it('returns 403 Forbidden when a professor tries to modify another professors question', async () => {
      const q = await ClassroomQuestion.create({
        title: 'Prof 1 Question',
        questionPrompt: 'Derive Bayes Theorem',
        maxMarks: 10,
        createdBy: professorId,
        isActive: true,
        status: 'ACTIVE',
      });

      mockSessionUser = {
        id: otherProfessorId.toString(),
        email: 'otherprof@iiit.ac.in',
        name: 'Prof Two',
        role: UserRole.PROFESSOR,
      };

      const req = {
        json: async () => ({ isActive: false }),
        headers: new Headers(),
      } as any;

      const res = await questionDetailPATCH(req, { params: Promise.resolve({ id: q._id.toString() }) });
      const body = await res.json();
      expect(res.status).toBe(403);
      expect(body.message).toContain('Forbidden');
    });
  });

  describe('2. Professor Question Management & Activation Flow', () => {
    it('allows a professor to create a question with rubric criteria and set it active', async () => {
      mockSessionUser = {
        id: professorId.toString(),
        email: 'prof@iiit.ac.in',
        name: 'Prof Jawahar',
        role: UserRole.PROFESSOR,
      };

      const req = {
        json: async () => ({
          title: 'Linear Algebra: Eigenvalue Problem',
          questionPrompt: 'Find all eigenvalues and corresponding eigenvectors for the matrix A = [[2, 1], [1, 2]].',
          maxMarks: 10,
          rubricCriteria: [
            { criterionName: 'Characteristic Polynomial', points: 4, description: 'Correct det(A - lambda*I) = 0' },
            { criterionName: 'Eigenvalues Calculation', points: 3, description: 'Roots lambda1=1, lambda2=3' },
            { criterionName: 'Eigenvectors Derivation', points: 3, description: 'Normalized basis vectors' },
          ],
          isActive: true,
        }),
        headers: new Headers(),
      } as any;

      const res = await questionsPOST(req);
      const body = await res.json();

      expect(res.status).toBe(201);
      expect(body.success).toBe(true);
      expect(body.data.title).toBe('Linear Algebra: Eigenvalue Problem');
      expect(body.data.isActive).toBe(true);
      expect(body.data.rubricCriteria).toHaveLength(3);
      expect(body.data.maxMarks).toBe(10);

      const dbQ = await ClassroomQuestion.findById(body.data._id);
      expect(dbQ).not.toBeNull();
      expect(dbQ?.isActive).toBe(true);
    });

    it('rejects question creation if rubric criteria points sum exceeds maxMarks', async () => {
      mockSessionUser = {
        id: professorId.toString(),
        email: 'prof@iiit.ac.in',
        name: 'Prof Jawahar',
        role: UserRole.PROFESSOR,
      };

      const req = {
        json: async () => ({
          title: 'Calculus Quiz',
          questionPrompt: 'Integrate e^(2x)',
          maxMarks: 5,
          rubricCriteria: [
            { criterionName: 'Substitution', points: 4 },
            { criterionName: 'Final Answer', points: 3 },
          ],
        }),
        headers: new Headers(),
      } as any;

      const res = await questionsPOST(req);
      const body = await res.json();
      expect(res.status).toBe(400);
      expect(body.success).toBe(false);
    });

    it('ensures only one question remains active when a new question is activated', async () => {
      mockSessionUser = {
        id: professorId.toString(),
        email: 'prof@iiit.ac.in',
        name: 'Prof Jawahar',
        role: UserRole.PROFESSOR,
      };

      const q1 = await ClassroomQuestion.create({
        title: 'Question 1',
        questionPrompt: 'Prompt 1',
        maxMarks: 10,
        createdBy: professorId,
        isActive: true,
        status: 'ACTIVE',
      });

      const q2 = await ClassroomAssessmentService.createQuestion(
        {
          title: 'Question 2',
          questionPrompt: 'Prompt 2',
          maxMarks: 10,
          isActive: true,
        },
        { actingUserId: professorId.toString(), actingUserRole: UserRole.PROFESSOR }
      );

      const updatedQ1 = await ClassroomQuestion.findById(q1._id);
      const updatedQ2 = await ClassroomQuestion.findById(q2._id);

      expect(updatedQ1?.isActive).toBe(false);
      expect(updatedQ2?.isActive).toBe(true);
    });
  });

  describe('3. Student Active Question & No-Active-Question Scenarios', () => {
    it('returns null when there is no active question', async () => {
      mockSessionUser = {
        id: studentId.toString(),
        email: 'student@iiit.ac.in',
        name: 'Student One',
        role: UserRole.STUDENT,
      };

      const res = await activeQuestionGET();
      const body = await res.json();
      expect(res.status).toBe(200);
      expect(body.data).toBeNull();
    });

    it('returns the active question when one is published', async () => {
      await ClassroomQuestion.create({
        title: 'Active Live Assessment',
        questionPrompt: 'Show step by step matrix inversion.',
        maxMarks: 10,
        createdBy: professorId,
        isActive: true,
        status: 'ACTIVE',
      });

      mockSessionUser = {
        id: studentId.toString(),
        email: 'student@iiit.ac.in',
        name: 'Student One',
        role: UserRole.STUDENT,
      };

      const res = await activeQuestionGET();
      const body = await res.json();
      expect(res.status).toBe(200);
      expect(body.data).not.toBeNull();
      expect(body.data.title).toBe('Active Live Assessment');
    });
  });

  describe('4. Multimodal Gemini Evaluation Quality & Robustness (Scenarios A - I)', () => {
    // Helper to create an active test question
    async function createTestQuestion(maxMarks = 10) {
      return await ClassroomQuestion.create({
        title: 'Fourier Transform Quiz',
        questionPrompt: 'Find the continuous-time Fourier transform of x(t) = e^(-2t)u(t). Show integration steps.',
        maxMarks,
        rubricCriteria: [
          { criterionName: 'Formula & Integral Setup', points: 4, description: 'Integral from 0 to infinity of e^(-(2+jw)t) dt' },
          { criterionName: 'Integration & Limit Evaluation', points: 4, description: 'Evaluation at upper and lower limits' },
          { criterionName: 'Final Expression', points: 2, description: 'X(jw) = 1 / (2 + jw)' }
        ],
        createdBy: professorId,
        isActive: true,
        status: 'ACTIVE',
      });
    }

    // Helper to create mock submission request
    function createMockSubmitRequest(questionId: string, imageBytes = 'VALID_HANDWRITTEN_IMAGE_BYTES', filename = 'answer.png', mimeType = 'image/png') {
      const buffer = Buffer.from(imageBytes);
      const fakeFile = {
        name: filename,
        type: mimeType,
        arrayBuffer: async () => Uint8Array.from(buffer).buffer,
      };
      const formData = new Map();
      formData.set('questionId', questionId);
      formData.set('file', fakeFile);

      return {
        formData: async () => formData,
        headers: new Headers(),
      } as any;
    }

    it('Scenario A: Correct answer receives high score with criterion-level evidence', async () => {
      const q = await createTestQuestion();
      mockSessionUser = { id: studentId.toString(), email: 'student@iiit.ac.in', name: 'Student One', role: UserRole.STUDENT };

      // Mock Gemini returning full marks with grounded evidence
      classroomEvaluationService.setGeminiCaller(async () => {
        return JSON.stringify({
          criteria: [
            {
              criterion: 'Formula & Integral Setup',
              maxMarks: 4,
              awardedMarks: 4,
              evidence: 'Handwritten integral setup correctly writes integral from 0 to inf of e^(-2t)e^(-jwt)dt = integral e^(-(2+jw)t)dt.'
            },
            {
              criterion: 'Integration & Limit Evaluation',
              maxMarks: 4,
              awardedMarks: 4,
              evidence: 'Correctly antiderivative [-1/(2+jw) * e^(-(2+jw)t)] evaluated from 0 to inf yielding 0 - (-1/(2+jw)).'
            },
            {
              criterion: 'Final Expression',
              maxMarks: 2,
              awardedMarks: 2,
              evidence: 'Boxed final answer clearly states X(jw) = 1 / (2 + jw).'
            }
          ],
          totalMarks: 10,
          maxMarks: 10,
          overallFeedback: 'Flawless handwritten solution with clear algebraic steps and correct final expression.',
          confidence: 0.96
        });
      });

      const res = await submitPOST(createMockSubmitRequest(q._id.toString()));
      const body = await res.json();

      expect(res.status).toBe(201);
      expect(body.success).toBe(true);
      expect(body.data.score).toBe(10);
      expect(body.data.maxMarks).toBe(10);
      expect(body.data.status).toBe('EVALUATED');
      expect(body.data.criterionScores).toHaveLength(3);
      expect(body.data.criterionScores[0].evidence).toContain('integral setup correctly writes');
      expect(body.data.confidence).toBe(0.96);
    });

    it('Scenario B: Partially correct answer receives partial score, NOT automatically full marks', async () => {
      const q = await createTestQuestion();
      mockSessionUser = { id: studentId.toString(), email: 'student@iiit.ac.in', name: 'Student One', role: UserRole.STUDENT };

      // Mock Gemini evaluating student who missed the negative sign in antiderivative
      classroomEvaluationService.setGeminiCaller(async () => {
        return JSON.stringify({
          criteria: [
            {
              criterion: 'Formula & Integral Setup',
              maxMarks: 4,
              awardedMarks: 4,
              evidence: 'Student wrote the correct CTFT definition integral with limits from 0 to infinity.'
            },
            {
              criterion: 'Integration & Limit Evaluation',
              maxMarks: 4,
              awardedMarks: 1.5,
              evidence: 'Sign error during integration step: missed negative sign in the exponent antiderivative factor.'
            },
            {
              criterion: 'Final Expression',
              maxMarks: 2,
              awardedMarks: 0.5,
              evidence: 'Final expression carried forward the sign error, writing -1/(2+jw) instead of 1/(2+jw).'
            }
          ],
          totalMarks: 6,
          maxMarks: 10,
          overallFeedback: 'Good initial setup, but sign error in intermediate calculus reduced score.',
          confidence: 0.90
        });
      });

      const res = await submitPOST(createMockSubmitRequest(q._id.toString()));
      const body = await res.json();

      expect(res.status).toBe(201);
      expect(body.success).toBe(true);
      expect(body.data.score).toBe(6); // 4 + 1.5 + 0.5 = 6.0
      expect(body.data.score).not.toBe(10);
      expect(body.data.criterionScores[1].marksAwarded).toBe(1.5);
      expect(body.data.criterionScores[1].evidence).toContain('Sign error');
    });

    it('Scenario C: Wrong answer receives low / zero score', async () => {
      const q = await createTestQuestion();
      mockSessionUser = { id: studentId.toString(), email: 'student@iiit.ac.in', name: 'Student One', role: UserRole.STUDENT };

      classroomEvaluationService.setGeminiCaller(async () => {
        return JSON.stringify({
          criteria: [
            {
              criterion: 'Formula & Integral Setup',
              maxMarks: 4,
              awardedMarks: 0,
              evidence: 'Student applied Laplace s-domain differentiation theorem instead of CTFT integral.'
            },
            {
              criterion: 'Integration & Limit Evaluation',
              maxMarks: 4,
              awardedMarks: 0,
              evidence: 'No integration was performed.'
            },
            {
              criterion: 'Final Expression',
              maxMarks: 2,
              awardedMarks: 0,
              evidence: 'Incorrect result s/(s+2).'
            }
          ],
          totalMarks: 0,
          maxMarks: 10,
          overallFeedback: 'The submitted answer uses incorrect transform formulas and does not address the required FT integral.',
          confidence: 0.95
        });
      });

      const res = await submitPOST(createMockSubmitRequest(q._id.toString()));
      const body = await res.json();

      expect(res.status).toBe(201);
      expect(body.success).toBe(true);
      expect(body.data.score).toBe(0);
      expect(body.data.feedback).toContain('incorrect transform formulas');
    });

    it('Scenario D: Irrelevant answer receives low / zero score', async () => {
      const q = await createTestQuestion();
      mockSessionUser = { id: studentId.toString(), email: 'student@iiit.ac.in', name: 'Student One', role: UserRole.STUDENT };

      classroomEvaluationService.setGeminiCaller(async () => {
        return JSON.stringify({
          criteria: [
            {
              criterion: 'Formula & Integral Setup',
              maxMarks: 4,
              awardedMarks: 0,
              evidence: 'Submitted image contains a sketch of a tree, completely unrelated to Fourier Transforms.'
            },
            {
              criterion: 'Integration & Limit Evaluation',
              maxMarks: 4,
              awardedMarks: 0,
              evidence: 'No calculations present.'
            },
            {
              criterion: 'Final Expression',
              maxMarks: 2,
              awardedMarks: 0,
              evidence: 'No mathematical expression present.'
            }
          ],
          totalMarks: 0,
          maxMarks: 10,
          overallFeedback: 'Image is completely irrelevant to the assessment question.',
          confidence: 0.99
        });
      });

      const res = await submitPOST(createMockSubmitRequest(q._id.toString()));
      const body = await res.json();

      expect(res.status).toBe(201);
      expect(body.data.score).toBe(0);
      expect(body.data.criterionScores[0].evidence).toContain('unrelated');
    });

    it('Scenario E: Blank / empty answer image receives zero score', async () => {
      const q = await createTestQuestion();
      mockSessionUser = { id: studentId.toString(), email: 'student@iiit.ac.in', name: 'Student One', role: UserRole.STUDENT };

      classroomEvaluationService.setGeminiCaller(async () => {
        return JSON.stringify({
          criteria: [
            {
              criterion: 'Formula & Integral Setup',
              maxMarks: 4,
              awardedMarks: 0,
              evidence: 'Page is completely blank. No handwritten content found.'
            },
            {
              criterion: 'Integration & Limit Evaluation',
              maxMarks: 4,
              awardedMarks: 0,
              evidence: 'Blank page.'
            },
            {
              criterion: 'Final Expression',
              maxMarks: 2,
              awardedMarks: 0,
              evidence: 'Blank page.'
            }
          ],
          totalMarks: 0,
          maxMarks: 10,
          overallFeedback: 'Empty submission. No answer provided.',
          confidence: 1.0
        });
      });

      const res = await submitPOST(createMockSubmitRequest(q._id.toString()));
      const body = await res.json();

      expect(res.status).toBe(201);
      expect(body.data.score).toBe(0);
      expect(body.data.feedback).toContain('Empty submission');
    });

    it('Scenario F: Malformed Gemini response yields controlled evaluation error, NEVER 10/10', async () => {
      const q = await createTestQuestion();
      mockSessionUser = { id: studentId.toString(), email: 'student@iiit.ac.in', name: 'Student One', role: UserRole.STUDENT };

      // Mock Gemini returning broken/malformed non-JSON output
      classroomEvaluationService.setGeminiCaller(async () => {
        return 'SORRY_MODEL_OVERLOADED_ERROR';
      });

      const res = await submitPOST(createMockSubmitRequest(q._id.toString()));
      const body = await res.json();

      expect(res.status).toBe(500);
      expect(body.success).toBe(false);
      expect(body.message).toContain('Evaluation failed');

      // Ensure failed submission is recorded as FAILED and never assigned full score
      const failedSub = await ClassroomSubmission.findOne({ question: q._id, student: studentId });
      expect(failedSub).not.toBeNull();
      expect(failedSub?.status).toBe('FAILED');
      expect(failedSub?.score).toBe(0);
    });

    it('Scenario G: Score exceeding rubric criterion maximum is clamped server-side', async () => {
      const q = await createTestQuestion();
      mockSessionUser = { id: studentId.toString(), email: 'student@iiit.ac.in', name: 'Student One', role: UserRole.STUDENT };

      // Mock Gemini returning 99 marks for a 4-point criterion
      classroomEvaluationService.setGeminiCaller(async () => {
        return JSON.stringify({
          criteria: [
            { criterion: 'Formula & Integral Setup', maxMarks: 4, awardedMarks: 99, evidence: 'Good' },
            { criterion: 'Integration & Limit Evaluation', maxMarks: 4, awardedMarks: 4, evidence: 'Good' },
            { criterion: 'Final Expression', maxMarks: 2, awardedMarks: 2, evidence: 'Good' }
          ],
          totalMarks: 105,
          maxMarks: 10,
          overallFeedback: 'Exceeded points test',
          confidence: 0.9
        });
      });

      const res = await submitPOST(createMockSubmitRequest(q._id.toString()));
      const body = await res.json();

      expect(res.status).toBe(201);
      // Server-side validation clamps criterion 1 from 99 down to target max 4
      expect(body.data.criterionScores[0].marksAwarded).toBe(4);
      expect(body.data.score).toBe(10); // 4 + 4 + 2 = 10
    });

    it('Scenario H: Total score exceeding question maximum is bounded server-side', async () => {
      const q = await createTestQuestion(10);
      mockSessionUser = { id: studentId.toString(), email: 'student@iiit.ac.in', name: 'Student One', role: UserRole.STUDENT };

      classroomEvaluationService.setGeminiCaller(async () => {
        return JSON.stringify({
          criteria: [
            { criterion: 'Formula & Integral Setup', maxMarks: 4, awardedMarks: 4 },
            { criterion: 'Integration & Limit Evaluation', maxMarks: 4, awardedMarks: 4 },
            { criterion: 'Final Expression', maxMarks: 2, awardedMarks: 2 }
          ],
          totalMarks: 50, // Bogus total
          maxMarks: 10,
          overallFeedback: 'Total clamp test',
          confidence: 0.9
        });
      });

      const res = await submitPOST(createMockSubmitRequest(q._id.toString()));
      const body = await res.json();

      expect(res.status).toBe(201);
      expect(body.data.score).toBeLessThanOrEqual(10);
      expect(body.data.score).toBe(10);
    });

    it('Scenario I: Gemini evaluation receives the actual image input and MIME type', async () => {
      const q = await createTestQuestion();
      mockSessionUser = { id: studentId.toString(), email: 'student@iiit.ac.in', name: 'Student One', role: UserRole.STUDENT };

      let capturedPayload: any = null;
      const testImageBytes = 'SPECIFIC_RAW_PNG_PIXEL_DATA_12345';

      classroomEvaluationService.setGeminiCaller(async (payload) => {
        capturedPayload = payload;
        return JSON.stringify({
          criteria: [
            { criterion: 'Formula & Integral Setup', maxMarks: 4, awardedMarks: 3, evidence: 'Saw formula' },
            { criterion: 'Integration & Limit Evaluation', maxMarks: 4, awardedMarks: 3, evidence: 'Saw integration' },
            { criterion: 'Final Expression', maxMarks: 2, awardedMarks: 2, evidence: 'Saw answer' }
          ],
          totalMarks: 8,
          maxMarks: 10,
          overallFeedback: 'Image inspect verify test',
          confidence: 0.9
        });
      });

      const res = await submitPOST(createMockSubmitRequest(q._id.toString(), testImageBytes, 'handwriting.png', 'image/png'));
      expect(res.status).toBe(201);

      expect(capturedPayload).not.toBeNull();
      expect(capturedPayload.imageBase64).toBe(Buffer.from(testImageBytes).toString('base64'));
      expect(capturedPayload.mimeType).toBe('image/png');
      expect(capturedPayload.promptText).toContain('=== ASSESSMENT QUESTION ===');
      expect(capturedPayload.systemInstruction).toContain('CRITICAL EVALUATION RULES:');
    });

    it('rejects submission when no active question exists for the question ID', async () => {
      const inactiveQ = await ClassroomQuestion.create({
        title: 'Closed Question',
        questionPrompt: 'Old question prompt',
        maxMarks: 10,
        createdBy: professorId,
        isActive: false,
        status: 'CLOSED',
      });

      mockSessionUser = { id: studentId.toString(), email: 'student@iiit.ac.in', name: 'Student One', role: UserRole.STUDENT };

      const res = await submitPOST(createMockSubmitRequest(inactiveQ._id.toString()));
      const body = await res.json();
      expect(res.status).toBe(400);
      expect(body.message).toContain('No active classroom assessment question found');
    });

    it('handles invalid file format cleanly (e.g., PDF or text)', async () => {
      const q = await createTestQuestion();
      mockSessionUser = { id: studentId.toString(), email: 'student@iiit.ac.in', name: 'Student One', role: UserRole.STUDENT };

      const res = await submitPOST(createMockSubmitRequest(q._id.toString(), '%PDF-1.4 file', 'doc.pdf', 'application/pdf'));
      const body = await res.json();
      expect(res.status).toBe(400);
      expect(body.message).toContain('Unsupported file format');
    });

    it('handles empty upload cleanly', async () => {
      const q = await createTestQuestion();
      mockSessionUser = { id: studentId.toString(), email: 'student@iiit.ac.in', name: 'Student One', role: UserRole.STUDENT };

      const res = await submitPOST(createMockSubmitRequest(q._id.toString(), '', 'empty.png', 'image/png'));
      const body = await res.json();
      expect(res.status).toBe(400);
      expect(body.message).toContain('empty');
    });

    it('prevents accidental duplicate submissions for an already evaluated question', async () => {
      const q = await createTestQuestion();

      await ClassroomSubmission.create({
        question: q._id,
        student: studentId,
        imagePath: 'classroom_submissions/test.png',
        originalFilename: 'test.png',
        fileSize: 100,
        mimeType: 'image/png',
        status: 'EVALUATED',
        score: 8,
        maxMarks: 10,
        feedback: 'Good job',
        submittedAt: new Date(),
        evaluatedAt: new Date(),
      });

      mockSessionUser = { id: studentId.toString(), email: 'student@iiit.ac.in', name: 'Student One', role: UserRole.STUDENT };

      const res = await submitPOST(createMockSubmitRequest(q._id.toString()));
      const body = await res.json();
      expect(res.status).toBe(409);
      expect(body.message).toContain('already submitted an answer');
    });
  });

  describe('5. Results Viewing & Scoping', () => {
    it('allows professor to retrieve all student submissions for their question', async () => {
      const q = await ClassroomQuestion.create({
        title: 'Professor Question',
        questionPrompt: 'Prompt',
        maxMarks: 10,
        createdBy: professorId,
        isActive: true,
        status: 'ACTIVE',
      });

      await ClassroomSubmission.create({
        question: q._id,
        student: studentId,
        imagePath: 'path1.png',
        originalFilename: 'sub1.png',
        fileSize: 200,
        mimeType: 'image/png',
        status: 'EVALUATED',
        score: 9,
        maxMarks: 10,
        feedback: 'Excellent',
        submittedAt: new Date(),
      });

      mockSessionUser = {
        id: professorId.toString(),
        email: 'prof@iiit.ac.in',
        name: 'Prof Jawahar',
        role: UserRole.PROFESSOR,
      };

      const res = await questionSubmissionsGET({} as any, { params: Promise.resolve({ id: q._id.toString() }) });
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data).toHaveLength(1);
      expect(body.data[0].score).toBe(9);
    });

    it('allows a student to retrieve their own evaluation result', async () => {
      const q = await ClassroomQuestion.create({
        title: 'Student Question',
        questionPrompt: 'Prompt',
        maxMarks: 10,
        createdBy: professorId,
        isActive: true,
        status: 'ACTIVE',
      });

      const sub = await ClassroomSubmission.create({
        question: q._id,
        student: studentId,
        imagePath: 'path1.png',
        originalFilename: 'sub1.png',
        fileSize: 200,
        mimeType: 'image/png',
        status: 'EVALUATED',
        score: 8.5,
        maxMarks: 10,
        feedback: 'Good work',
        submittedAt: new Date(),
      });

      mockSessionUser = {
        id: studentId.toString(),
        email: 'student@iiit.ac.in',
        name: 'Student One',
        role: UserRole.STUDENT,
      };

      const req = {
        url: `http://localhost:3000/api/classroom/submissions?questionId=${q._id.toString()}`,
      } as any;

      const res = await studentSubmissionsGET(req);
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data).toHaveLength(1);
      expect(body.data[0]._id.toString()).toBe(sub._id.toString());
      expect(body.data[0].score).toBe(8.5);

      const qRes = await questionDetailGET({} as any, { params: Promise.resolve({ id: q._id.toString() }) });
      const qBody = await qRes.json();
      expect(qRes.status).toBe(200);
      expect(qBody.data.title).toBe('Student Question');
    });

    it('forbids another student from inspecting a peer students private submission', async () => {
      const q = await ClassroomQuestion.create({
        title: 'Student Question',
        questionPrompt: 'Prompt',
        maxMarks: 10,
        createdBy: professorId,
        isActive: true,
        status: 'ACTIVE',
      });

      const sub = await ClassroomSubmission.create({
        question: q._id,
        student: studentId,
        imagePath: 'path1.png',
        originalFilename: 'sub1.png',
        fileSize: 200,
        mimeType: 'image/png',
        status: 'EVALUATED',
        score: 8.5,
        maxMarks: 10,
        feedback: 'Good work',
        submittedAt: new Date(),
      });

      mockSessionUser = {
        id: otherStudentId.toString(),
        email: 'otherstudent@iiit.ac.in',
        name: 'Student Two',
        role: UserRole.STUDENT,
      };

      const res = await singleSubmissionGET({} as any, { params: Promise.resolve({ id: sub._id.toString() }) });
      const body = await res.json();

      expect(res.status).toBe(403);
      expect(body.message).toContain('Forbidden');
    });
  });
});
