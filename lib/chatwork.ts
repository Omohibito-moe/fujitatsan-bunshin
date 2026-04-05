/**
 * Chatwork API v2 クライアント
 */

const CHATWORK_API_BASE = "https://api.chatwork.com/v2";

export interface ChatworkMessage {
  message_id: string;
  account: {
    account_id: number;
    name: string;
    avatar_image_url: string;
  };
  body: string;
  send_time: number;
  update_time: number;
}

function getApiToken(): string {
  const token = process.env.CHATWORK_API_TOKEN;
  if (!token) throw new Error("CHATWORK_API_TOKEN is not set");
  return token;
}

function getRoomId(): string {
  const roomId = process.env.CHATWORK_ROOM_ID;
  if (!roomId) throw new Error("CHATWORK_ROOM_ID is not set");
  return roomId;
}

/**
 * ルームのメッセージ一覧を取得する
 * @param force 1=全件取得（最大100件）、0=未読メッセージのみ
 */
export async function getMessages(force = 0): Promise<ChatworkMessage[]> {
  const roomId = getRoomId();
  const url = `${CHATWORK_API_BASE}/rooms/${roomId}/messages?force=${force}`;

  const res = await fetch(url, {
    method: "GET",
    headers: {
      "X-ChatWorkToken": getApiToken(),
    },
  });

  if (res.status === 204) {
    // No new messages
    return [];
  }

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Chatwork getMessages failed: ${res.status} ${body}`);
  }

  return res.json() as Promise<ChatworkMessage[]>;
}

/**
 * ルームにメッセージを投稿する
 */
export async function postMessage(body: string): Promise<void> {
  const roomId = getRoomId();
  const url = `${CHATWORK_API_BASE}/rooms/${roomId}/messages`;

  // Chatwork API のレートリミット対策: 最大5リクエスト/秒
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "X-ChatWorkToken": getApiToken(),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ body }).toString(),
  });

  if (!res.ok) {
    const resBody = await res.text();
    throw new Error(`Chatwork postMessage failed: ${res.status} ${resBody}`);
  }
}

/**
 * レートリミットを考慮したリトライ付きpostMessage
 */
export async function postMessageWithRetry(
  body: string,
  maxRetries = 3
): Promise<void> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await postMessage(body);
      return;
    } catch (err) {
      const isLastAttempt = attempt === maxRetries;
      if (isLastAttempt) throw err;

      // レートリミット時は少し待つ
      await sleep(300 * attempt);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Webhook署名を検証する
 * Chatwork は HMAC-SHA256 で署名を付与する
 */
export async function verifyWebhookSignature(
  rawBody: string,
  signatureHeader: string | null
): Promise<boolean> {
  const token = process.env.CHATWORK_WEBHOOK_TOKEN;
  if (!token) {
    // トークン未設定の場合は検証をスキップ（開発時）
    console.warn("CHATWORK_WEBHOOK_TOKEN is not set — skipping signature verification");
    return true;
  }

  if (!signatureHeader) return false;

  const encoder = new TextEncoder();
  const keyData = encoder.encode(token);
  const messageData = encoder.encode(rawBody);

  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyData,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign("HMAC", cryptoKey, messageData);
  const expectedHex = Buffer.from(signature).toString("hex");

  // タイミング攻撃対策の定数時間比較
  return timingSafeEqual(expectedHex, signatureHeader);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
