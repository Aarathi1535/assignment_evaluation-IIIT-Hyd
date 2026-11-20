import { NextResponse } from 'next/server';
import { KeyManager } from '@cvit/auth';

export async function GET() {
  const jwks = KeyManager.getJwksDocument();
  return NextResponse.json(jwks, {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400',
    },
  });
}
