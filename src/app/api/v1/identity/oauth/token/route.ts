import { NextRequest, NextResponse } from 'next/server';
import { connectIdentityDB } from '@/lib/identityDb';
import ApiClientCredential from '@/models/identity/ApiClientCredential';
import { ServiceAuthManager, signPlatformToken, ServiceAudience } from '@cvit/auth';

export async function POST(req: NextRequest) {
  try {
    await connectIdentityDB();
    const contentType = req.headers.get('content-type') || '';
    let grantType: string | null = null;
    let clientId: string | null = null;
    let clientSecret: string | null = null;
    let audience: string | null = null;

    if (contentType.includes('application/x-www-form-urlencoded')) {
      const formData = await req.formData();
      grantType = formData.get('grant_type') as string;
      clientId = formData.get('client_id') as string;
      clientSecret = formData.get('client_secret') as string;
      audience = formData.get('audience') as string;
    } else {
      const body = await req.json();
      grantType = body.grant_type;
      clientId = body.client_id;
      clientSecret = body.client_secret;
      audience = body.audience;
    }

    // Check Basic Auth header fallback (RFC 6749)
    const authHeader = req.headers.get('authorization');
    if (authHeader && authHeader.startsWith('Basic ')) {
      const decoded = Buffer.from(authHeader.substring(6), 'base64').toString('utf8');
      const [u, p] = decoded.split(':');
      clientId = u;
      clientSecret = p;
    }

    if (grantType !== 'client_credentials') {
      return NextResponse.json(
        {
          error: 'unsupported_grant_type',
          error_description: "Grant type must be 'client_credentials'.",
        },
        { status: 400 }
      );
    }

    if (!clientId || !clientSecret) {
      return NextResponse.json(
        {
          error: 'invalid_client',
          error_description: 'client_id and client_secret are required.',
        },
        { status: 401 }
      );
    }

    const client = await ApiClientCredential.findOne({ clientId, isActive: true });
    if (!client) {
      return NextResponse.json(
        {
          error: 'invalid_client',
          error_description: 'Client authentication failed.',
        },
        { status: 401 }
      );
    }

    const isValid = ServiceAuthManager.verifyCredentials(clientSecret, {
      clientId: client.clientId,
      clientSecretHash: client.clientSecretHash,
      name: client.name,
      ownerId: client.ownerId,
      scopes: client.scopes as any,
      isActive: client.isActive,
      createdAt: client.createdAt,
      expiresAt: client.expiresAt,
    });

    if (!isValid) {
      return NextResponse.json(
        {
          error: 'invalid_client',
          error_description: 'Client credentials invalid or expired.',
        },
        { status: 401 }
      );
    }

    client.lastUsedAt = new Date();
    await client.save();

    const targetAudience: ServiceAudience =
      (audience as ServiceAudience) || 'evaluation-service';

    const token = signPlatformToken({
      sub: client.clientId,
      role: 'ADMIN', // Service clients operate with machine admin scopes
      email: `${client.clientId}@machines.iiit.ac.in`,
      name: client.name,
      audience: targetAudience,
      permissions: ['service:machine', ...client.scopes.map((s) => `${s.service}:${s.actions.join(',')}`)],
      expiresInSeconds: 3600, // 1 hour for machine credentials
    });

    return NextResponse.json({
      access_token: token,
      token_type: 'Bearer',
      expires_in: 3600,
      scope: client.scopes.map((s) => `${s.service}`).join(' '),
    });
  } catch (err: unknown) {
    return NextResponse.json(
      {
        error: 'server_error',
        error_description: (err as Error).message,
      },
      { status: 500 }
    );
  }
}
