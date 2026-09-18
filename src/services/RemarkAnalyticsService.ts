import mongoose from 'mongoose';
import Exam from '../models/Exam';
import AnswerScript from '../models/AnswerScript';
import Grade from '../models/Grade';
import '../models/CommentTag'; // Ensure CommentTag schema is registered for mongoose lookup
import { HttpError } from '../lib/errors';

export interface RemarkTagAnalyticsResult {
  tagId: string;
  label: string;
  count: number;
}

export interface GetTagUsageAnalyticsOptions {
  professorId: string;
  examId?: string;
}

export class RemarkAnalyticsService {
  /**
   * Computes structured remark tag usage counts for exams owned by the authenticated professor.
   *
   * Enforces:
   * - Strict professor data isolation (only exams createdBy the authenticated professor).
   * - Explicit exam ownership validation (HTTP 403 if exam belongs to another professor).
   * - Database-level MongoDB aggregation for performance.
   * - Dynamic label resolution from CommentTag with fallback for deleted tags.
   */
  async getTagUsageAnalytics(
    options: GetTagUsageAnalyticsOptions
  ): Promise<RemarkTagAnalyticsResult[]> {
    const { professorId, examId } = options;

    if (!professorId || !mongoose.Types.ObjectId.isValid(professorId)) {
      throw new HttpError('Invalid professor user ID.', 400);
    }

    let targetExamIds: mongoose.Types.ObjectId[] = [];

    if (examId) {
      if (!mongoose.Types.ObjectId.isValid(examId)) {
        throw new HttpError('Invalid Exam ID format.', 400);
      }

      // Verify exam existence and strict professor ownership
      const exam = await Exam.findOne({
        _id: examId,
        createdBy: professorId,
        isActive: true,
      });

      if (!exam) {
        // Check if exam exists for another user to return accurate 403
        const existsForOther = await Exam.findOne({ _id: examId, isActive: true });
        if (existsForOther) {
          throw new HttpError(
            'Forbidden: Access denied to analytics for exams you do not own.',
            403
          );
        }
        throw new HttpError('Exam not found.', 404);
      }

      targetExamIds = [exam._id as mongoose.Types.ObjectId];
    } else {
      // Find all active exams created by the authenticated professor
      const ownedExamIds = await Exam.find({
        createdBy: professorId,
        isActive: true,
      }).distinct('_id');

      if (!ownedExamIds || ownedExamIds.length === 0) {
        return [];
      }

      targetExamIds = ownedExamIds;
    }

    // Retrieve active answer scripts for the target exams
    const scriptIds = await AnswerScript.find({
      exam: { $in: targetExamIds },
      isActive: true,
    }).distinct('_id');

    if (!scriptIds || scriptIds.length === 0) {
      return [];
    }

    // Aggregate tag references across all matching Grade documents
    const results = await Grade.aggregate([
      {
        $match: {
          answerScript: { $in: scriptIds },
          'tagIds.0': { $exists: true },
        },
      },
      {
        $unwind: '$tagIds',
      },
      {
        $group: {
          _id: '$tagIds',
          count: { $sum: 1 },
        },
      },
      {
        $lookup: {
          from: 'commenttags',
          localField: '_id',
          foreignField: '_id',
          as: 'tagDoc',
        },
      },
      {
        $project: {
          _id: 0,
          tagId: { $toString: '$_id' },
          label: {
            $ifNull: [
              { $arrayElemAt: ['$tagDoc.label', 0] },
              'Unknown Tag',
            ],
          },
          count: 1,
        },
      },
      {
        $sort: {
          count: -1,
          label: 1,
        },
      },
    ]);

    return results;
  }
}

export const remarkAnalyticsService = new RemarkAnalyticsService();
export default remarkAnalyticsService;
