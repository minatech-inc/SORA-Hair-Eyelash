/**
 * SORA Salon - Counseling Form to Notion Worker
 *
 * counseling.htmlのフォーム送信を受け取り、Notionの顧客カルテに新規ページを作成する
 *
 * 環境変数（Workerのシークレット）:
 *   NOTION_TOKEN  - Notion インテグレーションのアクセストークン
 *   CUSTOMER_DB_ID - 顧客カルテDBのID（ハードコード可だがシークレットの方が安全）
 *
 * 想定リクエスト:
 *   POST application/x-www-form-urlencoded
 *   Origin: https://minatech-inc.github.io
 *
 * 動作:
 *   1. フォームデータを Notion 顧客カルテDB に新規ページとして作成
 *   2. 成功したら counseling-thanks.html へリダイレクト
 *   3. 失敗したらJSONエラー
 */

const NOTION_API = 'https://api.notion.com/v1';
const NOTION_VERSION = '2022-06-28';

const ALLOWED_ORIGINS = [
  'https://minatech-inc.github.io',
  'http://localhost:9000',
  'http://localhost:8080',
];

const THANKS_URL = 'https://minatech-inc.github.io/SORA-Hair-Eyelash/counseling-thanks.html';

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const cors = buildCorsHeaders(origin);

    // Preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: cors });
    }

    // GET - simple health check
    if (request.method === 'GET') {
      return jsonResponse({ status: 'ok', service: 'SORA counseling worker' }, 200, cors);
    }

    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405, headers: cors });
    }

    // Parse form data
    let formData;
    try {
      formData = await request.formData();
    } catch (e) {
      return jsonResponse({ error: 'Invalid form data', detail: e.message }, 400, cors);
    }

    // Build Notion properties
    const properties = buildNotionProperties(formData);

    // Call Notion API
    try {
      const notionRes = await fetch(`${NOTION_API}/pages`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${env.NOTION_TOKEN}`,
          'Content-Type': 'application/json',
          'Notion-Version': NOTION_VERSION,
        },
        body: JSON.stringify({
          parent: { database_id: env.CUSTOMER_DB_ID },
          properties: properties,
        }),
      });

      if (!notionRes.ok) {
        const errorText = await notionRes.text();
        console.error('Notion API error:', errorText);
        return jsonResponse({
          error: 'Failed to create Notion page',
          status: notionRes.status,
          detail: errorText.slice(0, 500),
        }, 500, cors);
      }

      // Success - redirect to thank-you page
      return Response.redirect(THANKS_URL, 303);

    } catch (e) {
      console.error('Worker error:', e);
      return jsonResponse({ error: 'Internal error', detail: e.message }, 500, cors);
    }
  },
};

function buildCorsHeaders(origin) {
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'POST, OPTIONS, GET',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  };
}

function jsonResponse(obj, status, extraHeaders = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...extraHeaders,
    },
  });
}

function getAll(formData, key) {
  const all = formData.getAll(key);
  return all.filter(v => v && String(v).trim() !== '');
}

function buildNotionProperties(formData) {
  const props = {};
  const get = (key) => {
    const v = formData.get(key);
    return v ? String(v).trim() : '';
  };

  // タイトル: お名前
  const name = get('お名前');
  if (name) {
    props['お名前'] = { title: [{ text: { content: name } }] };
  } else {
    // タイトル必須なのでフォールバック
    props['お名前'] = { title: [{ text: { content: '名前未入力' } }] };
  }

  // フリガナ
  const kana = get('フリガナ');
  if (kana) props['フリガナ'] = { rich_text: [{ text: { content: kana } }] };

  // 電話番号
  const tel = get('お電話番号');
  if (tel) props['電話番号'] = { phone_number: tel };

  // メール
  const email = get('メールアドレス');
  if (email) props['メールアドレス'] = { email: email };

  // 生年月日
  const birthday = get('生年月日');
  if (birthday) props['生年月日'] = { date: { start: birthday } };

  // ご来店日 → 初来店日
  const visitDate = get('ご来店日');
  if (visitDate) props['初来店日'] = { date: { start: visitDate } };

  // 健康状態（チェックボックス複数）+ 詳細を 健康状態・アレルギー に統合
  const healthList = getAll(formData, '健康状態');
  const healthDetail = get('健康状態の詳細');
  const healthLines = [];
  if (healthList.length > 0) {
    healthLines.push(`チェック項目: ${healthList.join('、')}`);
  }
  if (healthDetail) {
    healthLines.push(`詳細: ${healthDetail}`);
  }
  if (healthLines.length > 0) {
    props['健康状態・アレルギー'] = {
      rich_text: [{ text: { content: healthLines.join('\n') } }],
    };
  }

  // タグ自動推論（健康状態の項目から）
  const tagMap = {
    'アレルギー体質': 'アレルギー',
    '敏感肌/アトピー': '敏感肌',
    'コンタクトレンズ使用': 'コンタクト',
  };
  const autoTags = healthList.map(h => tagMap[h]).filter(Boolean);
  if (autoTags.length > 0) {
    props['タグ'] = { multi_select: [...new Set(autoTags)].map(t => ({ name: t })) };
  }

  // お好み・要望（仕上がりイメージ・エクステ経験・過去トラブル・その他要望をまとめる）
  const styles = getAll(formData, '仕上がりイメージ');
  const extExp = get('エクステ経験');
  const extTrouble = get('過去のトラブル');
  const requests = get('その他ご要望');
  const requestedMenu = get('ご希望メニュー');

  const preferenceLines = [];
  if (requestedMenu) preferenceLines.push(`ご希望メニュー: ${requestedMenu}`);
  if (styles.length > 0) preferenceLines.push(`仕上がりイメージ: ${styles.join('、')}`);
  if (extExp) preferenceLines.push(`エクステ経験: ${extExp}`);
  if (extTrouble) preferenceLines.push(`過去のトラブル: ${extTrouble}`);
  if (requests) preferenceLines.push(`ご要望: ${requests}`);
  if (preferenceLines.length > 0) {
    props['お好み・要望'] = {
      rich_text: [{ text: { content: preferenceLines.join('\n') } }],
    };
  }

  // 同意書受理
  if (get('同意')) {
    props['同意書受理'] = { checkbox: true };
  }

  // ステータス: 新規はデフォルトでアクティブ
  props['ステータス'] = { select: { name: 'アクティブ' } };

  // 流入元: Webカウンセリング（既存選択肢にあれば設定。無ければスキップ）
  // 既存の流入元: Web予約 / 紹介 / Instagram / Google / ホットペッパー / 飛び込み
  // → Web予約に紐付ける
  props['流入元'] = { select: { name: 'Web予約' } };

  return props;
}
