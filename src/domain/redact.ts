const SECRET_FLAG_VALUE =
  /((?:^|\s)(?:--|\/)?(?:password|passwd|pwd|secret|token|api[_-]?key|access[_-]?key|auth|authorization|credential|conn(?:ection)?[_-]?str(?:ing)?|database[_-]?url|dsn)(?:[=:]\s*|\s+))(?:"[^"\r\n]*(?:"|$)|'[^'\r\n]*(?:'|$)|[^\s]+)/gi;

const KEY_VALUE_SECRET =
  /\b([A-Z0-9_]*(?:PASSWORD|PASSWD|SECRET|TOKEN|API[_-]?KEY|ACCESS[_-]?KEY|AUTH|CREDENTIAL|DATABASE_URL|DSN|CONNECTION_STRING)[A-Z0-9_]*)\s*=\s*(?:"[^"\r\n]*(?:"|$)|'[^'\r\n]*(?:'|$)|[^\s]+)/gi;

const URL_WITH_PASSWORD = /\b([a-z][a-z0-9+.-]*:\/\/[^:@\s]+:)([^@/\s]+)(@)/gi;

const BEARER = /\b(bearer\s+)[a-z0-9._\-+=/]+/gi;

export function redactCommand(command: string | undefined): string | undefined {
  if (!command) return undefined;
  let redacted = command.replace(URL_WITH_PASSWORD, "$1***$3");
  redacted = redacted.replace(KEY_VALUE_SECRET, "$1=***");
  redacted = redacted.replace(BEARER, "$1***");
  return redacted.replace(SECRET_FLAG_VALUE, "$1***");
}

export function looksLikeSecretKey(key: string): boolean {
  return /password|secret|token|api[_-]?key|credential|authorization|private[_-]?key|database_url|dsn/i.test(
    key,
  );
}
