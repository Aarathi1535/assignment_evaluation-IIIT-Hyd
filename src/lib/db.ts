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
  maxPoolSize: number;
  minPoolSize: number;
  maxIdleTimeMS: number;
  serverSelectionTimeoutMS: number;
}

export function getMongoPoolConfig(): MongoPoolConfig {
  const maxPoolSize = parseInt(process.env.MONGO_MAX_POOL_SIZE || '50', 10);
  const minPoolSize = parseInt(process.env.MONGO_MIN_POOL_SIZE || '5', 10);
  const maxIdleTimeMS = parseInt(process.env.MONGO_MAX_IDLE_TIME_MS || '30000', 10);
  const serverSelectionTimeoutMS = parseInt(process.env.MONGO_SERVER_SELECTION_TIMEOUT_MS || '5000', 10);

  return {
    maxPoolSize: isNaN(maxPoolSize) || maxPoolSize <= 0 ? 50 : maxPoolSize,
    minPoolSize: isNaN(minPoolSize) || minPoolSize < 0 ? 5 : minPoolSize,
    maxIdleTimeMS: isNaN(maxIdleTimeMS) || maxIdleTimeMS <= 0 ? 30000 : maxIdleTimeMS,
    serverSelectionTimeoutMS: isNaN(serverSelectionTimeoutMS) || serverSelectionTimeoutMS <= 0 ? 5000 : serverSelectionTimeoutMS,
  };
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
      maxPoolSize: poolConfig.maxPoolSize,
      minPoolSize: poolConfig.minPoolSize,
      maxIdleTimeMS: poolConfig.maxIdleTimeMS,
      serverSelectionTimeoutMS: poolConfig.serverSelectionTimeoutMS,
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
