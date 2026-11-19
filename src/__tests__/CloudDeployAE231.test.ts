import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
// @ts-expect-error - js-yaml has no bundled @types in devDependencies
import yaml from 'js-yaml';

interface KnativeEnvVar {
  name: string;
  value?: string;
  valueFrom?: {
    secretKeyRef?: {
      name: string;
      key: string;
    };
  };
}

interface KnativeContainer {
  name: string;
  image: string;
  ports: Array<{ name?: string; containerPort: number }>;
  resources: {
    limits: { cpu: string; memory: string };
    requests: { cpu: string; memory: string };
  };
  env: KnativeEnvVar[];
  startupProbe?: {
    httpGet: { path: string; port: number };
  };
  livenessProbe?: {
    httpGet: { path: string; port: number };
  };
}

interface KnativeServiceDoc {
  apiVersion: string;
  kind: string;
  metadata: {
    name: string;
    namespace?: string;
    labels: Record<string, string>;
    annotations?: Record<string, string>;
  };
  spec: {
    template: {
      metadata: {
        annotations: Record<string, string>;
      };
      spec: {
        containerConcurrency: number;
        timeoutSeconds: number;
        serviceAccountName?: string;
        containers: KnativeContainer[];
      };
    };
  };
}

describe('AE-231: Google Cloud Run Deployment & Staging Architecture', () => {
  const rootDir = process.cwd();
  const manifestPath = path.join(rootDir, 'deploy', 'cloudrun-service.yaml');
  const bashScriptPath = path.join(rootDir, 'deploy', 'deploy-staging.sh');
  const psScriptPath = path.join(rootDir, 'deploy', 'deploy-staging.ps1');
  const docsPath = path.join(rootDir, 'docs', 'CLOUD_DEPLOY.md');

  describe('Cloud Run Declarative Manifest (cloudrun-service.yaml)', () => {
    it('should exist and parse as valid YAML Knative Service', () => {
      expect(fs.existsSync(manifestPath)).toBe(true);
      const raw = fs.readFileSync(manifestPath, 'utf8');
      const doc = yaml.load(raw) as KnativeServiceDoc;

      expect(doc).toBeDefined();
      expect(doc.apiVersion).toBe('serving.knative.dev/v1');
      expect(doc.kind).toBe('Service');
      expect(doc.metadata.name).toBe('assignment-evaluator-staging');
      expect(doc.metadata.labels['cloud.googleapis.com/location']).toBe('asia-south1');
      expect(doc.metadata.labels.environment).toBe('staging');
    });

    it('should configure appropriate execution environment and autoscaling annotations', () => {
      const raw = fs.readFileSync(manifestPath, 'utf8');
      const doc = yaml.load(raw) as KnativeServiceDoc;
      const annotations = doc.spec.template.metadata.annotations;

      expect(annotations['run.googleapis.com/execution-environment']).toBe('gen2');
      expect(annotations['run.googleapis.com/cpu-throttling']).toBe('false');
      expect(parseInt(annotations['autoscaling.knative.dev/minScale'], 10)).toBeGreaterThanOrEqual(1);
      expect(parseInt(annotations['autoscaling.knative.dev/maxScale'], 10)).toBeLessThanOrEqual(10);
    });

    it('should configure port 3000, container concurrency, and compute resources', () => {
      const raw = fs.readFileSync(manifestPath, 'utf8');
      const doc = yaml.load(raw) as KnativeServiceDoc;
      const spec = doc.spec.template.spec;
      const container = spec.containers[0];

      expect(spec.containerConcurrency).toBe(80);
      expect(spec.timeoutSeconds).toBe(300);
      expect(container.ports[0].containerPort).toBe(3000);

      // CPU and Memory limits & requests
      expect(container.resources.limits.cpu).toBe('2');
      expect(container.resources.limits.memory).toBe('2Gi');
      expect(container.resources.requests.cpu).toBe('1');
      expect(container.resources.requests.memory).toBe('1Gi');
    });

    it('should securely bind sensitive credentials from Secret Manager', () => {
      const raw = fs.readFileSync(manifestPath, 'utf8');
      const doc = yaml.load(raw) as KnativeServiceDoc;
      const envVars = doc.spec.template.spec.containers[0].env;

      const secretNames = envVars
        .filter((e) => e.valueFrom?.secretKeyRef)
        .map((e) => ({
          name: e.name,
          secretName: e.valueFrom?.secretKeyRef?.name,
        }));

      expect(secretNames).toContainEqual({
        name: 'MONGODB_URI',
        secretName: 'evaluator-mongodb-uri',
      });
      expect(secretNames).toContainEqual({
        name: 'NEXTAUTH_SECRET',
        secretName: 'evaluator-nextauth-secret',
      });
      expect(secretNames).toContainEqual({
        name: 'ORIGINAL_STORAGE_HMAC_SECRET',
        secretName: 'evaluator-original-hmac-secret',
      });

      // GCS bucket configuration
      const gcsBucketEnv = envVars.find((e) => e.name === 'DERIVED_PAGE_STORAGE_BUCKET');
      expect(gcsBucketEnv).toBeDefined();
      expect(gcsBucketEnv?.value).toBe('iiit-assignment-evaluator-staging-assets');
    });

    it('should define startup and liveness health probes against /api/health', () => {
      const raw = fs.readFileSync(manifestPath, 'utf8');
      const doc = yaml.load(raw) as KnativeServiceDoc;
      const container = doc.spec.template.spec.containers[0];

      expect(container.startupProbe).toBeDefined();
      expect(container.startupProbe?.httpGet.path).toBe('/api/health');
      expect(container.startupProbe?.httpGet.port).toBe(3000);

      expect(container.livenessProbe).toBeDefined();
      expect(container.livenessProbe?.httpGet.path).toBe('/api/health');
      expect(container.livenessProbe?.httpGet.port).toBe(3000);
    });
  });

  describe('Staging Deployment Automation Scripts', () => {
    it('deploy-staging.sh should enforce strict pre-flight checks and non-fabrication', () => {
      expect(fs.existsSync(bashScriptPath)).toBe(true);
      const content = fs.readFileSync(bashScriptPath, 'utf8');

      // CLI check
      expect(content).toContain('command -v gcloud');
      // Auth check
      expect(content).toContain('gcloud auth print-access-token');
      // Project access check
      expect(content).toContain('gcloud projects describe');
      // Non-fabrication exit message
      expect(content).toContain('Skipping live deployment (strict non-fabrication policy)');
      // Knative replace command
      expect(content).toContain('gcloud run services replace');
    });

    it('deploy-staging.ps1 should enforce strict pre-flight checks on Windows', () => {
      expect(fs.existsSync(psScriptPath)).toBe(true);
      const content = fs.readFileSync(psScriptPath, 'utf8');

      expect(content).toContain('Get-Command gcloud');
      expect(content).toContain('gcloud auth print-access-token');
      expect(content).toContain('gcloud projects describe');
      expect(content).toContain('Skipping live deployment (strict non-fabrication policy)');
      expect(content).toContain('gcloud run services replace');
    });
  });

  describe('Staging Architecture Documentation (docs/CLOUD_DEPLOY.md)', () => {
    it('should exist and document architecture, IAM, secrets, and verification steps', () => {
      expect(fs.existsSync(docsPath)).toBe(true);
      const content = fs.readFileSync(docsPath, 'utf8');

      expect(content).toContain('Google Cloud Run');
      expect(content).toContain('asia-south1');
      expect(content).toContain('evaluator-mongodb-uri');
      expect(content).toContain('evaluator-nextauth-secret');
      expect(content).toContain('roles/secretmanager.secretAccessor');
      expect(content).toContain('Strict Non-Fabrication Policy');
      expect(content).toContain('/api/health');
    });
  });
});
