/**
 * OpenAI Assistants API クライアント
 * file_search ツールを使ったRAG回答生成
 */

import OpenAI from "openai";

let _client: OpenAI | null = null;

function getClient(): OpenAI {
  if (!_client) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("OPENAI_API_KEY is not set");
    _client = new OpenAI({ apiKey });
  }
  return _client;
}

function getAssistantId(): string {
  const id = process.env.OPENAI_ASSISTANT_ID;
  if (!id) throw new Error("OPENAI_ASSISTANT_ID is not set");
  return id;
}

/**
 * 既存のThreadにメッセージを追加してRunを実行し、回答を返す
 * @param threadId 既存のThread ID（なければ新規作成）
 * @param userMessage ユーザーからのメッセージ
 * @returns 回答テキスト
 */
export async function askAssistant(
  threadId: string | undefined,
  userMessage: string
): Promise<{ answer: string; threadId: string }> {
  const openai = getClient();
  const assistantId = getAssistantId();

  // Threadがなければ新規作成
  const thread = threadId
    ? { id: threadId }
    : await openai.beta.threads.create();

  // ユーザーメッセージを追加
  await openai.beta.threads.messages.create(thread.id, {
    role: "user",
    content: userMessage,
  });

  // Run実行（完了まで待機）
  const run = await openai.beta.threads.runs.createAndPoll(thread.id, {
    assistant_id: assistantId,
  });

  if (run.status !== "completed") {
    throw new Error(`Run failed with status: ${run.status}`);
  }

  // 最新の回答を取得
  const messages = await openai.beta.threads.messages.list(thread.id, {
    order: "desc",
    limit: 1,
  });

  const firstContent = messages.data[0]?.content[0];
  if (!firstContent || firstContent.type !== "text") {
    throw new Error("No text response from assistant");
  }

  // 引用注釈（【4:0†source】等）を除去
  const answer = firstContent.text.value
    .replace(/【\d+:\d+†[^】]*】/g, "")
    .trim();

  return { answer, threadId: thread.id };
}
