/* eslint-disable @typescript-eslint/no-explicit-any */
import path from 'path';
import fs from 'fs';
import { loadEnvConfig } from '@next/env';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { beforeAll, beforeEach, afterAll } from 'vitest';
import { GlobalFonts } from '@napi-rs/canvas';

// Load environment configuration (.env.local) if present
loadEnvConfig(process.cwd());

// Ensure bundled fallback fonts are available for canvas tests in CI (e.g. Linux runners)
try {
  const fontPath = path.join(process.cwd(), 'node_modules', 'pdfjs-dist', 'standard_fonts', 'LiberationSans-Regular.ttf');
  if (fs.existsSync(fontPath)) {
    GlobalFonts.registerFromPath(fontPath, 'Arial');
    GlobalFonts.registerFromPath(fontPath, 'sans-serif');
  }
} catch {
  // Ignore font loading errors if environment restricts file access
}

// Override MONGODB_URI immediately with a local placeholder to isolate tests from development database
process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/test-placeholder-safety';

let mongoServer: MongoMemoryServer;

beforeAll(async () => {
  // Set fallback env variables to satisfy Zod validation in env.ts
  process.env.NEXTAUTH_SECRET = process.env.NEXTAUTH_SECRET || 'test-secret-value-at-least-32-chars-long';
  process.env.NEXTAUTH_URL = process.env.NEXTAUTH_URL || 'http://localhost:3000';
  process.env.ORIGINAL_STORAGE_HMAC_SECRET = process.env.ORIGINAL_STORAGE_HMAC_SECRET || 'test-storage-hmac-secret-at-least-32-chars';
  process.env.ORIGINAL_STORAGE_KEY_ID = process.env.ORIGINAL_STORAGE_KEY_ID || 'v1';
  process.env.WATERMARK_HMAC_SECRET = process.env.WATERMARK_HMAC_SECRET || 'test-watermark-secret-at-least-32-chars';

  // Start in-memory MongoDB
  mongoServer = await MongoMemoryServer.create({ instance: { launchTimeout: 120000 } });
  const mongoUri = mongoServer.getUri();

  // Force MONGODB_URI to point to the in-memory database
  process.env.MONGODB_URI = mongoUri;

  // Establish connection to in-memory DB
  const { connectDB } = await import('../lib/db');
  await connectDB();

  // Patch Exam.deleteMany and Batch.deleteMany in test environment to use bypassWorm when filter is empty,
  // allowing legacy test teardown to clean test data without model-level NODE_ENV === 'test' bypasses.
  const Exam = (await import('../models/Exam')).default;
  const Batch = (await import('../models/Batch')).default;

  const origExamDeleteMany = Exam.deleteMany.bind(Exam);
  Exam.deleteMany = function (filter?: unknown, options?: Record<string, unknown>) {
    if (options && options.bypassWorm === false) {
      return origExamDeleteMany(filter as any, options);
    }
    if (!filter || Object.keys(filter as Record<string, unknown>).length === 0) {
      return origExamDeleteMany(filter as any, { ...options, bypassWorm: true });
    }
    return origExamDeleteMany(filter as any, options);
  } as any;

  const origBatchDeleteMany = Batch.deleteMany.bind(Batch);
  Batch.deleteMany = function (filter?: unknown, options?: Record<string, unknown>) {
    if (options && options.bypassWorm === false) {
      return origBatchDeleteMany(filter as any, options);
    }
    if (!filter || Object.keys(filter as Record<string, unknown>).length === 0) {
      return origBatchDeleteMany(filter as any, { ...options, bypassWorm: true });
    }
    return origBatchDeleteMany(filter as any, options);
  } as any;
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
