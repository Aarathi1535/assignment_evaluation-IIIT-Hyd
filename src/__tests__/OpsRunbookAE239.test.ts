import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('AE-239: Operations Runbook and Multi-Environment Deployment Guide', () => {
  const rootDir = process.cwd();
  const runbookPath = path.join(rootDir, 'docs', 'OPERATIONS_RUNBOOK.md');

  it('should exist and define multi-environment deployment topology', () => {
    expect(fs.existsSync(runbookPath)).toBe(true);
    const content = fs.readFileSync(runbookPath, 'utf8');

    expect(content).toContain('Local Development Environment');
    expect(content).toContain('Staging Environment');
    expect(content).toContain('Production Environment');
    expect(content).toContain('docker-compose.yml');
    expect(content).toContain('deploy/cloudrun-service.yaml');
    expect(content).toContain('deploy/autoscaling-policy.yaml');
  });

  it('should document secret management and GCP Secret Manager integrations', () => {
    const content = fs.readFileSync(runbookPath, 'utf8');

    expect(content).toContain('evaluator-mongodb-uri');
    expect(content).toContain('evaluator-nextauth-secret');
    expect(content).toContain('evaluator-original-hmac-secret');
    expect(content).toContain('evaluator-watermark-hmac-secret');
    expect(content).toContain('roles/secretmanager.secretAccessor');
  });

  it('should define health probes, SLOs, and telemetry standards', () => {
    const content = fs.readFileSync(runbookPath, 'utf8');

    expect(content).toContain('/api/health');
    expect(content).toContain('Startup Probe');
    expect(content).toContain('Liveness Probe');
    expect(content).toContain('99.9% uptime');
    expect(content).toContain('200');
  });

  it('should provide comprehensive incident response playbooks for Sev 1 and Sev 2 alerts', () => {
    const content = fs.readFileSync(runbookPath, 'utf8');

    // Playbook 1: DB Connection Pool
    expect(content).toContain('Playbook 1: Database Connection Pool Exhaustion');
    expect(content).toContain('MongoServerSelectionError');
    expect(content).toContain('--max-instances=5');

    // Playbook 2: OOMKill
    expect(content).toContain('Playbook 2: Container Out-Of-Memory');
    expect(content).toContain('Exit Code');
    expect(content).toContain('137');
    expect(content).toContain('memory: "4Gi"');

    // Playbook 3: Asset Tampering / HMAC Mismatch
    expect(content).toContain('Playbook 3: Cryptographic HMAC Signature Mismatch');
    expect(content).toContain('HMAC signature verification failed');
    expect(content).toContain('verifyIntegrity.ts');

    // Playbook 4: Queue Congestion
    expect(content).toContain('Playbook 4: Batch Ingestion Queue Congestion');
    expect(content).toContain('repairDerivedPages.ts');
  });

  it('should document zero-downtime deployment and instant revision rollback commands', () => {
    const content = fs.readFileSync(runbookPath, 'utf8');

    expect(content).toContain('Rolling Blue-Green Deployment');
    expect(content).toContain('--no-traffic');
    expect(content).toContain('--to-latest');
    expect(content).toContain('Instantaneous Revision Rollback');
    expect(content).toContain('--to-revisions=');
  });

  it('should document disaster recovery verification drills and script commands', () => {
    const content = fs.readFileSync(runbookPath, 'utf8');

    expect(content).toContain('backupDatabase.ts');
    expect(content).toContain('restoreDatabase.ts');
    expect(content).toContain('--dry-run');
    expect(content).toContain('verifyIntegrity.ts');
  });
});
