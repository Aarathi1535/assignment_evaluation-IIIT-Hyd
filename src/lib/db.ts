import mongoose from 'mongoose';
import { initBackgroundWorker } from './workerInit';
import { validateMongoTopology } from './validateMongoTopology';

interface MongooseCache {
  conn: typeof mongoose | null;
  promise: Promise<typeof mongoose> | null;
}

declare global {
  var mongoose: MongooseCache | undefined;
}

let cached = global.mongoose;

if (!cached) {
  cached = global.mongoose = { conn: null, promise: null };
}

const mongooseCache = cached;

export interface MongoPoolConfig {
  maxPoolSize?: number;
  minPoolSize?: number;
  maxIdleTimeMS?: number;
  serverSelectionTimeoutMS?: number;
}

/**
 * Retrieves opt-in MongoDB connection pool configuration from environment variables.
 * If an environment variable is unset, the corresponding option is omitted,
 * allowing the MongoDB driver / Mongoose defaults to remain in effect.
 */
export function getMongoPoolConfig(): MongoPoolConfig {
  const config: MongoPoolConfig = {};

  if (process.env.MONGO_MAX_POOL_SIZE) {
    const val = parseInt(process.env.MONGO_MAX_POOL_SIZE, 10);
    if (!isNaN(val) && val > 0) {
      config.maxPoolSize = val;
    }
  }

  if (process.env.MONGO_MIN_POOL_SIZE) {
    const val = parseInt(process.env.MONGO_MIN_POOL_SIZE, 10);
    if (!isNaN(val) && val >= 0) {
      config.minPoolSize = val;
    }
  }

  if (process.env.MONGO_MAX_IDLE_TIME_MS) {
    const val = parseInt(process.env.MONGO_MAX_IDLE_TIME_MS, 10);
    if (!isNaN(val) && val > 0) {
      config.maxIdleTimeMS = val;
    }
  }

  if (process.env.MONGO_SERVER_SELECTION_TIMEOUT_MS) {
    const val = parseInt(process.env.MONGO_SERVER_SELECTION_TIMEOUT_MS, 10);
    if (!isNaN(val) && val > 0) {
      config.serverSelectionTimeoutMS = val;
    }
  }

  return config;
}

export async function connectDB() {
  if (mongooseCache.conn) {
    return mongooseCache.conn;
  }

  if (!mongooseCache.promise) {
    const poolConfig = getMongoPoolConfig();
    const opts: mongoose.ConnectOptions = {
      bufferCommands: false,
      monitorCommands: true,
      ...(poolConfig.maxPoolSize !== undefined && { maxPoolSize: poolConfig.maxPoolSize }),
      ...(poolConfig.minPoolSize !== undefined && { minPoolSize: poolConfig.minPoolSize }),
      ...(poolConfig.maxIdleTimeMS !== undefined && { maxIdleTimeMS: poolConfig.maxIdleTimeMS }),
      ...(poolConfig.serverSelectionTimeoutMS !== undefined && { serverSelectionTimeoutMS: poolConfig.serverSelectionTimeoutMS }),
    };

    const MONGODB_URI = process.env.MONGODB_URI;
    if (!MONGODB_URI) {
      throw new Error('MONGODB_URI is not defined in process.env');
    }

    mongooseCache.promise = mongoose.connect(MONGODB_URI, opts).then((mongooseInstance) => {
      return mongooseInstance;
    });
  }

  try {
    mongooseCache.conn = await mongooseCache.promise;

    // Safely attach command monitoring to the underlying MongoClient
    try {
      const client = mongooseCache.conn.connection.getClient();
      if (client) {
        const { attachCommandMonitoring } = await import('./serverTiming');
        attachCommandMonitoring(client);
      }
    } catch {
      // Ignore if client is not available
    }

    // Validate topology before accepting traffic. Throws in production
    // if connected to a standalone MongoDB that cannot support transactions.
    validateMongoTopology(mongooseCache.conn.connection);

    // Migrate unique indexes to composite indexes
    const { migrateIndexes } = await import('../utils/dbMigration');
    await migrateIndexes();

    initBackgroundWorker();
  } catch (e) {
    mongooseCache.promise = null;
    throw e;
  }

  return mongooseCache.conn;
}

export function isTransactionCapable(conn: typeof mongoose.connection = mongoose.connection): boolean {
  const client = (conn as unknown as { client?: { topology?: { description?: { type?: string } } } })?.client;
  const topology = client?.topology;
  const topologyType = (topology?.description?.type as string | undefined) ?? 'Unknown';
  return [
    'ReplicaSetWithPrimary',
    'ReplicaSetNoPrimary',
    'Sharded',
    'LoadBalanced',
  ].includes(topologyType);
}
