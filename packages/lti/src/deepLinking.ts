export interface ContentItemSelection {
  type: 'ltiResourceLink';
  title: string;
  text?: string;
  url: string;
  custom?: Record<string, string>;
}

export class LtiDeepLinkingService {
  /**
   * Builds the Deep Linking response payload containing selected platform content items.
   */
  public static createResponsePayload(params: {
    iss: string;
    aud: string;
    deploymentId: string;
    data?: string;
    items: ContentItemSelection[];
  }): Record<string, unknown> {
    const now = Math.floor(Date.now() / 1000);
    return {
      iss: params.iss,
      aud: params.aud,
      exp: now + 300,
      iat: now,
      nonce: Math.random().toString(36).substring(2),
      'https://purl.imsglobal.org/spec/lti/claim/message_type': 'LtiDeepLinkingResponse',
      'https://purl.imsglobal.org/spec/lti/claim/version': '1.3.0',
      'https://purl.imsglobal.org/spec/lti/claim/deployment_id': params.deploymentId,
      'https://purl.imsglobal.org/spec/lti-dl/claim/data': params.data,
      'https://purl.imsglobal.org/spec/lti-dl/claim/content_items': params.items.map((item) => ({
        type: item.type,
        title: item.title,
        text: item.text,
        url: item.url,
        custom: item.custom || {},
      })),
    };
  }
}
