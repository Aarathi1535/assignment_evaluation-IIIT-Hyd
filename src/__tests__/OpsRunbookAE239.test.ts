import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { healthService } from '../services/HealthService';

describe('AE-239: Operations Runbook & Production Deployment Verification', () => {
  const rootDir = process.cwd();
  const runbookPath = path.join(rootDir, 'docs', 'OPERATIONS_RUNBOOK.md');

  describe('Runbook Content & Infrastructure Realism', () => {
    it('should exist and document real deployment architecture', () => {
      expect(fs.existsSync(runbookPath)).toBe(true);
      const content = fs.readFileSync(runbookPath, 'utf8');

      expect(content).toContain('Local Development Environment');
      expect(content).toContain('Staging Environment (GCP)');
      expect(content).toContain('Production Environment (GCP)');
      expect(content).toContain('docker-compose.yml');
      expect(content).toContain('deploy/cloudrun-service.yaml');
    });

    it('should mandate GCP_PROJECT_ID and explicit --region for all cloud commands without made-up projects', () => {
      const content = fs.readFileSync(runbookPath, 'utf8');

      // Must require GCP_PROJECT_ID environment variable
      expect(content).toContain('GCP_PROJECT_ID');
      expect(content).toContain('asia-south1');
      expect(content).not.toContain('iiit-hyd-assignment-eval.iam');

      // Cloud Run commands must specify project and region
      expect(content).toContain('--project="${PROJECT_ID}"');
      expect(content).toContain('--region="${REGION}"');
    });

    it('should specify accurate health probe response matching HealthService contract', () => {
      const content = fs.readFileSync(runbookPath, 'utf8');

      expect(content).toContain('/api/health');
      expect(content).toContain('"success": true');
      expect(content).toContain('"status": "healthy"');
      expect(content).toContain('"database": "connected"');
      expect(content).not.toContain('"storage": "available"'); // Fictional property eliminated
    });

    it('should define preview deployments with explicit --tag and --no-traffic', () => {
      const content = fs.readFileSync(runbookPath, 'utf8');

      expect(content).toContain('--no-traffic');
      expect(content).toContain('--tag="${TAG_NAME}"');
      expect(content).toContain('TAG_NAME="preview-');
      expect(content).toContain('/api/health');
    });

    it('should verify health before executing revision rollbacks', () => {
      const content = fs.readFileSync(runbookPath, 'utf8');

      // Must check that revision is healthy / ready before rolling back
      expect(content).toContain('status.conditions.type:Ready AND status.conditions.status:True');
      expect(content).toContain('--to-revisions="${PREVIOUS_HEALTHY_REV}=100"');
    });

    it('should document real disaster recovery standard via MongoDB Atlas PITR', () => {
      const content = fs.readFileSync(runbookPath, 'utf8');

      expect(content).toContain('MongoDB Atlas Continuous Cloud Backups');
      expect(content).toContain('--dry-run');
    });
  });

  describe('Live Health Service Schema Integration', () => {
    it('should return health status matching the documented contract', async () => {
      const status = await healthService.getHealthStatus();

      expect(status).toHaveProperty('status');
      expect(['healthy', 'unhealthy']).toContain(status.status);
      expect(status).toHaveProperty('database');
      expect(['connected', 'disconnected']).toContain(status.database);
      expect(status).toHaveProperty('timestamp');
      expect(new Date(status.timestamp).getTime()).not.toBeNaN();
    });
  });
});
