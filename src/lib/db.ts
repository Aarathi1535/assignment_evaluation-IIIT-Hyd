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

export async function connectDB() {
  if (mongooseCache.conn) {
    return mongooseCache.conn;
  }

  if (!mongooseCache.promise) {
    const opts = {
      bufferCommands: false,
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
    // Validate topology before accepting traffic. Throws in production
    // if connected to a standalone MongoDB that cannot support transactions.
    validateMongoTopology(mongooseCache.conn.connection);
    initBackgroundWorker();
  } catch (e) {
    mongooseCache.promise = null;
    throw e;
  }

  return mongooseCache.conn;
}
