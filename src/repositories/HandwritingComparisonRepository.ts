import mongoose, { QueryFilter } from 'mongoose';
import HandwritingComparisonModel, { IHandwritingComparisonDocument } from '../models/HandwritingComparison';
import { ComparisonMatchState } from '../models/HandwritingConsistency';

export interface FindComparisonsOptions {
    limit?: number;
    status?: ComparisonMatchState;
}

export class HandwritingComparisonRepository {
    private isValidObjectId(id: string): boolean {
        return !!id && mongoose.Types.ObjectId.isValid(id) && id.length === 24;
    }

    /**
     * Persists an immutable handwriting comparison record.
     */
    async create(
        data: Partial<IHandwritingComparisonDocument>,
        session?: mongoose.ClientSession
    ): Promise<IHandwritingComparisonDocument> {
        const comparison = new HandwritingComparisonModel(data);
        return await comparison.save({ session });
    }

    /**
     * Finds a comparison by ID, optionally verified against studentId.
     */
    async findById(
        comparisonId: string,
        studentId?: string
    ): Promise<IHandwritingComparisonDocument | null> {
        if (!this.isValidObjectId(comparisonId)) {
            return null;
        }

        const query: QueryFilter<IHandwritingComparisonDocument> = {
            _id: new mongoose.Types.ObjectId(comparisonId)
        };

        if (studentId) {
            if (!this.isValidObjectId(studentId)) {
                return null;
            }
            query.student = new mongoose.Types.ObjectId(studentId);
        }

        return await HandwritingComparisonModel.findOne(query);
    }

    /**
     * Finds all comparisons for a given student, sorted newest first.
     */
    async findByStudent(
        studentId: string,
        options?: FindComparisonsOptions
    ): Promise<IHandwritingComparisonDocument[]> {
        if (!this.isValidObjectId(studentId)) {
            return [];
        }

        const query: QueryFilter<IHandwritingComparisonDocument> = {
            student: new mongoose.Types.ObjectId(studentId)
        };

        if (options?.status) {
            query.status = options.status;
        }

        let q = HandwritingComparisonModel.find(query).sort({ comparedAt: -1 });

        if (options?.limit && options.limit > 0) {
            q = q.limit(options.limit);
        }

        return await q.exec();
    }

    /**
     * Finds comparisons associated with a specific sample ID, optionally student-scoped.
     */
    async findBySample(
        sampleId: string,
        studentId?: string
    ): Promise<IHandwritingComparisonDocument[]> {
        if (!this.isValidObjectId(sampleId)) {
            return [];
        }

        const query: QueryFilter<IHandwritingComparisonDocument> = {
            sample: new mongoose.Types.ObjectId(sampleId)
        };

        if (studentId) {
            if (!this.isValidObjectId(studentId)) {
                return [];
            }
            query.student = new mongoose.Types.ObjectId(studentId);
        }

        return await HandwritingComparisonModel.find(query).sort({ comparedAt: -1 });
    }
}

export const handwritingComparisonRepository = new HandwritingComparisonRepository();
export default handwritingComparisonRepository;
