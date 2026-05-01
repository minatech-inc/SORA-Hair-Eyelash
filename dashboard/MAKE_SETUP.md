# Make.com 自動化シナリオ構築手順

請求書フローの最終ステップ（PDF生成→Drive保存）を完全自動化するための設定です。

## 全体の流れ

```
[Notion 請求書ステータスが「確定」に変更される]
        ↓ Make.com が監視（10分ごと）
[Make.com シナリオ起動]
        ↓
[Step 1] HTTP GET → Worker から HTML を取得
        ↓
[Step 2] HTML to PDF 変換（Make.com 標準モジュール）
        ↓
[Step 3] スタッフのDriveフォルダIDを取得
        ↓
[Step 4] PDFをGoogle Driveにアップロード
        ↓
[Step 5] Notionに「Drive ファイルID」を書き戻す
```

---

## 事前準備

### 1. Drive フォルダIDの取得

各スタッフごとに Google Drive のフォルダIDが必要です。

**取得方法:**
1. https://drive.google.com を開く
2. 該当フォルダ（例: `共有ドライブ > MinaTech > 経理 > 請求書 > 外注費 > 美容事業 > 唐木田 帆花`）を開く
3. URLを確認: `https://drive.google.com/drive/folders/XXXXXXXXXXXXXXXX`
4. `folders/` の後の文字列がフォルダID

**両方のスタッフ分を取得して、Notion スタッフマスタの「DriveフォルダID」欄に入力してください。**

### 2. Make.com アカウント開設

1. https://www.make.com/en/register にアクセス
2. メール `isoya.h@minatech1210.com` で登録
3. リージョンは EU または US（どちらでも可）

---

## シナリオ構築（Make.com）

### Step 1: 新規シナリオ作成

1. Make.com ダッシュボード → **「Create a new scenario」**
2. 中央の「+」をクリック → **Notion** を検索 → **「Watch Database Items」** を選択

### Step 2: Notion 連携設定

**Connection:** 新規接続作成
- Connection name: `SORA Notion`
- Connection type: **Internal Integration Token**
- Internal Integration Token: 現在のNotionトークン（`ntn_...`）

**Database:** 請求書 を選択（ID: `353328a14fb481a2962cc82f8eb06527`）

**Filter:** 以下を設定
- Property: `ステータス`
- Condition: `equals`
- Value: `確定`

**Limit:** 10

### Step 3: ルーター追加（Drive ファイルID の有無で分岐）

未処理（ファイルIDが空）のものだけ処理するため、ルーターでフィルタ:

1. 中央の「+」→ **Router** を追加
2. 1つ目のルートのフィルタ:
   - Condition: `Drive ファイルID` `Does not exist` または `空`

### Step 4: HTTP モジュール追加

ルーターの後に **HTTP > Make a request** を追加:

- URL: `https://sora-dashboard-api.isoya-h.workers.dev/api/invoices/{{1.ID}}/html?token={DASHBOARD_PASSWORD}`
  - `{{1.ID}}` の部分はNotion要素のID（マッピングで選択）
  - `{DASHBOARD_PASSWORD}` は実際のパスワードに置換
- Method: GET
- Parse response: Yes

### Step 5: HTML to PDF 変換

**「PDF」モジュール** または **「HTML to PDF」** を追加:

Make.com 標準で利用可能な PDF 変換モジュールを選択。
- HTML Source: `Step 4 の Data`
- Page size: A4
- Margins: デフォルト
- Output: PDF Binary

### Step 6: スタッフ情報を取得

**Notion > Get a Database Item** を追加:

- Database: `スタッフマスタ`
- Item ID: `{{1.スタッフ.ID}}`（請求書のスタッフリレーションから取得）

Step 6 の出力から `DriveフォルダID` を取得できます。

### Step 7: Google Drive にアップロード

**Google Drive > Upload a File** を追加:

**Connection:** Google アカウント認証
**Folder ID:** `{{6.DriveフォルダID}}`（Step 6 から取得）
**File data:** `Step 5 の PDF data`
**File name:** `{{1.請求書番号}}.pdf`

### Step 8: Notion を更新（ファイルID保存）

**Notion > Update a Database Item** を追加:

- Item ID: `{{1.ID}}`
- Properties:
  - `Drive ファイルID`: `{{7.id}}`（Step 7 でアップロードしたファイルのID）

### Step 9: シナリオを保存・有効化

1. 右下の **「Save」** をクリック
2. シナリオの実行間隔: **15 minutes**（無料プランの最小）
3. **「ON」** に切り替えて稼働開始

---

## 動作確認

1. ダッシュボードで請求書を1件、ステータス「オーナー承認待ち」→「確定」に変更
2. Make.com の実行履歴を確認（最大15分後に自動実行）
3. Google Drive のスタッフフォルダにPDFが保存される
4. Notion の「Drive ファイルID」欄が更新される

---

## トラブルシューティング

### Make.com が起動しない
- シナリオが「ON」になっているか確認
- Notionの「請求書」DBに変更があるか確認

### Worker からHTML取得に失敗
- URL の `{DASHBOARD_PASSWORD}` が実際のパスワードに置換されているか
- Worker のCORS設定にMake.comのIPが許可されているか（HTTPなので関係ないはず）

### PDF 変換失敗
- Make.com の HTML to PDF モジュールがフリープランで利用可能か確認
- 利用不可なら **「PDF.co」** や **「HTML/CSS to Image」** などのアドオンが必要

### Drive アップロード失敗
- Google アカウントの権限（共有ドライブへのアクセス）を確認
- フォルダIDが正しいか確認

---

## 月次自動生成のスケジュール化（オプション）

毎月1日に自動で前月の請求書を生成する：

1. Make.com で **新しいシナリオ** 作成
2. トリガー: **Schedule > Every Day at 09:00 (1st of month only)**
3. アクション: **HTTP > Make a request**
   - URL: `https://sora-dashboard-api.isoya-h.workers.dev/api/invoices/generate`
   - Method: POST
   - Headers: `Authorization: Bearer {WORKER_TOKEN}`, `Content-Type: application/json`
   - Body: `{"year_month": "{前月のYYYY-MM}"}`

これで毎月1日に前月分が自動生成されます。
