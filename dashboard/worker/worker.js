/**
 * SORA Salon Management Dashboard API
 * Notion APIをブリッジして集計済みJSONを返すCloudflare Worker
 *
 * Endpoints:
 *   POST /auth/login        パスワード認証 → トークン発行
 *   GET  /api/summary       今月のKPIサマリー
 *   GET  /api/sales         売上データ（月別・日別）
 *   GET  /api/staff         スタッフ別売上
 *   GET  /api/menu          メニュー別売上
 *   GET  /api/recent        最近の施術記録（10件）
 *
 * 環境変数 (シークレット):
 *   NOTION_TOKEN          Notion インテグレーション トークン
 *   TREATMENT_DB_ID       施術履歴 DB ID
 *   MENU_DB_ID            メニューマスタ DB ID
 *   CUSTOMER_DB_ID        顧客カルテ DB ID
 *   DASHBOARD_PASSWORD    ダッシュボード閲覧用パスワード
 */

const NOTION_API = 'https://api.notion.com/v1';
const NOTION_VERSION = '2022-06-28';

const ALLOWED_ORIGINS = [
  'https://sora-dashboard.minatech1210.com',
  'https://sora-dashboard.pages.dev',
  'https://minatech-inc.github.io',
  'http://localhost:9000',
  'http://localhost:8080',
  'http://127.0.0.1:5500',
];

// Cloudflare Pages preview URLs ( <hash>.sora-dashboard.pages.dev ) も許可
function isAllowedOrigin(origin) {
  if (ALLOWED_ORIGINS.includes(origin)) return true;
  if (/^https:\/\/[a-z0-9-]+\.sora-dashboard\.pages\.dev$/.test(origin)) return true;
  return false;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const cors = corsHeaders(request);

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: cors });
    }

    try {
      // Routing
      if (url.pathname === '/auth/login' && request.method === 'POST') {
        return await handleLogin(request, env, cors);
      }

      // すべての /api/* は認証必須
      if (url.pathname.startsWith('/api/')) {
        const auth = request.headers.get('Authorization') || '';
        const token = auth.replace(/^Bearer\s+/i, '');
        const valid = await isValidToken(token, env);
        if (!valid) {
          return jsonResponse({ error: 'Unauthorized' }, 401, cors);
        }
      }

      if (url.pathname === '/api/summary') {
        return await handleSummary(env, cors);
      }
      if (url.pathname === '/api/sales') {
        return await handleSales(env, cors);
      }
      if (url.pathname === '/api/staff') {
        return await handleStaff(env, cors);
      }
      if (url.pathname === '/api/menu') {
        return await handleMenu(env, cors);
      }
      if (url.pathname === '/api/recent') {
        return await handleRecent(env, cors);
      }

      return jsonResponse({ status: 'ok', service: 'SORA Dashboard API' }, 200, cors);
    } catch (err) {
      console.error('Worker error:', err);
      return jsonResponse({ error: 'Internal error', detail: err.message }, 500, cors);
    }
  },
};

// =====================================================
// Auth
// =====================================================

async function handleLogin(request, env, cors) {
  const body = await request.json();
  if (body.password !== env.DASHBOARD_PASSWORD) {
    return jsonResponse({ error: 'Invalid password' }, 401, cors);
  }
  const token = await issueToken(env.DASHBOARD_PASSWORD);
  return jsonResponse({ token }, 200, cors);
}

async function issueToken(password) {
  // 簡易トークン: パスワードハッシュ + 発行日（1日有効）
  const today = new Date().toISOString().slice(0, 10);
  const data = `${password}:${today}`;
  const encoder = new TextEncoder();
  const hash = await crypto.subtle.digest('SHA-256', encoder.encode(data));
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

async function isValidToken(token, env) {
  if (!token) return false;
  const expected = await issueToken(env.DASHBOARD_PASSWORD);
  return token === expected;
}

// =====================================================
// Notion API helpers
// =====================================================

async function notionFetch(env, path, opts = {}) {
  const r = await fetch(`${NOTION_API}${path}`, {
    ...opts,
    headers: {
      'Authorization': `Bearer ${env.NOTION_TOKEN}`,
      'Content-Type': 'application/json',
      'Notion-Version': NOTION_VERSION,
      ...(opts.headers || {}),
    },
  });
  if (!r.ok) {
    throw new Error(`Notion API ${r.status}: ${await r.text()}`);
  }
  return r.json();
}

async function queryAll(env, dbId) {
  const all = [];
  let cursor;
  do {
    const body = { page_size: 100 };
    if (cursor) body.start_cursor = cursor;
    const data = await notionFetch(env, `/databases/${dbId}/query`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
    all.push(...(data.results || []));
    cursor = data.has_more ? data.next_cursor : null;
  } while (cursor);
  return all;
}

async function fetchMenuLookup(env) {
  const pages = await queryAll(env, env.MENU_DB_ID);
  const lookup = {};
  for (const p of pages) {
    const titleProp = Object.values(p.properties).find(v => v.type === 'title');
    const name = (titleProp?.title || []).map(t => t.plain_text).join('');
    if (name) lookup[p.id] = name;
  }
  return lookup;
}

// =====================================================
// Aggregations
// =====================================================

function aggregate(records, menuLookup) {
  const now = new Date();
  const jstOffset = 9 * 60 * 60 * 1000;
  const jstNow = new Date(now.getTime() + jstOffset);
  const thisYM = jstNow.toISOString().slice(0, 7);
  const thisY = jstNow.toISOString().slice(0, 4);
  const lastMonthDate = new Date(jstNow);
  lastMonthDate.setMonth(lastMonthDate.getMonth() - 1);
  const lastYM = lastMonthDate.toISOString().slice(0, 7);

  const byMonth = {};
  const byDay = {};
  const byStaff = {};
  const byMenu = {};

  let totalSales = 0;
  let totalVisits = 0;
  let thisMonthSales = 0;
  let thisMonthVisits = 0;
  let lastMonthSales = 0;
  let ytdSales = 0;

  for (const rec of records) {
    const props = rec.properties || {};
    const status = (props['ステータス']?.select?.name) || '';
    if (!status.includes('来店済')) continue;

    const fee = props['料金']?.number || 0;
    const dateStr = props['来店日時']?.date?.start || '';
    if (!dateStr) continue;

    const ym = dateStr.slice(0, 7);
    const day = dateStr.slice(0, 10);
    const y = dateStr.slice(0, 4);

    totalSales += fee;
    totalVisits += 1;
    byMonth[ym] = (byMonth[ym] || 0) + fee;
    byDay[day] = (byDay[day] || 0) + fee;
    if (ym === thisYM) {
      thisMonthSales += fee;
      thisMonthVisits += 1;
    }
    if (ym === lastYM) lastMonthSales += fee;
    if (y === thisY) ytdSales += fee;

    const staff = props['担当スタッフ']?.select?.name || '未設定';
    byStaff[staff] = byStaff[staff] || { sales: 0, count: 0 };
    byStaff[staff].sales += fee;
    byStaff[staff].count += 1;

    const menuRel = props['メニュー']?.relation || [];
    for (const m of menuRel) {
      const name = menuLookup[m.id] || '不明';
      byMenu[name] = byMenu[name] || { sales: 0, count: 0 };
      byMenu[name].sales += fee;
      byMenu[name].count += 1;
    }
  }

  return {
    thisYM,
    lastYM,
    totalSales,
    totalVisits,
    thisMonthSales,
    thisMonthVisits,
    lastMonthSales,
    ytdSales,
    avgPerVisit: totalVisits ? Math.floor(totalSales / totalVisits) : 0,
    byMonth,
    byDay,
    byStaff,
    byMenu,
  };
}

// =====================================================
// Endpoints
// =====================================================

async function handleSummary(env, cors) {
  const records = await queryAll(env, env.TREATMENT_DB_ID);
  const menuLookup = await fetchMenuLookup(env);
  const stats = aggregate(records, menuLookup);
  const customers = await queryAll(env, env.CUSTOMER_DB_ID);

  return jsonResponse({
    thisMonth: {
      sales: stats.thisMonthSales,
      visits: stats.thisMonthVisits,
      avgPerVisit: stats.thisMonthVisits ? Math.floor(stats.thisMonthSales / stats.thisMonthVisits) : 0,
    },
    lastMonth: { sales: stats.lastMonthSales },
    ytd: { sales: stats.ytdSales },
    total: {
      sales: stats.totalSales,
      visits: stats.totalVisits,
      avgPerVisit: stats.avgPerVisit,
    },
    customerCount: customers.length,
    diff: stats.thisMonthSales - stats.lastMonthSales,
    diffPercent: stats.lastMonthSales
      ? Math.round((stats.thisMonthSales - stats.lastMonthSales) / stats.lastMonthSales * 100)
      : null,
  }, 200, cors);
}

async function handleSales(env, cors) {
  const records = await queryAll(env, env.TREATMENT_DB_ID);
  const menuLookup = await fetchMenuLookup(env);
  const stats = aggregate(records, menuLookup);

  // 直近12ヶ月
  const months = [];
  const now = new Date();
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now);
    d.setMonth(d.getMonth() - i);
    months.push(d.toISOString().slice(0, 7));
  }
  const monthSeries = months.map(m => ({
    month: m,
    sales: stats.byMonth[m] || 0,
  }));

  // 直近30日
  const days = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    days.push(d.toISOString().slice(0, 10));
  }
  const daySeries = days.map(d => ({
    day: d,
    sales: stats.byDay[d] || 0,
  }));

  return jsonResponse({ monthSeries, daySeries }, 200, cors);
}

async function handleStaff(env, cors) {
  const records = await queryAll(env, env.TREATMENT_DB_ID);
  const menuLookup = await fetchMenuLookup(env);
  const stats = aggregate(records, menuLookup);

  const sorted = Object.entries(stats.byStaff)
    .map(([name, d]) => ({ name, ...d }))
    .sort((a, b) => b.sales - a.sales);
  return jsonResponse({ staff: sorted }, 200, cors);
}

async function handleMenu(env, cors) {
  const records = await queryAll(env, env.TREATMENT_DB_ID);
  const menuLookup = await fetchMenuLookup(env);
  const stats = aggregate(records, menuLookup);

  const sorted = Object.entries(stats.byMenu)
    .map(([name, d]) => ({ name, ...d }))
    .sort((a, b) => b.sales - a.sales);
  return jsonResponse({ menu: sorted }, 200, cors);
}

async function handleRecent(env, cors) {
  const data = await notionFetch(env, `/databases/${env.TREATMENT_DB_ID}/query`, {
    method: 'POST',
    body: JSON.stringify({
      page_size: 10,
      sorts: [{ property: '来店日時', direction: 'descending' }],
    }),
  });
  const menuLookup = await fetchMenuLookup(env);
  const recent = (data.results || []).map(r => {
    const props = r.properties || {};
    const titleProp = Object.values(props).find(v => v.type === 'title');
    const title = (titleProp?.title || []).map(t => t.plain_text).join('');
    const menuRel = props['メニュー']?.relation || [];
    const menuNames = menuRel.map(m => menuLookup[m.id] || '不明');
    return {
      id: r.id,
      title,
      date: props['来店日時']?.date?.start || '',
      staff: props['担当スタッフ']?.select?.name || '',
      menu: menuNames.join(', '),
      fee: props['料金']?.number || 0,
      status: props['ステータス']?.select?.name || '',
    };
  });
  return jsonResponse({ recent }, 200, cors);
}

// =====================================================
// Utilities
// =====================================================

function corsHeaders(request) {
  const origin = request.headers.get('Origin') || '';
  const allowed = isAllowedOrigin(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
  };
}

function jsonResponse(obj, status, extraHeaders = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...extraHeaders,
    },
  });
}
