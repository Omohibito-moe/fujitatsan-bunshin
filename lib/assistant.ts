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

  // アノテーション（引用）を処理してファイル名に置換
  const textContent = firstContent.text;
  const annotations = textContent.annotations ?? [];

  let answer = textContent.value;
  const citations: string[] = [];

  for (const annotation of annotations) {
    if (annotation.type === "file_citation") {
      const fileId = annotation.file_citation.file_id;
      let fileName = fileId;
      try {
        const fileInfo = await getClient().files.retrieve(fileId);
        fileName = fileInfo.filename.replace(/\.[^/.]+$/, ""); // 拡張子を除去
      } catch {
        // ファイル名取得失敗時はIDをそのまま使用
      }
      const citationIndex = citations.indexOf(fileName);
      const index = citationIndex === -1
        ? citations.push(fileName)
        : citationIndex + 1;
      answer = answer.replace(annotation.text, `[${index}]`);
    }
  }

  // 出典リストを末尾に追加
  if (citations.length > 0) {
    answer += "\n\n【出典】\n" + citations.map((c, i) => `[${i + 1}] ${c}`).join("\n");
  }

  return { answer: answer.trim(), threadId: thread.id };
}
