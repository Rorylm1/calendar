import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto';
export const hash = (value: string) => createHash('sha256').update(value).digest('hex');
export function safeEqual(a: string, b: string) { const x = Buffer.from(a); const y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); }
export class Vault {
  private readonly key: Buffer;
  constructor(encodedKey: string) { this.key = Buffer.from(encodedKey, /^[a-fA-F0-9]{64}$/.test(encodedKey) ? 'hex' : 'base64'); if (this.key.length !== 32) throw new Error('A 32-byte encryption key is required'); }
  seal(value: unknown, context: string): string {
    const nonce = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', this.key, nonce); cipher.setAAD(Buffer.from(context));
    const payload = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
    return ['v1', nonce.toString('base64'), cipher.getAuthTag().toString('base64'), payload.toString('base64')].join('.');
  }
  open<T>(value: string, context: string): T {
    const [version, nonce, tag, payload] = value.split('.');
    if (version !== 'v1' || !nonce || !tag || !payload) throw new Error('Invalid encrypted record');
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(nonce, 'base64')); decipher.setAAD(Buffer.from(context)); decipher.setAuthTag(Buffer.from(tag, 'base64'));
    return JSON.parse(Buffer.concat([decipher.update(Buffer.from(payload, 'base64')), decipher.final()]).toString('utf8')) as T;
  }
}
