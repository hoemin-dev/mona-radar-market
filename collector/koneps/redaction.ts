const SECRET_QUERY_NAMES = new Set(["servicekey"]);

export const REDACTED = "[REDACTED]";

export function redactKonepsUrl(input: string): string {
  return input.replace(/([?&])([^=&]+)=([^&#]*)/giu, (match, separator: string, name: string) =>
    SECRET_QUERY_NAMES.has(name.toLowerCase())
      ? `${separator}${name}=${REDACTED}`
      : match,
  );
}

export function redactSecrets(input: string, secrets: readonly string[] = []): string {
  let value = redactKonepsUrl(input);
  for (const secret of secrets) {
    if (secret) value = value.split(secret).join(REDACTED);
  }
  return value;
}
