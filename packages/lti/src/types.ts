export interface LtiPlatformRegistration {
  id: string;
  platformId: string;       // Issuer (iss), e.g., 'https://canvas.instructure.com'
  clientId: string;         // Tool Client ID
  authEndpoint: string;     // Platform OIDC authorization endpoint
  tokenEndpoint: string;    // Platform OAuth2 token endpoint
  jwksEndpoint: string;     // Platform public keys JWKS endpoint
  name: string;             // LMS Name ('Canvas', 'Moodle', etc.)
  isActive: boolean;
}

export interface LtiLaunchClaims {
  iss: string;
  sub: string;
  aud: string | string[];
  exp: number;
  iat: number;
  nonce: string;
  'https://purl.imsglobal.org/spec/lti/claim/message_type': 'LtiResourceLinkRequest' | 'LtiDeepLinkingRequest';
  'https://purl.imsglobal.org/spec/lti/claim/version': '1.3.0';
  'https://purl.imsglobal.org/spec/lti/claim/deployment_id': string;
  'https://purl.imsglobal.org/spec/lti/claim/target_link_uri': string;
  'https://purl.imsglobal.org/spec/lti/claim/resource_link'?: {
    id: string;
    title?: string;
    description?: string;
  };
  'https://purl.imsglobal.org/spec/lti/claim/roles': string[];
  'https://purl.imsglobal.org/spec/lti/claim/context'?: {
    id: string;
    label?: string;
    title?: string;
    type?: string[];
  };
  'https://purl.imsglobal.org/spec/lti-ags/claim/endpoint'?: {
    scope: string[];
    lineitems?: string;
    lineitem?: string;
  };
  'https://purl.imsglobal.org/spec/lti-nrps/claim/namesroleservice'?: {
    context_memberships_url: string;
    service_versions: string[];
  };
  email?: string;
  name?: string;
  given_name?: string;
  family_name?: string;
}

export interface LtiScorePayload {
  userId: string;
  scoreGiven: number;
  scoreMaximum: number;
  comment?: string;
  timestamp: string;
  activityProgress: 'Initialized' | 'Started' | 'InProgress' | 'Submitted' | 'Completed';
  gradingProgress: 'FullyGraded' | 'Pending' | 'PendingManual' | 'Failed' | 'NotReady';
}

export interface LtiLineItem {
  id?: string;
  scoreMaximum: number;
  label: string;
  resourceId?: string;
  tag?: string;
}

export interface LtiMember {
  status: 'Active' | 'Inactive' | 'Deleted';
  name: string;
  picture?: string;
  given_name?: string;
  family_name?: string;
  email?: string;
  user_id: string;
  roles: string[];
  lis_person_sourcedid?: string;
}
