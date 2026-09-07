import { z } from 'zod';

const envSchema = z.object({
  HOST: z.string().default('127.0.0.1'), PORT: z.coerce.number().int().min(1).max(65535).default(8787),
  CALENDAR_DB_PATH: z.string().default('./data/calendar.sqlite'),
  CALENDAR_SERVICE_TOKEN: z.string().min(32),
  CALENDAR_ENCRYPTION_KEY: z.string().refine(value => /^[a-fA-F0-9]{64}$/.test(value) || (/^[A-Za-z0-9+/]+={0,2}$/.test(value) && Buffer.from(value, 'base64').length === 32), 'Must encode exactly 32 random bytes'),
  GOOGLE_CLIENT_ID: z.string().default(''), GOOGLE_CLIENT_SECRET: z.string().default(''),
  GOOGLE_REDIRECT_URI: z.url().default('http://localhost:3000/api/calendar/gmail/callback'),
  GMAIL_ALLOWED_EMAIL: z.email(), OPENROUTER_API_KEY: z.string().default(''),
  GMAIL_REQUEST_INTERVAL_MS: z.coerce.number().int().min(250).max(10000).default(1000),
  AI_TRIAGE_MODEL: z.string().default('google/gemini-3.5-flash-lite'), AI_EXTRACTION_MODEL: z.string().default('google/gemini-3.6-flash'),
  AI_MONTHLY_BUDGET_USD: z.coerce.number().min(0).default(5),
  AI_TRIAGE_INPUT_USD: z.coerce.number().positive().default(0.30), AI_TRIAGE_OUTPUT_USD: z.coerce.number().positive().default(2.50),
  AI_EXTRACTION_INPUT_USD: z.coerce.number().positive().default(0.75), AI_EXTRACTION_OUTPUT_USD: z.coerce.number().positive().default(3.75),
});
export type Config = z.infer<typeof envSchema>;
export function readConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const result = envSchema.safeParse(env);
  if (!result.success) throw new Error(`Invalid service configuration: ${result.error.issues.map(x => x.path.join('.')).join(', ')}. See .env.example.`);
  for (const [model, expected, rates] of [
    ['AI_TRIAGE_MODEL', 'google/gemini-3.5-flash-lite', ['AI_TRIAGE_INPUT_USD', 'AI_TRIAGE_OUTPUT_USD']],
    ['AI_EXTRACTION_MODEL', 'google/gemini-3.6-flash', ['AI_EXTRACTION_INPUT_USD', 'AI_EXTRACTION_OUTPUT_USD']],
  ] as const) {
    if (result.data[model] !== expected && rates.some(key => !env[key])) throw new Error(`Set explicit token prices when changing ${model}.`);
  }
  const redirect = new URL(result.data.GOOGLE_REDIRECT_URI);
  if (redirect.protocol !== 'https:' && !(redirect.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(redirect.hostname))) throw new Error('OAuth redirect requires HTTPS outside localhost.');
  return result.data;
}
export const googleConfigured = (config: Config) => Boolean(config.GOOGLE_CLIENT_ID && config.GOOGLE_CLIENT_SECRET);
