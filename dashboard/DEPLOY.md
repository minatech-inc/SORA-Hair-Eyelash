# SORA Salon Dashboard デプロイ手順

朝に5分でデプロイ完了するための手順書です。

---

## 構成

```
[ブラウザ]
   ↓
[Cloudflare Pages]                ← 静的サイト（HTML/CSS/JS）
   ↓ API call
[Cloudflare Worker]                ← Notion APIブリッジ
   ↓
[Notion API]                       ← データソース
```

---

## Step 1: Cloudflare Worker（API）のデプロイ

### 1-1. Worker作成

1. https://dash.cloudflare.com/ → **Workers & Pages** → **「Create application」**
2. **「Create Worker」** → 名前: `sora-dashboard-api` → **Deploy**

### 1-2. コード差し替え

1. **Edit code** をクリック
2. 既存コード全削除 → `dashboard/worker/worker.js` の内容をコピペ
3. **Deploy**

### 1-3. シークレット設定

**Settings** → **Variables and Secrets** で以下5つを **Encrypted（Secret）** として追加:

| Variable name | Value |
|---|---|
| `NOTION_TOKEN` | 現在のNotionトークン |
| `TREATMENT_DB_ID` | `351328a14fb4801f9511dbdef7db17ef` |
| `MENU_DB_ID` | `351328a14fb480fb9d01fd3495b4273a` |
| `CUSTOMER_DB_ID` | `352328a14fb4813cb456edb3db121df3` |
| `DASHBOARD_PASSWORD` | 任意のパスワード（例: `sora2026`） |

設定後、Save and Deployで反映。

### 1-4. 動作確認

ブラウザで以下にアクセス:
```
https://sora-dashboard-api.<アカウント名>.workers.dev/
```

`{"status":"ok","service":"SORA Dashboard API"}` が返ればOK。

このURLをメモしてください（次のStepで使います）。

---

## Step 2: フロントエンドのURLを設定

`dashboard/js/config.js` を開いて、`API_BASE` を実際のWorker URLに書き換える:

```javascript
const CONFIG = {
    API_BASE: 'https://sora-dashboard-api.isoya-h.workers.dev',  // ← 実URLに
};
```

**変更後、Gitにコミット:**

```powershell
cd C:\Users\MinaTech株式会社\MinaTech-Eyelash
git add dashboard/js/config.js
git commit -m "Set Worker API URL for dashboard"
git push
```

---

## Step 3: Cloudflare Pagesでフロントエンドをデプロイ

### 3-1. Pages プロジェクト作成

1. **Workers & Pages** → **Create application** → **Pages** タブ
2. **Connect to Git** をクリック
3. **GitHub** を選択 → 認証
4. リポジトリ: **`minatech-inc/SORA-Hair-Eyelash`** を選択
5. **Begin setup**

### 3-2. ビルド設定

| 項目 | 値 |
|---|---|
| Project name | `sora-dashboard` |
| Production branch | `master` |
| Build command | （空欄） |
| Build output directory | `dashboard` |
| Root directory | （空欄） |

**Save and Deploy** をクリック。

数十秒でデプロイが完了し、`https://sora-dashboard.pages.dev` のようなURLが発行されます。

### 3-3. 動作確認

発行URLにアクセスして、ログイン画面が表示されるか確認。
Step 1-3で設定したパスワードでログインしてダッシュボードを確認。

---

## Step 4: 独自ドメインに紐付け

### 4-1. Pagesに独自ドメイン追加

1. **sora-dashboard** プロジェクトを開く
2. **Custom domains** タブ → **Set up a custom domain**
3. ドメイン入力: `sora-dashboard.minatech1210.com`
4. **Continue**

Cloudflareが自動でDNSを設定します（MinaTech1210.com がCloudflareにあるため）。

### 4-2. SSL証明書

自動発行されます（数分〜10分）。

### 4-3. 完了

`https://sora-dashboard.minatech1210.com/` でアクセスできるようになります。

---

## 完成後の使い方

1. https://sora-dashboard.minatech1210.com/ を開く
2. パスワードでログイン
3. ダッシュボード閲覧

データはNotionから自動取得。Notion側でデータが更新されると、ダッシュボードのリフレッシュボタンで即時反映されます。

---

## トラブルシューティング

### ログインできない
- Worker のシークレット `DASHBOARD_PASSWORD` が正しく設定されているか確認

### データが表示されない
- Worker のログを確認（Cloudflareダッシュボード → Workers → sora-dashboard-api → Logs）
- `NOTION_TOKEN` が現在のトークンと一致しているか
- DB IDが正しいか

### CORSエラー
- フロントの `config.js` の `API_BASE` がWorker URLと一致しているか
- Worker の `ALLOWED_ORIGINS` にPagesのURLが含まれているか
