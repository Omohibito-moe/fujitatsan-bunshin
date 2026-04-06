/**
 * Bot アカウントの既読初期化エンドポイント
 *
 * 新しいBotアカウントを設定した直後に1回だけ呼び出す。
 * 既存のメッセージを全て既読にして、以降の新着メッセージのみ処理されるようにする。
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getMessages } from "../lib/chatwork";

export const config = {
  maxDuration: 30,
};

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  try {
    // force=0 で取得するだけで既読になる（処理はしない）
    const messages = await getMessages(0);
    console.log(`[init] Marked ${messages.length} messages as read`);
    res.status(200).json({ status: "ok", markedAsRead: messages.length });
  } catch (err) {
    console.error("[init] Error:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
}
