import { hash } from './crypto.ts';
export const gmailAccountId = (email: string, primaryEmail: string) => email.toLowerCase() === primaryEmail.toLowerCase() ? 'default' : `g_${hash(email.toLowerCase()).slice(0, 32)}`;
// Preserve the original inbox's stored IDs and checkpoints; additional inboxes are namespaced.
export const gmailSourceId = (accountId: string, messageId: string) => accountId === 'default' ? messageId : `gmail:${accountId}:${messageId}`;
