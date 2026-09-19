/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach, afterEach, beforeAll, vi } from 'vitest';
import mongoose from 'mongoose';
import Course from '../models/Course';
import Exam from '../models/Exam';
import Rubric from '../models/Rubric';
import AnswerScript from '../models/AnswerScript';
import Allocation, { AllocationStatus } from '../models/Allocation';
import Grade from '../models/Grade';
import CommentTag, { TagScope } from '../models/CommentTag';
import AuditLog from '../models/AuditLog';
import gradingService from '../services/GradingService';
import { HttpError } from '../lib/errors';
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

describe('AE-145: Save Grade (Service & API)', () => {
  let gradesPOST: any;
  let questionGradePOST: any;

  let professorId: mongoose.Types.ObjectId;
  let taId: mongoose.Types.ObjectId;
  let otherTaId: mongoose.Types.ObjectId;
  let studentId: mongoose.Types.ObjectId;
  let examId: mongoose.Types.ObjectId;
  let courseId: mongoose.Types.ObjectId;
  let scriptId: mongoose.Types.ObjectId;
  let rubricId: mongoose.Types.ObjectId;

  beforeAll(async () => {
    gradesPOST = (await import('../app/api/scripts/[id]/grades/route')).POST;
    questionGradePOST = (await import('../app/api/scripts/[id]/questions/[questionNumber]/grade/route')).POST;
  });

  beforeEach(async () => {
    professorId = new mongoose.Types.ObjectId('000000000000000000000201');
    taId = new mongoose.Types.ObjectId('000000000000000000000202');
    otherTaId = new mongoose.Types.ObjectId('000000000000000000000203');
    studentId = new mongoose.Types.ObjectId('000000000000000000000204');

    // 1. Create Course
    const course = new Course({
      courseCode: 'CS401',
      courseName: 'Algorithms Design',
      semester: 1,
      academicYear: '2026-2027',
      professor: professorId,
      teachingAssistants: [taId, otherTaId],
      enrolledStudents: [studentId],
      isActive: true,
    });
    const savedCourse = await course.save();
    courseId = savedCourse._id as mongoose.Types.ObjectId;

    // 2. Create Exam
    const exam = new Exam({
      title: 'Midterm Exam',
      course: courseId,
      createdBy: professorId,
      examDate: new Date('2026-10-15T09:00:00.000Z'),
      totalMarks: 100,
      numberOfQuestions: 2,
      status: 'PUBLISHED',
      isActive: true,
    });
    const savedExam = await exam.save();
    examId = savedExam._id as mongoose.Types.ObjectId;

    // 3. Create Rubric
    const rubric = new Rubric({
      exam: examId,
      createdBy: professorId,
      questions: [
        {
          questionNumber: 1,
          maxMarks: 10,
          criteria: [
            { criterionName: 'Correctness', description: 'Logic correctness', points: 6 },
            { criterionName: 'Complexity', description: 'Optimal time bound', points: 4 },
          ],
        },
        {
          questionNumber: 2,
          maxMarks: 15,
          criteria: [
            { criterionName: 'Derivation', description: 'Step-by-step induction', points: 10 },
            { criterionName: 'Clarity', description: 'Clean presentation', points: 5 },
          ],
        },
      ],
      isActive: true,
    });
    const savedRubric = await rubric.save();
    rubricId = savedRubric._id as mongoose.Types.ObjectId;

    // 4. Create AnswerScript
    const script = new AnswerScript({
      exam: examId,
      student: studentId,
      status: 'INGESTED',
      pageCount: 3,
      pages: [],
      isActive: true,
    });
    const savedScript = await script.save();
    scriptId = savedScript._id as mongoose.Types.ObjectId;

    // 5. Create Allocation: TA is assigned to Question 1 (PENDING)
    const alloc = new Allocation({
      exam: examId,
      answerScript: scriptId,
      ta: taId,
      allocatedBy: professorId,
      question: 1,
      status: AllocationStatus.PENDING,
    });
    await alloc.save();
  });

  afterEach(async () => {
    await Course.deleteMany({});
    await Exam.deleteMany({});
    await Rubric.deleteMany({});
    await AnswerScript.deleteMany({});
    await Allocation.deleteMany({});
    await Grade.deleteMany({});
    await CommentTag.deleteMany({});
    await AuditLog.deleteMany({});
    mockSessionUser = null;
  });

  // 1. Authorized TA can save allocated question
  it('1. allows authorized TA to save Grade for allocated question and persists authoritative totalScore', async () => {
    const marksAwarded = [
      { criterionName: 'Correctness', score: 5, feedback: 'Almost complete' },
      { criterionName: 'Complexity', score: 3 },
    ];

    const saved = await gradingService.saveGrade({
      scriptId: scriptId.toString(),
      question: 1,
      marksAwarded,
      feedback: 'Good attempt',
      userId: taId.toString(),
      userRole: UserRole.TA,
    });

    expect(saved).toBeDefined();
    expect(saved.answerScript.toString()).toBe(scriptId.toString());
    expect(saved.rubric.toString()).toBe(rubricId.toString());
    expect(saved.gradedBy.toString()).toBe(taId.toString());
    expect(saved.question).toBe(1);
    expect(saved.totalScore).toBe(8); // 5 + 3 = 8
    expect(saved.feedback).toBe('Good attempt');
    expect(saved.isFinal).toBe(false);
    expect(saved.marksAwarded).toHaveLength(2);
  });

  // 2. Unauthorized/non-allocated question is rejected
  it('2. rejects TA attempting to grade a question they are not allocated to', async () => {
    const marksAwarded = [
      { criterionName: 'Derivation', score: 8 },
      { criterionName: 'Clarity', score: 4 },
    ];

    // TA is allocated to Q1, but tries to grade Q2
    await expect(
      gradingService.saveGrade({
        scriptId: scriptId.toString(),
        question: 2, // Q2 is not allocated to this TA!
        marksAwarded,
        userId: taId.toString(),
        userRole: UserRole.TA,
      })
    ).rejects.toThrow(HttpError);

    // Other TA (not allocated at all) tries to grade Q1
    await expect(
      gradingService.saveGrade({
        scriptId: scriptId.toString(),
        question: 1,
        marksAwarded: [{ criterionName: 'Correctness', score: 5 }],
        userId: otherTaId.toString(),
        userRole: UserRole.TA,
      })
    ).rejects.toThrow(HttpError);
  });

  // 3. No rubric returns 409
  it('3. returns HTTP 409 when no active rubric exists for the exam', async () => {
    // Delete the active rubric
    await Rubric.deleteMany({});

    await expect(
      gradingService.saveGrade({
        scriptId: scriptId.toString(),
        question: 1,
        marksAwarded: [{ criterionName: 'Correctness', score: 5 }],
        userId: taId.toString(),
        userRole: UserRole.TA,
      })
    ).rejects.toThrow('No active rubric configured for this exam');

    try {
      await gradingService.saveGrade({
        scriptId: scriptId.toString(),
        question: 1,
        marksAwarded: [{ criterionName: 'Correctness', score: 5 }],
        userId: taId.toString(),
        userRole: UserRole.TA,
      });
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(HttpError);
      if (err instanceof HttpError) {
        expect(err.statusCode).toBe(409);
      }
    }
  });

  // 4. Invalid criterion score rejected
  it('4. rejects invalid criterion scores: negative, exceeding max points, non-numeric, or exceeding question maxMarks', async () => {
    // Negative score
    await expect(
      gradingService.saveGrade({
        scriptId: scriptId.toString(),
        question: 1,
        marksAwarded: [{ criterionName: 'Correctness', score: -2 }],
        userId: taId.toString(),
        userRole: UserRole.TA,
      })
    ).rejects.toThrow('cannot be negative');

    // Score exceeding criterion max points (6)
    await expect(
      gradingService.saveGrade({
        scriptId: scriptId.toString(),
        question: 1,
        marksAwarded: [{ criterionName: 'Correctness', score: 8 }],
        userId: taId.toString(),
        userRole: UserRole.TA,
      })
    ).rejects.toThrow('exceeds maximum allowed points of 6');

    // Non-existent criterion
    await expect(
      gradingService.saveGrade({
        scriptId: scriptId.toString(),
        question: 1,
        marksAwarded: [{ criterionName: 'BogusCriterion', score: 2 }],
        userId: taId.toString(),
        userRole: UserRole.TA,
      })
    ).rejects.toThrow('does not exist in Question 1 rubric');
  });

  // 5. Client-provided totalScore is ignored/recomputed
  it('5. ignores client-provided totalScore and recomputes authoritative sum from criterion scores', async () => {
    const marksAwarded = [
      { criterionName: 'Correctness', score: 4 },
      { criterionName: 'Complexity', score: 3 },
    ];

    const saved = await gradingService.saveGrade({
      scriptId: scriptId.toString(),
      question: 1,
      marksAwarded,
      userId: taId.toString(),
      userRole: UserRole.TA,
      clientTotalScore: 9999, // Malicious spoofed client total
    });

    expect(saved.totalScore).toBe(7); // Authoritatively 4 + 3 = 7
  });

  // 6. Existing Grade can be updated
  it('6. updates existing Grade document in-place on subsequent saves', async () => {
    // First save
    const firstSave = await gradingService.saveGrade({
      scriptId: scriptId.toString(),
      question: 1,
      marksAwarded: [
        { criterionName: 'Correctness', score: 3 },
        { criterionName: 'Complexity', score: 2 },
      ],
      feedback: 'Initial evaluation',
      userId: taId.toString(),
      userRole: UserRole.TA,
    });
    expect(firstSave.totalScore).toBe(5);

    // Second save / update
    const updated = await gradingService.saveGrade({
      scriptId: scriptId.toString(),
      question: 1,
      marksAwarded: [
        { criterionName: 'Correctness', score: 6 },
        { criterionName: 'Complexity', score: 4 },
      ],
      feedback: 'Revised after reconsideration',
      userId: taId.toString(),
      userRole: UserRole.TA,
    });

    expect(updated._id.toString()).toBe(firstSave._id.toString());
    expect(updated.totalScore).toBe(10);
    expect(updated.feedback).toBe('Revised after reconsideration');

    // Verify only one Grade document exists in database
    const totalGrades = await Grade.countDocuments({ answerScript: scriptId, question: 1 });
    expect(totalGrades).toBe(1);
  });

  // 7. Completed allocation cannot be graded
  it('7. rejects grading when the allocation is already COMPLETED', async () => {
    // Set allocation to COMPLETED
    await Allocation.findOneAndUpdate(
      { answerScript: scriptId, ta: taId, question: 1 },
      { $set: { status: AllocationStatus.COMPLETED } }
    );

    await expect(
      gradingService.saveGrade({
        scriptId: scriptId.toString(),
        question: 1,
        marksAwarded: [{ criterionName: 'Correctness', score: 5 }],
        userId: taId.toString(),
        userRole: UserRole.TA,
      })
    ).rejects.toThrow('Cannot grade script: Allocation has already been marked as COMPLETED.');
  });

  // 8. Final Grade cannot be edited
  it('8. rejects edits when existing Grade has isFinal=true', async () => {
    // Create finalized grade
    const finalizedGrade = new Grade({
      answerScript: scriptId,
      rubric: rubricId,
      gradedBy: taId,
      question: 1,
      marksAwarded: [{ criterionName: 'Correctness', score: 5 }],
      totalScore: 5,
      isFinal: true,
    });
    await finalizedGrade.save();

    await expect(
      gradingService.saveGrade({
        scriptId: scriptId.toString(),
        question: 1,
        marksAwarded: [{ criterionName: 'Correctness', score: 6 }],
        userId: taId.toString(),
        userRole: UserRole.TA,
      })
    ).rejects.toThrow('Cannot edit grade: This grade has been finalized and cannot be modified.');
  });

  // 9. Successful save creates an audit entry
  it('9. creates an audit log entry on every successful grade write', async () => {
    const saved = await gradingService.saveGrade({
      scriptId: scriptId.toString(),
      question: 1,
      marksAwarded: [
        { criterionName: 'Correctness', score: 5 },
        { criterionName: 'Complexity', score: 3 },
      ],
      userId: taId.toString(),
      userRole: UserRole.TA,
    });

    const logs = await AuditLog.find({ entityId: saved._id, entityType: 'Grade' });
    expect(logs).toHaveLength(1);
    expect(logs[0].action).toBe('GRADE_SAVED');
    expect(logs[0].outcome).toBe('SUCCESS');
    expect(logs[0].user.toString()).toBe(taId.toString());
    expect(logs[0].details).toMatchObject({
      question: 1,
      totalScore: 8,
      marksAwardedCount: 2,
    });
  });

  // 10. First successful save claims the allocation
  it('10. transitions allocation from PENDING to IN_PROGRESS on the first successful grade save', async () => {
    const initialAlloc = await Allocation.findOne({ answerScript: scriptId, ta: taId, question: 1 });
    expect(initialAlloc?.status).toBe(AllocationStatus.PENDING);

    await gradingService.saveGrade({
      scriptId: scriptId.toString(),
      question: 1,
      marksAwarded: [{ criterionName: 'Correctness', score: 4 }],
      userId: taId.toString(),
      userRole: UserRole.TA,
    });

    const updatedAlloc = await Allocation.findOne({ answerScript: scriptId, ta: taId, question: 1 });
    expect(updatedAlloc?.status).toBe(AllocationStatus.IN_PROGRESS);
    expect(updatedAlloc?.claimedAt).toBeDefined();
  });

  // 11. API Route integration tests: POST /api/scripts/[id]/grades
  it('11. POST /api/scripts/[id]/grades returns 200 with saved Grade data for authenticated and allocated TA', async () => {
    mockSessionUser = {
      id: taId.toString(),
      name: 'TA User',
      email: 'ta@example.com',
      role: UserRole.TA,
    };

    const req = new Request(`http://localhost:3000/api/scripts/${scriptId}/grades`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        question: 1,
        marksAwarded: [
          { criterionName: 'Correctness', score: 5.5 },
          { criterionName: 'Complexity', score: 3.5 },
        ],
        feedback: 'API integration test',
        clientTotalScore: 100, // Should be ignored
      }),
    });

    const res = await gradesPOST(req, { params: Promise.resolve({ id: scriptId.toString() }) });
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.totalScore).toBe(9); // 5.5 + 3.5 = 9
    expect(json.data.question).toBe(1);
  });

  // 12. API Route integration tests: POST /api/scripts/[id]/questions/[questionNumber]/grade
  it('12. POST /api/scripts/[id]/questions/[questionNumber]/grade handles question-scoped saves', async () => {
    mockSessionUser = {
      id: taId.toString(),
      name: 'TA User',
      email: 'ta@example.com',
      role: UserRole.TA,
    };

    const req = new Request(`http://localhost:3000/api/scripts/${scriptId}/questions/1/grade`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        marksAwarded: [
          { criterionName: 'Correctness', score: 6 },
          { criterionName: 'Complexity', score: 2 },
        ],
        feedback: 'Question-scoped endpoint save',
      }),
    });

    const res = await questionGradePOST(req, {
      params: Promise.resolve({ id: scriptId.toString(), questionNumber: '1' }),
    });
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.totalScore).toBe(8);
  });

  // 13. API Route returns 401 when unauthenticated
  it('13. returns 401 when unauthenticated', async () => {
    mockSessionUser = null;

    const req = new Request(`http://localhost:3000/api/scripts/${scriptId}/grades`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        question: 1,
        marksAwarded: [{ criterionName: 'Correctness', score: 5 }],
      }),
    });

    const res = await gradesPOST(req, { params: Promise.resolve({ id: scriptId.toString() }) });
    expect(res.status).toBe(401);
  });

  // 14. API Route returns 403 when TA grades unallocated question
  it('14. returns 403 when TA tries to grade unallocated question via API', async () => {
    mockSessionUser = {
      id: taId.toString(),
      name: 'TA User',
      email: 'ta@example.com',
      role: UserRole.TA,
    };

    const req = new Request(`http://localhost:3000/api/scripts/${scriptId}/grades`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        question: 2, // TA is only allocated to Q1!
        marksAwarded: [{ criterionName: 'Derivation', score: 5 }],
      }),
    });

    const res = await gradesPOST(req, { params: Promise.resolve({ id: scriptId.toString() }) });
    expect(res.status).toBe(403);
  });

  // 15. Stale draft update after finalization returns 409
  it('15. rejects stale draft save with 409 if grade has already been finalized', async () => {
    const initialGrade = await Grade.create({
      answerScript: scriptId,
      rubric: rubricId,
      gradedBy: taId,
      question: 1,
      marksAwarded: [
        { criterionName: 'Correctness', score: 4 },
        { criterionName: 'Complexity', score: 2 },
      ],
      totalScore: 6,
      feedback: 'Initial draft feedback',
      isFinal: false,
    });

    // Final save completes
    await Grade.updateOne(
      { _id: initialGrade._id },
      {
        $set: {
          marksAwarded: [
            { criterionName: 'Correctness', score: 6 },
            { criterionName: 'Complexity', score: 4 },
          ],
          totalScore: 10,
          feedback: 'Final approved feedback',
          isFinal: true,
        },
      }
    );

    // Stale draft save attempts to write
    await expect(
      gradingService.saveGrade({
        scriptId: scriptId.toString(),
        question: 1,
        marksAwarded: [
          { criterionName: 'Correctness', score: 1 },
          { criterionName: 'Complexity', score: 1 },
        ],
        feedback: 'Stale debounced draft that should be rejected',
        userId: taId.toString(),
        userRole: UserRole.TA,
      })
    ).rejects.toThrow(HttpError);

    const checkGrade = await Grade.findById(initialGrade._id);
    expect(checkGrade).toBeDefined();
    expect(checkGrade?.isFinal).toBe(true);
    expect(checkGrade?.totalScore).toBe(10);
    expect(checkGrade?.feedback).toBe('Final approved feedback');
    expect(checkGrade?.marksAwarded[0].score).toBe(6);
    expect(checkGrade?.marksAwarded[1].score).toBe(4);
  });

  // 16. Concurrency / race condition test: in-flight draft cannot overwrite concurrently finalized Grade
  it('16. prevents in-flight draft save from overwriting a Grade that became finalized concurrently', async () => {
    const initialGrade = await Grade.create({
      answerScript: scriptId,
      rubric: rubricId,
      gradedBy: taId,
      question: 1,
      marksAwarded: [
        { criterionName: 'Correctness', score: 4 },
        { criterionName: 'Complexity', score: 2 },
      ],
      totalScore: 6,
      feedback: 'Draft in progress',
      isFinal: false,
    });

    // Simulate in-flight draft save: hook into Grade.findOne so that right after findOne reads non-final grade,
    // a concurrent final submission commits and finalizes the grade before draft atomic update executes.
    const originalFindOne = Grade.findOne.bind(Grade);
    let raceTriggered = false;
    vi.spyOn(Grade as any, 'findOne').mockImplementation(function (...args: any[]) {
      const query = (originalFindOne as any)(...args);
      const originalThen = query.then ? query.then.bind(query) : null;

      if (originalThen) {
        query.then = async (onfulfilled: any) => {
          const result = await originalThen();
          if (!raceTriggered && result && result._id.toString() === initialGrade._id.toString()) {
            raceTriggered = true;
            // Concurrent final save commits now:
            await Grade.updateOne(
              { _id: initialGrade._id },
              {
                $set: {
                  marksAwarded: [
                    { criterionName: 'Correctness', score: 6 },
                    { criterionName: 'Complexity', score: 4 },
                  ],
                  totalScore: 10,
                  feedback: 'Final approved submission',
                  isFinal: true,
                },
              }
            );
          }
          return onfulfilled ? onfulfilled(result) : result;
        };
      }
      return query;
    });

    // Draft save proceeds but should fail with 409 because conditional update matched 0 documents
    await expect(
      gradingService.saveGrade({
        scriptId: scriptId.toString(),
        question: 1,
        marksAwarded: [
          { criterionName: 'Correctness', score: 1 },
          { criterionName: 'Complexity', score: 1 },
        ],
        feedback: 'Stale draft overwrite attempt',
        userId: taId.toString(),
        userRole: UserRole.TA,
      })
    ).rejects.toThrowError(/Cannot modify grade: Grade has already been finalized/i);

    // Verify Grade state in DB: remains finalized with final marks, score, and feedback
    const persistedGrade = await Grade.findById(initialGrade._id);
    expect(persistedGrade?.isFinal).toBe(true);
    expect(persistedGrade?.totalScore).toBe(10);
    expect(persistedGrade?.feedback).toBe('Final approved submission');
    expect(persistedGrade?.marksAwarded[0].score).toBe(6);
    expect(persistedGrade?.marksAwarded[1].score).toBe(4);

    vi.restoreAllMocks();
  });

  // 17. Question maxMarks validation: sum of criteria exceeds question.maxMarks
  it('17. rejects grade when sum of criterion scores exceeds question.maxMarks even if individual criteria are valid', async () => {
    // Update question 1 maxMarks in rubric to 8 (criteria points are 6 and 4)
    await Rubric.updateOne(
      { _id: rubricId, 'questions.questionNumber': 1 },
      { $set: { 'questions.$.maxMarks': 8 } }
    );

    // Submit 5 (<= 6) and 4 (<= 4), sum = 9 > 8
    await expect(
      gradingService.saveGrade({
        scriptId: scriptId.toString(),
        question: 1,
        marksAwarded: [
          { criterionName: 'Correctness', score: 5 },
          { criterionName: 'Complexity', score: 4 },
        ],
        userId: taId.toString(),
        userRole: UserRole.TA,
      })
    ).rejects.toThrow('Computed question total (9) exceeds maximum marks of 8 for Question 1.');
  });

  // 18. Decimal precision handling
  it('18. accurately computes decimal criterion scores without floating-point precision issues', async () => {
    const saved = await gradingService.saveGrade({
      scriptId: scriptId.toString(),
      question: 1,
      marksAwarded: [
        { criterionName: 'Correctness', score: 5.5 },
        { criterionName: 'Complexity', score: 3.5 },
      ],
      userId: taId.toString(),
      userRole: UserRole.TA,
    });

    expect(saved.totalScore).toBe(9);

    // Verify precision rounding on arbitrary decimal sums in computeAuthoritativeTotal
    const precisionTotal = gradingService.computeAuthoritativeTotal([
      { criterionName: 'Correctness', score: 4.25 },
      { criterionName: 'Complexity', score: 2.15 },
    ]);
    expect(precisionTotal).toBe(6.4);
  });

  // 19. No persisted script-level total fields
  it('19. verifies no persisted script-level total field is created on Grade documents', async () => {
    const savedGrade = await gradingService.saveGrade({
      scriptId: scriptId.toString(),
      question: 1,
      marksAwarded: [
        { criterionName: 'Correctness', score: 6 },
        { criterionName: 'Complexity', score: 4 },
      ],
      userId: taId.toString(),
      userRole: UserRole.TA,
    });

    const gradeObject = savedGrade.toObject();

    expect(gradeObject).toHaveProperty('totalScore', 10);
    expect(gradeObject).toHaveProperty('question', 1);
    expect(gradeObject).not.toHaveProperty('scriptTotal');
    expect(gradeObject).not.toHaveProperty('scriptTotalScore');
    expect(gradeObject).not.toHaveProperty('wholeScriptTotal');
    expect(gradeObject).not.toHaveProperty('overallScore');
  });

  // 20. Invalid rubric question rejection
  it('20. rejects grade save for question number not present in the rubric', async () => {
    await expect(
      gradingService.saveGrade({
        scriptId: scriptId.toString(),
        question: 99,
        marksAwarded: [{ criterionName: 'Correctness', score: 5 }],
        userId: professorId.toString(),
        userRole: UserRole.PROFESSOR,
      })
    ).rejects.toThrow('Question 99 not found in rubric.');
  });

  // 21. Saving a preset tag persists its CommentTag ObjectId in Grade.tagIds
  it('21. allows saving preset tag and persists its CommentTag ObjectId in Grade.tagIds', async () => {
    const globalTag = await CommentTag.create({
      label: 'Good explanation.',
      scope: TagScope.GLOBAL,
      createdBy: professorId,
    });

    const saved = await gradingService.saveGrade({
      scriptId: scriptId.toString(),
      question: 1,
      marksAwarded: [{ criterionName: 'Correctness', score: 6 }],
      feedback: 'Good explanation.',
      tagIds: [globalTag._id.toString()],
      userId: taId.toString(),
      userRole: UserRole.TA,
    });

    expect(saved.tagIds).toBeDefined();
    expect(saved.tagIds).toHaveLength(1);
    expect(saved.tagIds![0].toString()).toBe(globalTag._id.toString());

    // Verify in DB directly
    const dbGrade = await Grade.findById(saved._id);
    expect(dbGrade?.tagIds).toHaveLength(1);
    expect(dbGrade?.tagIds![0].toString()).toBe(globalTag._id.toString());
  });

  // 22. Multiple different tags persist multiple IDs
  it('22. allows persisting multiple different preset tags as ObjectIds', async () => {
    const tag1 = await CommentTag.create({
      label: 'Clear steps',
      scope: TagScope.GLOBAL,
      createdBy: professorId,
    });
    const tag2 = await CommentTag.create({
      label: 'Accurate derivation',
      scope: TagScope.EXAM,
      exam: examId,
      createdBy: professorId,
    });

    const saved = await gradingService.saveGrade({
      scriptId: scriptId.toString(),
      question: 1,
      marksAwarded: [{ criterionName: 'Correctness', score: 6 }],
      feedback: 'Clear steps. Accurate derivation.',
      tagIds: [tag1._id.toString(), tag2._id.toString()],
      userId: taId.toString(),
      userRole: UserRole.TA,
    });

    expect(saved.tagIds).toHaveLength(2);
    expect(saved.tagIds!.map((id) => id.toString())).toContain(tag1._id.toString());
    expect(saved.tagIds!.map((id) => id.toString())).toContain(tag2._id.toString());
  });

  // 23. Same tag cannot be persisted twice (deduplicates on save)
  it('23. deduplicates same tag ID if passed multiple times in tagIds', async () => {
    const tag = await CommentTag.create({
      label: 'Unique tag',
      scope: TagScope.GLOBAL,
      createdBy: professorId,
    });

    const saved = await gradingService.saveGrade({
      scriptId: scriptId.toString(),
      question: 1,
      marksAwarded: [{ criterionName: 'Correctness', score: 5 }],
      tagIds: [tag._id.toString(), tag._id.toString(), tag._id],
      userId: taId.toString(),
      userRole: UserRole.TA,
    });

    expect(saved.tagIds).toHaveLength(1);
    expect(saved.tagIds![0].toString()).toBe(tag._id.toString());
  });

  // 24. Existing custom feedback remains intact when tag is saved
  it('24. preserves existing custom feedback intact when saving tagIds', async () => {
    const tag = await CommentTag.create({
      label: 'Optimal Solution',
      scope: TagScope.GLOBAL,
      createdBy: professorId,
    });

    const customFeedback = 'The student demonstrated exceptional grasp of dynamic programming. Optimal Solution';

    const saved = await gradingService.saveGrade({
      scriptId: scriptId.toString(),
      question: 1,
      marksAwarded: [{ criterionName: 'Correctness', score: 6 }],
      feedback: customFeedback,
      tagIds: [tag._id.toString()],
      userId: taId.toString(),
      userRole: UserRole.TA,
    });

    expect(saved.feedback).toBe(customFeedback);
    expect(saved.tagIds).toHaveLength(1);
  });

  // 25. Invalid tag ID is rejected server-side
  it('25. rejects invalid tag ID format or non-existent tag ID with 400', async () => {
    // 1. Invalid ObjectId format
    await expect(
      gradingService.saveGrade({
        scriptId: scriptId.toString(),
        question: 1,
        marksAwarded: [{ criterionName: 'Correctness', score: 6 }],
        tagIds: ['invalid-not-an-id'],
        userId: taId.toString(),
        userRole: UserRole.TA,
      })
    ).rejects.toThrow(HttpError);

    // 2. Non-existent ObjectId
    const fakeId = new mongoose.Types.ObjectId();
    await expect(
      gradingService.saveGrade({
        scriptId: scriptId.toString(),
        question: 1,
        marksAwarded: [{ criterionName: 'Correctness', score: 6 }],
        tagIds: [fakeId.toString()],
        userId: taId.toString(),
        userRole: UserRole.TA,
      })
    ).rejects.toThrow(HttpError);
  });

  // 26. Tag from another professor's exam is rejected
  it('26. rejects EXAM tag belonging to a different exam with 403', async () => {
    const otherExamId = new mongoose.Types.ObjectId();
    const otherExamTag = await CommentTag.create({
      label: 'Other Exam Special Tag',
      scope: TagScope.EXAM,
      exam: otherExamId,
      createdBy: new mongoose.Types.ObjectId(),
    });

    await expect(
      gradingService.saveGrade({
        scriptId: scriptId.toString(),
        question: 1,
        marksAwarded: [{ criterionName: 'Correctness', score: 6 }],
        tagIds: [otherExamTag._id.toString()],
        userId: taId.toString(),
        userRole: UserRole.TA,
      })
    ).rejects.toThrow('Forbidden: Comment tag belongs to a different exam and cannot be attached.');
  });

  // 27. EXAM tag for current exam is accepted
  it('27. accepts EXAM tag for current exam', async () => {
    const examTag = await CommentTag.create({
      label: 'Exam Specific Remark',
      scope: TagScope.EXAM,
      exam: examId,
      createdBy: professorId,
    });

    const saved = await gradingService.saveGrade({
      scriptId: scriptId.toString(),
      question: 1,
      marksAwarded: [{ criterionName: 'Correctness', score: 6 }],
      tagIds: [examTag._id.toString()],
      userId: taId.toString(),
      userRole: UserRole.TA,
    });

    expect(saved.tagIds).toHaveLength(1);
    expect(saved.tagIds![0].toString()).toBe(examTag._id.toString());
  });

  // 28. GLOBAL tag is accepted
  it('28. accepts GLOBAL tag for any exam', async () => {
    const globalTag = await CommentTag.create({
      label: 'Universal Tag',
      scope: TagScope.GLOBAL,
      createdBy: new mongoose.Types.ObjectId(),
    });

    const saved = await gradingService.saveGrade({
      scriptId: scriptId.toString(),
      question: 1,
      marksAwarded: [{ criterionName: 'Correctness', score: 6 }],
      tagIds: [globalTag._id.toString()],
      userId: taId.toString(),
      userRole: UserRole.TA,
    });

    expect(saved.tagIds).toHaveLength(1);
    expect(saved.tagIds![0].toString()).toBe(globalTag._id.toString());
  });

  // 29. Existing Grade.tagIds are not accidentally erased by an ordinary feedback/grade update
  it('29. preserves existing Grade.tagIds when update request omits tagIds', async () => {
    const tag = await CommentTag.create({
      label: 'Persisted tag',
      scope: TagScope.GLOBAL,
      createdBy: professorId,
    });

    // Initial save with tagIds
    const firstSave = await gradingService.saveGrade({
      scriptId: scriptId.toString(),
      question: 1,
      marksAwarded: [{ criterionName: 'Correctness', score: 5 }],
      feedback: 'Initial feedback',
      tagIds: [tag._id.toString()],
      userId: taId.toString(),
      userRole: UserRole.TA,
    });
    expect(firstSave.tagIds).toHaveLength(1);

    // Second update modifying only score and feedback without passing tagIds (tagIds is undefined)
    const secondSave = await gradingService.saveGrade({
      scriptId: scriptId.toString(),
      question: 1,
      marksAwarded: [{ criterionName: 'Correctness', score: 6 }],
      feedback: 'Updated feedback',
      userId: taId.toString(),
      userRole: UserRole.TA,
    });

    expect(secondSave.totalScore).toBe(6);
    expect(secondSave.feedback).toBe('Updated feedback');
    expect(secondSave.tagIds).toHaveLength(1);
    expect(secondSave.tagIds![0].toString()).toBe(tag._id.toString());
  });

  // 30. API endpoint POST /api/scripts/[id]/questions/[questionNumber]/grade accepts and persists tagIds
  it('30. POST /api/scripts/[id]/questions/[questionNumber]/grade accepts and persists tagIds', async () => {
    mockSessionUser = {
      id: taId.toString(),
      name: 'TA User',
      email: 'ta@example.com',
      role: UserRole.TA,
    };

    const tag = await CommentTag.create({
      label: 'API Tag Test',
      scope: TagScope.GLOBAL,
      createdBy: professorId,
    });

    const req = new Request(`http://localhost:3000/api/scripts/${scriptId}/questions/1/grade`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        marksAwarded: [
          { criterionName: 'Correctness', score: 6 },
          { criterionName: 'Complexity', score: 4 },
        ],
        feedback: 'API Tag Test feedback',
        tagIds: [tag._id.toString()],
      }),
    });

    const res = await questionGradePOST(req, {
      params: Promise.resolve({ id: scriptId.toString(), questionNumber: '1' }),
    });
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.tagIds).toBeDefined();
    expect(json.data.tagIds).toHaveLength(1);
    expect(json.data.tagIds[0].toString()).toBe(tag._id.toString());
  });
});
