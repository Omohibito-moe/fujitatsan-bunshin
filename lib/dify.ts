/**
 * Dify Cloud API クライアント
 * Chat Messages API を使用してRAGベースの回答を生成する
 */

export interface DifyResponse {
  answer: string;
  conversation_id: string;
  message_id: string;
}

interface DifyErrorResponse {
  code: string;
  message: string;
  status: number;
}

function getApiUrl(): string {
  return process.env.DIFY_API_URL ?? "https://api.dify.ai/v1";
}

function getApiKey(): string {
  const key = process.env.DIFY_API_KEY;
  if (!key) throw new Error("DIFY_API_KEY is not set");
  return key;
}

/**
 * Dify Chat Messages API に質問を送信し、回答を取得する
 * @param query ユーザーからの質問テキスト
 * @param userId Chatworkのaccount_idをユーザー識別子として使用
 * @param conversationId 既存の会話ID（ある場合）
 * @returns AI回答テキストと会話ID
 */
export async function askDify(
  query: string,
  userId: string,
  conversationId?: string
): Promise<DifyResponse> {
  const url = `${getApiUrl()}/chat-messages`;

  const requestBody: Record<string, unknown> = {
    inputs: {},
    query,
    response_mode: "blocking",
    user: userId,
  };

  if (conversationId) {
    requestBody.conversation_id = conversationId;
  }

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${getApiKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(requestBody),
  });

  if (!res.ok) {
    let errorMessage = `Dify API error: ${res.status}`;
    try {
      const errBody = (await res.json()) as DifyErrorResponse;
      errorMessage = `Dify API error ${errBody.status}: ${errBody.message} (${errBody.code})`;
    } catch {
      // JSONパース失敗時はステータスコードのみ使用
    }
    throw new Error(errorMessage);
  }

  const data = (await res.json()) as DifyResponse;
  return data;
}
