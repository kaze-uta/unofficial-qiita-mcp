# unofficial-qiita-mcp

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

Qiita API v2 を Claude Code（および MCP 対応クライアント）から使うための MCP サーバー。記事の検索・取得・投稿・編集・削除、コメント、ストックに対応。

> **非公式プロジェクトです。** これは個人が作成した非公式ツールであり、Qiita 株式会社とは一切関係ありません。"Qiita" は Qiita 株式会社の商標です。本ツールは Qiita が公開している [API v2](https://qiita.com/api/v2/docs) を利用しています。

## 必要要件

- Node.js 24.10.0 以上（開発・動作確認環境。`fetch` を使うため最低でも 18 が必要）
- Qiita のアクセストークン

## 1. ビルド

```bash
npm install
npm run build   # dist/index.js が生成される
```

## 2. アクセストークンを発行

https://qiita.com/settings/applications で個人用アクセストークンを発行する。

- 読み取りだけなら `read_qiita` スコープ
- 投稿・編集・削除など書き込み系を使うなら **`write_qiita`** スコープが必要

トークンはパスワードと同等の秘密情報です。リポジトリにコミットしたり、他人と共有したりしないでください。

## 3. Claude Code に登録

サーバー名を先頭に、`-e KEY=value` 形式でトークンを渡す。`/path/to/qiita-mcp` と「あなたのトークン」は実際の値に置き換える。**コマンドは 1 行で実行すること**（理由は下記）。

```bash
claude mcp add qiita --transport stdio -e QIITA_ACCESS_TOKEN=あなたのトークン -- node /path/to/qiita-mcp/dist/index.js
```

ポイント:
- **サーバー名 `qiita` を最初に置く。** `--env` / `-e` は可変長引数のため、サーバー名を後ろに置くと名前まで環境変数として飲み込まれ `Invalid environment variable format: qiita` というエラーになる。
- `-e KEY=value`（= `--env KEY=value`）でトークンを渡し、`--` の直前に置く。`--` 以降が実際に起動されるコマンド。
- 登録確認は `claude mcp list`、セッション内では `/mcp` で状態を確認できる。

### Windows での注意

README 中の `\` による行継続は **bash 用**で、Windows の PowerShell / コマンドプロンプトでは使えない（PowerShell の継続は `` ` ``、cmd は `^`）。改行をそのまま貼ると分割実行されてエラーになるので、**上記コマンドは 1 行で貼り付けて実行する**こと。パスはこの形式で問題ない:

```powershell
claude mcp add qiita --transport stdio -e QIITA_ACCESS_TOKEN=あなたのトークン -- node C:/path/to/qiita-mcp/dist/index.js
```

登録に成功すると `Added stdio MCP server qiita ...` と表示され、`~/.claude.json`（該当プロジェクト）に設定が書き込まれる。

スコープを使い分けたい場合は `--scope user`（全プロジェクト共通）か `--scope project`（リポジトリ単位、`.mcp.json` にコミットされる）を付ける。**トークンはコミットされる設定ファイルに直書きせず、必ず環境変数で渡すこと。**

> **トークンの取り扱い:** アクセストークンを他人に見せたり、チャット・Issue・ログなどに貼り付けたりした場合は、漏洩したものとして [設定画面](https://qiita.com/settings/applications) で速やかに破棄し、新しいトークンを発行し直すこと。

### AI エージェント（Claude Code 等）とトークンの関係

- **通常のツール利用ではトークンの値は AI のコンテキストに渡らない。** トークンを読むのは MCP サーバーのプロセス（`node dist/index.js`）であって AI 本体ではない。検索や投稿などのツール呼び出しは、サーバーが Authorization ヘッダーにトークンを付けて Qiita へ送る処理で完結するため、`qiita_search_items` などを何度実行してもトークンの実値が会話に載ることはない。
- **ただし露出する操作はある。** `claude mcp get qiita` は env を含む設定をそのまま出力するため、実行するとトークンが会話・ログに載る。`~/.claude.json` を `cat` する、設定ファイルをコミットする、なども同様。これらは避けること。
- **シェル権限を持つエージェントは原理的にトークンへ到達できる。** トークンはローカルに平文で保存される以上、ファイルを読める主体（人間でもエージェントでも）は取得可能。「AI に絶対知られない」状態は技術的に作れない。
- **したがって前提は「漏れない」ではなく「漏れても安く回せる」。** read 専用スコープの活用、定期的なローテーション、露出したら即破棄＆再発行、という運用で対処する。

### 設定ファイルで直接書く場合

`~/.claude/settings.json`（user スコープ）に：

```json
{
  "mcpServers": {
    "qiita": {
      "command": "node",
      "args": ["/path/to/qiita-mcp/dist/index.js"],
      "env": { "QIITA_ACCESS_TOKEN": "あなたのトークン" }
    }
  }
}
```

`.mcp.json` のようにリポジトリにコミットされうるファイルへトークンを直書きしないこと。

## 提供ツール

| ツール | 操作 | 備考 |
|---|---|---|
| `qiita_search_items` | 記事検索 | Qiita 検索構文に対応（`tag:Ruby user:Qiita stocks:>10` など） |
| `qiita_get_item` | 記事取得 | Markdown 本文込み |
| `qiita_get_authenticated_user` | 自分の情報 | トークン疎通確認に便利 |
| `qiita_list_my_items` | 自分の記事一覧 | |
| `qiita_list_item_comments` | コメント一覧 | |
| `qiita_create_item` | 記事投稿 | デフォルトは `private:true`（限定共有）。公開するには明示的に `private:false` |
| `qiita_update_item` | 記事更新 | 送ったフィールドで置き換わるため、先に `qiita_get_item` で現状取得を推奨 |
| `qiita_delete_item` | 記事削除 | **取り消し不可** |
| `qiita_post_comment` | コメント投稿 | |
| `qiita_stock_item` / `qiita_unstock_item` | ストック追加 / 解除 | |

## 注意点・免責

- **利用規約・ガイドラインを守って使うこと。** 本ツールを使った投稿・操作は、Qiita の[利用規約](https://qiita.com/terms)および[コミュニティガイドライン](https://help.qiita.com/ja/articles/qiita-community-guideline)に従う必要があります。宣伝目的のスパム投稿、いいね・Contribution の不正な水増しなど、ガイドラインに反する自動操作には使用しないでください。
- レート制限は認証あり 1000 回/時、認証なし 60 回/時（IP 単位）。大量の自動リクエストを送らないこと。
- `qiita_create_item` は事故防止のため初期値を限定共有（private）にしてあります。一般公開したいときだけ `private:false` を指定してください。
- 削除（`qiita_delete_item`）は取り消せません。AI に操作を委ねる際は対象の item_id をよく確認してください。
- 本ソフトウェアは MIT ライセンスの下、**無保証**で提供されます。利用により生じたいかなる損害についても作者は責任を負いません（[LICENSE](./LICENSE) 参照）。

## ライセンス

[MIT](./LICENSE)
