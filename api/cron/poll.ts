/**
 * Chatwork ポーリング + OpenAI Assistants API 回答 + Chatwork返信
 *
 * Vercel Cron Jobs（Proプラン）から3分間隔で呼び出される。
 * Bot専用アカウントのAPIトークンを使うことで、force=0（未読のみ）が正常に動作する。
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getMessages, postMessageWithRetry } from "../../lib/chatwork";
import { askAssistant } from "../../lib/assistant";
import { getThreadId, setThreadId, pruneExpired } from "../../lib/thread-store";
import { formatAiReply, ERROR_MESSAGE } from "../../lib/formatter";

export const config = {
  maxDuration: 60,
};

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = req.headers.authorization;
    if (authHeader !== `Bearer ${cronSecret}`) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
  }

  try {
    // Bot専用アカウントで未読メッセージのみ取得
    const messages = await getMessages(0);

    if (messages.length === 0) {
      res.status(200).json({ status: "no new messages" });
      return;
    }

    const botAccountId = Number(process.env.CHATWORK_BOT_ACCOUNT_ID);

    const targets = messages.filter((msg) => {
      if (botAccountId && msg.account.account_id === botAccountId) return false;
      if (!msg.body?.trim()) return false;
      return true;
    });

    if (targets.length === 0) {
      res.status(200).json({ status: "no new messages" });
      return;
    }

    pruneExpired();

    for (const msg of targets) {
      const query = stripChatworkMarkup(msg.body.trim());
      const accountId = msg.account.account_id;
      const threadId = getThreadId(accountId);

      try {
        const { answer, threadId: newThreadId } = await askAssistant(threadId, query);
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

      await sleep(200);
    }

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
