import mongoose from 'mongoose';

interface MongooseCache {
  conn: typeof mongoose | null;
  promise: Promise<typeof mongoose> | null;
}

declare global {
  var classroomMongooseCache: MongooseCache | undefined;
}

let cached = global.classroomMongooseCache;
if (!cached) {
  cached = global.classroomMongooseCache = { conn: null, promise: null };
}

const mongooseCache = cached!;

/**
 * Connect to the independent Classroom Activity database.
 * Uses MONGODB_CLASSROOM_URI with fallback to MONGODB_URI.
 */
export async function connectClassroomDB(): Promise<typeof mongoose> {
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

    const MONGODB_CLASSROOM_URI = process.env.MONGODB_CLASSROOM_URI || process.env.MONGODB_URI;
    if (!MONGODB_CLASSROOM_URI) {
      throw new Error('MONGODB_CLASSROOM_URI or MONGODB_URI is not defined in process.env');
    }

    mongooseCache.promise = mongoose.connect(MONGODB_CLASSROOM_URI, opts).then((instance) => {
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

export default connectClassroomDB;
