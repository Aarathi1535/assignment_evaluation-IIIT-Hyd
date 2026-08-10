import { loadEnvConfig } from '@next/env';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { beforeAll, beforeEach, afterAll } from 'vitest';

// Load environment configuration (.env.local) if present
loadEnvConfig(process.cwd());

// Override MONGODB_URI immediately with a local placeholder to isolate tests from development database
process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/test-placeholder-safety';

let mongoServer: MongoMemoryServer;

beforeAll(async () => {
  // Set fallback env variables to satisfy Zod validation in env.ts
  process.env.NEXTAUTH_SECRET = process.env.NEXTAUTH_SECRET || 'test-secret-value-at-least-32-chars-long';
  process.env.NEXTAUTH_URL = process.env.NEXTAUTH_URL || 'http://localhost:3000';
  process.env.ORIGINAL_STORAGE_HMAC_SECRET = process.env.ORIGINAL_STORAGE_HMAC_SECRET || 'test-storage-hmac-secret-at-least-32-chars';
  process.env.ORIGINAL_STORAGE_KEY_ID = process.env.ORIGINAL_STORAGE_KEY_ID || 'v1';

  // Start in-memory MongoDB
  mongoServer = await MongoMemoryServer.create();
  const mongoUri = mongoServer.getUri();

  // Force MONGODB_URI to point to the in-memory database
  process.env.MONGODB_URI = mongoUri;

  // Establish connection to in-memory DB
  const { connectDB } = await import('../lib/db');
  await connectDB();
});

afterAll(async () => {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.connection.close();
  }
  if (mongoServer) {
    await mongoServer.stop();
  }
});

beforeEach(async () => {
  // Clean all collections to ensure isolation between tests
  if (mongoose.connection.readyState !== 0) {
    // Safety guard: Verify connection points to local database only
    const host = mongoose.connection.host || '';
    const isSafe = host.includes('127.0.0.1') || host.includes('localhost') || host.includes('mongodb-memory-server');
    if (!isSafe) {
      throw new Error(`CRITICAL SECURITY VIOLATION: Test suite attempted to clean up a non-local database host: "${host}"`);
    }

    const collections = mongoose.connection.collections;
    for (const key in collections) {
      const collection = collections[key];
      await collection.deleteMany({});
    }
  }
});
