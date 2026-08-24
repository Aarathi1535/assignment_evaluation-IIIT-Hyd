import { describe, it, expect, beforeAll } from 'vitest';
import mongoose from 'mongoose';
import { connectDB } from '../lib/db';
import { migrateIndexes } from '../utils/dbMigration';

describe('Database Index Migration Tests (AE-085 Blocker 2)', () => {
    beforeAll(async () => {
        await connectDB();
    });

    it('should successfully run migration, drop obsolete unique indexes, create new composite ones, and be idempotent', async () => {
        const db = mongoose.connection.db;
        expect(db).toBeDefined();
        if (!db) return;

        const allocationsCol = db.collection('allocations');
        const gradesCol = db.collection('grades');

        // Clean previous state or collections to ensure clean testing environment
        try {
            await allocationsCol.drop();
        } catch { /* ignore if not exist */ }
        try {
            await gradesCol.drop();
        } catch { /* ignore if not exist */ }

        // Create collections explicitly
        await db.createCollection('allocations');
        await db.createCollection('grades');

        // 1. Setup obsolete unique indexes
        // Obsolete Allocation index on { ta: 1, answerScript: 1 }
        await allocationsCol.createIndex({ ta: 1, answerScript: 1 }, { unique: true, name: 'ta_1_answerScript_1_obsolete' });
        // Obsolete Grade index on { answerScript: 1 }
        await gradesCol.createIndex({ answerScript: 1 }, { unique: true, name: 'answerScript_1_obsolete' });

        // Add unrelated index to verify it is not dropped
        await allocationsCol.createIndex({ dummyField: 1 }, { name: 'dummy_1_unrelated' });

        // Verify obsolete indexes exist before migration
        let allocIndexes = await allocationsCol.indexes();
        let gradeIndexes = await gradesCol.indexes();

        const hasObsoleteAlloc = allocIndexes.some(idx => idx.name === 'ta_1_answerScript_1_obsolete');
        const hasObsoleteGrade = gradeIndexes.some(idx => idx.name === 'answerScript_1_obsolete');
        const hasUnrelatedAlloc = allocIndexes.some(idx => idx.name === 'dummy_1_unrelated');

        expect(hasObsoleteAlloc).toBe(true);
        expect(hasObsoleteGrade).toBe(true);
        expect(hasUnrelatedAlloc).toBe(true);

        // 2. Run index migration
        await migrateIndexes();

        // Verify obsolete indexes are dropped
        allocIndexes = await allocationsCol.indexes();
        gradeIndexes = await gradesCol.indexes();

        const hasObsoleteAllocAfter = allocIndexes.some(idx => idx.name === 'ta_1_answerScript_1_obsolete');
        const hasObsoleteGradeAfter = gradeIndexes.some(idx => idx.name === 'answerScript_1_obsolete');
        const hasUnrelatedAllocAfter = allocIndexes.some(idx => idx.name === 'dummy_1_unrelated');

        expect(hasObsoleteAllocAfter).toBe(false);
        expect(hasObsoleteGradeAfter).toBe(false);
        expect(hasUnrelatedAllocAfter).toBe(true); // Unrelated index preserved!

        // Verify new composite indexes exist
        const hasNewCompositeAlloc = allocIndexes.some(idx => 
            idx.key && idx.key.ta === 1 && idx.key.answerScript === 1 && idx.key.question === 1
        );
        const hasNewCompositeGrade = gradeIndexes.some(idx => 
            idx.key && idx.key.answerScript === 1 && idx.key.question === 1
        );

        expect(hasNewCompositeAlloc).toBe(true);
        expect(hasNewCompositeGrade).toBe(true);

        // 3. Verify idempotency: run migration again, check it runs without issues/throwing
        await expect(migrateIndexes()).resolves.not.toThrow();

        // Verify state is unchanged
        allocIndexes = await allocationsCol.indexes();
        const hasNewCompositeAllocAgain = allocIndexes.some(idx => 
            idx.key && idx.key.ta === 1 && idx.key.answerScript === 1 && idx.key.question === 1
        );
        expect(hasNewCompositeAllocAgain).toBe(true);
    });
});
