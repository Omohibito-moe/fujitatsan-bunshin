/**
 * Vector Storeのファイルを全削除して、note_articles/の個別ファイルで再構築するスクリプト
 *
 * 使い方:
 *   npx ts-node scripts/rebuild-knowledge.ts
 */

import OpenAI from "openai";
import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";

dotenv.config();

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function main() {
  const assistantId = process.env.OPENAI_ASSISTANT_ID;
  if (!assistantId) throw new Error("OPENAI_ASSISTANT_ID が設定されていません");

  // AssistantのVector Store IDを取得
  const assistant = await openai.beta.assistants.retrieve(assistantId);
  const vectorStoreIds = assistant.tool_resources?.file_search?.vector_store_ids ?? [];
  if (vectorStoreIds.length === 0) throw new Error("Vector StoreがAssistantに紐づいていません");

  const vectorStoreId = vectorStoreIds[0];
  console.log(`Vector Store ID: ${vectorStoreId}\n`);

  // 既存ファイルを全削除
  console.log("1. 既存ファイルを削除中...");
  const existingFiles = await openai.vectorStores.files.list(vectorStoreId);
  for (const f of existingFiles.data) {
    await openai.vectorStores.files.del(vectorStoreId, f.id);
    console.log(`   削除: ${f.id}`);
  }
  console.log(`   完了: ${existingFiles.data.length}件削除\n`);

  // note_articles/ の個別ファイルをアップロード
  const articlesDir = path.join(process.cwd(), "knowledge_data", "note_articles");
  const files = fs.readdirSync(articlesDir)
    .filter((f) => f.endsWith(".txt"))
    .sort();

  console.log(`2. ${files.length}件の記事ファイルをアップロード中...`);

  // 50件ずつバッチ処理（API制限対策）
  const batchSize = 50;
  for (let i = 0; i < files.length; i += batchSize) {
    const batch = files.slice(i, i + batchSize);
    const fileStreams = batch.map((f) =>
      fs.createReadStream(path.join(articlesDir, f))
    );

    const result = await openai.vectorStores.fileBatches.uploadAndPoll(vectorStoreId, {
      files: fileStreams,
    });

    console.log(`   バッチ ${Math.floor(i / batchSize) + 1}: 成功=${result.file_counts.completed}, 失敗=${result.file_counts.failed}`);
  }

  console.log("\n完了！記事ごとに分割してアップロードしました。");
  console.log("RAGの検索精度が向上します。");
}

main().catch((err) => {
  console.error("エラー:", err);
  process.exit(1);
});
