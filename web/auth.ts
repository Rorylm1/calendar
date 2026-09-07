import NextAuth from 'next-auth';
import Google from 'next-auth/providers/google';
import { allowedGoogleProfile, appOrigin } from './lib/access';

declare module 'next-auth' {
  interface User { ownerVerified?: boolean }
}

export const { handlers, auth, signIn, signOut } = NextAuth(() => {
  const origin = appOrigin(process.env.CALENDAR_APP_ORIGIN);
  if (!process.env.AUTH_URL || appOrigin(process.env.AUTH_URL) !== origin) throw new Error('Authentication origin must match calendar origin');
  return {
    secret: process.env.AUTH_SECRET,
    trustHost: true,
    useSecureCookies: origin.startsWith('https:'),
    session: { strategy: 'jwt', maxAge: 7 * 24 * 60 * 60 },
    providers: [Google({
      clientId: process.env.AUTH_GOOGLE_ID,
      clientSecret: process.env.AUTH_GOOGLE_SECRET,
      authorization: { params: { scope: 'openid email profile', access_type: 'online', include_granted_scopes: 'false' } },
      checks: ['pkce', 'state', 'nonce'],
    })],
    pages: { signIn: '/sign-in', error: '/sign-in' },
    callbacks: {
      signIn({ account, profile }) {
        return allowedGoogleProfile(account?.provider, profile, process.env.CALENDAR_OWNER_EMAIL) && Boolean(process.env.CALENDAR_OWNER_ID);
      },
      jwt({ token, account, profile }) {
        if (account) token.ownerVerified = allowedGoogleProfile(account.provider, profile, process.env.CALENDAR_OWNER_EMAIL);
        if (token.ownerVerified !== true || token.email?.toLowerCase() !== process.env.CALENDAR_OWNER_EMAIL?.toLowerCase() || !process.env.CALENDAR_OWNER_ID) return null;
        return token;
      },
      session({ session, token }) {
        session.user.id = process.env.CALENDAR_OWNER_ID!;
        session.user.email = token.email!;
        session.user.ownerVerified = token.ownerVerified === true;
        return session;
      },
      redirect({ url }) {
        const target = new URL(url, origin);
        return target.origin === origin && ['/calendar', '/sign-in'].includes(target.pathname) ? target.href : `${origin}/calendar`;
      },
    },
    logger: {
      error() { console.error('Calendar sign-in could not complete.'); },
      warn() {},
      debug() {},
    },
  };
});
