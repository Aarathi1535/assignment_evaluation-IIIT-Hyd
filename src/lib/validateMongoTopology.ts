import mongoose from 'mongoose';

/**
 * Transaction-capable topology types supported by the MongoDB driver.
 * 'Single' (standalone) does not support multi-document transactions.
 */
const TRANSACTION_CAPABLE_TYPES = new Set([
    'ReplicaSetWithPrimary',
    'ReplicaSetNoPrimary',
    'Sharded',
    'LoadBalanced',
]);

/**
 * Reads the topology type from an established Mongoose connection.
 * Returns the raw string from the driver (e.g. 'Single', 'ReplicaSetWithPrimary').
 * Returns 'Unknown' when the topology object is not yet available.
 */
export function getTopologyType(connection: typeof mongoose.connection): string {
    // mongoose.connection.getClient() returns the underlying MongoClient (Mongoose 9.x / driver 6.x).
    // MongoClient.topology is set after connect() resolves.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const topology = (connection.getClient() as any)?.topology;
    return (topology?.description?.type as string | undefined) ?? 'Unknown';
}

/**
 * Validates that the connected MongoDB topology is capable of supporting
 * multi-document transactions.
 *
 * Rules:
 *  - production  + standalone  → throws a fatal Error (startup must abort).
 *  - production  + replica-set → allowed.
 *  - development + any         → allowed (local standalone is fine).
 *  - test        + any         → allowed (MongoMemoryServer / MongoMemoryReplSet).
 *
 * Must be called after mongoose.connect() resolves.
 */
export function validateMongoTopology(connection: typeof mongoose.connection): void {
    if (process.env.NODE_ENV !== 'production') {
        // Only enforce in production; local development and tests are exempt.
        return;
    }

    const topologyType = getTopologyType(connection);

    if (!TRANSACTION_CAPABLE_TYPES.has(topologyType)) {
        throw new Error(
            `FATAL: Production requires a MongoDB replica set or sharded cluster to support ` +
            `transactions. Connected topology is "${topologyType}" (standalone). ` +
            `Start MongoDB as a replica set or update MONGODB_URI to point to a replica set. ` +
            `Application cannot start.`
        );
    }
}
