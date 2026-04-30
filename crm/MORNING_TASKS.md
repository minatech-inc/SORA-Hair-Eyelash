# 朝にやることリスト

夜のうちに準備したものをデプロイ・最終調整する手順です。
**所要時間: 合計 30〜40分**

---

## ✅ 夜のうちに完了済み

- [x] Notion 顧客カルテにフィルタ用フォーミュラ4種を追加（API経由）
- [x] Cloudflare Workerコード作成
- [x] counseling.htmlのNotion連携JavaScript追加

---

## 🌅 朝にやること

### Task 1: Notionトークンのローテーション（5分）

PowerShell履歴に旧トークンが残っているため再発行します。

1. https://www.notion.so/profile/integrations
2. **「SORA Salon Connector」** をクリック
3. **「インストールのアクセストークン」** の右の **「再読み込み」** をクリック
4. 新しいトークンをコピー（メモ帳に一時保管）

---

### Task 2: Cloudflare Workerをデプロイ（15分）

詳細手順: [worker/DEPLOY.md](worker/DEPLOY.md)

**かいつまんで:**

1. https://dash.cloudflare.com/ にログイン
2. 「Workers & Pages」 → 「Create application」 → 「Create Worker」
3. Worker名: `sora-counseling-worker` → Deploy
4. 「Edit code」をクリック → 既存コードを削除 → [worker/worker.js](worker/worker.js) の中身をコピペ → Deploy
5. 「Settings」 → 「Variables and Secrets」で以下2つを追加（**Encrypted/Secret**として）:
   - `NOTION_TOKEN` = Task 1で取得した新しいトークン
   - `CUSTOMER_DB_ID` = `352328a14fb4813cb456edb3db121df3`
6. WorkerのURLをメモ（例: `https://sora-counseling-worker.xxxxx.workers.dev`）

---

### Task 3: counseling.htmlにWorker URLを設定（2分）

[counseling.html](../counseling.html) の以下の部分を編集:

**修正前:**
```javascript
const WORKER_URL = '';
```

**修正後:**
```javascript
const WORKER_URL = 'https://sora-counseling-worker.xxxxx.workers.dev';
```

GitHubに反映:
```powershell
cd C:\Users\MinaTech株式会社\MinaTech-Eyelash
git add counseling.html
git commit -m "Set Cloudflare Worker URL for Notion sync"
git push
```

---

### Task 4: Notionにビューを追加（10分）

設計書通りのビューをNotion UIで追加します（API不可なので手動）。

#### 顧客カルテに以下5つのビューを追加

各ビューの作り方は基本同じ:
1. Notionで顧客カルテDBを開く
2. 既存の「テーブル」タブの右の **「+」** をクリック
3. **「Table」** を選択
4. 名前を入力
5. **「フィルタ」** をクリックして条件を設定

| ビュー名 | フィルタ条件 |
|---|---|
| ⭐ 常連様 | 「常連フラグ」が「is not empty」 |
| 🌱 新規 | 「新規フラグ」が「is not empty」 |
| ⚠️ 要フォロー | 「要フォローフラグ」が「is not empty」 |
| 🎂 今月誕生日 | 「今月誕生日フラグ」が「is not empty」 |
| 📸 ギャラリー | （ビュータイプを「Gallery」に変更、フィルタなし） |

#### 施術履歴に以下3つのビューを追加

| ビュー名 | フィルタ条件 |
|---|---|
| 📅 今日の予約 | 「来店日時」が「Today」 |
| 📅 今週 | 「来店日時」が「Within: This week」 |
| ✅ 来店済 | 「ステータス」が「来店済」 |

---

### Task 5: 動作テスト（5分）

1. https://minatech-inc.github.io/SORA-Hair-Eyelash/counseling.html を開く  
   （reploy反映に1〜2分かかる場合あり）
2. テスト用のお名前等を入力して送信
3. 確認:
   - メール: `isoya.h@minatech1210.com` に通知が届く（Web3Forms）
   - Notion: 顧客カルテに新規ページが追加されている（Worker）
   - リダイレクト: counseling-thanks.html が表示される

両方反映されていれば、Phase 2の自動転記機能の構築完了です🎉

---

## トラブル時

### Cloudflare Workerデプロイで詰まった

[worker/DEPLOY.md](worker/DEPLOY.md) のトラブルシューティング参照。

### Notionに記録が作成されない

Workerのログで原因確認:
1. Cloudflareダッシュボード → Workers & Pages → sora-counseling-worker
2. 「Logs」タブを開いてリアルタイムログ確認
3. テスト送信して、エラーメッセージを確認

エラー内容を私（Claude）に共有してもらえれば対応できます。

### Notionのフィルタフォーミュラがエラー表示

Notion UIで「常連フラグ」等の列がエラー表示されている場合、フォーミュラが既存のロールアップを参照できていない可能性があります。私に教えていただければ修正します。
