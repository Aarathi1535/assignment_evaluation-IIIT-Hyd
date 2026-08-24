import mongoose from 'mongoose';

/**
 * Helper to match index keys object.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function matchKeys(indexKeys: Record<string, any>, targetKeys: Record<string, number>): boolean {
    const indexKeyNames = Object.keys(indexKeys);
    const targetKeyNames = Object.keys(targetKeys);
    if (indexKeyNames.length !== targetKeyNames.length) return false;
    return targetKeyNames.every(name => indexKeys[name] === targetKeys[name]);
}

/**
 * Drops an obsolete index by matching its key signature or default name on a collection.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function dropObsoleteIndex(collection: any, keys: Record<string, number>, defaultName: string): Promise<void> {
    try {
        const indexes = await collection.indexes();
        for (const index of indexes) {
            if (matchKeys(index.key, keys) || index.name === defaultName) {
                console.log(`Dropping obsolete index ${index.name} on collection ${collection.collectionName}`);
                await collection.dropIndex(index.name);
                break;
            }
        }
    } catch (error: unknown) {
        // NamespaceNotFound (code 26) means collection/database does not exist yet. Safe to ignore.
        const err = error as { code?: number };
        if (err.code !== 26) {
            console.warn(`Error checking/dropping index on ${collection.collectionName}:`, error);
        }
    }
}

/**
 * Explicit migration for existing databases:
 * - drops the obsolete Allocation unique index on { ta: 1, answerScript: 1 }
 * - drops the obsolete Grade unique index on { answerScript: 1 }
 * - ensures the new composite indexes exist
 */
export async function migrateIndexes(): Promise<void> {
    const connection = mongoose.connection;
    const db = connection.db;
    if (!db) {
        console.warn('MongoDB database connection is not established yet. Skipping migration.');
        return;
    }

    const allocationsCol = db.collection('allocations');
    const gradesCol = db.collection('grades');

    // 1. Drop obsolete Allocation unique index on (ta, answerScript)
    await dropObsoleteIndex(allocationsCol, { ta: 1, answerScript: 1 }, 'ta_1_answerScript_1');

    // 2. Drop obsolete Grade unique index on answerScript
    await dropObsoleteIndex(gradesCol, { answerScript: 1 }, 'answerScript_1');

    // 3. Ensure the new composite indexes exist by calling createIndexes on models
    const Allocation = (await import('../models/Allocation')).default;
    const Grade = (await import('../models/Grade')).default;

    await Allocation.createIndexes();
    await Grade.createIndexes();
}
