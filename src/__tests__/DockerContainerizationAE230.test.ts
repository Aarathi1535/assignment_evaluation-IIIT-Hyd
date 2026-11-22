import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import nextConfig from '../../next.config';
import { GET as healthGET } from '../app/api/health/route';

describe('AE-230: Production Containerization & Docker Orchestration', () => {
  const rootDir = process.cwd();

  describe('1. Next.js Standalone Configuration & Build Optimization', () => {
    it('verifies next.config.ts enables standalone output mode for container optimization', () => {
      expect(nextConfig.output).toBe('standalone');
      expect(nextConfig.serverExternalPackages).toContain('@napi-rs/canvas');
      expect(nextConfig.serverExternalPackages).toContain('pdfjs-dist');
    });
  });

  describe('2. Production Dockerfile Multi-Stage Verification', () => {
    const dockerfilePath = path.join(rootDir, 'Dockerfile');

    it('verifies Dockerfile strictly enforces reproducible npm ci without fallback to npm install', () => {
      expect(fs.existsSync(dockerfilePath)).toBe(true);
      const content = fs.readFileSync(dockerfilePath, 'utf-8');

      // Verify no fallback to npm install which could hide lockfile drift
      expect(content).toMatch(/npm ci --ignore-scripts/);
      expect(content).not.toMatch(/npm ci.*\|\|\s*npm install/);
    });

    it('verifies runner stage copies standalone build output and drops root privileges', () => {
      const content = fs.readFileSync(dockerfilePath, 'utf-8');

      // Standalone output copy
      expect(content).toMatch(/\.next\/standalone/);
      expect(content).toMatch(/CMD\s+\["node",\s*"server\.js"\]/);

      // Non-root user
      expect(content).toMatch(/useradd.*nextjs/i);
      expect(content).toMatch(/USER\s+nextjs/);
    });
  });

  describe('3. Docker Compose Replica Set & Network Security', () => {
    const composePath = path.join(rootDir, 'docker-compose.yml');

    it('verifies docker-compose.yml configures MongoDB replica set for transaction support', () => {
      expect(fs.existsSync(composePath)).toBe(true);
      const content = fs.readFileSync(composePath, 'utf-8');

      // MongoDB must start with replica set flag
      expect(content).toMatch(/--replSet/);
      expect(content).toMatch(/rs0/);

      // Application MONGODB_URI must include replicaSet=rs0
      expect(content).toMatch(/replicaSet=rs0/);
    });

    it('verifies MongoDB port is not exposed directly to host without authentication', () => {
      const content = fs.readFileSync(composePath, 'utf-8');
      const mongoSection = content.split('mongodb:')[1]?.split('volumes:')[0] || '';

      // Host port 27017:27017 must not be exposed on the host
      expect(mongoSection).not.toMatch(/ports:\s*-\s*["']?27017:27017/);
    });
  });

  describe('4. Application Health Endpoint for Container Health Checks', () => {
    it('verifies GET /api/health responds with 200/503 status code for container health probes', async () => {
      const res = await healthGET();
      expect([200, 503]).toContain(res.status);
      const data = await res.json();
      expect(data).toHaveProperty('success');
    });
  });
});
