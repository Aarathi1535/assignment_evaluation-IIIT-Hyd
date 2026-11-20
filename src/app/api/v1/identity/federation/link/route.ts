import { NextRequest, NextResponse } from 'next/server';
import { authenticatePlatformToken, FederationManager } from '@cvit/auth';
import { connectIdentityDB } from '@/lib/identityDb';
import UserFederationLink from '@/models/identity/UserFederationLink';

export async function POST(req: NextRequest) {
  const auth = authenticatePlatformToken(req);
  if (!auth.authorized) {
    return auth.response!;
  }

  try {
    await connectIdentityDB();
    const body = await req.json();
    const { action, targetProduct, localUserId, state, nonce } = body;

    if (action === 'initiate') {
      if (!targetProduct || !localUserId) {
        return NextResponse.json(
          {
            type: 'https://errors.iiit.ac.in/validation/missing-fields',
            title: 'Validation Error',
            status: 400,
            detail: 'targetProduct and localUserId are required to initiate linking.',
          },
          { status: 400 }
        );
      }

      const linkingSession = FederationManager.initiateLinking({
        targetProduct,
        localUserId,
        ttlMinutes: 10,
      });

      return NextResponse.json({
        success: true,
        data: linkingSession,
      });
    }

    if (action === 'complete') {
      if (!state || !nonce || !targetProduct || !localUserId) {
        return NextResponse.json(
          {
            type: 'https://errors.iiit.ac.in/validation/missing-fields',
            title: 'Validation Error',
            status: 400,
            detail: 'state, nonce, targetProduct, and localUserId are required to complete linking.',
          },
          { status: 400 }
        );
      }

      // Validates single-use state & nonce cryptographic match
      FederationManager.validateCallback(state, nonce);

      // Upsert link record
      const link = await UserFederationLink.findOneAndUpdate(
        { platformUserId: auth.claims!.sub, product: targetProduct },
        {
          platformUserId: auth.claims!.sub,
          localUserId,
          product: targetProduct,
          linkedAt: new Date(),
          linkedBy: auth.claims!.email,
        },
        { upsert: true, returnDocument: 'after' }
      );

      return NextResponse.json({
        success: true,
        data: {
          id: link._id.toString(),
          platformUserId: link.platformUserId,
          localUserId: link.localUserId,
          product: link.product,
          linkedAt: link.linkedAt,
        },
      });
    }

    return NextResponse.json(
      {
        type: 'https://errors.iiit.ac.in/validation/invalid-action',
        title: 'Validation Error',
        status: 400,
        detail: "Action must be 'initiate' or 'complete'.",
      },
      { status: 400 }
    );
  } catch (err: unknown) {
    return NextResponse.json(
      {
        type: 'https://errors.iiit.ac.in/auth/linking-failed',
        title: 'Linking Error',
        status: 400,
        detail: (err as Error).message,
      },
      { status: 400 }
    );
  }
}
