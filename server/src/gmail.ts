import { OAuth2Client, CodeChallengeMethod, type Credentials } from 'google-auth-library';
import { randomBytes } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { type Config, googleConfigured } from './config.ts';
import { Store } from './store.ts';
import { AppError, ProviderError } from './errors.ts';
import type { GmailConnection } from './domain.ts';
import type { GmailMessage } from './mail.ts';
import { gmailAccountId } from './gmail-accounts.ts';

export type HistoryPage = { history?: { messagesAdded?: { message: { id: string } }[]; labelsAdded?: { message: { id: string } }[]; messages?: { id: string }[] }[]; historyId: string; nextPageToken?: string };
export type ListPage = { messages?: { id: string }[]; nextPageToken?: string };
export interface GmailProvider {
  profile(): Promise<{ emailAddress: string; historyId: string }>;
  list(query: string, pageToken?: string): Promise<ListPage>;
  history(start: string, pageToken?: string): Promise<HistoryPage>;
  message(id: string): Promise<GmailMessage>;
  thread(id: string): Promise<GmailMessage[]>;
  attachment(messageId: string, attachmentId: string): Promise<string>;
}
const scope = 'https://www.googleapis.com/auth/gmail.readonly';
const abortableDelay = (ms: number, signal?: AbortSignal) => sleep(ms, undefined, { signal });
export async function retryGmailRead<T>(read: () => Promise<T>, delay: (ms: number, signal?: AbortSignal) => Promise<void> = abortableDelay, signal?: AbortSignal): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    signal?.throwIfAborted();
    try { return await read(); }
    catch (error) { signal?.throwIfAborted(); if (!(error instanceof ProviderError) || !error.retryable || attempt >= 2) throw error; await delay(Math.max(error.retryAfterMs, error.rateLimitReason || error.status === 429 ? 60000 : attempt === 0 ? 500 : 1500), signal); }
  }
}
export class GmailReadPacer {
  private nextAllowedAt = 0;
  constructor(private intervalMs = 1000, private now: () => number = Date.now, private delay: (ms: number, signal?: AbortSignal) => Promise<void> = abortableDelay) {}
  async wait(signal?: AbortSignal) { signal?.throwIfAborted(); const slot = Math.max(this.now(), this.nextAllowedAt); this.nextAllowedAt = slot + this.intervalMs; const wait = slot - this.now(); if (wait > 0) await this.delay(wait, signal); signal?.throwIfAborted(); }
}
export class GoogleGateway {
  private readonly readPacer: GmailReadPacer;
  constructor(private config: Config, private store: Store, private clientFactory?: () => OAuth2Client) { this.readPacer = new GmailReadPacer(config.GMAIL_REQUEST_INTERVAL_MS); }
  private client(credentials?: Credentials, persist = true, accountId = 'default'): OAuth2Client {
    const client = this.clientFactory?.() || new OAuth2Client({ clientId: this.config.GOOGLE_CLIENT_ID, clientSecret: this.config.GOOGLE_CLIENT_SECRET, redirectUri: this.config.GOOGLE_REDIRECT_URI, transporterOptions: { timeout: 20000, retry: false } });
    if (credentials) client.setCredentials(credentials);
    const generation = this.store.get<number>('oauth_generation', accountId) || 0;
    if (persist) client.on('tokens', tokens => { if ((this.store.get<number>('oauth_generation', accountId) || 0) !== generation || !this.store.get('credentials', accountId)) return; const old = this.store.get<Credentials>('credentials', accountId) || credentials || {}; if (credentials?.refresh_token && old.refresh_token !== credentials.refresh_token) return; this.store.put('credentials', accountId, { ...old, ...tokens }); });
    return client;
  }
  async connect(ownerId: string, requestedEmail = this.config.GMAIL_ALLOWED_EMAIL) {
    if (!googleConfigured(this.config)) throw new AppError('not_configured', 'Gmail connection needs its Google OAuth settings.', 503);
    const email = requestedEmail.trim().toLowerCase(); const accountId = gmailAccountId(email, this.config.GMAIL_ALLOWED_EMAIL);
    if (this.store.gmailConnections().some(connection => connection.ownerId !== ownerId)) throw new AppError('wrong_owner', 'This calendar belongs to another owner.', 403);
    const client = this.client(undefined, false); const { codeVerifier, codeChallenge } = await client.generateCodeVerifierAsync(); const state = randomBytes(32).toString('base64url');
    this.store.createOAuthState(state, ownerId, codeVerifier, Date.now(), { accountId, email, generation: this.store.get<number>('oauth_generation', accountId) || 0 });
    return { state, url: client.generateAuthUrl({ scope: [scope], access_type: 'offline', prompt: 'consent', state, code_challenge: codeChallenge, code_challenge_method: CodeChallengeMethod.S256, login_hint: email, include_granted_scopes: false }) };
  }
  async callback(ownerId: string, code: string, state: string) {
    const context = this.store.consumeOAuthContext(state, ownerId); const accountId = context.accountId || 'default'; const email = context.email || this.config.GMAIL_ALLOWED_EMAIL;
    const generation = context.generation ?? (this.store.get<number>('oauth_generation', accountId) || 0);
    const verifier = context.verifier; const client = this.client(undefined, false);
    let tokens: Credentials;
    try { tokens = (await client.getToken({ code, codeVerifier: verifier, redirect_uri: this.config.GOOGLE_REDIRECT_URI })).tokens; } catch { throw new AppError('oauth_failed', 'Gmail could not complete the connection. Start again.', 400); }
    client.setCredentials(tokens);
    let profile: { emailAddress: string; historyId: string };
    try { profile = await this.provider(client).profile(); } catch { await client.revokeToken(tokens.access_token || '').catch(() => {}); throw new AppError('oauth_failed', 'Gmail identity could not be verified. Start again.', 400); }
    if (profile.emailAddress.toLowerCase() !== email.toLowerCase()) { if (!this.store.gmailConnections().some(c => c.email.toLowerCase() === profile.emailAddress.toLowerCase())) await client.revokeToken(tokens.refresh_token || tokens.access_token || '').catch(() => {}); throw new AppError('wrong_account', 'Connect the Gmail account configured for this calendar.', 403); }
    if (!tokens.refresh_token) throw new AppError('offline_access_missing', 'Gmail did not grant offline access. Reconnect and grant consent.', 400);
    const existing = this.store.get<GmailConnection>('connection', accountId);
    if (this.store.gmailConnections().some(connection => connection.ownerId !== ownerId)) throw new AppError('wrong_owner', 'This calendar belongs to another owner.', 403);
    try { this.store.transaction(() => {
      if ((this.store.get<number>('oauth_generation', accountId) || 0) !== generation) throw new AppError('oauth_cancelled', 'This connection was cancelled. Start again if you want to connect Gmail.', 409);
      this.store.put('credentials', accountId, tokens);
      this.store.put('connection', accountId, { ownerId, email: profile.emailAddress, status: 'connected', lastSyncAt: existing?.lastSyncAt || null, nextSyncAt: new Date().toISOString(), historyId: existing?.historyId, error: null, warning: existing?.warning || null } satisfies GmailConnection);
    }); } catch (error) { await client.revokeToken(tokens.refresh_token || tokens.access_token || '').catch(() => {}); throw error; }
    return { connected: true as const };
  }
  connectedProvider(signal?: AbortSignal, accountId = 'default'): GmailProvider {
    const credentials = this.store.get<Credentials>('credentials', accountId); if (!credentials) throw new AppError('not_connected', 'Connect Gmail to check for bookings.', 409);
    return this.provider(this.client(credentials, true, accountId), signal);
  }
  async disconnect(accountId = 'default') {
    this.store.put('oauth_generation', accountId, (this.store.get<number>('oauth_generation', accountId) || 0) + 1);
    const credentials = this.store.get<Credentials>('credentials', accountId); let warning: string | undefined;
    if (credentials) { try { await this.client(credentials, false, accountId).revokeToken(credentials.refresh_token || credentials.access_token || ''); } catch { warning = 'Local access was removed. Google could not confirm revocation; remove this app from your Google account permissions as well.'; } }
    this.store.transaction(() => { this.store.remove('credentials', accountId); this.store.remove('connection', accountId); this.store.remove('scan', accountId); this.store.clearSources(accountId); });
    return { disconnected: true as const, ...(warning ? { warning } : {}) };
  }
  private provider(client: OAuth2Client, signal?: AbortSignal): GmailProvider {
    const readPacer = this.readPacer;
    async function request<T>(path: string, params: Record<string, string | undefined> = {}): Promise<T> {
      const url = new URL(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`); for (const [key, value] of Object.entries(params)) if (value !== undefined) url.searchParams.set(key, value);
      return retryGmailRead(async () => {
        await readPacer.wait(signal);
        try { return (await client.request<T>({ url: url.toString(), method: 'GET', timeout: 20000, retry: false, signal })).data; }
        catch (error) {
          signal?.throwIfAborted();
          const value = error as { response?: { status?: number; headers?: { get?: (name: string) => string | null }; data?: { error?: string | { errors?: { reason?: string }[] } } }; code?: string | number };
          const status = Number(value.response?.status || 0); const providerError = value.response?.data?.error;
          const reconnect = status === 401 || providerError === 'invalid_grant';
          const rateLimitReason = typeof providerError === 'object' ? providerError?.errors?.find(item => ['rateLimitExceeded', 'userRateLimitExceeded'].includes(item.reason || ''))?.reason as 'rateLimitExceeded' | 'userRateLimitExceeded' | undefined : undefined;
          const retryAfter = value.response?.headers?.get?.('retry-after'); const seconds = retryAfter && /^\d+$/.test(retryAfter) ? Number(retryAfter) : 0;
          const retryAfterMs = Math.min(60000, Math.max(0, seconds * 1000));
          throw new ProviderError(status, reconnect, !reconnect && (status === 0 || status === 408 || status === 429 || status >= 500 || Boolean(rateLimitReason)), retryAfterMs, rateLimitReason);
        }
      }, undefined, signal);
    }
    return {
      profile: () => request('profile'), list: (q, pageToken) => request('messages', { q, maxResults: '50', pageToken, includeSpamTrash: 'false' }),
      history: (startHistoryId, pageToken) => request('history', { startHistoryId, maxResults: '100', pageToken }),
      message: id => request(`messages/${encodeURIComponent(id)}`, { format: 'full' }),
      thread: async id => (await request<{ messages?: GmailMessage[] }>(`threads/${encodeURIComponent(id)}`, { format: 'full' })).messages || [],
      attachment: async (id, attachment) => Buffer.from((await request<{ data: string }>(`messages/${encodeURIComponent(id)}/attachments/${encodeURIComponent(attachment)}`)).data, 'base64url').toString('utf8'),
    };
  }
}
