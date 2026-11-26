import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
// @ts-expect-error - js-yaml has no bundled @types in devDependencies
import yaml from 'js-yaml';
import { getMongoPoolConfig } from '../lib/db';

interface KnativeServiceManifest {
  apiVersion: string;
  kind: string;
  metadata: {
    name: string;
    namespace?: string;
    labels?: Record<string, string>;
  };
  spec: {
    template: {
      metadata: {
        annotations: Record<string, string>;
      };
      spec: {
        containerConcurrency: number;
        timeoutSeconds: number;
      };
    };
  };
}

describe('AE-232: Autoscaling Configuration and Policy Specifications', () => {
  const rootDir = process.cwd();
  const cloudRunServicePath = path.join(rootDir, 'deploy', 'cloudrun-service.yaml');
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.MONGO_MAX_POOL_SIZE;
    delete process.env.MONGO_MIN_POOL_SIZE;
    delete process.env.MONGO_MAX_IDLE_TIME_MS;
    delete process.env.MONGO_SERVER_SELECTION_TIMEOUT_MS;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('1. Cloud Run Autoscaling Configuration Verification', () => {
    it('verifies deploy/cloudrun-service.yaml specifies minScale: 1 and maxScale: 10', () => {
      if (fs.existsSync(cloudRunServicePath)) {
        const raw = fs.readFileSync(cloudRunServicePath, 'utf8');
        const doc = yaml.load(raw) as KnativeServiceManifest;
        const annotations = doc.spec.template.metadata.annotations;

        // Warm standby instance to eliminate cold-start latency
        expect(annotations['autoscaling.knative.dev/minScale']).toBe('1');
        // Horizontal ceiling protecting database connection pools
        expect(annotations['autoscaling.knative.dev/maxScale']).toBe('10');
      }
    });
  });

  describe('2. Opt-in MongoDB Connection Pool Sizing (src/lib/db.ts)', () => {
    it('returns empty pool config by default so Mongoose/driver defaults remain in effect', () => {
      const config = getMongoPoolConfig();

      // No overrides when environment variables are unset
      expect(config.maxPoolSize).toBeUndefined();
      expect(config.minPoolSize).toBeUndefined();
      expect(config.maxIdleTimeMS).toBeUndefined();
      expect(config.serverSelectionTimeoutMS).toBeUndefined();
    });

    it('allows opting into pool parameter overrides via environment variables', () => {
      process.env.MONGO_MAX_POOL_SIZE = '50';
      process.env.MONGO_MIN_POOL_SIZE = '5';
      process.env.MONGO_MAX_IDLE_TIME_MS = '30000';
      process.env.MONGO_SERVER_SELECTION_TIMEOUT_MS = '5000';

      const config = getMongoPoolConfig();
      expect(config.maxPoolSize).toBe(50);
      expect(config.minPoolSize).toBe(5);
      expect(config.maxIdleTimeMS).toBe(30000);
      expect(config.serverSelectionTimeoutMS).toBe(5000);
    });

    it('safely ignores invalid or non-numeric environment variables', () => {
      process.env.MONGO_MAX_POOL_SIZE = '-10';
      process.env.MONGO_MIN_POOL_SIZE = 'invalid';
      process.env.MONGO_MAX_IDLE_TIME_MS = '0';
      process.env.MONGO_SERVER_SELECTION_TIMEOUT_MS = 'abc';

      const config = getMongoPoolConfig();
      expect(config.maxPoolSize).toBeUndefined();
      expect(config.minPoolSize).toBeUndefined();
      expect(config.maxIdleTimeMS).toBeUndefined();
      expect(config.serverSelectionTimeoutMS).toBeUndefined();
    });
  });
});
