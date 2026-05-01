/**
 * SORA Salon Management Dashboard API
 * Notion APIをブリッジして集計済みJSONを返すCloudflare Worker
 *
 * Endpoints:
 *   POST /auth/login                パスワード認証 → トークン発行
 *
 *   ↓ 以下、ダッシュボード認証必須 (Bearer token)
 *   GET  /api/summary               今月のKPIサマリー
 *   GET  /api/sales                 売上データ（月別・日別）
 *   GET  /api/staff                 スタッフ別売上
 *   GET  /api/menu                  メニュー別売上
 *   GET  /api/recent                最近の施術記録（10件）
 *   GET  /api/attendance/today      今日の打刻履歴
 *   GET  /api/attendance/summary    月次勤務時間集計
 *
 *   ↓ 以下、認証なし (PINで個別認証)
 *   GET  /api/attendance/staff-list 有効スタッフ一覧（PIN以外）
 *   POST /api/attendance/punch      打刻（PIN必須）
 *
 * 環境変数 (シークレット):
 *   NOTION_TOKEN          Notion インテグレーション トークン
 *   TREATMENT_DB_ID       施術履歴 DB ID
 *   MENU_DB_ID            メニューマスタ DB ID
 *   CUSTOMER_DB_ID        顧客カルテ DB ID
 *   STAFF_DB_ID           スタッフマスタ DB ID
 *   ATTENDANCE_DB_ID      勤怠記録 DB ID
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

function isAllowedOrigin(origin) {
  if (ALLOWED_ORIGINS.includes(origin)) return true;
  if (/^https:\/\/[a-z0-9-]+\.sora-dashboard\.pages\.dev$/.test(origin)) return true;
  return false;
}

// 認証不要エンドポイント（PINで自己認証する勤怠系）
const PUBLIC_ENDPOINTS = [
  '/api/attendance/staff-list',
  '/api/attendance/punch',
];

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const cors = corsHeaders(request);

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: cors });
    }

    try {
      if (url.pathname === '/auth/login' && request.method === 'POST') {
        return await handleLogin(request, env, cors);
      }

      // ダッシュボード認証チェック（PUBLIC以外）
      if (url.pathname.startsWith('/api/') && !PUBLIC_ENDPOINTS.includes(url.pathname)) {
        const auth = request.headers.get('Authorization') || '';
        const token = auth.replace(/^Bearer\s+/i, '');
        const valid = await isValidToken(token, env);
        if (!valid) {
          return jsonResponse({ error: 'Unauthorized' }, 401, cors);
        }
      }

      // Sales / Customer endpoints
      if (url.pathname === '/api/summary')      return await handleSummary(env, cors);
      if (url.pathname === '/api/sales')        return await handleSales(env, cors);
      if (url.pathname === '/api/staff')        return await handleStaff(env, cors);
      if (url.pathname === '/api/menu')         return await handleMenu(env, cors);
      if (url.pathname === '/api/recent')       return await handleRecent(env, cors);

      // Attendance endpoints
      if (url.pathname === '/api/attendance/staff-list') return await handleStaffList(env, cors);
      if (url.pathname === '/api/attendance/punch')      return await handlePunch(request, env, cors);
      if (url.pathname === '/api/attendance/today')      return await handleAttendanceToday(env, cors);
      if (url.pathname === '/api/attendance/summary')    return await handleAttendanceSummary(env, cors);

      return jsonResponse({ status: 'ok', service: 'SORA Dashboard API' }, 200, cors);
    } catch (err) {
      console.error('Worker error:', err);
      return jsonResponse({ error: 'Internal error', detail: err.message }, 500, cors);
    }
  },
};

// =====================================================
// Auth (Dashboard owner)
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

async function queryAll(env, dbId, filter = null) {
  const all = [];
  let cursor;
  do {
    const body = { page_size: 100 };
    if (filter) body.filter = filter;
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

async function fetchStaffMap(env) {
  /** id -> {id, name, role, pin, hourlyRate, salaryType, commissionRate, active, displayOrder} */
  const pages = await queryAll(env, env.STAFF_DB_ID);
  const map = {};
  for (const p of pages) {
    const props = p.properties || {};
    const titleProp = Object.values(props).find(v => v.type === 'title');
    const name = (titleProp?.title || []).map(t => t.plain_text).join('');
    const pin = (props['PIN']?.rich_text || []).map(t => t.plain_text).join('');
    const role = props['役割']?.select?.name || '';
    const hourlyRate = props['時給']?.number || 0;
    const salaryType = props['報酬体系']?.select?.name || '';
    const commissionRate = props['歩合率(%)']?.number || 0;
    const active = props['有効']?.checkbox || false;
    const displayOrder = props['表示順']?.number || 0;
    if (!name) continue;
    map[p.id] = {
      id: p.id,
      name,
      pin,
      role,
      hourlyRate,
      salaryType,
      commissionRate,
      active,
      displayOrder,
    };
  }
  return map;
}

// =====================================================
// Sales aggregations
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
    thisYM, lastYM,
    totalSales, totalVisits,
    thisMonthSales, thisMonthVisits, lastMonthSales, ytdSales,
    avgPerVisit: totalVisits ? Math.floor(totalSales / totalVisits) : 0,
    byMonth, byDay, byStaff, byMenu,
  };
}

// =====================================================
// Sales endpoints
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

  const months = [];
  const now = new Date();
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now);
    d.setMonth(d.getMonth() - i);
    months.push(d.toISOString().slice(0, 7));
  }
  const monthSeries = months.map(m => ({ month: m, sales: stats.byMonth[m] || 0 }));

  const days = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    days.push(d.toISOString().slice(0, 10));
  }
  const daySeries = days.map(d => ({ day: d, sales: stats.byDay[d] || 0 }));

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
// Attendance endpoints
// =====================================================

async function handleStaffList(env, cors) {
  /** PUBLIC: PIN以外の情報のみ返す */
  const staffMap = await fetchStaffMap(env);
  const list = Object.values(staffMap)
    .filter(s => s.active)
    .sort((a, b) => a.displayOrder - b.displayOrder)
    .map(s => ({ id: s.id, name: s.name, role: s.role }));
  return jsonResponse({ staff: list }, 200, cors);
}

async function handlePunch(request, env, cors) {
  /** PUBLIC: PINで自己認証 */
  const body = await request.json();
  const { staff_id, pin, type, memo } = body;

  if (!staff_id || !pin || !type) {
    return jsonResponse({ error: 'staff_id, pin, type required' }, 400, cors);
  }

  const VALID_TYPES = ['出勤', '退勤', '休憩開始', '休憩終了'];
  if (!VALID_TYPES.includes(type)) {
    return jsonResponse({ error: 'Invalid punch type' }, 400, cors);
  }

  // PIN検証
  const staffMap = await fetchStaffMap(env);
  const staff = staffMap[staff_id];
  if (!staff || !staff.active) {
    return jsonResponse({ error: 'Staff not found or inactive' }, 401, cors);
  }
  if (staff.pin !== pin) {
    return jsonResponse({ error: 'Invalid PIN' }, 401, cors);
  }

  // 打刻記録作成
  const now = new Date();
  const jstNow = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const dateStr = jstNow.toISOString().slice(0, 16).replace('T', ' ');

  const properties = {
    '件名': {
      title: [{ text: { content: `${staff.name} - ${dateStr} ${type}` } }]
    },
    'スタッフ': { relation: [{ id: staff_id }] },
    '打刻種別': { select: { name: type } },
    '日時': { date: { start: now.toISOString() } },
    '作成元': { select: { name: 'PIN打刻' } },
  };
  if (memo) {
    properties['備考'] = { rich_text: [{ text: { content: memo } }] };
  }

  const r = await notionFetch(env, '/pages', {
    method: 'POST',
    body: JSON.stringify({
      parent: { database_id: env.ATTENDANCE_DB_ID },
      properties,
    }),
  });

  return jsonResponse({
    success: true,
    staff: staff.name,
    type,
    timestamp: now.toISOString(),
  }, 200, cors);
}

async function handleAttendanceToday(env, cors) {
  const now = new Date();
  const jstNow = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const today = jstNow.toISOString().slice(0, 10);

  const records = await queryAll(env, env.ATTENDANCE_DB_ID, {
    property: '日時',
    date: { equals: today },
  });

  const staffMap = await fetchStaffMap(env);
  const punches = records.map(r => {
    const props = r.properties || {};
    const staffRel = props['スタッフ']?.relation || [];
    const staffId = staffRel[0]?.id;
    return {
      id: r.id,
      staffName: staffId ? (staffMap[staffId]?.name || '不明') : '',
      type: props['打刻種別']?.select?.name || '',
      timestamp: props['日時']?.date?.start || '',
      memo: (props['備考']?.rich_text || []).map(t => t.plain_text).join(''),
    };
  }).sort((a, b) => b.timestamp.localeCompare(a.timestamp));

  return jsonResponse({ today: punches }, 200, cors);
}

async function handleAttendanceSummary(env, cors) {
  /** 月次の勤務時間集計 */
  const now = new Date();
  const jstNow = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const thisYM = jstNow.toISOString().slice(0, 7);

  const records = await queryAll(env, env.ATTENDANCE_DB_ID);
  const staffMap = await fetchStaffMap(env);

  // staffId -> 日付 -> [{type, timestamp}]
  const grouped = {};
  for (const r of records) {
    const props = r.properties || {};
    const dateStr = props['日時']?.date?.start || '';
    if (!dateStr) continue;
    if (!dateStr.startsWith(thisYM)) continue;
    const day = dateStr.slice(0, 10);
    const staffRel = props['スタッフ']?.relation || [];
    const staffId = staffRel[0]?.id;
    if (!staffId) continue;
    grouped[staffId] = grouped[staffId] || {};
    grouped[staffId][day] = grouped[staffId][day] || [];
    grouped[staffId][day].push({
      type: props['打刻種別']?.select?.name || '',
      timestamp: dateStr,
    });
  }

  const summary = [];
  for (const [staffId, days] of Object.entries(grouped)) {
    const staff = staffMap[staffId];
    if (!staff) continue;
    let totalMinutes = 0;
    let workDays = 0;
    for (const [day, punches] of Object.entries(days)) {
      const sorted = punches.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
      let workStart = null;
      let workEnd = null;
      let breakMinutes = 0;
      let breakStart = null;
      for (const p of sorted) {
        const ts = new Date(p.timestamp);
        if (p.type === '出勤' && !workStart) workStart = ts;
        if (p.type === '退勤') workEnd = ts;
        if (p.type === '休憩開始') breakStart = ts;
        if (p.type === '休憩終了' && breakStart) {
          breakMinutes += Math.round((ts - breakStart) / 60000);
          breakStart = null;
        }
      }
      if (workStart && workEnd) {
        const workMinutes = Math.round((workEnd - workStart) / 60000) - breakMinutes;
        if (workMinutes > 0) {
          totalMinutes += workMinutes;
          workDays++;
        }
      } else if (workStart) {
        // 退勤打刻なし。今日なら経過時間を仮算出
        const lastPunch = sorted[sorted.length - 1];
        if (day === jstNow.toISOString().slice(0, 10)) {
          // 出勤中として今までの時間を加算
        }
      }
    }
    summary.push({
      staffId,
      name: staff.name,
      role: staff.role,
      workDays,
      totalMinutes,
      totalHours: (totalMinutes / 60).toFixed(1),
      hourlyWage: staff.hourlyRate || 0,
      estimatedWage: staff.hourlyRate ? Math.floor(totalMinutes / 60 * staff.hourlyRate) : null,
    });
  }
  summary.sort((a, b) => b.totalMinutes - a.totalMinutes);

  return jsonResponse({ summary, month: thisYM }, 200, cors);
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
