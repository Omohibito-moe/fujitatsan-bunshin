/**
 * OpenAI Thread ID 管理モジュール
 *
 * Chatworkのaccount_idをキーにthread_idを保持する。
 * Phase 1: インメモリ（サーバーレス再起動でリセット — 許容範囲）
 * Phase 2: Vercel KVに移行して永続化する
 *
 * 24時間経過したThreadは自動リセット。
 */

// ---- Phase 1: インメモリ実装 ----

interface ThreadEntry {
  threadId: string;
  updatedAt: number;
}

const store = new Map<string, ThreadEntry>();
const TTL_MS = 24 * 60 * 60 * 1000;

export function getThreadId(accountId: number): string | undefined {
  const entry = store.get(String(accountId));
  if (!entry) return undefined;
  if (Date.now() - entry.updatedAt > TTL_MS) {
    store.delete(String(accountId));
    return undefined;
  }
  return entry.threadId;
}

export function setThreadId(accountId: number, threadId: string): void {
  store.set(String(accountId), { threadId, updatedAt: Date.now() });
}

export function pruneExpired(): void {
  const now = Date.now();
  for (const [key, entry] of store.entries()) {
    if (now - entry.updatedAt > TTL_MS) store.delete(key);
  }
}

// ---- Phase 2: Vercel KV実装（コメントアウト） ----
// import { kv } from "@vercel/kv";
//
// const TTL_SECONDS = 24 * 60 * 60;
// const key = (accountId: number) => `thread:${accountId}`;
//
// export async function getThreadId(accountId: number): Promise<string | undefined> {
//   const val = await kv.get<string>(key(accountId));
//   return val ?? undefined;
// }
//
// export async function setThreadId(accountId: number, threadId: string): Promise<void> {
//   await kv.set(key(accountId), threadId, { ex: TTL_SECONDS });
// }
//
// export function pruneExpired(): void {} // KVはTTLで自動削除されるため不要
