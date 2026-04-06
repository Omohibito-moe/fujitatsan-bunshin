"""
藤田英明氏のナレッジベース用データ収集スクリプト

【前提条件】
- Python 3.9+
- pip install requests beautifulsoup4 yt-dlp openai-whisper（またはwhisper）

【使い方】
1. note記事の全件取得:  python collect_knowledge.py note
2. YouTube動画リスト取得: python collect_knowledge.py youtube_list
3. YouTube動画の文字起こし: python collect_knowledge.py youtube_transcribe
4. 全部まとめて実行:      python collect_knowledge.py all
"""

import sys
import os
import json
import time
import requests
from pathlib import Path

OUTPUT_DIR = Path("knowledge_data")
NOTE_DIR = OUTPUT_DIR / "note_articles"
YOUTUBE_DIR = OUTPUT_DIR / "youtube"
YOUTUBE_AUDIO_DIR = YOUTUBE_DIR / "audio"
YOUTUBE_TRANSCRIPT_DIR = YOUTUBE_DIR / "transcripts"

NOTE_USER = "fujita_fukushi"
YOUTUBE_CHANNEL_URL = "https://www.youtube.com/@fujita-hideaki/videos"


def setup_dirs():
    for d in [NOTE_DIR, YOUTUBE_AUDIO_DIR, YOUTUBE_TRANSCRIPT_DIR]:
        d.mkdir(parents=True, exist_ok=True)


# ========================================
# 1. note記事の全件取得
# ========================================
def fetch_note_articles():
    """noteのAPIを使って全記事を取得し、テキストファイルとして保存"""
    print("=== note記事の取得開始 ===")
    
    page = 1
    per_page = 20
    all_articles = []
    
    while True:
        url = f"https://note.com/api/v2/creators/{NOTE_USER}/contents?kind=note&page={page}&per_page={per_page}"
        print(f"  ページ {page} を取得中...")
        
        try:
            resp = requests.get(url, headers={
                "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"
            })
            resp.raise_for_status()
            data = resp.json()
        except Exception as e:
            print(f"  APIエラー: {e}")
            # APIが使えない場合はスクレイピングにフォールバック
            print("  → APIが使えない場合は、後述のスクレイピング方式を使ってください")
            break
        
        notes = data.get("data", {}).get("contents", [])
        if not notes:
            print(f"  ページ {page} に記事なし。取得完了。")
            break
        
        all_articles.extend(notes)
        print(f"  {len(notes)} 件取得（累計: {len(all_articles)} 件）")
        
        if data.get("data", {}).get("isLastPage", True):
            break
        
        page += 1
        time.sleep(1)  # レートリミット対策
    
    print(f"\n合計 {len(all_articles)} 件の記事メタデータを取得")
    
    # 各記事の本文を取得
    for i, article in enumerate(all_articles):
        note_key = article.get("key", "")
        title = article.get("name", "無題")
        note_url = f"https://note.com/{NOTE_USER}/n/{note_key}"
        
        safe_title = "".join(c for c in title if c.isalnum() or c in " _-あ-んア-ン一-龥").strip()[:80]
        filename = f"{i+1:03d}_{safe_title}.txt"
        filepath = NOTE_DIR / filename
        
        if filepath.exists():
            print(f"  [{i+1}/{len(all_articles)}] スキップ（既存）: {title}")
            continue
        
        print(f"  [{i+1}/{len(all_articles)}] 取得中: {title}")
        
        # 記事詳細APIから本文を取得
        detail_url = f"https://note.com/api/v3/notes/{note_key}"
        try:
            detail_resp = requests.get(detail_url, headers={
                "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"
            })
            detail_resp.raise_for_status()
            detail_data = detail_resp.json()
            
            body = detail_data.get("data", {}).get("body", "")
            
            # HTMLタグを除去（簡易版）
            from html.parser import HTMLParser
            class HTMLStripper(HTMLParser):
                def __init__(self):
                    super().__init__()
                    self.text = []
                def handle_data(self, data):
                    self.text.append(data)
                def get_text(self):
                    return "\n".join(self.text)
            
            stripper = HTMLStripper()
            stripper.feed(body)
            plain_text = stripper.get_text()
            
            # ファイルに保存
            with open(filepath, "w", encoding="utf-8") as f:
                f.write(f"タイトル: {title}\n")
                f.write(f"URL: {note_url}\n")
                f.write(f"公開日: {article.get('publishAt', '不明')}\n")
                f.write(f"{'='*60}\n\n")
                f.write(plain_text)
            
            print(f"    → 保存完了: {filepath}")
            
        except Exception as e:
            print(f"    → エラー: {e}")
            # エラーの場合はメタデータだけ保存
            with open(filepath, "w", encoding="utf-8") as f:
                f.write(f"タイトル: {title}\n")
                f.write(f"URL: {note_url}\n")
                f.write(f"公開日: {article.get('publishAt', '不明')}\n")
                f.write(f"本文取得エラー: {e}\n")
        
        time.sleep(1.5)  # レートリミット対策
    
    # 記事一覧のインデックスファイルを保存
    index_path = NOTE_DIR / "_index.json"
    with open(index_path, "w", encoding="utf-8") as f:
        json.dump([{
            "title": a.get("name", ""),
            "key": a.get("key", ""),
            "url": f"https://note.com/{NOTE_USER}/n/{a.get('key', '')}",
            "publishAt": a.get("publishAt", ""),
            "likeCount": a.get("likeCount", 0),
        } for a in all_articles], f, ensure_ascii=False, indent=2)
    
    print(f"\nインデックスファイル保存: {index_path}")
    print(f"=== note記事の取得完了 ===\n")


# ========================================
# 2. YouTube動画リストの取得
# ========================================
def fetch_youtube_list():
    """yt-dlpを使ってYouTubeチャンネルの全動画リストを取得"""
    print("=== YouTube動画リストの取得開始 ===")
    
    import subprocess
    
    list_file = YOUTUBE_DIR / "video_list.json"
    
    cmd = [
        "yt-dlp",
        "--flat-playlist",
        "--dump-json",
        YOUTUBE_CHANNEL_URL + "/videos",
    ]
    
    print(f"  コマンド: {' '.join(cmd)}")
    
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
        
        if result.returncode != 0:
            print(f"  エラー: {result.stderr[:500]}")
            return
        
        videos = []
        for line in result.stdout.strip().split("\n"):
            if line:
                try:
                    video = json.loads(line)
                    videos.append({
                        "id": video.get("id", ""),
                        "title": video.get("title", ""),
                        "url": video.get("url", f"https://www.youtube.com/watch?v={video.get('id', '')}"),
                        "duration": video.get("duration", 0),
                        "view_count": video.get("view_count", 0),
                    })
                except json.JSONDecodeError:
                    continue
        
        with open(list_file, "w", encoding="utf-8") as f:
            json.dump(videos, f, ensure_ascii=False, indent=2)
        
        print(f"  {len(videos)} 件の動画を取得")
        print(f"  保存先: {list_file}")
        
        # 一覧を表示
        for v in videos:
            dur = int(v.get("duration", 0) or 0)
            dur_str = f"{dur//60}:{dur%60:02d}" if dur else "不明"
            print(f"    - [{dur_str}] {v['title']}")
    
    except subprocess.TimeoutExpired:
        print("  タイムアウト（5分）")
    except FileNotFoundError:
        print("  yt-dlpがインストールされていません。")
        print("  → pip install yt-dlp")
    
    print(f"=== YouTube動画リストの取得完了 ===\n")


# ========================================
# 3. YouTube動画の音声ダウンロード＋文字起こし
# ========================================
def transcribe_youtube_videos():
    """
    YouTube動画をダウンロード→Whisperで文字起こし
    
    注意: 
    - Whisperの実行にはGPU推奨（CPUでも可能だが遅い）
    - pip install openai-whisper
    - 動画が多い場合は数時間かかる
    """
    print("=== YouTube動画の文字起こし開始 ===")
    
    import subprocess
    
    list_file = YOUTUBE_DIR / "video_list.json"
    if not list_file.exists():
        print("  動画リストがありません。先に youtube_list を実行してください。")
        return
    
    with open(list_file, "r", encoding="utf-8") as f:
        videos = json.load(f)
    
    print(f"  {len(videos)} 件の動画を処理します")
    
    for i, video in enumerate(videos):
        vid = video["id"]
        title = video["title"]
        url = video.get("url", f"https://www.youtube.com/watch?v={vid}")
        
        transcript_file = YOUTUBE_TRANSCRIPT_DIR / f"{vid}.txt"
        
        if transcript_file.exists():
            print(f"  [{i+1}/{len(videos)}] スキップ（既存）: {title}")
            continue
        
        print(f"  [{i+1}/{len(videos)}] 処理中: {title}")
        
        # --- まずYouTubeの自動字幕を試す（Whisperより速い） ---
        subtitle_file = YOUTUBE_AUDIO_DIR / f"{vid}.ja.vtt"
        
        cmd_sub = [
            "yt-dlp",
            "--write-auto-sub",
            "--sub-lang", "ja",
            "--skip-download",
            "--output", str(YOUTUBE_AUDIO_DIR / f"{vid}"),
            url
        ]
        
        try:
            subprocess.run(cmd_sub, capture_output=True, text=True, timeout=60)
        except:
            pass
        
        # 字幕ファイルがあればそれを使う
        vtt_files = list(YOUTUBE_AUDIO_DIR.glob(f"{vid}*.vtt"))
        if vtt_files:
            print(f"    → 自動字幕を使用")
            text = parse_vtt(vtt_files[0])
            with open(transcript_file, "w", encoding="utf-8") as f:
                f.write(f"タイトル: {title}\n")
                f.write(f"URL: {url}\n")
                f.write(f"ソース: YouTube自動字幕\n")
                f.write(f"{'='*60}\n\n")
                f.write(text)
            print(f"    → 保存完了: {transcript_file}")
            # VTTファイルを削除
            for vf in vtt_files:
                vf.unlink()
            continue
        
        # --- 字幕がなければ音声DL→Whisper ---
        audio_file = YOUTUBE_AUDIO_DIR / f"{vid}.mp3"
        
        if not audio_file.exists():
            cmd_dl = [
                "yt-dlp",
                "--extract-audio",
                "--audio-format", "mp3",
                "--audio-quality", "5",  # 低品質（文字起こし用なら十分）
                "--output", str(YOUTUBE_AUDIO_DIR / f"{vid}.%(ext)s"),
                url
            ]
            
            try:
                result = subprocess.run(cmd_dl, capture_output=True, text=True, timeout=600)
                if result.returncode != 0:
                    print(f"    → ダウンロードエラー: {result.stderr[:200]}")
                    continue
            except subprocess.TimeoutExpired:
                print(f"    → ダウンロードタイムアウト")
                continue
        
        # Whisperで文字起こし
        try:
            import whisper
            
            print(f"    → Whisperで文字起こし中...")
            model = whisper.load_model("base")  # small/medium/largeで精度向上
            result = model.transcribe(str(audio_file), language="ja")
            
            with open(transcript_file, "w", encoding="utf-8") as f:
                f.write(f"タイトル: {title}\n")
                f.write(f"URL: {url}\n")
                f.write(f"ソース: Whisper文字起こし（baseモデル）\n")
                f.write(f"{'='*60}\n\n")
                f.write(result["text"])
            
            print(f"    → 保存完了: {transcript_file}")
            
            # 音声ファイルを削除（容量節約）
            audio_file.unlink()
            
        except ImportError:
            print("    → Whisperがインストールされていません。")
            print("    → pip install openai-whisper")
            print("    → 代替案: YouTube字幕のみで進める")
            break
        except Exception as e:
            print(f"    → Whisperエラー: {e}")
    
    print(f"=== YouTube動画の文字起こし完了 ===\n")


def parse_vtt(vtt_path):
    """VTT字幕ファイルをプレーンテキストに変換"""
    lines = []
    seen = set()
    
    with open(vtt_path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            # タイムスタンプ行やヘッダーをスキップ
            if not line or line.startswith("WEBVTT") or "-->" in line or line.startswith("NOTE"):
                continue
            # HTMLタグを除去
            import re
            clean = re.sub(r"<[^>]+>", "", line)
            if clean and clean not in seen:
                seen.add(clean)
                lines.append(clean)
    
    return "\n".join(lines)


# ========================================
# 4. Difyアップロード用にファイルを統合
# ========================================
def merge_for_dify():
    """全データを統合してDifyアップロード用のファイルを作成"""
    print("=== Difyアップロード用ファイルの作成 ===")
    
    merged_dir = OUTPUT_DIR / "dify_upload"
    merged_dir.mkdir(exist_ok=True)
    
    # note記事を1ファイルにまとめる（大きすぎる場合は分割）
    note_files = sorted(NOTE_DIR.glob("*.txt"))
    if note_files:
        merged_note = merged_dir / "note_articles_all.txt"
        with open(merged_note, "w", encoding="utf-8") as out:
            for nf in note_files:
                if nf.name.startswith("_"):
                    continue
                content = nf.read_text(encoding="utf-8")
                out.write(content)
                out.write(f"\n\n{'='*80}\n\n")
        
        size_mb = merged_note.stat().st_size / (1024 * 1024)
        print(f"  note記事統合ファイル: {merged_note} ({size_mb:.1f} MB)")
        
        # 5MB超なら分割
        if size_mb > 4.5:
            print(f"  → Difyの制限（5MB/ファイル）を超える可能性があるため、個別ファイルでアップロードしてください")
    
    # YouTube文字起こしを1ファイルにまとめる
    yt_files = sorted(YOUTUBE_TRANSCRIPT_DIR.glob("*.txt"))
    if yt_files:
        merged_yt = merged_dir / "youtube_transcripts_all.txt"
        with open(merged_yt, "w", encoding="utf-8") as out:
            for yf in yt_files:
                content = yf.read_text(encoding="utf-8")
                out.write(content)
                out.write(f"\n\n{'='*80}\n\n")
        
        size_mb = merged_yt.stat().st_size / (1024 * 1024)
        print(f"  YouTube文字起こし統合ファイル: {merged_yt} ({size_mb:.1f} MB)")
    
    print(f"=== 作成完了 ===")
    print(f"\n次のステップ:")
    print(f"  1. Dify Cloud (https://cloud.dify.ai) にログイン")
    print(f"  2. ナレッジベースを作成")
    print(f"  3. {merged_dir} 内のファイルをアップロード")
    print(f"  4. チャンクサイズ: 1000-1500トークン推奨")
    print(f"  5. 重複排除: 有効にする")


# ========================================
# メイン
# ========================================
def main():
    setup_dirs()
    
    if len(sys.argv) < 2:
        print("使い方:")
        print("  python collect_knowledge.py note              # note記事の全件取得")
        print("  python collect_knowledge.py youtube_list       # YouTube動画リスト取得")
        print("  python collect_knowledge.py youtube_transcribe # YouTube文字起こし")
        print("  python collect_knowledge.py merge              # Difyアップロード用に統合")
        print("  python collect_knowledge.py all                # 全部実行")
        return
    
    cmd = sys.argv[1]
    
    if cmd in ("note", "all"):
        fetch_note_articles()
    
    if cmd in ("youtube_list", "all"):
        fetch_youtube_list()
    
    if cmd in ("youtube_transcribe", "all"):
        transcribe_youtube_videos()
    
    if cmd in ("merge", "all"):
        merge_for_dify()


if __name__ == "__main__":
    main()
