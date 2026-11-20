import { LtiMember } from './types';

export interface NrpsClientConfig {
  membershipsUrl?: string;
  accessToken?: string;
  isStubMode?: boolean;
}

export class LtiNrpsService {
  private readonly membershipsUrl?: string;
  private readonly accessToken?: string;
  private readonly isStubMode: boolean;

  constructor(config: NrpsClientConfig = {}) {
    this.membershipsUrl = config.membershipsUrl;
    this.accessToken = config.accessToken;
    this.isStubMode =
      config.isStubMode ??
      (process.env.LTI_STUB_MODE === 'true' || process.env.NODE_ENV === 'test');
  }

  /**
   * Syncs course roster members from LMS platform.
   */
  public async getMembers(targetUrl?: string): Promise<LtiMember[]> {
    const url = targetUrl || this.membershipsUrl;

    if (this.isStubMode || !url) {
      // Safe stub mode returns mock course roster
      return [
        {
          status: 'Active',
          name: 'Prof. C.V. Jawahar',
          given_name: 'C.V.',
          family_name: 'Jawahar',
          email: 'jawahar@iiit.ac.in',
          user_id: 'lms-prof-001',
          roles: ['http://purl.imsglobal.org/vocab/lis/v2/membership#Instructor'],
        },
        {
          status: 'Active',
          name: 'Aarathi Sree',
          given_name: 'Aarathi',
          family_name: 'Sree',
          email: 'aarathi@iiit.ac.in',
          user_id: 'lms-student-101',
          roles: ['http://purl.imsglobal.org/vocab/lis/v2/membership#Learner'],
          lis_person_sourcedid: '2026101',
        },
      ];
    }

    const headers: Record<string, string> = {
      Accept: 'application/vnd.ims.lti-nrps.v2.membershipcontainer+json',
    };
    if (this.accessToken) {
      headers['Authorization'] = `Bearer ${this.accessToken}`;
    }

    const res = await fetch(url, { headers });
    if (!res.ok) {
      throw new Error(`LTI NRPS roster fetch failed (${res.status}): ${await res.text()}`);
    }

    const data = await res.json();
    return data.members || [];
  }
}
