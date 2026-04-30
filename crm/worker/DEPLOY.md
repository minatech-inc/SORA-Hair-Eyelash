# Cloudflare Worker デプロイ手順

カウンセリングシート → 顧客カルテ自動転記用のWorkerをデプロイします。

## 推奨方法: Cloudflareダッシュボード（Web UI）からデプロイ

最もシンプルな方法です。CLIインストール不要。

### Step 1: Cloudflareにログイン

1. https://dash.cloudflare.com/ にアクセス
2. 既存のアカウント（dashboard.minatech1210.com を運用しているアカウント）でログイン

### Step 2: Workers & Pages を開く

1. 左メニューから **「Workers & Pages」** をクリック
2. **「Create application」** をクリック
3. **「Create Worker」** タブを選択
4. Worker名: `sora-counseling-worker`
5. **「Deploy」** をクリック → 仮のWorkerが作成される

### Step 3: コードを差し替え

1. 作成されたWorkerのページで **「Edit code」** をクリック
2. エディタが開く
3. 既存のコード（"Hello World" のサンプル）をすべて削除
4. `worker.js` の内容を全てコピー＆ペースト
5. 右上の **「Deploy」** をクリック

### Step 4: 環境変数（Secret）を設定

Workerの「Settings」タブで以下2つのシークレットを設定:

1. 「Settings」 → 「Variables and Secrets」
2. 以下を「Encrypted」（Secret）として追加:

| Variable name | Value |
|---|---|
| `NOTION_TOKEN` | `ntn_xxxxx`（最新のNotionトークン） |
| `CUSTOMER_DB_ID` | `352328a14fb4813cb456edb3db121df3` |

各設定後に **「Save and deploy」** をクリック

### Step 5: WorkerのURLを取得

「Triggers」タブまたはWorker一覧画面で、Workerのドメインを確認:
- 例: `https://sora-counseling-worker.<あなたのアカウント>.workers.dev`

このURLをcounseling.htmlのフォームaction属性に設定します（次のステップ）。

### Step 6: 動作確認

ブラウザで以下にアクセス（GETで疎通確認）:
```
https://sora-counseling-worker.<あなたのアカウント>.workers.dev
```

`{"status":"ok","service":"SORA counseling worker"}` が返れば成功。

---

## 代替方法: Wrangler CLI（コマンドラインからデプロイ）

エンジニア向け。CLI操作に慣れている場合。

### 前提

```powershell
# Node.js が必要
node --version  # v18 以上推奨

# Wrangler のインストール
npm install -g wrangler

# Cloudflare アカウントにログイン
wrangler login
```

### デプロイ

```powershell
cd C:\Users\MinaTech株式会社\MinaTech-Eyelash\crm\worker

# シークレットを登録
wrangler secret put NOTION_TOKEN
# プロンプトでトークンを入力

wrangler secret put CUSTOMER_DB_ID
# プロンプトで 352328a14fb4813cb456edb3db121df3 を入力

# デプロイ
wrangler deploy
```

デプロイ完了後にURL（`https://sora-counseling-worker.xxx.workers.dev`）が表示されます。

---

## デプロイ後の動作

1. https://minatech-inc.github.io/SORA-Hair-Eyelash/counseling.html を開く
2. フォームに入力して送信
3. Notionの顧客カルテに新しいページが自動作成される
4. counseling-thanks.html へリダイレクトされる

---

## トラブルシューティング

### CORS エラーが出る

`worker.js` の `ALLOWED_ORIGINS` を確認。GitHub PagesのURL（`https://minatech-inc.github.io`）が含まれているか。

### Notion APIエラー (401)

`NOTION_TOKEN` が正しく設定されていない、またはトークンがローテーションされて古い。  
Cloudflareダッシュボードで再設定。

### Notion APIエラー (404)

`CUSTOMER_DB_ID` が間違っている、またはNotionインテグレーションがそのDBにアクセス権を持っていない。  
NotionのDBページで「⋯」→「Connections」→「SORA Salon Connector」を追加。

### フォーム送信後、Notionに反映されない

Workerのログを確認:
1. Cloudflareダッシュボード → Workers & Pages → sora-counseling-worker
2. 「Logs」タブで送信履歴・エラーを確認
