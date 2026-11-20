import { describe, it, expect, vi } from 'vitest';
import {
  ApiClientError,
  ClassroomApiClient,
  PracticeApiClient,
} from '@cvit/api-client';

describe('Typed API Client Package (@cvit/api-client)', () => {
  it('injects x-request-id and Authorization bearer token into outbound requests', async () => {
    let capturedHeaders: HeadersInit | undefined;

    const mockFetch = vi.fn().mockImplementation((url, init) => {
      capturedHeaders = init?.headers;
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ status: 'healthy', uptime: 100 }),
      });
    });

    vi.stubGlobal('fetch', mockFetch);

    const client = new ClassroomApiClient({
      baseUrl: 'http://test-classroom.local/api/v1/classroom',
      authToken: 'test-signed-jwt-token',
    });

    const res = await client.getHealth();
    expect(res.status).toBe('healthy');

    const headersRecord = capturedHeaders as Record<string, string>;
    expect(headersRecord['Authorization']).toBe('Bearer test-signed-jwt-token');
    expect(headersRecord['x-request-id']).toBeDefined();

    vi.unstubAllGlobals();
  });

  it('parses RFC 7807 problem details when server returns 4xx error', async () => {
    const mockProblem = {
      type: 'https://errors.iiit.ac.in/validation/bad-request',
      title: 'Bad Request',
      status: 400,
      detail: 'Invalid 6-character session code format.',
    };

    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      statusText: 'Bad Request',
      json: () => Promise.resolve(mockProblem),
    });

    vi.stubGlobal('fetch', mockFetch);

    const client = new ClassroomApiClient({ baseUrl: 'http://test-classroom.local' });

    await expect(client.getSessionByCode('INVALID_CODE')).rejects.toThrow(ApiClientError);

    try {
      await client.getSessionByCode('INVALID_CODE');
    } catch (err: unknown) {
      const clientErr = err as ApiClientError;
      expect(clientErr.status).toBe(400);
      expect(clientErr.message).toBe('Invalid 6-character session code format.');
      expect(clientErr.problem?.type).toBe('https://errors.iiit.ac.in/validation/bad-request');
    }

    vi.unstubAllGlobals();
  });

  it('retries request on transient 503 error with exponential backoff', async () => {
    let callCount = 0;
    const mockFetch = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve({
          ok: false,
          status: 503,
          statusText: 'Service Unavailable',
          json: () => Promise.resolve({ detail: 'Service transiently unavailable' }),
        });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ status: 'healthy', uptime: 200 }),
      });
    });

    vi.stubGlobal('fetch', mockFetch);

    const client = new PracticeApiClient({
      baseUrl: 'http://test-practice.local',
      maxRetries: 2,
    });

    const res = await client.getHealth();
    expect(res.status).toBe('healthy');
    expect(callCount).toBe(2); // Retried once and succeeded

    vi.unstubAllGlobals();
  });
});
