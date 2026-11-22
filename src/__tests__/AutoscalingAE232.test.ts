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
  const policyPath = path.join(rootDir, 'deploy', 'autoscaling-policy.yaml');
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

  describe('1. Knative Serving Autoscaling Manifest Validation', () => {
    it('parses as valid Knative Service YAML with single-service schema', () => {
      expect(fs.existsSync(policyPath)).toBe(true);
      const raw = fs.readFileSync(policyPath, 'utf8');
      const doc = yaml.load(raw) as KnativeServiceManifest;

      expect(doc.apiVersion).toBe('serving.knative.dev/v1');
      expect(doc.kind).toBe('Service');
      expect(doc.metadata.name).toBe('assignment-evaluator');
    });

    it('enforces minScale: 1 (aligned with PR #355) and bounded maxScale: 10', () => {
      const raw = fs.readFileSync(policyPath, 'utf8');
      const doc = yaml.load(raw) as KnativeServiceManifest;
      const annotations = doc.spec.template.metadata.annotations;
      const spec = doc.spec.template.spec;

      // minScale: 1 guarantees warm standby without over-provisioning
      expect(annotations['autoscaling.knative.dev/minScale']).toBe('1');
      // maxScale: 10 prevents uncontrolled MongoDB connection saturation
      expect(annotations['autoscaling.knative.dev/maxScale']).toBe('10');
      // 70% target concurrency utilization
      expect(annotations['autoscaling.knative.dev/targetUtilizationPercentage']).toBe('70');
      // Unthrottled CPU for background canvas/crypto processing
      expect(annotations['run.googleapis.com/cpu-throttling']).toBe('false');
      expect(annotations['run.googleapis.com/execution-environment']).toBe('gen2');
      // Concurrency settings
      expect(spec.containerConcurrency).toBe(80);
      expect(spec.timeoutSeconds).toBe(300);
    });

    it('matches autoscaling annotations in deploy/cloudrun-service.yaml if present', () => {
      if (fs.existsSync(cloudRunServicePath)) {
        const raw = fs.readFileSync(cloudRunServicePath, 'utf8');
        const doc = yaml.load(raw) as KnativeServiceManifest;
        const annotations = doc.spec.template.metadata.annotations;

        expect(annotations['autoscaling.knative.dev/minScale']).toBe('1');
        expect(annotations['autoscaling.knative.dev/maxScale']).toBe('10');
      }
    });
  });

  describe('2. MongoDB Connection Pool Sizing & Protection (src/lib/db.ts)', () => {
    it('exports default pool configuration safely sized for Cloud Run concurrency', () => {
      const config = getMongoPoolConfig();

      expect(config.maxPoolSize).toBe(50);
      expect(config.minPoolSize).toBe(5);
      expect(config.maxIdleTimeMS).toBe(30000);
      expect(config.serverSelectionTimeoutMS).toBe(5000);
    });

    it('allows overriding pool parameters via environment variables', () => {
      process.env.MONGO_MAX_POOL_SIZE = '25';
      process.env.MONGO_MIN_POOL_SIZE = '2';
      process.env.MONGO_MAX_IDLE_TIME_MS = '15000';
      process.env.MONGO_SERVER_SELECTION_TIMEOUT_MS = '3000';

      const config = getMongoPoolConfig();
      expect(config.maxPoolSize).toBe(25);
      expect(config.minPoolSize).toBe(2);
      expect(config.maxIdleTimeMS).toBe(15000);
      expect(config.serverSelectionTimeoutMS).toBe(3000);
    });

    it('falls back to safe defaults when environment variables are invalid', () => {
      process.env.MONGO_MAX_POOL_SIZE = '-10';
      process.env.MONGO_MIN_POOL_SIZE = 'invalid';

      const config = getMongoPoolConfig();
      expect(config.maxPoolSize).toBe(50);
      expect(config.minPoolSize).toBe(5);
    });

    it('guarantees maximum scale connection ceiling stays safely under 50% of Atlas M10 limit', () => {
      const raw = fs.readFileSync(policyPath, 'utf8');
      const doc = yaml.load(raw) as KnativeServiceManifest;
      const maxInstances = parseInt(doc.spec.template.metadata.annotations['autoscaling.knative.dev/maxScale'], 10);
      const config = getMongoPoolConfig();

      const totalMaxConnections = maxInstances * config.maxPoolSize;
      const atlasM10Limit = 1500;

      // Total connections: 10 * 50 = 500
      expect(totalMaxConnections).toBe(500);
      // Leaves at least 1,000 connections free for background workers and admin
      expect(totalMaxConnections / atlasM10Limit).toBeLessThanOrEqual(0.35);
    });

    it('computes effective concurrency scale-out threshold', () => {
      const raw = fs.readFileSync(policyPath, 'utf8');
      const doc = yaml.load(raw) as KnativeServiceManifest;
      const concurrency = doc.spec.template.spec.containerConcurrency;
      const targetPercent = parseInt(doc.spec.template.metadata.annotations['autoscaling.knative.dev/targetUtilizationPercentage'], 10);

      const triggerThreshold = (concurrency * targetPercent) / 100;
      expect(triggerThreshold).toBe(56);
    });
  });
});
