import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/calendar', name: 'My Calendar', short_name: 'Calendar',
    description: 'A quiet space for your plans.', start_url: '/calendar', scope: '/',
    display: 'standalone', background_color: '#192330', theme_color: '#192330',
    icons: [
      { src: '/app-icon/192', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/app-icon/512', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/app-icon/512', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
