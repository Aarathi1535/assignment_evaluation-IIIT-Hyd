import crypto from 'crypto';
import { LinkingSessionState, FederationLinkRecord } from './types';

// In-memory linking session store with 10-minute TTL
const activeLinkingSessions = new Map<string, LinkingSessionState>();

export class FederationManager {
  /**
   * Step 1: Initiates linking round-trip from consumer product settings.
   */
  public static initiateLinking(params: {
    targetProduct: 'EVALUATION' | 'CLASSROOM' | 'PRACTICE';
    localUserId: string;
    ttlMinutes?: number;
  }): { state: string; nonce: string } {
    const state = crypto.randomBytes(24).toString('hex');
    const nonce = crypto.randomBytes(24).toString('hex');
    const ttl = (params.ttlMinutes || 10) * 60 * 1000;

    activeLinkingSessions.set(state, {
      state,
      nonce,
      targetProduct: params.targetProduct,
      localUserId: params.localUserId,
      expiresAt: Date.now() + ttl,
    });

    return { state, nonce };
  }

  /**
   * Step 2: Validates state and nonce on return callback.
   */
  public static validateCallback(
    returnedState: string,
    returnedNonce: string
  ): LinkingSessionState {
    const session = activeLinkingSessions.get(returnedState);
    if (!session) {
      throw new Error('Invalid or expired linking state. Please initiate linking again.');
    }

    if (Date.now() > session.expiresAt) {
      activeLinkingSessions.delete(returnedState);
      throw new Error('Linking state has expired. Please initiate linking again.');
    }

    if (session.nonce !== returnedNonce) {
      activeLinkingSessions.delete(returnedState);
      throw new Error('Cryptographic nonce mismatch in linking callback.');
    }

    // Single-use token consumed
    activeLinkingSessions.delete(returnedState);
    return session;
  }

  /**
   * Step 3: Creates link record for UserFederationLink table.
   */
  public static createLinkRecord(params: {
    platformUserId: string;
    localUserId: string;
    product: 'EVALUATION' | 'CLASSROOM' | 'PRACTICE';
    linkedBy: string;
  }): FederationLinkRecord {
    return {
      platformUserId: params.platformUserId,
      localUserId: params.localUserId,
      product: params.product,
      linkedAt: new Date(),
      linkedBy: params.linkedBy,
    };
  }

  /**
   * Cleans expired states.
   */
  public static pruneExpired(): void {
    const now = Date.now();
    for (const [state, session] of activeLinkingSessions.entries()) {
      if (session.expiresAt < now) {
        activeLinkingSessions.delete(state);
      }
    }
  }
}
