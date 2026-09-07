import { handlers } from '@/auth';
import { NextRequest } from 'next/server';
import { fixedIdentitySignInUrl } from '@/lib/auth-request';
export const GET = (request: NextRequest) => handlers.GET(new NextRequest(fixedIdentitySignInUrl(request.url), request));
export const POST = (request: NextRequest) => handlers.POST(new NextRequest(fixedIdentitySignInUrl(request.url), request));
export const runtime = 'nodejs';
