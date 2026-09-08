import { createHash } from 'node:crypto';
import type { Config } from './config.ts';
import type { SourceMessage } from './domain.ts';

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export class WhatsAppMediaError extends Error {
  constructor(public reason: 'access' | 'unavailable' | 'unsupported') { super(`WhatsApp image ${reason}`); }
}
async function bounded(response: Response, limit: number): Promise<Buffer> {
  if (!response.ok) throw new WhatsAppMediaError([401, 403].includes(response.status) ? 'access' : 'unavailable');
  if (Number(response.headers.get('content-length')) > limit) { await response.body?.cancel(); throw new WhatsAppMediaError('unsupported'); }
  const reader = response.body?.getReader(); if (!reader) throw new WhatsAppMediaError('unavailable');
  const chunks: Buffer[] = []; let size = 0;
  try { while (true) { const chunk = await reader.read(); if (chunk.done) break; size += chunk.value.length; if (size > limit) throw new WhatsAppMediaError('unsupported'); chunks.push(Buffer.from(chunk.value)); } }
  finally { await reader.cancel(); }
  return Buffer.concat(chunks);
}
export function validateImage(bytes: Buffer, type: string): void {
  let width = 0; let height = 0;
  if (type === 'image/png' && bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) && bytes.toString('ascii', 12, 16) === 'IHDR') {
    width = bytes.readUInt32BE(16); height = bytes.readUInt32BE(20);
  } else if (type === 'image/jpeg' && bytes.length > 4 && bytes[0] === 255 && bytes[1] === 216) {
    for (let i = 2; i + 8 < bytes.length;) {
      if (bytes[i++] !== 255) break;
      while (bytes[i] === 255) i++;
      const marker = bytes[i++]!; if ([216, 1].includes(marker)) continue;
      if ([217, 218].includes(marker) || i + 2 > bytes.length) break;
      const length = bytes.readUInt16BE(i); if (length < 2 || i + length > bytes.length) break;
      if ([192, 193, 194].includes(marker) && length >= 8) { height = bytes.readUInt16BE(i + 3); width = bytes.readUInt16BE(i + 5); break; }
      i += length;
    }
  }
  if (!width || !height || width > 8192 || height > 8192 || width * height > 16_777_216) throw new WhatsAppMediaError('unsupported');
}
export async function downloadWhatsAppImage(config: Config, source: SourceMessage, signal?: AbortSignal, request: typeof fetch = fetch): Promise<string> {
  if (!config.WHATSAPP_ACCESS_TOKEN) throw new WhatsAppMediaError('access');
  const media = source.whatsapp;
  if (!media?.mediaId || !/^\d{1,80}$/.test(media.mediaId)) throw new WhatsAppMediaError('unsupported');
  const abort = AbortSignal.any([AbortSignal.timeout(30000), ...(signal ? [signal] : [])]);
  const headers = { Authorization: `Bearer ${config.WHATSAPP_ACCESS_TOKEN}` };
  const metadataResponse = await request(`https://graph.facebook.com/v26.0/${media.mediaId}?phone_number_id=${encodeURIComponent(config.WHATSAPP_PHONE_NUMBER_ID)}`, { headers, signal: abort, redirect: 'error' });
  const metadata = JSON.parse((await bounded(metadataResponse, 65536)).toString()) as { id?: string; url?: string; mime_type?: string; file_size?: number; sha256?: string };
  if (metadata.id !== media.mediaId || !['image/png', 'image/jpeg'].includes(metadata.mime_type || '') || !metadata.url || !metadata.file_size || metadata.file_size > MAX_IMAGE_BYTES) throw new WhatsAppMediaError('unsupported');
  const url = new URL(metadata.url);
  // Only Meta's media host receives the credential. Never follow redirects or message-supplied URLs.
  if (url.protocol !== 'https:' || url.hostname !== 'lookaside.fbsbx.com' || url.port || url.username || url.password) throw new WhatsAppMediaError('unsupported');
  const response = await request(url, { headers, signal: abort, redirect: 'error' });
  const bytes = await bounded(response, MAX_IMAGE_BYTES);
  if (bytes.length !== metadata.file_size) throw new WhatsAppMediaError('unavailable');
  for (const expected of [metadata.sha256, media.mediaHash].filter(Boolean)) {
    const hex = /^[a-fA-F0-9]{64}$/.test(expected!);
    const actual = createHash('sha256').update(bytes).digest(hex ? 'hex' : 'base64');
    if (actual !== (hex ? expected!.toLowerCase() : expected)) throw new WhatsAppMediaError('unavailable');
  }
  validateImage(bytes, metadata.mime_type!);
  return `data:${metadata.mime_type};base64,${bytes.toString('base64')}`;
}
