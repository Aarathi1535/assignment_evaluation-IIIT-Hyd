import mongoose from 'mongoose';

interface MongooseCache {
  conn: typeof mongoose | null;
  promise: Promise<typeof mongoose> | null;
}

declare global {
  var personalizedMongooseCache: MongooseCache | undefined;
}

let cached = global.personalizedMongooseCache;
if (!cached) {
  cached = global.personalizedMongooseCache = { conn: null, promise: null };
}

const mongooseCache = cached!;

/**
 * Connect to the independent Personalised Learning database.
 * Uses MONGODB_PERSONALIZED_URI with fallback to MONGODB_URI.
 */
export async function connectPersonalizedDB(): Promise<typeof mongoose> {
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

    const MONGODB_PERSONALIZED_URI = process.env.MONGODB_PERSONALIZED_URI || process.env.MONGODB_URI;
    if (!MONGODB_PERSONALIZED_URI) {
      throw new Error('MONGODB_PERSONALIZED_URI or MONGODB_URI is not defined in process.env');
    }

    mongooseCache.promise = mongoose.connect(MONGODB_PERSONALIZED_URI, opts).then((instance) => {
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

export default connectPersonalizedDB;
