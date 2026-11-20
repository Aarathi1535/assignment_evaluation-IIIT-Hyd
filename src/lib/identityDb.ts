import mongoose from 'mongoose';

interface MongooseCache {
  conn: typeof mongoose | null;
  promise: Promise<typeof mongoose> | null;
}

declare global {
  var identityMongooseCache: MongooseCache | undefined;
}

let cached = global.identityMongooseCache;
if (!cached) {
  cached = global.identityMongooseCache = { conn: null, promise: null };
}

const mongooseCache = cached!;

/**
 * Connect to the independent Identity & Access Management database.
 * Uses MONGODB_IDENTITY_URI with fallback to MONGODB_URI.
 */
export async function connectIdentityDB(): Promise<typeof mongoose> {
  if (mongooseCache.conn) {
    return mongooseCache.conn;
  }

  if (mongoose.connection.readyState === 1) {
    mongooseCache.conn = mongoose;
    return mongooseCache.conn;
  }

  if (!mongooseCache.promise) {
    const opts: mongoose.ConnectOptions = {
      bufferCommands: false,
    };

    const MONGODB_IDENTITY_URI =
      process.env.MONGODB_IDENTITY_URI || process.env.MONGODB_URI;

    if (!MONGODB_IDENTITY_URI) {
      throw new Error('MONGODB_IDENTITY_URI or MONGODB_URI is not defined in process.env');
    }

    mongooseCache.promise = mongoose.connect(MONGODB_IDENTITY_URI, opts).then((instance) => {
      return instance;
    });
  }

  try {
    mongooseCache.conn = await mongooseCache.promise;
  } catch (err) {
    mongooseCache.promise = null;
    throw err;
  }

  return mongooseCache.conn;
}
