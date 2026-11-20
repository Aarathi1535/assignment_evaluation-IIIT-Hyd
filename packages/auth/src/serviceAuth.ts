import crypto from 'crypto';
import { ApiClientCredentials, ApiClientScope, ServiceAudience } from './types';

export class ServiceAuthManager {
  /**
   * Generates a new API client credential pair.
   */
  public static generateClientCredentials(params: {
    name: string;
    ownerId: string;
    scopes: ApiClientScope[];
    expiresInDays?: number;
  }): { clientId: string; clientSecret: string; credentialRecord: ApiClientCredentials } {
    const clientId = `client_${crypto.randomBytes(12).toString('hex')}`;
    const clientSecret = `sec_${crypto.randomBytes(32).toString('hex')}`;

    const clientSecretHash = crypto.createHash('sha256').update(clientSecret).digest('hex');

    const expiresAt = params.expiresInDays
      ? new Date(Date.now() + params.expiresInDays * 24 * 60 * 60 * 1000)
      : undefined;

    const credentialRecord: ApiClientCredentials = {
      clientId,
      clientSecretHash,
      name: params.name,
      ownerId: params.ownerId,
      scopes: params.scopes,
      isActive: true,
      createdAt: new Date(),
      expiresAt,
    };

    return { clientId, clientSecret, credentialRecord };
  }

  /**
   * Verifies client credentials against stored client record.
   */
  public static verifyCredentials(
    candidateSecret: string,
    record: ApiClientCredentials
  ): boolean {
    if (!record.isActive) return false;
    if (record.expiresAt && record.expiresAt.getTime() < Date.now()) return false;

    const candidateHash = crypto.createHash('sha256').update(candidateSecret).digest('hex');
    return crypto.timingSafeEqual(Buffer.from(candidateHash), Buffer.from(record.clientSecretHash));
  }

  /**
   * Checks whether the client has permission for the specified service and action.
   */
  public static hasScope(
    record: ApiClientCredentials,
    service: ServiceAudience,
    action: 'read' | 'write' | 'admin'
  ): boolean {
    const serviceScope = record.scopes.find((s) => s.service === service);
    if (!serviceScope) return false;
    if (serviceScope.actions.includes('admin')) return true;
    return serviceScope.actions.includes(action);
  }
}
