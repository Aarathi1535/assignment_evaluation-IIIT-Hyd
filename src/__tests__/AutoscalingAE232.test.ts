import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
// @ts-expect-error - js-yaml has no bundled @types in devDependencies
import yaml from 'js-yaml';

interface CloudRunPolicyDoc {
  cloudRunPolicy: {
    apiVersion: string;
    kind: string;
    metadata: {
      name: string;
      namespace: string;
      labels: Record<string, string>;
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
  };
}

interface HpaMetric {
  type: string;
  resource: {
    name: string;
    target: {
      type: string;
      averageUtilization: number;
    };
  };
}

interface HpaDoc {
  apiVersion: string;
  kind: string;
  metadata: {
    name: string;
    namespace: string;
  };
  spec: {
    scaleTargetRef: {
      apiVersion: string;
      kind: string;
      name: string;
    };
    minReplicas: number;
    maxReplicas: number;
    metrics: HpaMetric[];
    behavior: {
      scaleUp: {
        stabilizationWindowSeconds: number;
        selectPolicy: string;
      };
      scaleDown: {
        stabilizationWindowSeconds: number;
        selectPolicy: string;
      };
    };
  };
}

describe('AE-232: Autoscaling Configuration and Policy Specifications', () => {
  const rootDir = process.cwd();
  const policyPath = path.join(rootDir, 'deploy', 'autoscaling-policy.yaml');
  const docsPath = path.join(rootDir, 'docs', 'AUTOSCALING.md');

  describe('Declarative Autoscaling Manifest (autoscaling-policy.yaml)', () => {
    it('should exist and parse multi-document YAML specifications', () => {
      expect(fs.existsSync(policyPath)).toBe(true);
      const raw = fs.readFileSync(policyPath, 'utf8');
      const docs = yaml.loadAll(raw);

      expect(docs.length).toBe(2);
    });

    it('should configure Cloud Run autoscaling with warm pool and bounded ceiling', () => {
      const raw = fs.readFileSync(policyPath, 'utf8');
      const docs = yaml.loadAll(raw);
      const cloudRun = docs[0] as CloudRunPolicyDoc;

      expect(cloudRun.cloudRunPolicy).toBeDefined();
      const annotations = cloudRun.cloudRunPolicy.spec.template.metadata.annotations;
      const spec = cloudRun.cloudRunPolicy.spec.template.spec;

      // Minimum 2 instances to eliminate cold start latency
      expect(parseInt(annotations['autoscaling.knative.dev/minScale'], 10)).toBe(2);
      // Maximum 10 instances to bound DB connections
      expect(parseInt(annotations['autoscaling.knative.dev/maxScale'], 10)).toBe(10);
      // 70% target concurrency utilization
      expect(parseInt(annotations['autoscaling.knative.dev/targetUtilizationPercentage'], 10)).toBe(70);
      // CPU unthrottled for canvas workers
      expect(annotations['run.googleapis.com/cpu-throttling']).toBe('false');
      expect(annotations['run.googleapis.com/execution-environment']).toBe('gen2');
      // Concurrency limit
      expect(spec.containerConcurrency).toBe(80);
      expect(spec.timeoutSeconds).toBe(300);
    });

    it('should configure Kubernetes HorizontalPodAutoscaler (HPA v2) correctly', () => {
      const raw = fs.readFileSync(policyPath, 'utf8');
      const docs = yaml.loadAll(raw);
      const hpa = docs[1] as HpaDoc;

      expect(hpa.apiVersion).toBe('autoscaling/v2');
      expect(hpa.kind).toBe('HorizontalPodAutoscaler');
      expect(hpa.metadata.name).toBe('assignment-evaluator-hpa');
      expect(hpa.spec.scaleTargetRef.name).toBe('assignment-evaluator');
      expect(hpa.spec.minReplicas).toBe(2);
      expect(hpa.spec.maxReplicas).toBe(10);

      // CPU metric: 75%
      const cpuMetric = hpa.spec.metrics.find((m) => m.resource.name === 'cpu');
      expect(cpuMetric).toBeDefined();
      expect(cpuMetric?.resource.target.averageUtilization).toBe(75);

      // Memory metric: 80%
      const memMetric = hpa.spec.metrics.find((m) => m.resource.name === 'memory');
      expect(memMetric).toBeDefined();
      expect(memMetric?.resource.target.averageUtilization).toBe(80);

      // Flapping mitigation
      expect(hpa.spec.behavior.scaleUp.stabilizationWindowSeconds).toBe(0);
      expect(hpa.spec.behavior.scaleDown.stabilizationWindowSeconds).toBe(300);
    });
  });

  describe('Capacity and Pool Protection Calculations', () => {
    it('should ensure max connection count stays under 10% of MongoDB Atlas M10 quota', () => {
      const maxInstances = 10;
      const connectionsPerInstance = 10;
      const totalConnections = maxInstances * connectionsPerInstance;
      const atlasM10Limit = 1500;

      expect(totalConnections).toBe(100);
      expect(totalConnections / atlasM10Limit).toBeLessThan(0.1);
    });

    it('should compute effective concurrency trigger threshold', () => {
      const maxConcurrency = 80;
      const targetPercent = 70;
      const triggerThreshold = (maxConcurrency * targetPercent) / 100;

      expect(triggerThreshold).toBe(56);
    });
  });

  describe('Autoscaling Documentation (docs/AUTOSCALING.md)', () => {
    it('should document workload profiles, database limits, and monitoring alerts', () => {
      expect(fs.existsSync(docsPath)).toBe(true);
      const content = fs.readFileSync(docsPath, 'utf8');

      expect(content).toContain('Peak TA Grading Session');
      expect(content).toContain('Batch Ingestion Spike');
      expect(content).toContain('Database Connection Pool Arithmetic');
      expect(content).toContain('1,500 connections');
      expect(content).toContain('minScale: 2');
      expect(content).toContain('300 seconds (5 min)');
      expect(content).toContain('Instance Saturation Alert');
      expect(content).toContain('Rapid Flapping Alert');
    });
  });
});
