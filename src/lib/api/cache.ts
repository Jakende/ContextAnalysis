type CacheRecord<T> = {
  createdAt: number;
  value: T;
};

const memory = new Map<string, CacheRecord<unknown>>();

export function getCached<T>(key: string, maxAgeMs: number): T | null {
  const now = Date.now();
  const local = memory.get(key) as CacheRecord<T> | undefined;
  if (local && now - local.createdAt < maxAgeMs) return local.value;

  try {
    const serialized = window.localStorage.getItem(key);
    if (!serialized) return null;
    const record = JSON.parse(serialized) as CacheRecord<T>;
    if (now - record.createdAt > maxAgeMs) return null;
    memory.set(key, record);
    return record.value;
  } catch {
    return null;
  }
}

export function setCached<T>(key: string, value: T): void {
  const record: CacheRecord<T> = { createdAt: Date.now(), value };
  memory.set(key, record);
  try {
    window.localStorage.setItem(key, JSON.stringify(record));
  } catch {
    // Memory cache is enough when LocalStorage is unavailable.
  }
}

export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = 6_000,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    window.clearTimeout(timeout);
  }
}
