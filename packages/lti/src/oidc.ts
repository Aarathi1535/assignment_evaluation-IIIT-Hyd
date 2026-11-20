import crypto from 'crypto';
import { LtiPlatformRegistration, LtiLaunchClaims } from './types';

// In-memory nonce/state store for OIDC launch with 10-minute TTL
const activeOidcStates = new Map<string, { nonce: string; platformId: string; expiresAt: number }>();

export class LtiOidcManager {
  /**
   * Generates OIDC authorization initiation parameters when LMS calls tool login initiation.
   */
  public static initiateLogin(params: {
    iss: string;
    loginHint: string;
    targetLinkUri: string;
    ltiMessageHint?: string;
    platform: LtiPlatformRegistration;
  }): { authUrl: string; state: string; nonce: string } {
    const state = crypto.randomBytes(24).toString('hex');
    const nonce = crypto.randomBytes(24).toString('hex');
    const ttl = 10 * 60 * 1000; // 10 minutes

    activeOidcStates.set(state, {
      nonce,
      platformId: params.iss,
      expiresAt: Date.now() + ttl,
    });

    const url = new URL(params.platform.authEndpoint);
    url.searchParams.set('response_type', 'id_token');
    url.searchParams.set('scope', 'openid');
    url.searchParams.set('client_id', params.platform.clientId);
    url.searchParams.set('redirect_uri', params.targetLinkUri);
    url.searchParams.set('login_hint', params.loginHint);
    url.searchParams.set('state', state);
    url.searchParams.set('nonce', nonce);
    url.searchParams.set('response_mode', 'form_post');
    url.searchParams.set('prompt', 'none');
    if (params.ltiMessageHint) {
      url.searchParams.set('lti_message_hint', params.ltiMessageHint);
    }

    return { authUrl: url.toString(), state, nonce };
  }

  /**
   * Validates launch state and nonce upon id_token callback form_post.
   */
  public static validateLaunchState(state: string, nonce: string): boolean {
    const session = activeOidcStates.get(state);
    if (!session) {
      throw new Error('Invalid or expired LTI launch state.');
    }

    if (Date.now() > session.expiresAt) {
      activeOidcStates.delete(state);
      throw new Error('LTI launch state expired.');
    }

    if (session.nonce !== nonce) {
      activeOidcStates.delete(state);
      throw new Error('LTI cryptographic nonce mismatch.');
    }

    // State consumed once
    activeOidcStates.delete(state);
    return true;
  }

  /**
   * Decodes and validates required LTI 1.3 launch claims from id_token.
   */
  public static parseLaunchToken(idToken: string): LtiLaunchClaims {
    if (!idToken || typeof idToken !== 'string') {
      throw new Error('Missing LTI id_token');
    }

    const parts = idToken.split('.');
    if (parts.length !== 3) {
      throw new Error('Invalid JWT format in LTI id_token');
    }

    let payloadStr = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    while (payloadStr.length % 4) {
      payloadStr += '=';
    }

    const claims = JSON.parse(Buffer.from(payloadStr, 'base64').toString('utf8')) as LtiLaunchClaims;

    if (claims['https://purl.imsglobal.org/spec/lti/claim/version'] !== '1.3.0') {
      throw new Error('Unsupported LTI version. Expected 1.3.0');
    }

    const messageType = claims['https://purl.imsglobal.org/spec/lti/claim/message_type'];
    if (messageType !== 'LtiResourceLinkRequest' && messageType !== 'LtiDeepLinkingRequest') {
      throw new Error(`Unsupported LTI message type: ${messageType}`);
    }

    return claims;
  }
}
