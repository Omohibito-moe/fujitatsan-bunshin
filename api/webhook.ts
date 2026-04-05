/**
 * Chatwork Webhook エンドポイント
 *
 * Chatworkからのメッセージ通知を受け取り、Difyに回答を生成させてChatworkに返信する。
 * ビジネスプラン以上のChatworkアカウントが必要。
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { verifyWebhookSignature, postMessageWithRetry } from "../lib/chatwork";
import { askDify } from "../lib/dify";
import { getConversationId, setConversationId, pruneExpired } from "../lib/conversation";
import { formatAiReply, ERROR_MESSAGE } from "../lib/formatter";

interface WebhookPayload {
  webhook_setting_id: string;
  webhook_event_type: string;
  webhook_event_time: number;
  webhook_event: {
    from_account_id: number;
    to_account_id: number;
    room_id: number;
    message_id: string;
    body: string;
    send_time: number;
    update_time: number;
  };
}

export const config = {
  maxDuration: 60, // Vercel Serverless: 最大60秒
};

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method Not Allowed" });
    return;
  }

  // 署名検証
  const rawBody = JSON.stringify(req.body);
  const signature = (req.headers["x-chatworkwebhooksignature"] as string) ?? null;

  const isValid = await verifyWebhookSignature(rawBody, signature);
  if (!isValid) {
    res.status(401).json({ error: "Invalid signature" });
    return;
  }

  const payload = req.body as WebhookPayload;

  // メッセージ送信イベント以外は無視
  if (payload.webhook_event_type !== "mention_to_me" &&
      payload.webhook_event_type !== "message_created") {
    res.status(200).json({ status: "ignored" });
    return;
  }

  const event = payload.webhook_event;

  // Bot自身の投稿は無視（無限ループ防止）
  const botAccountId = Number(process.env.CHATWORK_BOT_ACCOUNT_ID);
  if (botAccountId && event.from_account_id === botAccountId) {
    res.status(200).json({ status: "ignored: bot message" });
    return;
  }

  // 空メッセージは無視
  const messageBody = event.body?.trim();
  if (!messageBody) {
    res.status(200).json({ status: "ignored: empty body" });
    return;
  }

  // Chatwork の [To:xxx] などのメンション記法を除去
  const cleanedQuery = stripChatworkMarkup(messageBody);

  // Vercelに200を先に返し、処理を非同期で続行（タイムアウト対策）
  res.status(200).json({ status: "processing" });

  // 期限切れ会話を掃除
  pruneExpired();

  const accountId = event.from_account_id;
  const conversationId = getConversationId(accountId);

  try {
    const difyRes = await askDify(
      cleanedQuery,
      String(accountId),
      conversationId
    );

    // 会話IDを更新
    setConversationId(accountId, difyRes.conversation_id);

    const replyText = formatAiReply(difyRes.answer);
    await postMessageWithRetry(replyText);
  } catch (err) {
    console.error("[webhook] Error:", err);
    try {
      await postMessageWithRetry(ERROR_MESSAGE);
    } catch (postErr) {
      console.error("[webhook] Failed to post error message:", postErr);
    }
  }
}

/**
 * Chatworkのメッセージ記法（[To:xxx]、[Re:xxx]等）を除去する
 */
function stripChatworkMarkup(text: string): string {
  return text
    .replace(/\[To:\d+\][^\n]*/g, "")
    .replace(/\[Re:messageId=\d+\]/g, "")
    .trim();
}
