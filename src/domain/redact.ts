const SECRET_FLAG =
  /(?:^|[\s=])(?:--|\/)?(?:password|passwd|pwd|secret|token|api[_-]?key|access[_-]?key|auth|authorization|credential|conn(?:ection)?[_-]?str(?:ing)?|database[_-]?url|dsn)(?:[=\s:]+|$)/i;

const KEY_VALUE_SECRET =
  /\b([A-Z0-9_]*(?:PASSWORD|PASSWD|SECRET|TOKEN|API[_-]?KEY|ACCESS[_-]?KEY|AUTH|CREDENTIAL|DATABASE_URL|DSN|CONNECTION_STRING)[A-Z0-9_]*)\s*=\s*([^\s]+)/gi;

const URL_WITH_PASSWORD = /\b([a-z][a-z0-9+.-]*:\/\/[^:@\s]+:)([^@/\s]+)(@)/gi;

const BEARER = /\b(bearer\s+)[a-z0-9._\-+=/]+/gi;

export function redactCommand(command: string | undefined): string | undefined {
  if (!command) return undefined;
  let redacted = command.replace(URL_WITH_PASSWORD, "$1***$3");
  redacted = redacted.replace(KEY_VALUE_SECRET, "$1=***");
  redacted = redacted.replace(BEARER, "$1***");
  if (SECRET_FLAG.test(command) && redacted === command) {
    redacted = redactFlagValues(redacted);
  }
  return redacted;
}

function redactFlagValues(command: string): string {
  const parts = command.split(/\s+/);
  const out: string[] = [];
  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i];
    if (!part) continue;
    if (SECRET_FLAG.test(part) && !part.includes("=") && parts[i + 1]) {
      out.push(part, "***");
      i += 1;
      continue;
    }
    if (SECRET_FLAG.test(part) && part.includes("=")) {
      out.push(part.replace(/=.*/, "=***"));
      continue;
    }
    out.push(part);
  }
  return out.join(" ");
}

export function looksLikeSecretKey(key: string): boolean {
  return /password|secret|token|api[_-]?key|credential|authorization|private[_-]?key|database_url|dsn/i.test(
    key,
  );
}
