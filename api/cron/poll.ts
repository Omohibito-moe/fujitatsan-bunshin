/**
 * Chatwork ポーリング + OpenAI Assistants API 回答 + Chatwork返信
 *
 * Vercel Cron Jobs（Proプラン）から3分間隔で呼び出される。
 * lastProcessedMessageId は Vercel KV に永続化する。
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { kv } from "@vercel/kv";
import { getMessages, postMessageWithRetry } from "../../lib/chatwork";
import { askAssistant } from "../../lib/assistant";
import { getThreadId, setThreadId, pruneExpired } from "../../lib/thread-store";
import { formatAiReply, ERROR_MESSAGE } from "../../lib/formatter";

export const config = {
  maxDuration: 60,
};

const KV_KEY = "last_processed_message_id";

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  // 外部cronからのリクエスト認証（CRON_SECRETが設定されている場合）
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = req.headers.authorization;
    if (authHeader !== `Bearer ${cronSecret}`) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
  }

  try {
    // KVから最後に処理したメッセージIDを取得
    const lastProcessedMessageId = await kv.get<string>(KV_KEY);

    // force=1で全件取得（既読・未読問わず最新100件）
    const messages = await getMessages(1);

    if (messages.length === 0) {
      res.status(200).json({ status: "no new messages" });
      return;
    }

    // 初回起動時（KVにIDがない）は最新IDを記録するだけでスキップ
    if (!lastProcessedMessageId) {
      const latestId = messages[messages.length - 1]?.message_id ?? null;
      if (latestId) await kv.set(KV_KEY, latestId);
      console.log(`[poll] Initialized. lastProcessedMessageId=${latestId}`);
      res.status(200).json({ status: "initialized", lastProcessedMessageId: latestId });
      return;
    }

    const botAccountId = Number(process.env.CHATWORK_BOT_ACCOUNT_ID);

    // Bot自身・空メッセージ・処理済みメッセージを除外
    const targets = messages.filter((msg) => {
      if (botAccountId && msg.account.account_id === botAccountId) return false;
      if (!msg.body?.trim()) return false;
      if (msg.message_id <= lastProcessedMessageId) return false;
      return true;
    });

    if (targets.length === 0) {
      res.status(200).json({ status: "no new messages" });
      return;
    }

    pruneExpired();

    let newLastId = lastProcessedMessageId;

    // 直列処理（レートリミット対策）
    for (const msg of targets) {
      const query = stripChatworkMarkup(msg.body.trim());
      const accountId = msg.account.account_id;
      const threadId = getThreadId(accountId);

      try {
        const { answer, threadId: newThreadId } = await askAssistant(
          threadId,
          query
        );

        setThreadId(accountId, newThreadId);
        await postMessageWithRetry(formatAiReply(answer));
      } catch (err) {
        console.error(`[poll] Error processing message ${msg.message_id}:`, err);
        try {
          await postMessageWithRetry(ERROR_MESSAGE);
        } catch (postErr) {
          console.error("[poll] Failed to post error message:", postErr);
        }
      }

      newLastId = msg.message_id;
      await sleep(200);
    }

    // 処理済みIDをKVに保存
    await kv.set(KV_KEY, newLastId);

    res.status(200).json({ status: "ok", processed: targets.length });
  } catch (err) {
    console.error("[poll] Unexpected error:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
}

function stripChatworkMarkup(text: string): string {
  return text
    .replace(/\[To:\d+\][^\n]*/g, "")
    .replace(/\[Re:messageId=\d+\]/g, "")
    .trim();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
