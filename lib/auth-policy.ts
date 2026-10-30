export const CORPORATE_EMAIL_DOMAIN = "example.com";
export const CORPORATE_EMAIL_SUFFIX = `@${CORPORATE_EMAIL_DOMAIN}`;

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isCorporateEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const normalized = normalizeEmail(email);
  const [localPart, domain, ...extraParts] = normalized.split("@");
  return (
    extraParts.length === 0 &&
    Boolean(localPart) &&
    domain === CORPORATE_EMAIL_DOMAIN
  );
}
