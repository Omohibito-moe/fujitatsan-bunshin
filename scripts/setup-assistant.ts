/**
 * OpenAI Assistant & Vector Store 初期セットアップスクリプト
 *
 * 使い方:
 *   1. .env ファイルに OPENAI_API_KEY を設定
 *   2. knowledge_data/ に .txt ファイルを格納
 *   3. npx ts-node scripts/setup-assistant.ts を実行
 *   4. 出力された OPENAI_ASSISTANT_ID を Vercel 環境変数に設定
 *
 * 既にAssistantが存在する場合は再実行不要（ファイル追加は別途行う）
 */

import OpenAI from "openai";
import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";

dotenv.config();

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const SYSTEM_INSTRUCTIONS = `あなたは介護・福祉事業の経営アドバイザー「藤田AI」です。
藤田英明の経験・ナレッジに基づいて、加盟店からの経営相談に回答します。

## ルール
- file_searchで取得した参考情報に基づいて回答してください
- 参考情報にない質問には「この件についてはナレッジに情報がないため、藤田または担当SVにご確認ください」と回答してください
- 法令の具体的な条文番号や数値を回答する場合は、必ず「最新の法令を確認してください」と付記してください
- 口調は丁寧だが端的に。経営者同士の会話のトーンで
- 回答は日本語で行ってください`;

async function main() {
  console.log("=== OpenAI Assistant セットアップ開始 ===\n");

  // 1. Vector Store作成
  console.log("1. Vector Store を作成中...");
  const vectorStore = await openai.vectorStores.create({
    name: "fujita_knowledge",
  });
  console.log(`   Vector Store ID: ${vectorStore.id}\n`);

  // 2. knowledge_data/ 内の .txt ファイルをアップロード
  const knowledgeDir = path.join(process.cwd(), "knowledge_data");
  const files = fs.existsSync(knowledgeDir)
    ? fs.readdirSync(knowledgeDir).filter((f) => f.endsWith(".txt"))
    : [];

  if (files.length === 0) {
    console.log("2. knowledge_data/ に .txt ファイルがありません。スキップします。");
    console.log("   後でファイルを追加したい場合は scripts/add-knowledge.ts を使用してください。\n");
  } else {
    console.log(`2. ${files.length} ファイルをアップロード中...`);
    const fileStreams = files.map((f) =>
      fs.createReadStream(path.join(knowledgeDir, f))
    );

    await openai.vectorStores.fileBatches.uploadAndPoll(vectorStore.id, {
      files: fileStreams,
    });
    console.log(`   完了: ${files.join(", ")}\n`);
  }

  // 3. Assistant作成
  console.log("3. Assistant を作成中...");
  const assistant = await openai.beta.assistants.create({
    name: "藤田AIナレッジBot",
    instructions: SYSTEM_INSTRUCTIONS,
    model: "gpt-4o",
    tools: [{ type: "file_search" }],
    tool_resources: {
      file_search: {
        vector_store_ids: [vectorStore.id],
      },
    },
  });
  console.log(`   Assistant ID: ${assistant.id}\n`);

  console.log("=== セットアップ完了 ===");
  console.log("");
  console.log("以下を Vercel の Environment Variables に設定してください:");
  console.log(`  OPENAI_ASSISTANT_ID=${assistant.id}`);
  console.log("");
  console.log("設定後、Vercel を Redeploy してください。");
}

main().catch((err) => {
  console.error("セットアップ失敗:", err);
  process.exit(1);
});
