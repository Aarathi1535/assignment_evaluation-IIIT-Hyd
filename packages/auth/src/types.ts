export type PlatformRole = 'ADMIN' | 'PROFESSOR' | 'TA' | 'STUDENT';

export type ServiceAudience = 'evaluation-service' | 'classroom-service' | 'practice-service' | 'identity-service';

export interface PlatformUserClaims {
  sub: string;               // Unique platform user id
  iss: string;               // Issuer URL (e.g. https://auth.iiit.ac.in)
  aud: string;               // Target service audience
  role: PlatformRole;
  email: string;
  name: string;
  exp: number;               // Expiry timestamp (seconds)
  iat: number;               // Issued at (seconds)
  jti: string;               // Unique JWT ID for revocation
  courseIds?: string[];
  permissions?: string[];
}

export interface ApiClientScope {
  service: ServiceAudience;
  actions: ('read' | 'write' | 'admin')[];
}

export interface ApiClientCredentials {
  clientId: string;
  clientSecretHash: string;
  name: string;
  ownerId: string;
  scopes: ApiClientScope[];
  isActive: boolean;
  createdAt: Date;
  expiresAt?: Date;
}

export interface FederationLinkRecord {
  platformUserId: string;
  localUserId: string;
  product: 'EVALUATION' | 'CLASSROOM' | 'PRACTICE';
  linkedAt: Date;
  linkedBy: string;
}

export interface LinkingSessionState {
  state: string;
  nonce: string;
  platformUserId?: string;
  targetProduct: 'EVALUATION' | 'CLASSROOM' | 'PRACTICE';
  localUserId: string;
  expiresAt: number;
}
