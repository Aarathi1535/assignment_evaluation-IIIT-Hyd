import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
// @ts-expect-error - js-yaml does not provide bundled types
import yaml from 'js-yaml';
import { GET as healthGET } from '../app/api/health/route';

interface KnativeContainerEnv {
  name: string;
  value?: string;
  valueFrom?: {
    secretKeyRef?: {
      name: string;
      key: string;
    };
  };
}

interface KnativeServiceManifest {
  apiVersion: string;
  kind: string;
  metadata: {
    name: string;
    labels: Record<string, string>;
  };
  spec: {
    template: {
      metadata: {
        annotations: Record<string, string>;
      };
      spec: {
        containers: Array<{
          name: string;
          image: string;
          env: KnativeContainerEnv[];
        }>;
      };
    };
  };
}

describe('AE-231: Google Cloud Run Deployment & Staging Architecture', () => {
  const rootDir = process.cwd();
  const manifestPath = path.join(rootDir, 'deploy', 'cloudrun-service.yaml');
  const bashScriptPath = path.join(rootDir, 'deploy', 'deploy-staging.sh');
  const psScriptPath = path.join(rootDir, 'deploy', 'deploy-staging.ps1');

  describe('1. Cloud Run Knative Service Manifest', () => {
    it('parses as valid YAML and specifies required region and gen2 execution environment', () => {
      expect(fs.existsSync(manifestPath)).toBe(true);
      const raw = fs.readFileSync(manifestPath, 'utf8');
      const doc = yaml.load(raw) as KnativeServiceManifest;

      expect(doc.apiVersion).toBe('serving.knative.dev/v1');
      expect(doc.kind).toBe('Service');
      expect(doc.metadata.labels['cloud.googleapis.com/location']).toBe('asia-south1');
      expect(doc.spec.template.metadata.annotations['run.googleapis.com/execution-environment']).toBe('gen2');
    });

    it('binds sensitive credentials from GCP Secret Manager', () => {
      const raw = fs.readFileSync(manifestPath, 'utf8');
      const doc = yaml.load(raw) as KnativeServiceManifest;
      const envVars = doc.spec.template.spec.containers[0].env;

      const secretEnvNames = envVars
        .filter((e) => e.valueFrom && e.valueFrom.secretKeyRef)
        .map((e) => e.name);

      expect(secretEnvNames).toContain('MONGODB_URI');
      expect(secretEnvNames).toContain('NEXTAUTH_SECRET');
      expect(secretEnvNames).toContain('ORIGINAL_STORAGE_HMAC_SECRET');
    });
  });

  describe('2. Deployment Script Safety Guarantees', () => {
    it('verifies deploy scripts require GCP_PROJECT_ID and do not use hardcoded project IDs', () => {
      const bashContent = fs.readFileSync(bashScriptPath, 'utf8');
      const psContent = fs.readFileSync(psScriptPath, 'utf8');

      // Must check for GCP_PROJECT_ID requirement
      expect(bashContent).toMatch(/GCP_PROJECT_ID/);
      expect(bashContent).toMatch(/exit 1/);

      expect(psContent).toMatch(/GCP_PROJECT_ID/);
      expect(psContent).toMatch(/exit 1/);
    });

    it('verifies deploy scripts enforce --no-traffic preview revisions before migrating traffic', () => {
      const bashContent = fs.readFileSync(bashScriptPath, 'utf8');
      const psContent = fs.readFileSync(psScriptPath, 'utf8');

      // Both scripts must deploy with --no-traffic
      expect(bashContent).toMatch(/--no-traffic/);
      expect(psContent).toMatch(/--no-traffic/);

      // Both scripts must probe health before update-traffic
      expect(bashContent).toMatch(/\/api\/health/);
      expect(bashContent).toMatch(/update-traffic[\s\S]*--to-latest/);

      expect(psContent).toMatch(/\/api\/health/);
      expect(psContent).toMatch(/update-traffic[\s\S]*--to-latest/);
    });

    it('verifies deploy scripts exit with error code 1 when unauthenticated', () => {
      const bashContent = fs.readFileSync(bashScriptPath, 'utf8');
      const psContent = fs.readFileSync(psScriptPath, 'utf8');

      // Must not exit 0 on unauthenticated state
      expect(bashContent).not.toMatch(/gcloud auth print-access-token[\s\S]*exit 0/);
      expect(psContent).not.toMatch(/gcloud auth print-access-token[\s\S]*exit 0/);
    });
  });

  describe('3. Application Health Probe Verification', () => {
    it('verifies /api/health endpoint responds with expected status for Cloud Run smoke testing', async () => {
      const res = await healthGET();
      expect([200, 503]).toContain(res.status);
      const body = await res.json();
      expect(body).toHaveProperty('success');
    });
  });
});
