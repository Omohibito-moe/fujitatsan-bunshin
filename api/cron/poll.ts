/**
 * Chatwork ポーリング用 Cron エンドポイント（フォールバック方式）
 *
 * Webhook が利用できない場合（スタンダードプラン以下）に使用する。
 * vercel.json の crons 設定により 5分ごとに実行される。
 *
 * 注意: サーバーレス関数はステートレスなため、lastMessageId はインメモリでは
 *       リセットされる。本番ではVercel KVへの移行を推奨。
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getMessages, postMessageWithRetry } from "../../lib/chatwork";
import { askDify } from "../../lib/dify";
import { getConversationId, setConversationId, pruneExpired } from "../../lib/conversation";
import { formatAiReply, ERROR_MESSAGE } from "../../lib/formatter";

export const config = {
  maxDuration: 60,
};

// インメモリで最終処理済みメッセージIDを保持
// （サーバーレス関数の再起動で失われるが、Vercel KV移行前の暫定対応）
let lastProcessedMessageId: string | null = null;

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  // Vercel Cronからのリクエストのみ許可
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = req.headers.authorization;
    if (authHeader !== `Bearer ${cronSecret}`) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
  }

  try {
    const messages = await getMessages(0); // 未読メッセージのみ取得

    if (messages.length === 0) {
      res.status(200).json({ status: "no new messages" });
      return;
    }

    const botAccountId = Number(process.env.CHATWORK_BOT_ACCOUNT_ID);

    // 処理対象メッセージをフィルタリング
    const targets = messages.filter((msg) => {
      // Bot自身のメッセージは除外
      if (botAccountId && msg.account.account_id === botAccountId) return false;
      // 空メッセージは除外
      if (!msg.body?.trim()) return false;
      // 既処理IDより古いメッセージは除外
      if (lastProcessedMessageId && msg.message_id <= lastProcessedMessageId) return false;
      return true;
    });

    if (targets.length === 0) {
      res.status(200).json({ status: "no new messages" });
      return;
    }

    // 期限切れ会話を掃除
    pruneExpired();

    // 各メッセージを順番に処理（レートリミット対策で直列処理）
    for (const msg of targets) {
      const cleanedQuery = stripChatworkMarkup(msg.body.trim());
      const accountId = msg.account.account_id;
      const conversationId = getConversationId(accountId);

      try {
        const difyRes = await askDify(
          cleanedQuery,
          String(accountId),
          conversationId
        );

        setConversationId(accountId, difyRes.conversation_id);

        const replyText = formatAiReply(difyRes.answer);
        await postMessageWithRetry(replyText);
      } catch (err) {
        console.error(`[poll] Error processing message ${msg.message_id}:`, err);
        try {
          await postMessageWithRetry(ERROR_MESSAGE);
        } catch (postErr) {
          console.error("[poll] Failed to post error message:", postErr);
        }
      }

      // 処理済みIDを更新
      lastProcessedMessageId = msg.message_id;

      // レートリミット対策: メッセージ間に200ms待機
      await sleep(200);
    }

    res.status(200).json({
      status: "ok",
      processed: targets.length,
    });
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
