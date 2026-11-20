import { BaseApiClient } from './base';
import { ApiResponse, ClientConfig } from './types';

export interface IdentityUserDto {
  id: string;
  name: string;
  email: string;
  role: 'ADMIN' | 'PROFESSOR' | 'TA' | 'STUDENT';
  department?: string;
  rollNumber?: string;
  courses?: string[];
}

export class IdentityApiClient extends BaseApiClient {
  constructor(config?: Partial<ClientConfig>) {
    super({
      baseUrl: config?.baseUrl || process.env.IDENTITY_SERVICE_URL || 'http://localhost:3000/api/v1/identity',
      authToken: config?.authToken,
      apiKey: config?.apiKey,
      timeoutMs: config?.timeoutMs,
      maxRetries: config?.maxRetries,
    });
  }

  public async register(user: {
    name: string;
    email: string;
    password: string;
    role?: string;
    department?: string;
    rollNumber?: string;
    adminInviteCode?: string;
  }): Promise<ApiResponse<IdentityUserDto>> {
    return this.request<ApiResponse<IdentityUserDto>>('/auth/register', {
      method: 'POST',
      body: user,
    });
  }

  public async login(credentials: {
    email: string;
    password: string;
    audience?: string;
  }): Promise<ApiResponse<{ token: string; user: IdentityUserDto }>> {
    return this.request<ApiResponse<{ token: string; user: IdentityUserDto }>>('/auth/login', {
      method: 'POST',
      body: credentials,
    });
  }

  public async getProfile(): Promise<ApiResponse<IdentityUserDto>> {
    return this.request<ApiResponse<IdentityUserDto>>('/auth/me');
  }

  public async exchangeClientCredentials(params: {
    clientId: string;
    clientSecret: string;
    audience?: string;
  }): Promise<{ access_token: string; token_type: string; expires_in: number }> {
    return this.request<{ access_token: string; token_type: string; expires_in: number }>('/oauth/token', {
      method: 'POST',
      body: {
        grant_type: 'client_credentials',
        client_id: params.clientId,
        client_secret: params.clientSecret,
        audience: params.audience,
      },
    });
  }
}
