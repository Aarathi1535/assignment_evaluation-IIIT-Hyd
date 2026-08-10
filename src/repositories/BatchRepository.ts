import Batch, { IBatch } from '../models/Batch';
import IngestionJob, { IIngestionJob } from '../models/IngestionJob';
import mongoose, { QueryFilter } from 'mongoose';

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

        if (actingUserRole === 'ADMIN') {
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
}

const batchRepository = new BatchRepository();
export default batchRepository;
