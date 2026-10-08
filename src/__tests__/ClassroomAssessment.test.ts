/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import mongoose from 'mongoose';
import ClassroomQuestion from '../models/ClassroomQuestion';
import ClassroomSubmission from '../models/ClassroomSubmission';
import ClassroomAssessmentService from '../services/ClassroomAssessmentService';
import ClassroomEventService, { ClassroomRealtimeEvent } from '../services/ClassroomEventService';
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

describe('Interactive Mentimeter-Style Classroom Assessment (Research Direction 1)', () => {
  let questionsGET: any;
  let questionsPOST: any;
  let activeQuestionGET: any;
  let questionDetailGET: any;
  let questionDetailPATCH: any;
  let questionDetailDELETE: any;
  let submitPOST: any;
  let resultsGET: any;
  let nextQuestionPOST: any;

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
    questionDetailDELETE = (await import('../app/api/classroom/questions/[id]/route')).DELETE;
    submitPOST = (await import('../app/api/classroom/submit/route')).POST;
    resultsGET = (await import('../app/api/classroom/questions/[id]/results/route')).GET;
    nextQuestionPOST = (await import('../app/api/classroom/questions/next/route')).POST;

    professorId = new mongoose.Types.ObjectId('000000000000000000000301');
    otherProfessorId = new mongoose.Types.ObjectId('000000000000000000000302');
    studentId = new mongoose.Types.ObjectId('000000000000000000000303');
    otherStudentId = new mongoose.Types.ObjectId('000000000000000000000304');
  });

  beforeEach(async () => {
    mockSessionUser = null;
    await ClassroomQuestion.deleteMany({});
    await ClassroomSubmission.deleteMany({});
    ClassroomEventService.reset();
  });

  afterEach(() => {
    ClassroomEventService.reset();
  });

  describe('1. Authentication & Role-Based Access Control', () => {
    it('returns 401 Unauthorized when unauthenticated user queries questions', async () => {
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
          title: 'Cache Policy',
          questionPrompt: 'Which policy updates RAM immediately?',
          type: 'MULTIPLE_CHOICE',
          options: ['Write-through', 'Write-back'],
        }),
        headers: new Headers(),
      } as any;

      const res = await questionsPOST(req);
      const body = await res.json();
      expect(res.status).toBe(403);
      expect(body.message).toContain('Forbidden');
    });

    it('returns 403 Forbidden when Admin accesses classroom questions', async () => {
      mockSessionUser = {
        id: '000000000000000000000399',
        email: 'admin@iiit.ac.in',
        name: 'Admin User',
        role: UserRole.ADMIN,
      };

      const res = await questionsGET();
      const body = await res.json();
      expect(res.status).toBe(403);
      expect(body.message).toContain('Forbidden');
    });

    it('returns 403 Forbidden when professor tries to modify another professors question', async () => {
      const q = await ClassroomQuestion.create({
        title: 'Prof A Question',
        questionPrompt: 'Prompt',
        type: 'MULTIPLE_CHOICE',
        options: ['A', 'B'],
        createdBy: otherProfessorId,
        isActive: false,
        status: 'DRAFT',
      });

      mockSessionUser = {
        id: professorId.toString(),
        email: 'prof1@iiit.ac.in',
        name: 'Professor One',
        role: UserRole.PROFESSOR,
      };

      const req = {
        json: async () => ({ action: 'activate' }),
        headers: new Headers(),
      } as any;

      const res = await questionDetailPATCH(req, { params: Promise.resolve({ id: q._id.toString() }) });
      const body = await res.json();
      expect(res.status).toBe(403);
      expect(body.message).toContain('Forbidden');
    });
  });

  describe('2. Question Creation & Single Active Question Invariant', () => {
    it('creates a multiple choice question with options, correct answer, and explanation', async () => {
      mockSessionUser = {
        id: professorId.toString(),
        email: 'prof@iiit.ac.in',
        name: 'Professor Jawahar',
        role: UserRole.PROFESSOR,
      };

      const req = {
        json: async () => ({
          title: 'Computer Architecture Quiz',
          questionPrompt: 'Which cache write policy guarantees immediate consistency in main memory?',
          type: 'MULTIPLE_CHOICE',
          options: ['Write-through', 'Write-back', 'Write-allocate', 'No-write-allocate'],
          correctOptionIndex: 0,
          explanation: 'Write-through updates both cache and main memory concurrently on every write.',
          isActive: true,
        }),
        headers: new Headers(),
      } as any;

      const res = await questionsPOST(req);
      const body = await res.json();
      expect(res.status).toBe(201);
      expect(body.success).toBe(true);
      expect(body.data.title).toBe('Computer Architecture Quiz');
      expect(body.data.options).toHaveLength(4);
      expect(body.data.correctOptionIndex).toBe(0);
      expect(body.data.isActive).toBe(true);
      expect(body.data.status).toBe('ACTIVE');

      const inDb = await ClassroomQuestion.findById(body.data._id);
      expect(inDb).not.toBeNull();
      expect(inDb?.isActive).toBe(true);
    });

    it('enforces single active question invariant: activating Q2 deactivates Q1', async () => {
      mockSessionUser = {
        id: professorId.toString(),
        email: 'prof@iiit.ac.in',
        name: 'Professor Jawahar',
        role: UserRole.PROFESSOR,
      };

      const q1 = await ClassroomQuestion.create({
        title: 'Question 1',
        questionPrompt: 'Prompt 1',
        type: 'MULTIPLE_CHOICE',
        options: ['A', 'B'],
        createdBy: professorId,
        isActive: true,
        status: 'ACTIVE',
      });

      const q2 = await ClassroomAssessmentService.createQuestion(
        {
          title: 'Question 2',
          questionPrompt: 'Prompt 2',
          type: 'MULTIPLE_CHOICE',
          options: ['C', 'D'],
          isActive: true,
        },
        { actingUserId: professorId.toString(), actingUserRole: UserRole.PROFESSOR }
      );

      const refreshedQ1 = await ClassroomQuestion.findById(q1._id);
      const refreshedQ2 = await ClassroomQuestion.findById(q2._id);

      expect(refreshedQ1?.isActive).toBe(false);
      expect(refreshedQ1?.status).toBe('CLOSED');
      expect(refreshedQ2?.isActive).toBe(true);
      expect(refreshedQ2?.status).toBe('ACTIVE');
    });

    it('retrieves question details by ID for the professor', async () => {
      const q = await ClassroomQuestion.create({
        title: 'Detail Check',
        questionPrompt: 'Detail Prompt',
        type: 'MULTIPLE_CHOICE',
        options: ['X', 'Y'],
        createdBy: professorId,
        isActive: false,
        status: 'DRAFT',
      });

      mockSessionUser = {
        id: professorId.toString(),
        email: 'prof@iiit.ac.in',
        name: 'Professor',
        role: UserRole.PROFESSOR,
      };

      const res = await questionDetailGET({} as any, { params: Promise.resolve({ id: q._id.toString() }) });
      const body = await res.json();
      expect(res.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data.title).toBe('Detail Check');
    });

    it('excludes legacy un-typed or prototype questions from the question deck', async () => {
      mockSessionUser = {
        id: professorId.toString(),
        email: 'prof@iiit.ac.in',
        name: 'Professor Jawahar',
        role: UserRole.PROFESSOR,
      };

      // Legacy question without valid type in DB
      await ClassroomQuestion.collection.insertOne({
        title: 'Legacy Prototype Question',
        questionPrompt: 'Untyped handwritten question',
        createdBy: professorId,
        isActive: false,
        status: 'DRAFT',
      });

      const res = await questionsGET();
      const body = await res.json();
      expect(res.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data).toHaveLength(0);
    });
  });

  describe('3. Student View Sanitization & Real-Time Active Question', () => {
    it('sanitizes answer key and explanation from students while voting is active', async () => {
      const q = await ClassroomQuestion.create({
        title: 'Hidden Answer Question',
        questionPrompt: 'What is 2 + 2?',
        type: 'MULTIPLE_CHOICE',
        options: ['3', '4', '5'],
        correctOptionIndex: 1,
        explanation: 'Basic arithmetic: 2 + 2 = 4.',
        createdBy: professorId,
        isActive: true,
        status: 'ACTIVE',
      });

      // Student checks active question
      mockSessionUser = {
        id: studentId.toString(),
        email: 'student@iiit.ac.in',
        name: 'Student One',
        role: UserRole.STUDENT,
      };

      const res = await activeQuestionGET();
      const body = await res.json();
      expect(res.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data._id).toBe(q._id.toString());
      expect(body.data.questionPrompt).toBe('What is 2 + 2?');
      // Must NOT reveal answer key or explanation to student!
      expect(body.data.correctOptionIndex).toBeUndefined();
      expect(body.data.explanation).toBeUndefined();
      expect(body.data.hasSubmitted).toBe(false);
      expect(body.data.mySubmission).toBeNull();
    });
  });

  describe('4. Student Response Submission & Validation', () => {
    it('submits a student response to an active multiple choice question', async () => {
      const q = await ClassroomQuestion.create({
        title: 'Live Poll',
        questionPrompt: 'What is your favorite topic?',
        type: 'MULTIPLE_CHOICE',
        options: ['Algorithms', 'Systems', 'AI', 'Security'],
        correctOptionIndex: 0,
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

      const req = {
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({
          questionId: q._id.toString(),
          selectedOption: 0,
        }),
      } as any;

      const res = await submitPOST(req);
      const body = await res.json();
      expect(res.status).toBe(201);
      expect(body.success).toBe(true);
      expect(body.data.selectedOption).toBe(0);
      expect(body.data.isCorrect).toBe(true);
      expect(body.data.score).toBe(1);

      // Verify persisted in DB
      const sub = await ClassroomSubmission.findOne({ question: q._id, student: studentId });
      expect(sub).not.toBeNull();
      expect(sub?.selectedOption).toBe(0);
    });

    it('prevents duplicate responses from the same student on the same question (409 Conflict)', async () => {
      const q = await ClassroomQuestion.create({
        title: 'Duplicate Check',
        questionPrompt: 'Select one',
        type: 'MULTIPLE_CHOICE',
        options: ['A', 'B'],
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

      // First submission
      await submitPOST({
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({
          questionId: q._id.toString(),
          selectedOption: 0,
        }),
      } as any);

      // Duplicate submission
      const secondRes = await submitPOST({
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({
          questionId: q._id.toString(),
          selectedOption: 1,
        }),
      } as any);

      const body = await secondRes.json();
      expect(secondRes.status).toBe(409);
      expect(body.message).toContain('already submitted');
    });

    it('rejects responses with 400 when question is closed or voting is locked', async () => {
      const q = await ClassroomQuestion.create({
        title: 'Closed Question',
        questionPrompt: 'Time expired',
        type: 'MULTIPLE_CHOICE',
        options: ['A', 'B'],
        createdBy: professorId,
        isActive: true,
        status: 'CLOSED',
      });

      mockSessionUser = {
        id: studentId.toString(),
        email: 'student@iiit.ac.in',
        name: 'Student One',
        role: UserRole.STUDENT,
      };

      const res = await submitPOST({
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({
          questionId: q._id.toString(),
          selectedOption: 0,
        }),
      } as any);

      const body = await res.json();
      expect(res.status).toBe(400);
      expect(body.message).toContain('No active classroom assessment question found');
    });

    it('rejects responses with invalid option index (out of bounds)', async () => {
      const q = await ClassroomQuestion.create({
        title: 'Bounds Check',
        questionPrompt: 'Pick 0 or 1',
        type: 'MULTIPLE_CHOICE',
        options: ['A', 'B'],
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

      const res = await submitPOST({
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({
          questionId: q._id.toString(),
          selectedOption: 5,
        }),
      } as any);

      const body = await res.json();
      expect(res.status).toBe(400);
      expect(body.message).toContain('Invalid option');
    });
  });

  describe('5. Real-Time Aggregation & Reveal Flow', () => {
    it('aggregates response distribution correctly across multiple student submissions', async () => {
      const q = await ClassroomQuestion.create({
        title: 'Class Distribution',
        questionPrompt: 'Vote for A, B, or C',
        type: 'MULTIPLE_CHOICE',
        options: ['Alpha', 'Beta', 'Gamma'],
        correctOptionIndex: 1,
        createdBy: professorId,
        isActive: true,
        status: 'ACTIVE',
      });

      // Student 1 votes Alpha (0)
      await ClassroomSubmission.create({
        question: q._id,
        student: studentId,
        selectedOption: 0,
        status: 'SUBMITTED',
      });

      // Student 2 votes Beta (1)
      await ClassroomSubmission.create({
        question: q._id,
        student: otherStudentId,
        selectedOption: 1,
        status: 'SUBMITTED',
      });

      mockSessionUser = {
        id: professorId.toString(),
        email: 'prof@iiit.ac.in',
        name: 'Professor',
        role: UserRole.PROFESSOR,
      };

      const res = await resultsGET({} as any, { params: Promise.resolve({ id: q._id.toString() }) });
      const body = await res.json();
      expect(res.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data.totalResponses).toBe(2);
      expect(body.data.options[0].count).toBe(1);
      expect(body.data.options[0].percentage).toBe(50);
      expect(body.data.options[1].count).toBe(1);
      expect(body.data.options[1].percentage).toBe(50);
      expect(body.data.options[2].count).toBe(0);
      expect(body.data.options[2].percentage).toBe(0);
    });

    it('reveals results, correct answer, and explanation to students when professor reveals', async () => {
      const q = await ClassroomQuestion.create({
        title: 'Reveal Test',
        questionPrompt: 'What is O(log N) search?',
        type: 'MULTIPLE_CHOICE',
        options: ['Linear Search', 'Binary Search'],
        correctOptionIndex: 1,
        explanation: 'Binary Search halves the search space each step.',
        createdBy: professorId,
        isActive: true,
        status: 'ACTIVE',
      });

      // Student submits Binary Search (index 1)
      await ClassroomSubmission.create({
        question: q._id,
        student: studentId,
        selectedOption: 1,
        isCorrect: true,
        score: 1,
        status: 'SUBMITTED',
      });

      // Professor reveals question
      mockSessionUser = {
        id: professorId.toString(),
        email: 'prof@iiit.ac.in',
        name: 'Professor',
        role: UserRole.PROFESSOR,
      };

      const patchRes = await questionDetailPATCH(
        {
          json: async () => ({ action: 'reveal' }),
          headers: new Headers(),
        } as any,
        { params: Promise.resolve({ id: q._id.toString() }) }
      );
      expect(patchRes.status).toBe(200);

      // Student fetches active question after reveal
      mockSessionUser = {
        id: studentId.toString(),
        email: 'student@iiit.ac.in',
        name: 'Student One',
        role: UserRole.STUDENT,
      };

      const activeRes = await activeQuestionGET();
      const activeBody = await activeRes.json();
      expect(activeRes.status).toBe(200);
      expect(activeBody.data.status).toBe('REVEALED');
      // Revealed state exposes answer key, explanation, and results
      expect(activeBody.data.correctOptionIndex).toBe(1);
      expect(activeBody.data.explanation).toBe('Binary Search halves the search space each step.');
      expect(activeBody.data.hasSubmitted).toBe(true);
      expect(activeBody.data.mySubmission.isCorrect).toBe(true);
      expect(activeBody.data.results.totalResponses).toBe(1);
    });
  });

  describe('6. Next Question & Deck Progression Flow', () => {
    it('advances to next question, closing previous and activating next', async () => {
      const q1 = await ClassroomQuestion.create({
        title: 'Q1',
        questionPrompt: 'Prompt 1',
        type: 'MULTIPLE_CHOICE',
        options: ['A', 'B'],
        order: 1,
        createdBy: professorId,
        isActive: true,
        status: 'ACTIVE',
      });

      const q2 = await ClassroomQuestion.create({
        title: 'Q2',
        questionPrompt: 'Prompt 2',
        type: 'MULTIPLE_CHOICE',
        options: ['C', 'D'],
        order: 2,
        createdBy: professorId,
        isActive: false,
        status: 'DRAFT',
      });

      mockSessionUser = {
        id: professorId.toString(),
        email: 'prof@iiit.ac.in',
        name: 'Professor',
        role: UserRole.PROFESSOR,
      };

      const req = {
        json: async () => ({ currentQuestionId: q1._id.toString() }),
      } as any;

      const res = await nextQuestionPOST(req);
      const body = await res.json();
      expect(res.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data._id).toBe(q2._id.toString());
      expect(body.data.isActive).toBe(true);
      expect(body.data.status).toBe('ACTIVE');

      const refreshedQ1 = await ClassroomQuestion.findById(q1._id);
      expect(refreshedQ1?.isActive).toBe(false);
      expect(refreshedQ1?.status).toBe('CLOSED');
    });

    it('returns null and cleanly deactivates current question when reaching end of question deck', async () => {
      const q1 = await ClassroomQuestion.create({
        title: 'Last Question',
        questionPrompt: 'Prompt',
        type: 'MULTIPLE_CHOICE',
        options: ['A', 'B'],
        order: 1,
        createdBy: professorId,
        isActive: true,
        status: 'ACTIVE',
      });

      mockSessionUser = {
        id: professorId.toString(),
        email: 'prof@iiit.ac.in',
        name: 'Professor',
        role: UserRole.PROFESSOR,
      };

      const req = {
        json: async () => ({ currentQuestionId: q1._id.toString() }),
      } as any;

      const res = await nextQuestionPOST(req);
      const body = await res.json();
      expect(res.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data).toBeNull();
      expect(body.message).toContain('No more questions');

      const refreshedQ1 = await ClassroomQuestion.findById(q1._id);
      expect(refreshedQ1?.isActive).toBe(false);
      expect(refreshedQ1?.status).toBe('CLOSED');
    });
  });

  describe('7. Realtime Event Bus Dispatch', () => {
    it('dispatches realtime events to listeners on activate, submit, close, and reveal', async () => {
      const eventsReceived: ClassroomRealtimeEvent[] = [];
      const unsubscribe = ClassroomEventService.subscribe((event) => {
        eventsReceived.push(event);
      });

      const q = await ClassroomQuestion.create({
        title: 'Event Test',
        questionPrompt: 'Prompt',
        type: 'MULTIPLE_CHOICE',
        options: ['A', 'B'],
        correctOptionIndex: 0,
        createdBy: professorId,
        isActive: false,
        status: 'DRAFT',
      });

      const context = { actingUserId: professorId.toString(), actingUserRole: UserRole.PROFESSOR };

      // 1. Activate
      await ClassroomAssessmentService.setQuestionStatus(q._id.toString(), 'ACTIVE', context);
      expect(eventsReceived.some((e) => e.type === 'QUESTION_ACTIVATED')).toBe(true);

      // 2. Submit response
      await ClassroomAssessmentService.submitResponse(
        {
          questionId: q._id.toString(),
          studentId: studentId.toString(),
          selectedOption: 0,
        },
        { actingUserId: studentId.toString(), actingUserRole: UserRole.STUDENT }
      );
      expect(eventsReceived.some((e) => e.type === 'RESPONSE_SUBMITTED')).toBe(true);

      // 3. Close
      await ClassroomAssessmentService.setQuestionStatus(q._id.toString(), 'CLOSED', context);
      expect(eventsReceived.some((e) => e.type === 'QUESTION_CLOSED')).toBe(true);

      // 4. Reveal
      await ClassroomAssessmentService.setQuestionStatus(q._id.toString(), 'REVEALED', context);
      expect(eventsReceived.some((e) => e.type === 'QUESTION_REVEALED')).toBe(true);

      unsubscribe();
    });
  });

  describe('8. Question Deletion', () => {
    it('allows professor to delete their question and cascades response deletion', async () => {
      const q = await ClassroomQuestion.create({
        title: 'To Be Deleted',
        questionPrompt: 'Prompt',
        type: 'MULTIPLE_CHOICE',
        options: ['A', 'B'],
        createdBy: professorId,
        isActive: false,
        status: 'DRAFT',
      });

      await ClassroomSubmission.create({
        question: q._id,
        student: studentId,
        selectedOption: 0,
        status: 'SUBMITTED',
      });

      mockSessionUser = {
        id: professorId.toString(),
        email: 'prof@iiit.ac.in',
        name: 'Professor',
        role: UserRole.PROFESSOR,
      };

      const res = await questionDetailDELETE({} as any, { params: Promise.resolve({ id: q._id.toString() }) });
      const body = await res.json();
      expect(res.status).toBe(200);
      expect(body.success).toBe(true);

      expect(await ClassroomQuestion.findById(q._id)).toBeNull();
      expect(await ClassroomSubmission.countDocuments({ question: q._id })).toBe(0);
    });
  });

  describe('9. Completed Session Dashboard & Response History Persistence', () => {
    it('persists questions, aggregated results, and response history after session ends', async () => {
      // 1. Create and activate question
      const q = await ClassroomQuestion.create({
        title: 'Completed Session Question',
        questionPrompt: 'Which sorting algorithm has O(n log n) worst-case time?',
        type: 'MULTIPLE_CHOICE',
        options: ['Quicksort', 'Merge Sort', 'Bubble Sort'],
        correctOptionIndex: 1,
        explanation: 'Merge sort always divides in half and merges in linear time, guaranteeing O(n log n).',
        createdBy: professorId,
        isActive: true,
        status: 'ACTIVE',
      });

      // 2. Student 1 submits
      await ClassroomSubmission.create({
        question: q._id,
        student: studentId,
        selectedOption: 1,
        isCorrect: true,
        status: 'SUBMITTED',
        submittedAt: new Date(),
      });

      // 3. Student 2 submits
      await ClassroomSubmission.create({
        question: q._id,
        student: otherStudentId,
        selectedOption: 0,
        isCorrect: false,
        status: 'SUBMITTED',
        submittedAt: new Date(),
      });

      // 4. Professor ends session (deactivates question)
      const context = { actingUserId: professorId.toString(), actingUserRole: UserRole.PROFESSOR };
      await ClassroomAssessmentService.setQuestionStatus(q._id.toString(), 'DRAFT', context);

      const refreshed = await ClassroomQuestion.findById(q._id);
      expect(refreshed?.isActive).toBe(false);

      // 5. Professor fetches results and response history indefinitely
      mockSessionUser = {
        id: professorId.toString(),
        email: 'prof@iiit.ac.in',
        name: 'Professor Jawahar',
        role: UserRole.PROFESSOR,
      };

      const res = await resultsGET({} as any, { params: Promise.resolve({ id: q._id.toString() }) });
      const body = await res.json();
      expect(res.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data.totalResponses).toBe(2);
      expect(body.data.options).toHaveLength(3);
      expect(body.data.correctOptionIndex).toBe(1);
      expect(body.data.explanation).toContain('Merge sort');
      expect(body.data.responseHistory).toHaveLength(2);
      expect(body.data.responseHistory[0].selectedOption).toBeDefined();
      expect(body.data.responseHistory[0].studentName).toBeDefined();

      // 6. Verify students cannot access response history of other peers
      mockSessionUser = {
        id: studentId.toString(),
        email: 'student@iiit.ac.in',
        name: 'Student One',
        role: UserRole.STUDENT,
      };

      // Mark revealed for testing student view
      await ClassroomQuestion.findByIdAndUpdate(q._id, { isRevealed: true, status: 'REVEALED' });
      const studentRes = await resultsGET({} as any, { params: Promise.resolve({ id: q._id.toString() }) });
      const studentBody = await studentRes.json();
      expect(studentRes.status).toBe(200);
      expect(studentBody.data.responseHistory).toBeUndefined();
    });
  });
});
