import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('AE-230: Production Containerization & Docker Orchestration', () => {
  const rootDir = process.cwd();

  describe('1. Production Multi-Stage Dockerfile Verification', () => {
    const dockerfilePath = path.join(rootDir, 'Dockerfile');

    it('verifies Dockerfile exists and defines all 4 build stages', () => {
      expect(fs.existsSync(dockerfilePath)).toBe(true);
      const content = fs.readFileSync(dockerfilePath, 'utf-8');

      expect(content).toMatch(/FROM\s+node:20-slim\s+AS\s+base/i);
      expect(content).toMatch(/FROM\s+base\s+AS\s+deps/i);
      expect(content).toMatch(/FROM\s+base\s+AS\s+builder/i);
      expect(content).toMatch(/FROM\s+base\s+AS\s+runner/i);
    });

    it('verifies non-root user security configuration', () => {
      const content = fs.readFileSync(dockerfilePath, 'utf-8');

      expect(content).toMatch(/groupadd.*nodejs/i);
      expect(content).toMatch(/useradd.*nextjs/i);
      expect(content).toMatch(/USER\s+nextjs/i);
    });

    it('verifies system font and canvas rendering dependencies are installed', () => {
      const content = fs.readFileSync(dockerfilePath, 'utf-8');

      expect(content).toMatch(/fontconfig/);
      expect(content).toMatch(/fonts-dejavu-core/);
      expect(content).toMatch(/ca-certificates/);
      expect(content).toMatch(/curl/);
    });

    it('verifies port exposure and container healthcheck directive', () => {
      const content = fs.readFileSync(dockerfilePath, 'utf-8');

      expect(content).toMatch(/EXPOSE\s+3000/);
      expect(content).toMatch(/HEALTHCHECK/);
      expect(content).toMatch(/\/api\/health/);
      expect(content).toMatch(/CMD\s+\["npm",\s*"start"\]/);
    });
  });

  describe('2. Docker Ignore (.dockerignore) File Hygiene', () => {
    const dockerignorePath = path.join(rootDir, '.dockerignore');

    it('verifies .dockerignore exists and excludes build caches, git, and secrets', () => {
      expect(fs.existsSync(dockerignorePath)).toBe(true);
      const content = fs.readFileSync(dockerignorePath, 'utf-8');

      expect(content).toMatch(/^node_modules/m);
      expect(content).toMatch(/^\.next/m);
      expect(content).toMatch(/^\.git/m);
      expect(content).toMatch(/^\.env\*/m);
      expect(content).toMatch(/^!\.env\.example/m);
      expect(content).toMatch(/^coverage/m);
      expect(content).toMatch(/^scratch/m);
    });
  });

  describe('3. Docker Compose Orchestration (docker-compose.yml)', () => {
    const composePath = path.join(rootDir, 'docker-compose.yml');

    it('verifies docker-compose.yml defines required services and persistent volumes', () => {
      expect(fs.existsSync(composePath)).toBe(true);
      const content = fs.readFileSync(composePath, 'utf-8');

      // Verify app and mongodb services
      expect(content).toMatch(/app:/);
      expect(content).toMatch(/mongodb:/);
      expect(content).toMatch(/image:\s*mongo:7\.0/);

      // Verify dependency condition
      expect(content).toMatch(/depends_on:/);
      expect(content).toMatch(/condition:\s*service_healthy/);

      // Verify healthchecks for both services
      expect(content).toMatch(/\/api\/health/);
      expect(content).toMatch(/db\.adminCommand\('ping'\)/);

      // Verify persistent volumes
      expect(content).toMatch(/volumes:/);
      expect(content).toMatch(/mongo_data:/);
      expect(content).toMatch(/app_data:/);

      // Verify bridge network
      expect(content).toMatch(/evaluator_network:/);
      expect(content).toMatch(/driver:\s*bridge/);
    });

    it('verifies environment variables configured in compose satisfy required application secrets', () => {
      const content = fs.readFileSync(composePath, 'utf-8');

      expect(content).toMatch(/MONGODB_URI=mongodb:\/\/mongodb:27017\/assignment_evaluator/);
      expect(content).toMatch(/NEXTAUTH_URL=http:\/\/localhost:3000/);
      expect(content).toMatch(/NEXTAUTH_SECRET=/);
      expect(content).toMatch(/ORIGINAL_STORAGE_HMAC_SECRET=/);
      expect(content).toMatch(/ORIGINAL_STORAGE_PATH=\/app\/data\/originals/);
    });
  });
});
