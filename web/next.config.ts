import type { NextConfig } from 'next';
const config: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [{ source: '/sw.js', headers: [{ key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' }, { key: 'Service-Worker-Allowed', value: '/' }, { key: 'Content-Security-Policy', value: "default-src 'self'; script-src 'self'; object-src 'none'" }] }, ...(process.env.NODE_ENV === 'production' ? [{ source: '/demo', headers: [{ key: 'Content-Security-Policy', value: "connect-src 'none'; form-action 'none'; object-src 'none'; worker-src 'none'; base-uri 'self'" }] }] : []), { source: '/:path*', headers: [
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
    ] }];
  },
};
export default config;
