import { describe, it, beforeEach, vi } from 'vitest';
import mongoose from 'mongoose';
import User, { UserRole, IUser } from '../models/User';
import Course from '../models/Course';
import Exam, { ExamStatus } from '../models/Exam';
import AnswerScript from '../models/AnswerScript';
import Allocation, { AllocationStatus, AllocationRule } from '../models/Allocation';
import IngestionPage from '../models/IngestionPage';
import Page from '../models/Page';
import Grade from '../models/Grade';
import Rubric from '../models/Rubric';
import { AnnotationPersistenceService } from '../services/AnnotationPersistenceService';
import gradingService from '../services/GradingService';
import AllocationService from '../services/AllocationService';

vi.mock('../lib/apiAuth', () => ({
  requireGradingOrAnnotationAccess: vi.fn(),
}));

describe('AE-177 Backend Response-Time Budget Benchmark', () => {
  let taUser: IUser;
  let profUser: IUser;
  let course: mongoose.Document & { _id: mongoose.Types.ObjectId };
  let exam: mongoose.Document & { _id: mongoose.Types.ObjectId };
  let rubric: mongoose.Document & {
    _id: mongoose.Types.ObjectId;
    questions: {
      questionNumber: number;
      maxMarks: number;
      criteria: {
        criterionName: string;
        description?: string;
        points: number;
      }[];
    }[];
  };
  let scripts: Array<mongoose.Document & { _id: mongoose.Types.ObjectId }> = [];
  let allocations: Array<mongoose.Document & { _id: mongoose.Types.ObjectId }> = [];
  let firstScriptId: string;
  let firstPageId: string;
  let annotationService: AnnotationPersistenceService;

  beforeEach(async () => {
    // 1. Setup DB
    await User.init();
    await Course.init();
    await Exam.init();
    await AnswerScript.init();
    await Allocation.init();
    await IngestionPage.init();
    await Page.init();
    await Grade.init();
    await Rubric.init();

    await User.deleteMany({});
    await Course.deleteMany({});
    await Exam.deleteMany({});
    await AnswerScript.deleteMany({});
    await Allocation.deleteMany({});
    await IngestionPage.deleteMany({});
    await Grade.deleteMany({});
    await Rubric.deleteMany({});

    profUser = await User.create({
      name: 'Professor',
      email: 'prof@example.com',
      password: 'pwd',
      role: UserRole.PROFESSOR,
      isActive: true,
    });

    taUser = await User.create({
      name: 'TA',
      email: 'ta@example.com',
      password: 'pwd',
      role: UserRole.TA,
      isActive: true,
    });

    course = await Course.create({
      courseCode: 'CS101',
      courseName: 'CS',
      semester: 1,
      academicYear: '2026',
      professor: profUser._id,
      teachingAssistants: [taUser._id],
      isActive: true,
    });

    exam = await Exam.create({
      title: 'Benchmark Exam',
      course: course._id,
      createdBy: profUser._id,
      examDate: new Date(),
      totalMarks: 100,
      status: ExamStatus.PUBLISHED,
      numberOfQuestions: 10,
      isActive: true,
    });

    const rubricQuestions = Array.from({ length: 10 }, (_, i) => ({
      questionNumber: i + 1,
      maxMarks: 10,
      criteria: [{ criterionName: 'dummy', points: 10 }],
    }));

    rubric = await Rubric.create({
      exam: exam._id,
      createdBy: profUser._id,
      isActive: true,
      questions: rubricQuestions,
    });

    // 2. Generate 200 scripts, 20 pages each, 10 grades each
    const scriptDocs = [];
    const pageDocs = [];
    const allocDocs = [];
    const gradeDocs: Record<string, unknown>[] = [];

    for (let i = 0; i < 200; i++) {
      const scriptId = new mongoose.Types.ObjectId();

      scriptDocs.push({
        _id: scriptId,
        exam: exam._id,
        anonymizedId: `SCRIPT_${i}`,
        isActive: true,
      });

      allocDocs.push({
        _id: new mongoose.Types.ObjectId(),
        exam: exam._id,
        ta: taUser._id,
        answerScript: scriptId,
        allocatedBy: profUser._id,
        rule: AllocationRule.EQUAL,
        status: AllocationStatus.IN_PROGRESS,
      });

      for (let p = 1; p <= 20; p++) {
        const pageId = new mongoose.Types.ObjectId();

        if (i === 0 && p === 1) {
          firstPageId = pageId.toString();
        }

        pageDocs.push({
          _id: pageId,
          batchId: new mongoose.Types.ObjectId(),
          answerScript: scriptId,
          pageNumber: p,
          fileIndex: p,
          width: 800,
          height: 1100,
          storageKey: `dummy/storage/${p}.jpg`,
          fileId: new mongoose.Types.ObjectId(),
          job: new mongoose.Types.ObjectId(),
          metadata: {
            annotations: {
              annotations: [],
              strokes: [],
              version: 1,
            },
          },
        });
      }

      for (let q = 1; q <= 10; q++) {
        gradeDocs.push({
          answerScript: scriptId,
          rubric: rubric._id,
          question: q,
          totalScore: 10,
          marksAwarded: [{ criterionName: 'dummy', score: 10 }],
          gradedBy: taUser._id,
          isFinal: i > 5,
        });
      }
    }

    await AnswerScript.insertMany(scriptDocs);
    await IngestionPage.insertMany(pageDocs);
    await Allocation.insertMany(allocDocs);
    await Grade.insertMany(gradeDocs);

    scripts = await AnswerScript.find().lean();
    allocations = await Allocation.find().lean();
    firstScriptId = scripts[0]._id.toString();

    const { requireGradingOrAnnotationAccess } = await import('../lib/apiAuth');

    vi.mocked(requireGradingOrAnnotationAccess).mockResolvedValue({
      authorized: true,
      response: null,
      user: {
        id: taUser._id.toString(),
        email: taUser.email,
        name: taUser.name,
        role: UserRole.TA,
      },
    });

    annotationService = new AnnotationPersistenceService();
  }, 30000);

  const runBenchmark = async (
    name: string,
    fn: () => Promise<void>,
    iterations: number
  ) => {
    // Warm up
    await fn();
    await fn();

    // Reset query count
    let dbOps = 0;

    mongoose.set('debug', () => {
      dbOps++;
    });

    const latencies: number[] = [];

    try {
      for (let i = 0; i < iterations; i++) {
        const start = performance.now();
        await fn();
        latencies.push(performance.now() - start);
      }
    } finally {
      mongoose.set('debug', false);
    }

    latencies.sort((a, b) => a - b);

    const p50 = latencies[Math.floor(latencies.length * 0.5)];
    const p95 = latencies[Math.floor(latencies.length * 0.95)];
    const max = latencies[latencies.length - 1];

    console.log(`[Benchmark] ${name}`);
    console.log(`  p50: ${p50.toFixed(2)} ms`);
    console.log(`  p95: ${p95.toFixed(2)} ms`);
    console.log(`  max: ${max.toFixed(2)} ms`);
    console.log(`  Avg DB ops per call: ${(dbOps / iterations).toFixed(1)}`);
  };

  it('Runs all benchmarks', async () => {
    await runBenchmark(
      'GET Script (20 pages)',
      async () => {
        // Direct DB operations that mimic GET /scripts/[id]
        await AnswerScript.findOne({
          _id: firstScriptId,
          isActive: true,
        });

        await Allocation.findOne({
          answerScript: firstScriptId,
        });

        const ingestionPages = await IngestionPage.find({
          answerScript: firstScriptId,
        }).sort({
          fileIndex: 1,
          pageNumber: 1,
        });

        if (ingestionPages.length === 0) {
          await Page.find({
            answerScript: firstScriptId,
            isActive: true,
          }).sort({
            pageNumber: 1,
          });
        }
      },
      100
    );

    await runBenchmark(
      'saveGrade',
      async () => {
        await gradingService.saveGrade({
          scriptId: firstScriptId,
          question: 1,
          marksAwarded: [{ criterionName: 'dummy', score: 5 }],
          userId: taUser._id.toString(),
          userRole: UserRole.TA,
          clientTotalScore: 5,
          isFinal: false,
        });
      },
      100
    );

    let lastUpdatedAt: string | undefined;

    await runBenchmark(
      'Annotation Autosave',
      async () => {
        const currentUpdateAt =
          lastUpdatedAt ||
          (await IngestionPage.findById(firstPageId))?.updatedAt?.toISOString() ||
          new Date().toISOString();

        const res = await annotationService.savePageAnnotations({
          scriptId: firstScriptId,
          pageIdentifier: firstPageId,
          payload: {
            annotations: [],
            strokes: [],
            version: 1,
          },
          userId: taUser._id.toString(),
          userRole: UserRole.TA,
          baseUpdatedAt: currentUpdateAt,
        });

        lastUpdatedAt = res.updatedAt;
      },
      100
    );

    let scriptIdx = 10;

    await runBenchmark(
      'Script Submit',
      async () => {
        const sId = scripts[scriptIdx]._id.toString();

        await gradingService.submitScript({
          scriptId: sId,
          userId: taUser._id.toString(),
          userRole: UserRole.TA,
        });

        scriptIdx++;
      },
      50
    );

    // Ensure exam createdBy matches
    await Exam.updateOne(
      { _id: exam._id },
      { $set: { createdBy: profUser._id } }
    );

    await runBenchmark(
      'Bulk Submit (50 items)',
      async () => {
        await gradingService.bulkSubmit({
          examId: exam._id.toString(),
          userId: taUser._id.toString(),
          userRole: UserRole.TA,
          confirmed: true,
          limit: 50,
        });
      },
      2
    );

    await runBenchmark(
      'Image GET',
      async () => {
        await IngestionPage.findById(firstPageId);
      },
      100
    );

    await runBenchmark(
      'getNextAllocation',
      async () => {
        await AllocationService.getNextAllocation(
          taUser._id.toString(),
          exam._id,
          allocations[0]._id
        );
      },
      100
    );
  });
});