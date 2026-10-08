import { NextRequest, NextResponse } from 'next/server';
import mongoose from 'mongoose';
import { connectDB } from '../../../../../lib/db';
import { requirePermission } from '../../../../../lib/apiAuth';
import { Permission } from '../../../../../constants/permissions';
import { HttpError } from '../../../../../lib/errors';
import IngestionApprovalService from '../../../../../services/IngestionApprovalService';
import AllocationService from '../../../../../services/AllocationService';
import Allocation, { AllocationRule, AllocationStatus } from '../../../../../models/Allocation';
import Exam from '../../../../../models/Exam';
import Course from '../../../../../models/Course';
import AnswerScript from '../../../../../models/AnswerScript';
import Grade from '../../../../../models/Grade';
import ExamRepository from '../../../../../repositories/ExamRepository';

/**
 * POST /api/exams/[id]/allocate
 *
 * Grading/allocation gate for AE-074.
 * Enforces that ingestion must be APPROVED before any grading or allocation
 * can begin for the exam. Returns 403 if not approved.
 *
 * Validates request payload and triggers re-run prepare contract (AE-082).
 */
export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requirePermission(Permission.ALLOCATE_SCRIPTS);
  if (!auth.authorized) {
    return auth.response;
  }

  const { id } = await context.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return NextResponse.json({
      success: false,
      message: 'Invalid ID format',
      data: null
    }, { status: 400 });
  }

  try {
    await connectDB();

    const exam = await ExamRepository.getExamById(id, auth.user.id, auth.user.role);
    if (!exam) {
      return NextResponse.json({ success: false, message: 'Exam not found', data: null }, { status: 404 });
    }

    // AE-074 gate: exam ingestion must be APPROVED before grading/allocation
    await IngestionApprovalService.requireApproved(id);

    // Parse options from request body
    let rule: AllocationRule;
    let taIds: string[] | undefined;
    let seed: unknown;
    try {
      const body = await req.json();
      if (!body) {
        return NextResponse.json({
          success: false,
          message: 'Request body is required',
          data: null
        }, { status: 400 });
      }
      rule = body.rule;
      taIds = body.taIds;
      seed = body.seed;
    } catch {
      return NextResponse.json({
        success: false,
        message: 'Invalid JSON payload or empty request body',
        data: null
      }, { status: 400 });
    }

    if (!rule) {
      return NextResponse.json({
        success: false,
        message: 'Allocation rule is required',
        data: null
      }, { status: 400 });
    }

    // Validate the rule
    if (!Object.values(AllocationRule).includes(rule)) {
      return NextResponse.json({
        success: false,
        message: `Invalid allocation rule: ${rule}`,
        data: null
      }, { status: 400 });
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let resultData: any = { examId: id, rule };

    if (!taIds || !Array.isArray(taIds) || taIds.length === 0) {
      return NextResponse.json({
        success: false,
        message: `At least one selected TA must be provided for ${rule.toLowerCase()} allocation`,
        data: null
      }, { status: 400 });
    }

    // Check if user is authenticated (should be, as checked by requirePermission)
    const actingUserId = auth.user?.id || '';

    if (rule === AllocationRule.EQUAL) {
      const createdAllocations = await AllocationService.allocateEqual(id, taIds, actingUserId);
      resultData = createdAllocations;
    } else if (rule === AllocationRule.QUESTION) {
      const createdAllocations = await AllocationService.allocateByQuestion(id, taIds, actingUserId);
      resultData = createdAllocations;
    } else {
      // rule === AllocationRule.RANDOM
      if (
        seed === undefined ||
        seed === null ||
        typeof seed !== 'number' ||
        !Number.isFinite(seed) ||
        !Number.isInteger(seed)
      ) {
        return NextResponse.json({
          success: false,
          message: 'Invalid seed: seed must be a finite integer number',
          data: null
        }, { status: 400 });
      }
      const createdAllocations = await AllocationService.allocateRandom(id, taIds, actingUserId, seed);
      resultData = createdAllocations;
    }


    return NextResponse.json({
      success: true,
      message: 'Allocation completed successfully',
      data: resultData
    }, { status: 200 });

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'An unexpected error occurred';
    const status = error instanceof HttpError ? error.statusCode : 500;
    return NextResponse.json({
      success: false,
      message,
      data: null
    }, { status });
  }
}

/**
 * GET /api/exams/[id]/allocate
 *
 * Retrieves the exam details (status, questions) and its course TAs
 * to configure allocation rules.
 */
export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requirePermission(Permission.ALLOCATE_SCRIPTS);
  if (!auth.authorized) {
    return auth.response;
  }

  const { id } = await context.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return NextResponse.json({
      success: false,
      message: 'Invalid ID format',
      data: null
    }, { status: 400 });
  }

  try {
    await connectDB();

    const authorizedExam = await ExamRepository.getExamById(id, auth.user.id, auth.user.role);
    if (!authorizedExam) {
      return NextResponse.json({ success: false, message: 'Exam not found', data: null }, { status: 404 });
    }

    const exam = await Exam.findOne({ _id: id, isActive: true }).lean();
    if (!exam) {
      return NextResponse.json({
        success: false,
        message: 'Exam not found',
        data: null
      }, { status: 404 });
    }

    // Force register User model for population reference safety
    const course = await Course.findOne({ _id: exam.course, isActive: true })
      .populate('teachingAssistants', 'name email role isActive')
      .lean();

    if (!course) {
      return NextResponse.json({
        success: false,
        message: 'Course not found for this exam',
        data: null
      }, { status: 404 });
    }

    // Query allocation status from MongoDB (source of truth)
    const existingAllocations = await Allocation.find({ exam: new mongoose.Types.ObjectId(id) })
      .select('ta status rule createdAt')
      .lean();

    const allocationCount = existingAllocations.length;
    const isAllocated = allocationCount > 0;
    const allocatedTaIds = [...new Set(existingAllocations.map(a => a.ta.toString()))];
    const allocatedTaCount = allocatedTaIds.length;

    // Determine the allocation rule (all allocations for an exam share the same rule)
    const allocationRule = isAllocated ? (existingAllocations[0].rule || null) : null;

    // Latest allocation timestamp
    const latestAllocationTime = isAllocated
      ? existingAllocations.reduce((latest, a) => {
          const t = new Date(a.createdAt).getTime();
          return t > latest ? t : latest;
        }, 0)
      : null;

    // Check if grading has commenced (any allocation not PENDING, or any Grade exists)
    const hasGradingCommenced = existingAllocations.some(
      a => a.status !== AllocationStatus.PENDING
    );
    let hasGrades = false;
    if (isAllocated && !hasGradingCommenced) {
      const scriptIds = await AnswerScript.find({ exam: new mongoose.Types.ObjectId(id) })
        .select('_id')
        .lean();
      if (scriptIds.length > 0) {
        hasGrades = !!(await Grade.findOne({ answerScript: { $in: scriptIds.map(s => s._id) } })
          .select('_id')
          .lean());
      }
    }

    return NextResponse.json({
      success: true,
      message: 'Allocation settings retrieved successfully',
      data: {
        exam: {
          _id: exam._id.toString(),
          title: exam.title,
          numberOfQuestions: exam.numberOfQuestions,
          ingestionApprovalStatus: exam.ingestionApprovalStatus
        },
        teachingAssistants: course.teachingAssistants || [],
        allocationStatus: {
          isAllocated,
          allocationCount,
          allocatedTaCount,
          allocationRule,
          latestAllocationTime: latestAllocationTime ? new Date(latestAllocationTime).toISOString() : null,
          hasGradingCommenced: hasGradingCommenced || hasGrades,
          allocatedTaIds
        }
      }
    }, { status: 200 });

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'An unexpected error occurred';
    const status = error instanceof HttpError ? error.statusCode : 500;
    return NextResponse.json({
      success: false,
      message,
      data: null
    }, { status });
  }
}
