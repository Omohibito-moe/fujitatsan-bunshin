/**
 * Chatwork メッセージフォーマッター
 *
 * AI回答に免責文を付与し、Chatworkのメッセージ記法でラップする。
 */

const DISCLAIMER =
  "※この回答はAIによる参考情報です。法令・制度に関する重要な判断は藤田または担当SVにご確認ください。";

/**
 * AI回答本文を免責文付きのChatworkメッセージに変換する
 */
export function formatAiReply(answerBody: string): string {
  return `[info][title]🤖 AI回答（参考情報）[/title]\n${answerBody.trim()}\n\n${DISCLAIMER}[/info]`;
}

/**
 * エラー時にユーザーに表示するメッセージ
 */
export const ERROR_MESSAGE =
  "申し訳ありません。回答の生成に失敗しました。担当SVにお問い合わせください。";
