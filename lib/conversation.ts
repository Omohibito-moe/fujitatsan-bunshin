/**
 * Dify conversation_id 管理モジュール
 *
 * Chatworkのaccount_idをキーに会話IDを保持する。
 * Phase 1: インメモリ（サーバーレス再起動で消える — 許容範囲）
 * Phase 2: Vercel KV に移行して永続化する
 *
 * 24時間経過した会話コンテキストは自動リセットする。
 */

interface ConversationEntry {
  conversationId: string;
  updatedAt: number; // Unix timestamp (ms)
}

// インメモリストア（サーバーレス関数の同一インスタンス内でのみ有効）
const store = new Map<string, ConversationEntry>();

const TTL_MS = 24 * 60 * 60 * 1000; // 24時間

/**
 * account_id に紐付く conversation_id を取得する
 * TTL切れの場合は undefined を返す（会話をリセット）
 */
export function getConversationId(accountId: number): string | undefined {
  const key = String(accountId);
  const entry = store.get(key);
  if (!entry) return undefined;

  const isExpired = Date.now() - entry.updatedAt > TTL_MS;
  if (isExpired) {
    store.delete(key);
    return undefined;
  }

  return entry.conversationId;
}

/**
 * account_id に conversation_id を紐付けて保存する
 */
export function setConversationId(accountId: number, conversationId: string): void {
  store.set(String(accountId), {
    conversationId,
    updatedAt: Date.now(),
  });
}

/**
 * 期限切れエントリを掃除する（メモリリーク防止）
 */
export function pruneExpired(): void {
  const now = Date.now();
  for (const [key, entry] of store.entries()) {
    if (now - entry.updatedAt > TTL_MS) {
      store.delete(key);
    }
  }
}
