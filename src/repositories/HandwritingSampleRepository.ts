import mongoose, { QueryFilter } from 'mongoose';
import HandwritingSampleModel, { IHandwritingSampleDocument } from '../models/HandwritingSample';

export interface FindSamplesOptions {
    usableOnly?: boolean;
    limit?: number;
    sortOrder?: 'asc' | 'desc';
    includeExpired?: boolean;
}

export class HandwritingSampleRepository {
    private isValidObjectId(id: string): boolean {
        return !!id && mongoose.Types.ObjectId.isValid(id) && id.length === 24;
    }

    /**
     * Persists a new handwriting sample document.
     */
    async create(
        data: Partial<IHandwritingSampleDocument>,
        session?: mongoose.ClientSession
    ): Promise<IHandwritingSampleDocument> {
        const sample = new HandwritingSampleModel(data);
        return await sample.save({ session });
    }

    /**
     * Finds a sample by ID, optionally scoped to a specific student for security.
     * By default, excludes expired samples unless includeExpired is true.
     */
    async findById(
        sampleId: string,
        studentId?: string,
        options?: { includeExpired?: boolean }
    ): Promise<IHandwritingSampleDocument | null> {
        if (!this.isValidObjectId(sampleId)) {
            return null;
        }

        const query: QueryFilter<IHandwritingSampleDocument> = {
            _id: new mongoose.Types.ObjectId(sampleId)
        };

        if (studentId) {
            if (!this.isValidObjectId(studentId)) {
                return null;
            }
            query.student = new mongoose.Types.ObjectId(studentId);
        }

        if (!options?.includeExpired) {
            const now = new Date();
            query.$or = [
                { retentionExpiresAt: { $exists: false } },
                { retentionExpiresAt: { $gt: now } }
            ];
        }

        return await HandwritingSampleModel.findOne(query);
    }

    /**
     * Finds samples for a student, filtered by usability, ordered,
     * and excluding expired samples by default.
     */
    async findByStudent(
        studentId: string,
        options?: FindSamplesOptions
    ): Promise<IHandwritingSampleDocument[]> {
        if (!this.isValidObjectId(studentId)) {
            return [];
        }

        const query: QueryFilter<IHandwritingSampleDocument> = {
            student: new mongoose.Types.ObjectId(studentId)
        };

        if (options?.usableOnly) {
            query.isUsable = true;
        }

        if (!options?.includeExpired) {
            const now = new Date();
            query.$or = [
                { retentionExpiresAt: { $exists: false } },
                { retentionExpiresAt: { $gt: now } }
            ];
        }

        const sortDirection = options?.sortOrder === 'desc' ? -1 : 1;
        let q = HandwritingSampleModel.find(query).sort({ createdAt: sortDirection });

        if (options?.limit && options.limit > 0) {
            q = q.limit(options.limit);
        }

        return await q.exec();
    }

    /**
     * Counts the total number of usable, non-expired baseline samples for a student.
     */
    async countUsableSamples(studentId: string, options?: { includeExpired?: boolean }): Promise<number> {
        if (!this.isValidObjectId(studentId)) {
            return 0;
        }

        const query: QueryFilter<IHandwritingSampleDocument> = {
            student: new mongoose.Types.ObjectId(studentId),
            isUsable: true
        };

        if (!options?.includeExpired) {
            const now = new Date();
            query.$or = [
                { retentionExpiresAt: { $exists: false } },
                { retentionExpiresAt: { $gt: now } }
            ];
        }

        return await HandwritingSampleModel.countDocuments(query);
    }

    /**
     * Finds an existing sample by its unique source reference for a student.
     * Prevents duplicate sample ingestion.
     */
    async findBySourceReference(
        studentId: string,
        sourceReference: string
    ): Promise<IHandwritingSampleDocument | null> {
        if (!this.isValidObjectId(studentId) || !sourceReference) {
            return null;
        }

        return await HandwritingSampleModel.findOne({
            student: new mongoose.Types.ObjectId(studentId),
            sourceReference: sourceReference.trim()
        });
    }

    /**
     * In-architecture purge of expired samples for a student or globally.
     */
    async purgeExpired(studentId?: string): Promise<number> {
        const now = new Date();
        const query: QueryFilter<IHandwritingSampleDocument> = {
            retentionExpiresAt: { $lte: now }
        };
        if (studentId && this.isValidObjectId(studentId)) {
            query.student = new mongoose.Types.ObjectId(studentId);
        }
        const res = await HandwritingSampleModel.deleteMany(query);
        return res.deletedCount || 0;
    }
}

export const handwritingSampleRepository = new HandwritingSampleRepository();
export default handwritingSampleRepository;
