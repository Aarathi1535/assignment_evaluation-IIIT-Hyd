import { loadEnvConfig } from '@next/env';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { beforeAll, beforeEach, afterAll } from 'vitest';

// Load environment configuration (.env.local) if present
loadEnvConfig(process.cwd());

let mongoServer: MongoMemoryServer;

beforeAll(async () => {
  // Set fallback env variables to satisfy Zod validation in env.ts
  process.env.NEXTAUTH_SECRET = process.env.NEXTAUTH_SECRET || 'test-secret-value-at-least-32-chars-long';
  process.env.NEXTAUTH_URL = process.env.NEXTAUTH_URL || 'http://localhost:3000';

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
    const collections = mongoose.connection.collections;
    for (const key in collections) {
      const collection = collections[key];
      await collection.deleteMany({});
    }
  }
});
