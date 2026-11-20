import { describe, it, expect } from 'vitest';
import {
  LtiOidcManager,
  LtiAgsService,
  LtiNrpsService,
  LtiDeepLinkingService,
  LtiPlatformRegistration,
} from '@cvit/lti';

describe('LTI 1.3 Advantage Integration Package (@cvit/lti)', () => {
  const mockPlatform: LtiPlatformRegistration = {
    id: 'moodle-iiit',
    platformId: 'https://moodle.iiit.ac.in',
    clientId: 'iiit-learning-tool-client-id',
    authEndpoint: 'https://moodle.iiit.ac.in/mod/lti/auth.php',
    tokenEndpoint: 'https://moodle.iiit.ac.in/mod/lti/token.php',
    jwksEndpoint: 'https://moodle.iiit.ac.in/mod/lti/certs.php',
    name: 'IIIT Moodle',
    isActive: true,
  };

  it('initiates OIDC login flow with state and nonce parameters', () => {
    const { authUrl, state, nonce } = LtiOidcManager.initiateLogin({
      iss: mockPlatform.platformId,
      loginHint: 'user-77',
      targetLinkUri: 'https://platform.iiit.ac.in/api/lti/launch',
      platform: mockPlatform,
    });

    expect(authUrl).toContain('https://moodle.iiit.ac.in/mod/lti/auth.php');
    expect(authUrl).toContain(`state=${state}`);
    expect(authUrl).toContain(`nonce=${nonce}`);
    expect(authUrl).toContain('response_type=id_token');

    // Validates single-use state & nonce match
    expect(LtiOidcManager.validateLaunchState(state, nonce)).toBe(true);

    // Second validation attempt must throw
    expect(() => LtiOidcManager.validateLaunchState(state, nonce)).toThrow();
  });

  it('submits grades via Assignment and Grade Services (AGS 2.0) in safe stub mode', async () => {
    const ags = new LtiAgsService({ isStubMode: true });
    const payload = LtiAgsService.createScorePayload({
      studentLmsSub: 'moodle-student-99',
      points: 45,
      maxPoints: 50,
      comment: 'Excellent performance in Midterm 1',
    });

    const result = await ags.submitScore(payload);
    expect(result.success).toBe(true);
    expect(result.statusCode).toBe(200);
    expect(result.responseData).toBeDefined();
  });

  it('retrieves course members via Names and Role Provisioning Services (NRPS 2.0)', async () => {
    const nrps = new LtiNrpsService({ isStubMode: true });
    const members = await nrps.getMembers();

    expect(members.length).toBeGreaterThan(0);
    expect(members[0].email).toBe('jawahar@iiit.ac.in');
    expect(members[1].lis_person_sourcedid).toBe('2026101');
  });

  it('constructs Deep Linking 2.0 response payload', () => {
    const response = LtiDeepLinkingService.createResponsePayload({
      iss: 'https://platform.iiit.ac.in',
      aud: mockPlatform.platformId,
      deploymentId: 'dep-101',
      items: [
        {
          type: 'ltiResourceLink',
          title: 'Classroom Poll: Computer Vision Intro',
          url: 'https://platform.iiit.ac.in/classroom/join/CV101A',
        },
      ],
    });

    expect(response['https://purl.imsglobal.org/spec/lti/claim/message_type']).toBe('LtiDeepLinkingResponse');
    expect(response['https://purl.imsglobal.org/spec/lti-dl/claim/content_items']).toBeDefined();
  });
});
