const SECRET_FLAG_VALUE =
  /((?:^|\s)(?:--|\/)?(?:password|passwd|pwd|secret|token|api[_-]?key|access[_-]?key|auth|authorization|credential|conn(?:ection)?[_-]?str(?:ing)?|database[_-]?url|dsn)(?:[=:]\s*|\s+))(?:"(?:\\.|[^"\\\r\n])*(?:"|$)|'[^'\r\n]*(?:'|$)|[^\s]+)/gi;

const KEY_VALUE_SECRET =
  /\b([A-Z0-9_]*(?:PASSWORD|PASSWD|SECRET|TOKEN|API[_-]?KEY|ACCESS[_-]?KEY|AUTH|CREDENTIAL|DATABASE_URL|DSN|CONNECTION_STRING)[A-Z0-9_]*)\s*=\s*(?:"(?:\\.|[^"\\\r\n])*(?:"|$)|'[^'\r\n]*(?:'|$)|[^\s]+)/gi;

const URL_WITH_PASSWORD = /\b([a-z][a-z0-9+.-]*:\/\/[^:@\s]+:)([^@/\s]+)(@)/gi;

const BEARER = /\b(bearer\s+)[a-z0-9._\-+=/]+/gi;

export function redactCommand(command: string | undefined): string | undefined {
  if (!command) return undefined;
  let redacted = command.replace(URL_WITH_PASSWORD, "$1***$3");
  redacted = redacted.replace(KEY_VALUE_SECRET, "$1=***");
  redacted = redacted.replace(BEARER, "$1***");
  return redacted.replace(SECRET_FLAG_VALUE, "$1***");
}

// /proc preserves argument boundaries; redact complete values before joining them.
export function redactArgv(args: string[]): string | undefined {
  const secretArgument =
    /^(?:--|\/)?(?:password|passwd|pwd|secret|token|api[_-]?key|access[_-]?key|auth|authorization|credential|conn(?:ection)?[_-]?str(?:ing)?|database[_-]?url|dsn)(?=$|[=:])/i;
  const redacted: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    const match = secretArgument.exec(arg);
    const equals = arg.indexOf("=");
    if (match) {
      redacted.push(arg.length === match[0].length ? arg : `${match[0]}=***`);
      if (arg.length === match[0].length && index + 1 < args.length) {
        redacted.push("***");
        index += 1;
      }
    } else if (equals > 0 && looksLikeSecretKey(arg.slice(0, equals))) {
      redacted.push(`${arg.slice(0, equals)}=***`);
    } else {
      redacted.push(redactCommand(arg) ?? "");
    }
  }
  return redactCommand(
    redacted.map((arg) => (/[\s"\\]/.test(arg) ? JSON.stringify(arg) : arg)).join(" "),
  );
}

export function looksLikeSecretKey(key: string): boolean {
  return /password|secret|token|api[_-]?key|credential|authorization|private[_-]?key|database_url|dsn/i.test(
    key,
  );
}
