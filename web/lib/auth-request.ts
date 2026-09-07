// Auth.js accepts optional authorization parameters in a sign-in URL. This app
// intentionally uses only its configured identity scopes and callback settings.
export function fixedIdentitySignInUrl(input: string): string {
  const url = new URL(input);
  if (/\/api\/auth\/signin(?:\/google)?\/?$/.test(url.pathname)) url.search = '';
  return url.href;
}
