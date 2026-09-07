import { ImageResponse } from 'next/og';

export async function GET(_request: Request, { params }: { params: Promise<{ size: string }> }) {
  const { size: value } = await params;
  if (!['180', '192', '512'].includes(value)) return new Response(null, { status: 404 });
  const size = Number(value);
  return new ImageResponse(<div style={{ width: '100%', height: '100%', background: '#192330', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
    <svg width={size * .66} height={size * .66} viewBox="0 0 32 32">
      <rect x="5" y="7" width="22" height="22" rx="4" fill="none" stroke="#A8C6EB" strokeWidth="1.5" />
      <path d="M10 3v8m12-8v8M5 15h22" stroke="#A8C6EB" strokeWidth="1.5" strokeLinecap="round" />
      <rect x="10" y="20" width="5" height="5" rx="1" fill="#A8C6EB" />
    </svg>
  </div>, { width: size, height: size, headers: { 'Cache-Control': 'public, max-age=86400' } });
}
