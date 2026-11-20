import crypto from 'crypto';
import { ClientConfig, ProblemDetails } from './types';

export class ApiClientError extends Error {
  public readonly status: number;
  public readonly problem?: ProblemDetails;
  public readonly requestId?: string;

  constructor(message: string, status: number, problem?: ProblemDetails, requestId?: string) {
    super(message);
    this.name = 'ApiClientError';
    this.status = status;
    this.problem = problem;
    this.requestId = requestId;
  }
}

export class BaseApiClient {
  protected baseUrl: string;
  protected authToken?: string;
  protected apiKey?: string;
  protected timeoutMs: number;
  protected maxRetries: number;
  protected defaultHeaders: Record<string, string>;

  constructor(config: ClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.authToken = config.authToken;
    this.apiKey = config.apiKey;
    this.timeoutMs = config.timeoutMs ?? 15000;
    this.maxRetries = config.maxRetries ?? 2;
    this.defaultHeaders = config.defaultHeaders || {};
  }

  public setAuthToken(token: string | undefined): void {
    this.authToken = token;
  }

  protected async request<T>(
    endpoint: string,
    options: {
      method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
      body?: unknown;
      headers?: Record<string, string>;
      query?: Record<string, string | number | boolean | undefined>;
    } = {}
  ): Promise<T> {
    const method = options.method || 'GET';
    const requestId = crypto.randomUUID();

    let urlStr = `${this.baseUrl}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`;
    if (options.query) {
      const searchParams = new URLSearchParams();
      for (const [k, v] of Object.entries(options.query)) {
        if (v !== undefined) searchParams.append(k, String(v));
      }
      const qs = searchParams.toString();
      if (qs) urlStr += `?${qs}`;
    }

    const headers: Record<string, string> = {
      Accept: 'application/json, application/problem+json',
      'x-request-id': requestId,
      ...this.defaultHeaders,
      ...options.headers,
    };

    if (this.authToken) {
      headers['Authorization'] = `Bearer ${this.authToken}`;
    } else if (this.apiKey) {
      headers['x-api-key'] = this.apiKey;
    }

    if (options.body && !(options.body instanceof FormData)) {
      headers['Content-Type'] = 'application/json';
    }

    let attempt = 0;
    let delay = 300;

    while (true) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

      try {
        const response = await fetch(urlStr, {
          method,
          headers,
          body: options.body
            ? options.body instanceof FormData
              ? options.body
              : JSON.stringify(options.body)
            : undefined,
          signal: controller.signal,
        });

        if (response.ok) {
          if (response.status === 204) return {} as T;
          return (await response.json()) as T;
        }

        // Parse RFC 7807 problem details or standard error
        let problem: ProblemDetails | undefined;
        try {
          problem = (await response.json()) as ProblemDetails;
        } catch {
          problem = undefined;
        }

        const errorMessage =
          problem?.detail || problem?.title || `HTTP ${response.status} ${response.statusText}`;

        // Retry on 502/503/504 transient server errors
        if ([502, 503, 504].includes(response.status) && attempt < this.maxRetries) {
          attempt++;
          await new Promise((res) => setTimeout(res, delay));
          delay *= 2;
          continue;
        }

        throw new ApiClientError(errorMessage, response.status, problem, requestId);
      } catch (err: unknown) {
        if (err instanceof ApiClientError) throw err;

        if (attempt < this.maxRetries) {
          attempt++;
          await new Promise((res) => setTimeout(res, delay));
          delay *= 2;
          continue;
        }

        throw new ApiClientError(
          `Network or timeout error contacting ${urlStr}: ${(err as Error).message}`,
          503,
          undefined,
          requestId
        );
      } finally {
        clearTimeout(timeout);
      }
    }
  }
}
