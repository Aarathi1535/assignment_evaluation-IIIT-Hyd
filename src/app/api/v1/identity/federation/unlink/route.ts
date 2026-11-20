import { NextRequest, NextResponse } from 'next/server';
import { authenticatePlatformToken } from '@cvit/auth';
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
    const { targetProduct } = body;

    if (!targetProduct) {
      return NextResponse.json(
        {
          type: 'https://errors.iiit.ac.in/validation/missing-field',
          title: 'Validation Error',
          status: 400,
          detail: 'targetProduct is required to unlink.',
        },
        { status: 400 }
      );
    }

    const deleted = await UserFederationLink.findOneAndDelete({
      platformUserId: auth.claims!.sub,
      product: targetProduct,
    });

    if (!deleted) {
      return NextResponse.json(
        {
          type: 'https://errors.iiit.ac.in/auth/link-not-found',
          title: 'Not Found',
          status: 404,
          detail: `No active account link found for product '${targetProduct}'.`,
        },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      data: {
        message: `Platform account unlinked successfully from product '${targetProduct}'.`,
        unlinkedProduct: targetProduct,
      },
    });
  } catch (err: unknown) {
    return NextResponse.json(
      {
        type: 'https://errors.iiit.ac.in/internal-error',
        title: 'Internal Server Error',
        status: 500,
        detail: (err as Error).message,
      },
      { status: 500 }
    );
  }
}
