export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function normalizeOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function interpolateVariables(
  template: string,
  variables: Record<string, string>
): string {
  return template.replace(/\{\{var:([a-zA-Z0-9_-]+)}}/g, (match, key: string) =>
    Object.prototype.hasOwnProperty.call(variables, key) ? variables[key]! : match
  );
}

export function safeJsonParse<T>(raw: string): T {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const candidate = (fenced ?? raw).trim();
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end < start) throw new Error('The model did not return a JSON object.');
  return JSON.parse(candidate.slice(start, end + 1)) as T;
}

export function sanitizeText(value: string, knownSecrets: string[] = []): string {
  let sanitized = value;
  for (const secret of knownSecrets) {
    if (secret.length >= 3) sanitized = sanitized.split(secret).join('[REDACTED]');
  }
  sanitized = sanitized
    .replace(/(?:sk-or-v1-|sk-|api[_-]?key[=: ]+)[a-zA-Z0-9_\-.]{8,}/gi, '[REDACTED_API_KEY]')
    .replace(/\b(?:\d[ -]*?){13,19}\b/g, '[REDACTED_CARD]')
    .replace(/\b\d{6}\b/g, '[REDACTED_CODE]');
  return sanitized.slice(0, 4_000);
}

export function originMatches(origin: string, allowedOrigins: string[]): boolean {
  return allowedOrigins.some((allowed) => {
    if (allowed === origin) return true;
    if (!allowed.startsWith('*.')) return false;
    const suffix = allowed.slice(1);
    try {
      return new URL(origin).hostname.endsWith(suffix);
    } catch {
      return false;
    }
  });
}

export function nowId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${crypto.randomUUID().slice(0, 8)}`;
}

export function dataUrlByteLength(dataUrl: string): number {
  const base64 = dataUrl.split(',')[1] ?? '';
  return Math.floor((base64.length * 3) / 4);
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    if (!signal) return;
    const abort = () => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, { once: true });
  });
}
