import type { OfflineQueueItem } from '../types/anagu';

const TOKEN_KEY = 'anagu_auth_token_v1';
const USER_KEY = 'anagu_auth_user_v1';
const OFFLINE_QUEUE_KEY = 'anagu_offline_queue_v1';
const OFFLINE_MODE_KEY = 'anagu_offline_mode_v1';

export function getStoredToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setStoredSession(token: string, user: unknown) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function getStoredUser<T>(): T | null {
  const raw = localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function clearStoredSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

export function isOfflineSimulated(): boolean {
  return localStorage.getItem(OFFLINE_MODE_KEY) === 'true' || !navigator.onLine;
}

export function setOfflineSimulated(offline: boolean) {
  localStorage.setItem(OFFLINE_MODE_KEY, offline ? 'true' : 'false');
}

export function getOfflineQueue(): OfflineQueueItem[] {
  const raw = localStorage.getItem(OFFLINE_QUEUE_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as OfflineQueueItem[];
  } catch {
    return [];
  }
}

export function enqueueOfflineItem(item: OfflineQueueItem): OfflineQueueItem[] {
  const next = [...getOfflineQueue(), item];
  localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(next));
  return next;
}

export function clearOfflineQueue() {
  localStorage.removeItem(OFFLINE_QUEUE_KEY);
}

export async function apiRequest<T = Record<string, unknown>>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const token = getStoredToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> | undefined),
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const res = await fetch(path, { ...options, headers });
  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('text/csv')) {
    if (!res.ok) throw new Error('Export failed.');
    return (await res.text()) as unknown as T;
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  return data as T;
}

export async function computeFileSha256(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  const hex = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return `0x${hex}`;
}
