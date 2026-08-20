import Batch, { IBatch, IBatchFile } from '../models/Batch';
import IngestionJob, { IIngestionJob, IngestionStatus } from '../models/IngestionJob';
import mongoose, { QueryFilter } from 'mongoose';
import { SYSTEM_ROLE } from '../constants/permissions';

class BatchRepository {
    async createBatch(data: Partial<IBatch>): Promise<IBatch> {
        const batch = new Batch(data);
        return await batch.save();
    }

    async createIngestionJob(data: Partial<IIngestionJob>): Promise<IIngestionJob> {
        const job = new IngestionJob(data);
        return await job.save();
    }

    private buildBatchQuery(id: string, actingUserId?: string, actingUserRole?: string): QueryFilter<IBatch> | null {
        if (!actingUserId || !actingUserRole) {
            return null;
        }

        const isObjectId = mongoose.Types.ObjectId.isValid(id) && id.length === 24;
        const idFilter = isObjectId
            ? { $or: [{ _id: new mongoose.Types.ObjectId(id) }, { batchId: id }] }
            : { batchId: id };

        const baseQuery: QueryFilter<IBatch> = {
            ...idFilter,
            isActive: true
        };

        if (actingUserRole === 'ADMIN' || actingUserRole === SYSTEM_ROLE) {
            return baseQuery;
        }

        if (actingUserRole === 'PROFESSOR') {
            if (!mongoose.Types.ObjectId.isValid(actingUserId)) {
                return null;
            }
            baseQuery.uploadedBy = new mongoose.Types.ObjectId(actingUserId);
            return baseQuery;
        }

        // Deny-by-default for any other role (TA, STUDENT, or unknown)
        return null;
    }

    async getBatchById(id: string, actingUserId?: string, actingUserRole?: string): Promise<IBatch | null> {
        const query = this.buildBatchQuery(id, actingUserId, actingUserRole);
        if (!query) {
            return null;
        }
        return await Batch.findOne(query);
    }

    async getBatches(actingUserId?: string, actingUserRole?: string): Promise<IBatch[]> {
        if (!actingUserId || !actingUserRole) {
            return [];
        }

        const baseQuery: QueryFilter<IBatch> = {
            isActive: true
        };

        if (actingUserRole === 'ADMIN' || actingUserRole === SYSTEM_ROLE) {
            // unrestricted
        } else if (actingUserRole === 'PROFESSOR') {
            if (!mongoose.Types.ObjectId.isValid(actingUserId)) {
                return [];
            }
            baseQuery.uploadedBy = new mongoose.Types.ObjectId(actingUserId);
        } else {
            return [];
        }

        return await Batch.find(baseQuery).populate('exam').sort({ createdAt: -1 });
    }

    async updateBatch(id: string, data: Partial<IBatch>, actingUserId?: string, actingUserRole?: string): Promise<IBatch | null> {
        const query = this.buildBatchQuery(id, actingUserId, actingUserRole);
        if (!query) {
            return null;
        }
        return await Batch.findOneAndUpdate(
            query,
            data,
            { new: true, runValidators: true }
        );
    }

    async getIngestionJobByBatchId(batchId: string, actingUserId?: string, actingUserRole?: string): Promise<IIngestionJob | null> {
        // Enforce batch access before returning ingestion job
        const batch = await this.getBatchById(batchId, actingUserId, actingUserRole);
        if (!batch) {
            return null;
        }
        return await IngestionJob.findOne({ batchId: batch.batchId });
    }

    async updateIngestionJob(
        batchId: string,
        data: Partial<IIngestionJob>,
        actingUserId?: string,
        actingUserRole?: string
    ): Promise<IIngestionJob | null> {
        const batch = await this.getBatchById(batchId, actingUserId, actingUserRole);
        if (!batch) {
            return null;
        }
        return await IngestionJob.findOneAndUpdate(
            { batchId: batch.batchId },
            data,
            { new: true, runValidators: true }
        );
    }

    async getBatchByStorageKey(
        storageKey: string,
        actingUserId?: string,
        actingUserRole?: string
    ): Promise<{ batch: IBatch; file: IBatchFile } | null> {
        if (!actingUserId || !actingUserRole) {
            return null;
        }

        const baseQuery: QueryFilter<IBatch> = {
            'files.storageKey': storageKey,
            isActive: true
        };

        if (actingUserRole === 'ADMIN') {
            // Unrestricted for Admin
        } else if (actingUserRole === 'PROFESSOR') {
            if (!mongoose.Types.ObjectId.isValid(actingUserId)) {
                return null;
            }
            baseQuery.uploadedBy = new mongoose.Types.ObjectId(actingUserId);
        } else {
            // Deny-by-default for STUDENT, TA, or unknown roles
            return null;
        }

        const batch = await Batch.findOne(baseQuery);
        if (!batch) {
            return null;
        }

        const file = batch.files.find(f => f.storageKey === storageKey);
        if (!file) {
            return null;
        }

        return { batch, file };
    }

    /**
     * Atomically claims one queued (or stale processing) ingestion job using MongoDB findOneAndUpdate.
     * Prevents concurrent workers from claiming the same job.
     */
    async claimNextQueuedJob(
        workerId: string,
        staleTimeoutMs = 60000
    ): Promise<IIngestionJob | null> {
        const now = new Date();
        const staleThreshold = new Date(now.getTime() - staleTimeoutMs);

        const filter = {
            $expr: { $lt: ['$attempts', '$maxRetries'] },
            $or: [
                { status: IngestionStatus.QUEUED },
                {
                    status: IngestionStatus.PROCESSING,
                    $or: [
                        { heartbeatAt: { $lt: staleThreshold } },
                        { heartbeatAt: { $exists: false }, startedAt: { $lt: staleThreshold } }
                    ]
                }
            ]
        };

        const update: Record<string, unknown> = {
            $set: {
                status: IngestionStatus.PROCESSING,
                workerId,
                heartbeatAt: now
            },
            $inc: { attempts: 1 }
        };

        const job = await IngestionJob.findOneAndUpdate(
            filter,
            update,
            { new: true, sort: { createdAt: 1 } }
        );

        if (job && !job.startedAt) {
            await IngestionJob.updateOne(
                { _id: job._id, startedAt: { $exists: false } },
                { $set: { startedAt: now } }
            );
            job.startedAt = now;
        }

        return job;
    }

    async updateHeartbeat(jobId: string | mongoose.Types.ObjectId, workerId: string): Promise<boolean> {
        const res = await IngestionJob.updateOne(
            { _id: jobId, workerId },
            { $set: { heartbeatAt: new Date() } }
        );
        return res.modifiedCount > 0;
    }

    async getBatchByBatchIdInternal(batchId: string): Promise<IBatch | null> {
        return await Batch.findOne({ batchId, isActive: true });
    }
}

const batchRepository = new BatchRepository();
export default batchRepository;
