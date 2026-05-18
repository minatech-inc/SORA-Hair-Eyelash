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
 *   GET  /api/customers/list        顧客一覧
 *   GET  /api/customers/{id}        顧客詳細（施術履歴含む）
 *   PATCH /api/customers/{id}       顧客情報更新
 *   POST /api/treatments            施術履歴新規作成
 *   PATCH /api/treatments/{id}      施術履歴更新
 *   POST /api/upload                ファイルをR2にアップロード（写真等）
 *   GET  /api/invoices/list         請求書一覧（オーナー視点）
 *   POST /api/invoices/generate     月末請求書を一括生成
 *   POST /api/invoices/owner-approve オーナー承認
 *   POST /api/invoices/reject       却下
 *   POST /api/invoices/mark-paid    支払済マーク
 *
 *   ↓ 以下、認証なし (PINで個別認証)
 *   GET  /api/attendance/staff-list 有効スタッフ一覧（PIN以外）
 *   POST /api/attendance/punch      打刻（PIN必須）
 *   POST /api/invoices/staff-list   スタッフ自身の請求書一覧（PIN必須）
 *   POST /api/invoices/staff-approve スタッフ承認（PIN必須）
 *
 * 環境変数 (シークレット):
 *   NOTION_TOKEN          Notion インテグレーション トークン
 *   TREATMENT_DB_ID       施術履歴 DB ID
 *   MENU_DB_ID            メニューマスタ DB ID
 *   CUSTOMER_DB_ID        顧客カルテ DB ID
 *   STAFF_DB_ID           スタッフマスタ DB ID
 *   ATTENDANCE_DB_ID      勤怠記録 DB ID
 *   INVOICE_DB_ID         請求書 DB ID
 *   DASHBOARD_PASSWORD    ダッシュボード閲覧用パスワード
 */

const NOTION_API = 'https://api.notion.com/v1';
const NOTION_VERSION = '2022-06-28';

const ALLOWED_ORIGINS = [
  'https://sora.minatech1210.com',
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

// 認証不要エンドポイント（PINで自己認証する系）
const PUBLIC_ENDPOINTS = [
  '/api/attendance/staff-list',
  '/api/attendance/punch',
  '/api/invoices/staff-list',
  '/api/invoices/staff-approve',
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

      // Staff admin endpoints (auth required)
      if (url.pathname === '/api/staff/admin-list' && request.method === 'GET') {
        return await handleStaffAdminList(env, cors);
      }
      if (url.pathname === '/api/staff/admin' && request.method === 'POST') {
        return await handleStaffCreate(request, env, cors);
      }
      const staffAdminMatch = url.pathname.match(/^\/api\/staff\/admin\/([a-f0-9-]+)$/);
      if (staffAdminMatch && request.method === 'PATCH') {
        return await handleStaffUpdate(staffAdminMatch[1], request, env, cors);
      }

      // Customer endpoints
      if (url.pathname === '/api/customers/list') return await handleCustomerList(env, cors);
      if (url.pathname === '/api/customers' && request.method === 'POST') {
        return await handleCustomerCreate(request, env, cors);
      }
      const customerMatch = url.pathname.match(/^\/api\/customers\/([a-f0-9-]+)$/);
      if (customerMatch) {
        if (request.method === 'PATCH') return await handleCustomerUpdate(customerMatch[1], request, env, cors);
        return await handleCustomerDetail(customerMatch[1], env, cors);
      }

      // Treatment endpoints
      if (url.pathname === '/api/treatments' && request.method === 'POST') {
        return await handleTreatmentCreate(request, env, cors);
      }
      const treatmentMatch = url.pathname.match(/^\/api\/treatments\/([a-f0-9-]+)$/);
      if (treatmentMatch && request.method === 'PATCH') {
        return await handleTreatmentUpdate(treatmentMatch[1], request, env, cors);
      }

      // Upload to R2
      if (url.pathname === '/api/upload' && request.method === 'POST') {
        return await handleUpload(request, env, cors);
      }

      // Invoice endpoints
      if (url.pathname === '/api/invoices/list')           return await handleInvoiceList(env, cors);
      if (url.pathname === '/api/invoices/generate')       return await handleInvoiceGenerate(request, env, cors);
      if (url.pathname === '/api/invoices/owner-approve')  return await handleInvoiceOwnerApprove(request, env, cors);
      if (url.pathname === '/api/invoices/reject')         return await handleInvoiceReject(request, env, cors);
      if (url.pathname === '/api/invoices/mark-paid')      return await handleInvoiceMarkPaid(request, env, cors);
      if (url.pathname === '/api/invoices/staff-list')     return await handleStaffInvoices(request, env, cors);
      if (url.pathname === '/api/invoices/staff-approve')  return await handleInvoiceStaffApprove(request, env, cors);

      // Invoice HTML/Info (with token query auth)
      const htmlMatch = url.pathname.match(/^\/api\/invoices\/([^/]+)\/html$/);
      if (htmlMatch) return await handleInvoiceHtml(htmlMatch[1], url, env);
      const infoMatch = url.pathname.match(/^\/api\/invoices\/([^/]+)\/info$/);
      if (infoMatch) return await handleInvoiceInfo(infoMatch[1], url, env, cors);
      const updateFileMatch = url.pathname.match(/^\/api\/invoices\/([^/]+)\/set-drive-file$/);
      if (updateFileMatch) return await handleSetDriveFile(updateFileMatch[1], request, url, env, cors);

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
  /** id -> {id, name, role, pin, hourlyRate, salaryType, commissionRate, active, displayOrder, invoiceTarget} */
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
    const invoiceTarget = props['請求書対象']?.checkbox || false;
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
      invoiceTarget,
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
  /** PUBLIC: PIN以外の情報のみ返す。
   * クエリパラメータ ?invoice=1 で請求書対象スタッフのみに絞る */
  const staffMap = await fetchStaffMap(env);
  const list = Object.values(staffMap)
    .filter(s => s.active)
    .sort((a, b) => a.displayOrder - b.displayOrder)
    .map(s => ({
      id: s.id,
      name: s.name,
      role: s.role,
      invoiceTarget: s.invoiceTarget,
    }));
  return jsonResponse({ staff: list }, 200, cors);
}

// =====================================================
// Staff admin (auth token required)
// =====================================================
async function handleStaffAdminList(env, cors) {
  /** ADMIN: 全フィールド（PIN含む）を返す。無効スタッフも含む */
  const staffMap = await fetchStaffMap(env);
  const list = Object.values(staffMap)
    .sort((a, b) => (a.displayOrder || 0) - (b.displayOrder || 0));
  return jsonResponse({ staff: list }, 200, cors);
}

function buildStaffProperties(body) {
  const props = {};
  if (body['お名前'] !== undefined) {
    props['お名前'] = { title: [{ text: { content: body['お名前'] } }] };
  }
  if (body['PIN'] !== undefined) {
    props['PIN'] = { rich_text: [{ text: { content: body['PIN'] || '' } }] };
  }
  if (body['役割'] !== undefined) {
    props['役割'] = body['役割'] ? { select: { name: body['役割'] } } : { select: null };
  }
  if (body['時給'] !== undefined) {
    props['時給'] = { number: body['時給'] === '' || body['時給'] == null ? null : Number(body['時給']) };
  }
  if (body['報酬体系'] !== undefined) {
    props['報酬体系'] = body['報酬体系'] ? { select: { name: body['報酬体系'] } } : { select: null };
  }
  if (body['歩合率(%)'] !== undefined) {
    props['歩合率(%)'] = { number: body['歩合率(%)'] === '' || body['歩合率(%)'] == null ? null : Number(body['歩合率(%)']) };
  }
  if (body['表示順'] !== undefined) {
    props['表示順'] = { number: body['表示順'] === '' || body['表示順'] == null ? null : Number(body['表示順']) };
  }
  if (body['有効'] !== undefined) props['有効'] = { checkbox: !!body['有効'] };
  if (body['請求書対象'] !== undefined) props['請求書対象'] = { checkbox: !!body['請求書対象'] };
  return props;
}

async function handleStaffCreate(request, env, cors) {
  const body = await request.json();
  if (!body['お名前']) {
    return jsonResponse({ error: 'お名前は必須です' }, 400, cors);
  }
  if (body['PIN'] && !/^\d{4}$/.test(body['PIN'])) {
    return jsonResponse({ error: 'PINは4桁の数字で入力してください' }, 400, cors);
  }
  const props = buildStaffProperties(body);
  // デフォルトで有効に
  if (props['有効'] === undefined) props['有効'] = { checkbox: true };
  const r = await notionFetch(env, '/pages', {
    method: 'POST',
    body: JSON.stringify({
      parent: { database_id: env.STAFF_DB_ID },
      properties: props,
    }),
  });
  return jsonResponse({ success: true, id: r.id }, 200, cors);
}

async function handleStaffUpdate(staffId, request, env, cors) {
  const body = await request.json();
  if (body['PIN'] !== undefined && body['PIN'] !== '' && !/^\d{4}$/.test(body['PIN'])) {
    return jsonResponse({ error: 'PINは4桁の数字で入力してください' }, 400, cors);
  }
  const props = buildStaffProperties(body);
  await notionFetch(env, `/pages/${staffId}`, {
    method: 'PATCH',
    body: JSON.stringify({ properties: props }),
  });
  return jsonResponse({ success: true }, 200, cors);
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
// Customer endpoints
// =====================================================

function formatCustomer(rec, withDetails = false) {
  const props = rec.properties || {};
  const titleProp = Object.values(props).find(v => v.type === 'title');
  const name = (titleProp?.title || []).map(t => t.plain_text).join('');
  const get = (k, type) => props[k]?.[type];
  const getRichText = (k) => (props[k]?.rich_text || []).map(t => t.plain_text).join('');
  const getRollupNumber = (k) => props[k]?.rollup?.number || 0;
  const getRollupDate = (k) => props[k]?.rollup?.date?.start || '';

  const base = {
    id: rec.id,
    name,
    kana: getRichText('フリガナ'),
    phone: get('電話番号', 'phone_number') || '',
    email: get('メールアドレス', 'email') || '',
    birthday: get('生年月日', 'date')?.start || '',
    gender: get('性別', 'select')?.name || '',
    firstVisitDate: get('初来店日', 'date')?.start || '',
    lastVisitDate: getRollupDate('最終来店日'),
    visitCount: getRollupNumber('来店回数'),
    totalSpent: getRollupNumber('累計売上'),
    tags: (get('タグ', 'multi_select') || []).map(t => t.name),
    staff: get('担当スタッフ', 'select')?.name || '',
    status: get('ステータス', 'select')?.name || '',
    source: get('流入元', 'select')?.name || '',
    lineRegistered: get('LINE登録', 'checkbox') || false,
    consentReceived: get('同意書受理', 'checkbox') || false,
  };

  if (withDetails) {
    base.health = getRichText('健康状態・アレルギー');
    base.preferences = getRichText('お好み・要望');
    base.staffMemo = getRichText('スタッフメモ');
    base.photoConsent = (get('撮影同意', 'multi_select') || []).map(t => t.name);
    base.treatmentRelations = (get('施術履歴', 'relation') || []).map(r => r.id);
  }

  return base;
}

async function handleCustomerList(env, cors) {
  const records = await queryAll(env, env.CUSTOMER_DB_ID);
  const customers = records.map(r => formatCustomer(r))
    .sort((a, b) => (b.lastVisitDate || '').localeCompare(a.lastVisitDate || ''));
  return jsonResponse({ customers }, 200, cors);
}

async function handleCustomerDetail(customerId, env, cors) {
  const customer = await notionFetch(env, `/pages/${customerId}`);
  const detail = formatCustomer(customer, true);

  // 施術履歴を取得
  const menuLookup = await fetchMenuLookup(env);
  const treatments = [];
  for (const treatmentId of detail.treatmentRelations) {
    try {
      const t = await notionFetch(env, `/pages/${treatmentId}`);
      const tProps = t.properties || {};
      const titleProp = Object.values(tProps).find(v => v.type === 'title');
      const title = (titleProp?.title || []).map(p => p.plain_text).join('');
      const menuRel = tProps['メニュー']?.relation || [];
      const menuNames = menuRel.map(m => menuLookup[m.id] || '不明');
      treatments.push({
        id: t.id,
        title,
        date: tProps['来店日時']?.date?.start || '',
        staff: tProps['担当スタッフ']?.select?.name || '',
        menu: menuNames.join(', '),
        fee: tProps['料金']?.number || 0,
        status: tProps['ステータス']?.select?.name || '',
        beforePhotos: (tProps['Before写真']?.files || []).map(f => f.file?.url || f.external?.url),
        afterPhotos: (tProps['After写真']?.files || []).map(f => f.file?.url || f.external?.url),
        memo: (tProps['詳細メモ']?.rich_text || []).map(p => p.plain_text).join(''),
        nextProposal: (tProps['次回提案']?.rich_text || []).map(p => p.plain_text).join(''),
      });
    } catch (e) {
      console.error('Treatment fetch error:', e);
    }
  }
  treatments.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  detail.treatments = treatments;
  delete detail.treatmentRelations;

  return jsonResponse({ customer: detail }, 200, cors);
}

function buildCustomerProperties(body) {
  const props = {};

  // 名前 (Title) - 新規時は必須
  if (body['お名前'] !== undefined) {
    props['お名前'] = { title: [{ text: { content: body['お名前'] } }] };
  }

  // テキストフィールド
  const textFields = ['フリガナ', '健康状態・アレルギー', 'お好み・要望', 'スタッフメモ'];
  for (const f of textFields) {
    if (body[f] !== undefined) {
      props[f] = { rich_text: [{ text: { content: body[f] || '' } }] };
    }
  }

  if (body['電話番号'] !== undefined) props['電話番号'] = { phone_number: body['電話番号'] || null };
  if (body['メールアドレス'] !== undefined) props['メールアドレス'] = { email: body['メールアドレス'] || null };
  if (body['生年月日'] !== undefined) props['生年月日'] = body['生年月日'] ? { date: { start: body['生年月日'] } } : { date: null };
  if (body['初来店日'] !== undefined) props['初来店日'] = body['初来店日'] ? { date: { start: body['初来店日'] } } : { date: null };

  if (body['性別'] !== undefined) props['性別'] = body['性別'] ? { select: { name: body['性別'] } } : { select: null };
  if (body['担当スタッフ'] !== undefined) props['担当スタッフ'] = body['担当スタッフ'] ? { select: { name: body['担当スタッフ'] } } : { select: null };
  if (body['ステータス'] !== undefined) props['ステータス'] = body['ステータス'] ? { select: { name: body['ステータス'] } } : { select: null };
  if (body['流入元'] !== undefined) props['流入元'] = body['流入元'] ? { select: { name: body['流入元'] } } : { select: null };

  if (body['LINE登録'] !== undefined) props['LINE登録'] = { checkbox: !!body['LINE登録'] };
  if (body['同意書受理'] !== undefined) props['同意書受理'] = { checkbox: !!body['同意書受理'] };

  if (Array.isArray(body['タグ'])) {
    props['タグ'] = { multi_select: body['タグ'].map(n => ({ name: n })) };
  }
  if (Array.isArray(body['撮影同意'])) {
    props['撮影同意'] = { multi_select: body['撮影同意'].map(n => ({ name: n })) };
  }

  return props;
}

async function handleCustomerCreate(request, env, cors) {
  const body = await request.json();
  if (!body['お名前']) {
    return jsonResponse({ error: 'お名前は必須です' }, 400, cors);
  }
  const props = buildCustomerProperties(body);
  // ステータス未指定なら「アクティブ」を初期値に
  if (!props['ステータス']) {
    props['ステータス'] = { select: { name: 'アクティブ' } };
  }
  const r = await notionFetch(env, '/pages', {
    method: 'POST',
    body: JSON.stringify({
      parent: { database_id: env.CUSTOMER_DB_ID },
      properties: props,
    }),
  });
  return jsonResponse({ success: true, id: r.id }, 200, cors);
}

async function handleCustomerUpdate(customerId, request, env, cors) {
  const body = await request.json();
  const props = {};

  // テキストフィールド
  const textFields = ['フリガナ', '健康状態・アレルギー', 'お好み・要望', 'スタッフメモ'];
  for (const f of textFields) {
    if (body[f] !== undefined) {
      props[f] = { rich_text: [{ text: { content: body[f] || '' } }] };
    }
  }

  // 名前 (Title)
  if (body['お名前'] !== undefined) {
    props['お名前'] = { title: [{ text: { content: body['お名前'] } }] };
  }

  if (body['電話番号'] !== undefined) props['電話番号'] = { phone_number: body['電話番号'] || null };
  if (body['メールアドレス'] !== undefined) props['メールアドレス'] = { email: body['メールアドレス'] || null };
  if (body['生年月日'] !== undefined) props['生年月日'] = body['生年月日'] ? { date: { start: body['生年月日'] } } : { date: null };
  if (body['初来店日'] !== undefined) props['初来店日'] = body['初来店日'] ? { date: { start: body['初来店日'] } } : { date: null };

  if (body['性別'] !== undefined) props['性別'] = body['性別'] ? { select: { name: body['性別'] } } : { select: null };
  if (body['担当スタッフ'] !== undefined) props['担当スタッフ'] = body['担当スタッフ'] ? { select: { name: body['担当スタッフ'] } } : { select: null };
  if (body['ステータス'] !== undefined) props['ステータス'] = body['ステータス'] ? { select: { name: body['ステータス'] } } : { select: null };
  if (body['流入元'] !== undefined) props['流入元'] = body['流入元'] ? { select: { name: body['流入元'] } } : { select: null };

  if (body['LINE登録'] !== undefined) props['LINE登録'] = { checkbox: !!body['LINE登録'] };
  if (body['同意書受理'] !== undefined) props['同意書受理'] = { checkbox: !!body['同意書受理'] };

  if (Array.isArray(body['タグ'])) {
    props['タグ'] = { multi_select: body['タグ'].map(n => ({ name: n })) };
  }
  if (Array.isArray(body['撮影同意'])) {
    props['撮影同意'] = { multi_select: body['撮影同意'].map(n => ({ name: n })) };
  }

  await notionFetch(env, `/pages/${customerId}`, {
    method: 'PATCH',
    body: JSON.stringify({ properties: props }),
  });
  return jsonResponse({ success: true }, 200, cors);
}

// =====================================================
// Treatment endpoints
// =====================================================

function buildTreatmentProperties(body) {
  const props = {};
  if (body['件名']) props['件名'] = { title: [{ text: { content: body['件名'] } }] };
  if (body['来店日時']) props['来店日時'] = { date: { start: body['来店日時'] } };
  if (body['担当スタッフ']) props['担当スタッフ'] = { select: { name: body['担当スタッフ'] } };
  if (body['ステータス']) props['ステータス'] = { select: { name: body['ステータス'] } };
  if (body['支払方法']) props['支払方法'] = { select: { name: body['支払方法'] } };
  if (body['料金'] !== undefined) props['料金'] = { number: Number(body['料金']) };

  if (body['詳細メモ'] !== undefined) props['詳細メモ'] = { rich_text: [{ text: { content: body['詳細メモ'] || '' } }] };
  if (body['次回提案'] !== undefined) props['次回提案'] = { rich_text: [{ text: { content: body['次回提案'] || '' } }] };

  if (Array.isArray(body['メニューIds']) && body['メニューIds'].length) {
    props['メニュー'] = { relation: body['メニューIds'].map(id => ({ id })) };
  }
  if (body['顧客Id']) {
    // 関係プロパティ名: Notion 自動命名で "Related to 顧客カルテ (施術履歴)" 等になる場合あり
    // ここではキーをそのまま渡すと壊れる可能性があるため、別途リレーション名の取得が必要。
    // 動作上、施術履歴側からのリレーション設定が完了している前提
  }

  if (Array.isArray(body['Before写真URLs'])) {
    props['Before写真'] = {
      files: body['Before写真URLs'].map(url => ({
        name: 'photo.jpg',
        type: 'external',
        external: { url }
      }))
    };
  }
  if (Array.isArray(body['After写真URLs'])) {
    props['After写真'] = {
      files: body['After写真URLs'].map(url => ({
        name: 'photo.jpg',
        type: 'external',
        external: { url }
      }))
    };
  }
  return props;
}

async function getCustomerRelationPropertyName(env) {
  // 施術履歴DB上の顧客カルテへのリレーションプロパティ名を取得
  const db = await notionFetch(env, `/databases/${env.TREATMENT_DB_ID}`);
  for (const [name, prop] of Object.entries(db.properties || {})) {
    if (prop.type === 'relation' && prop.relation?.database_id?.replace(/-/g, '') === env.CUSTOMER_DB_ID.replace(/-/g, '')) {
      return name;
    }
  }
  return null;
}

async function handleTreatmentCreate(request, env, cors) {
  const body = await request.json();
  const props = buildTreatmentProperties(body);

  if (body['顧客Id']) {
    const relName = await getCustomerRelationPropertyName(env);
    if (relName) {
      props[relName] = { relation: [{ id: body['顧客Id'] }] };
    }
  }

  const r = await notionFetch(env, '/pages', {
    method: 'POST',
    body: JSON.stringify({
      parent: { database_id: env.TREATMENT_DB_ID },
      properties: props,
    }),
  });
  return jsonResponse({ success: true, id: r.id }, 200, cors);
}

async function handleTreatmentUpdate(treatmentId, request, env, cors) {
  const body = await request.json();
  const props = buildTreatmentProperties(body);
  await notionFetch(env, `/pages/${treatmentId}`, {
    method: 'PATCH',
    body: JSON.stringify({ properties: props }),
  });
  return jsonResponse({ success: true }, 200, cors);
}

// =====================================================
// File upload to R2
// =====================================================

async function handleUpload(request, env, cors) {
  if (!env.PHOTOS) {
    return jsonResponse({ error: 'R2 bucket not configured. Set PHOTOS binding.' }, 500, cors);
  }
  const formData = await request.formData();
  const file = formData.get('file');
  if (!file || typeof file === 'string') {
    return jsonResponse({ error: 'file required (multipart/form-data)' }, 400, cors);
  }

  // ファイル名/拡張子
  const origName = file.name || 'upload';
  const ext = (origName.includes('.') ? origName.split('.').pop() : 'bin').toLowerCase().slice(0, 8);
  const key = `treatments/${new Date().toISOString().slice(0, 10)}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

  await env.PHOTOS.put(key, file.stream(), {
    httpMetadata: { contentType: file.type || 'application/octet-stream' },
  });

  const publicBase = env.PHOTOS_PUBLIC_BASE || `https://photos-placeholder.invalid`;
  const publicUrl = `${publicBase.replace(/\/$/, '')}/${key}`;
  return jsonResponse({ url: publicUrl, key }, 200, cors);
}

// =====================================================
// Invoice endpoints
// =====================================================

function ymToMonthKey(y, m) {
  return `${y}-${String(m).padStart(2, '0')}`;
}

function findStaffMatch(staffMap, treatmentStaffName) {
  // 施術履歴の担当スタッフ名（select値）からスタッフマスタを検索
  // 例: "からきだ" → "唐木田 帆花" にマッチさせる
  if (!treatmentStaffName) return null;
  const normalized = treatmentStaffName.replace(/\s+/g, '');
  for (const s of Object.values(staffMap)) {
    const sName = s.name.replace(/\s+/g, '');
    // 完全一致、部分一致、または特定エイリアス
    if (sName === normalized) return s;
    if (sName.includes(normalized) || normalized.includes(sName)) return s;
    // 「からきだ」→「唐木田」のエイリアス対応
    if (treatmentStaffName === 'からきだ' && s.name.includes('唐木田')) return s;
    if (treatmentStaffName === 'からきだ ほのか' && s.name.includes('唐木田')) return s;
  }
  return null;
}

async function findInvoiceForStaffMonth(env, staffId, yearMonth) {
  const data = await notionFetch(env, `/databases/${env.INVOICE_DB_ID}/query`, {
    method: 'POST',
    body: JSON.stringify({
      filter: {
        and: [
          { property: 'スタッフ', relation: { contains: staffId } },
          { property: '対象月', rich_text: { equals: yearMonth } },
        ]
      }
    })
  });
  return (data.results || [])[0] || null;
}

async function handleInvoiceList(env, cors) {
  const records = await queryAll(env, env.INVOICE_DB_ID);
  const staffMap = await fetchStaffMap(env);

  const list = records.map(r => formatInvoice(r, staffMap)).sort((a, b) => {
    return (b.targetMonth || '').localeCompare(a.targetMonth || '');
  });
  return jsonResponse({ invoices: list }, 200, cors);
}

function formatInvoice(rec, staffMap) {
  const props = rec.properties || {};
  const titleProp = Object.values(props).find(v => v.type === 'title');
  const title = (titleProp?.title || []).map(t => t.plain_text).join('');
  const staffRel = props['スタッフ']?.relation || [];
  const staffId = staffRel[0]?.id;
  const staff = staffId ? staffMap[staffId] : null;
  return {
    id: rec.id,
    invoiceNo: title,
    staffId,
    staffName: staff?.name || '',
    targetMonth: (props['対象月']?.rich_text || []).map(t => t.plain_text).join(''),
    periodStart: props['期間開始']?.date?.start || '',
    periodEnd: props['期間終了']?.date?.start || '',
    closingDate: props['締日']?.date?.start || '',
    paymentDueDate: props['支払予定日']?.date?.start || '',
    visitCount: props['件数']?.number || 0,
    salesExclTax: props['売上合計(税抜)']?.number || 0,
    tax: props['消費税']?.formula?.number || 0,
    salesInclTax: props['売上合計(税込)']?.formula?.number || 0,
    commissionRate: props['報酬率(%)']?.number || 0,
    feeAmount: props['報酬額']?.formula?.number || 0,
    status: props['ステータス']?.select?.name || '',
    staffApprovedAt: props['スタッフ承認日時']?.date?.start || '',
    ownerApprovedAt: props['オーナー承認日時']?.date?.start || '',
    paidAt: props['支払日時']?.date?.start || '',
    driveFileId: (props['Drive ファイルID']?.rich_text || []).map(t => t.plain_text).join(''),
    note: (props['備考']?.rich_text || []).map(t => t.plain_text).join(''),
    source: props['作成元']?.select?.name || '',
  };
}

async function handleInvoiceGenerate(request, env, cors) {
  const body = await request.json().catch(() => ({}));
  const { year_month, dry_run } = body;
  if (!year_month || !/^\d{4}-\d{2}$/.test(year_month)) {
    return jsonResponse({ error: 'year_month required (YYYY-MM)' }, 400, cors);
  }

  // 締日は対象月の末日、支払日は翌月25日
  const [y, m] = year_month.split('-').map(Number);
  const periodStart = `${y}-${String(m).padStart(2, '0')}-01`;
  const lastDay = new Date(y, m, 0).getDate();
  const periodEnd = `${y}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
  const nextMonth = m === 12 ? 1 : m + 1;
  const nextYear = m === 12 ? y + 1 : y;
  const paymentDue = `${nextYear}-${String(nextMonth).padStart(2, '0')}-25`;

  // スタッフ取得（請求書対象のみ）
  const staffMap = await fetchStaffMap(env);
  const targetStaff = Object.values(staffMap).filter(s => {
    // 請求書対象フラグはfetchStaffMapに含まれていないので、Notionから直接取得
    return s.active;
  });

  // 改めてフラグ付きで取得
  const staffPages = await queryAll(env, env.STAFF_DB_ID);
  const invoiceTargets = [];
  for (const p of staffPages) {
    const props = p.properties || {};
    const isInvoiceTarget = props['請求書対象']?.checkbox || false;
    const isActive = props['有効']?.checkbox || false;
    if (isInvoiceTarget && isActive && staffMap[p.id]) {
      invoiceTargets.push(staffMap[p.id]);
    }
  }

  // 施術履歴を期間でフィルタ取得（property: 来店日時）
  const treatments = await queryAll(env, env.TREATMENT_DB_ID, {
    and: [
      { property: '来店日時', date: { on_or_after: periodStart } },
      { property: '来店日時', date: { on_or_before: periodEnd } },
    ]
  });

  const generated = [];
  const skipped = [];
  for (const staff of invoiceTargets) {
    // 既存請求書チェック
    const existing = await findInvoiceForStaffMonth(env, staff.id, year_month);
    if (existing) {
      skipped.push({ staff: staff.name, reason: 'Already exists', invoiceId: existing.id });
      continue;
    }

    // 売上集計
    let visitCount = 0;
    let salesInclTaxTotal = 0;
    for (const rec of treatments) {
      const props = rec.properties || {};
      const status = props['ステータス']?.select?.name || '';
      if (!status.includes('来店済')) continue;
      const treatmentStaffName = props['担当スタッフ']?.select?.name || '';
      const matchedStaff = findStaffMatch({ [staff.id]: staff }, treatmentStaffName);
      if (!matchedStaff || matchedStaff.id !== staff.id) continue;
      visitCount++;
      salesInclTaxTotal += props['料金']?.number || 0;
    }

    if (visitCount === 0) {
      skipped.push({ staff: staff.name, reason: 'No completed visits' });
      continue;
    }

    // 税抜計算（料金は税込前提）
    const salesExclTax = Math.round(salesInclTaxTotal / 1.1);
    const commissionRate = staff.commissionRate || 0.5;
    const invoiceNo = `INV-${year_month}-${staff.name.replace(/\s+/g, '').slice(0, 6)}`;

    if (dry_run) {
      generated.push({
        staff: staff.name,
        invoiceNo,
        visitCount,
        salesExclTax,
        feeAmount: Math.round(salesExclTax * commissionRate),
      });
      continue;
    }

    // Notion作成
    const props = {
      '請求書番号': { title: [{ text: { content: invoiceNo } }] },
      'スタッフ': { relation: [{ id: staff.id }] },
      '対象月': { rich_text: [{ text: { content: year_month } }] },
      '期間開始': { date: { start: periodStart } },
      '期間終了': { date: { start: periodEnd } },
      '締日': { date: { start: periodEnd } },
      '支払予定日': { date: { start: paymentDue } },
      '件数': { number: visitCount },
      '売上合計(税抜)': { number: salesExclTax },
      '報酬率(%)': { number: commissionRate },
      'ステータス': { select: { name: 'スタッフ承認待ち' } },
      '作成元': { select: { name: '自動生成' } },
    };

    const created = await notionFetch(env, '/pages', {
      method: 'POST',
      body: JSON.stringify({
        parent: { database_id: env.INVOICE_DB_ID },
        properties: props,
      }),
    });
    generated.push({
      id: created.id,
      staff: staff.name,
      invoiceNo,
      visitCount,
      salesExclTax,
      feeAmount: Math.round(salesExclTax * commissionRate),
    });
  }

  return jsonResponse({
    yearMonth: year_month,
    periodStart,
    periodEnd,
    paymentDue,
    generated,
    skipped,
  }, 200, cors);
}

async function handleInvoiceStaffApprove(request, env, cors) {
  const body = await request.json();
  const { invoice_id, staff_id, pin } = body;
  if (!invoice_id || !staff_id || !pin) {
    return jsonResponse({ error: 'invoice_id, staff_id, pin required' }, 400, cors);
  }
  // PIN検証
  const staffMap = await fetchStaffMap(env);
  const staff = staffMap[staff_id];
  if (!staff || staff.pin !== pin) {
    return jsonResponse({ error: 'Invalid PIN' }, 401, cors);
  }
  // 請求書取得・所有確認
  const invoice = await notionFetch(env, `/pages/${invoice_id}`);
  const invStaffId = invoice.properties['スタッフ']?.relation?.[0]?.id;
  if (invStaffId !== staff_id) {
    return jsonResponse({ error: 'Not your invoice' }, 403, cors);
  }
  const status = invoice.properties['ステータス']?.select?.name;
  if (status !== 'スタッフ承認待ち') {
    return jsonResponse({ error: `Cannot approve from status: ${status}` }, 400, cors);
  }
  // 更新
  await notionFetch(env, `/pages/${invoice_id}`, {
    method: 'PATCH',
    body: JSON.stringify({
      properties: {
        'ステータス': { select: { name: 'オーナー承認待ち' } },
        'スタッフ承認日時': { date: { start: new Date().toISOString() } },
      }
    })
  });
  return jsonResponse({ success: true, status: 'オーナー承認待ち' }, 200, cors);
}

async function handleInvoiceOwnerApprove(request, env, cors) {
  const body = await request.json();
  const { invoice_id } = body;
  if (!invoice_id) return jsonResponse({ error: 'invoice_id required' }, 400, cors);
  const invoice = await notionFetch(env, `/pages/${invoice_id}`);
  const status = invoice.properties['ステータス']?.select?.name;
  if (status !== 'オーナー承認待ち') {
    return jsonResponse({ error: `Cannot approve from status: ${status}` }, 400, cors);
  }
  await notionFetch(env, `/pages/${invoice_id}`, {
    method: 'PATCH',
    body: JSON.stringify({
      properties: {
        'ステータス': { select: { name: '確定' } },
        'オーナー承認日時': { date: { start: new Date().toISOString() } },
      }
    })
  });
  return jsonResponse({ success: true, status: '確定' }, 200, cors);
}

async function handleInvoiceReject(request, env, cors) {
  const body = await request.json();
  const { invoice_id, reason } = body;
  if (!invoice_id) return jsonResponse({ error: 'invoice_id required' }, 400, cors);
  const props = {
    'ステータス': { select: { name: '却下' } },
  };
  if (reason) {
    props['備考'] = { rich_text: [{ text: { content: reason } }] };
  }
  await notionFetch(env, `/pages/${invoice_id}`, {
    method: 'PATCH',
    body: JSON.stringify({ properties: props })
  });
  return jsonResponse({ success: true, status: '却下' }, 200, cors);
}

async function handleInvoiceMarkPaid(request, env, cors) {
  const body = await request.json();
  const { invoice_id } = body;
  if (!invoice_id) return jsonResponse({ error: 'invoice_id required' }, 400, cors);
  await notionFetch(env, `/pages/${invoice_id}`, {
    method: 'PATCH',
    body: JSON.stringify({
      properties: {
        'ステータス': { select: { name: '支払済' } },
        '支払日時': { date: { start: new Date().toISOString() } },
      }
    })
  });
  return jsonResponse({ success: true, status: '支払済' }, 200, cors);
}

async function handleStaffInvoices(request, env, cors) {
  const body = await request.json();
  const { staff_id, pin } = body;
  if (!staff_id || !pin) {
    return jsonResponse({ error: 'staff_id, pin required' }, 400, cors);
  }
  const staffMap = await fetchStaffMap(env);
  const staff = staffMap[staff_id];
  if (!staff || staff.pin !== pin) {
    return jsonResponse({ error: 'Invalid PIN' }, 401, cors);
  }
  const data = await notionFetch(env, `/databases/${env.INVOICE_DB_ID}/query`, {
    method: 'POST',
    body: JSON.stringify({
      filter: { property: 'スタッフ', relation: { contains: staff_id } },
      sorts: [{ property: '対象月', direction: 'descending' }],
    })
  });
  const invoices = (data.results || []).map(r => formatInvoice(r, staffMap));
  return jsonResponse({ invoices, staffName: staff.name }, 200, cors);
}

// =====================================================
// Invoice info endpoint (returns staff folder ID, name, etc for Make.com)
// =====================================================

async function handleInvoiceInfo(invoiceId, url, env, cors) {
  const token = url.searchParams.get('token');
  if (token !== env.DASHBOARD_PASSWORD) {
    return jsonResponse({ error: 'Unauthorized' }, 401, cors);
  }

  const invoicePage = await notionFetch(env, `/pages/${invoiceId}`);
  const staffMap = await fetchStaffMap(env);
  const inv = formatInvoice(invoicePage, staffMap);
  const staff = staffMap[inv.staffId];

  if (!staff) {
    return jsonResponse({ error: 'Staff not found' }, 404, cors);
  }

  // スタッフ情報をフェッチして、DriveフォルダIDを取得
  const staffPage = await notionFetch(env, `/pages/${staff.id}`);
  const driveFolderId = (staffPage.properties['DriveフォルダID']?.rich_text || [])
    .map(t => t.plain_text).join('');

  // ファイル名（請求書No に拡張子付与）
  const filename = `${inv.invoiceNo}.pdf`;

  return jsonResponse({
    invoiceId: inv.id,
    invoiceNo: inv.invoiceNo,
    staffId: staff.id,
    staffName: staff.name,
    driveFolderId,
    filename,
    targetMonth: inv.targetMonth,
    htmlUrl: `${url.origin}/api/invoices/${inv.id}/html?token=${token}`,
  }, 200, cors);
}

async function handleSetDriveFile(invoiceId, request, url, env, cors) {
  const token = url.searchParams.get('token');
  if (token !== env.DASHBOARD_PASSWORD) {
    return jsonResponse({ error: 'Unauthorized' }, 401, cors);
  }
  const body = await request.json().catch(() => ({}));
  const { drive_file_id } = body;
  if (!drive_file_id) {
    return jsonResponse({ error: 'drive_file_id required' }, 400, cors);
  }
  await notionFetch(env, `/pages/${invoiceId}`, {
    method: 'PATCH',
    body: JSON.stringify({
      properties: {
        'Drive ファイルID': { rich_text: [{ text: { content: drive_file_id } }] },
      }
    })
  });
  return jsonResponse({ success: true }, 200, cors);
}

// =====================================================
// Invoice HTML rendering (for Make.com -> PDF conversion)
// =====================================================

async function handleInvoiceHtml(invoiceId, url, env) {
  // 認証: ?token=DASHBOARD_PASSWORD で照合
  const token = url.searchParams.get('token');
  if (token !== env.DASHBOARD_PASSWORD) {
    return new Response('Unauthorized', { status: 401 });
  }

  const invoicePage = await notionFetch(env, `/pages/${invoiceId}`);
  const staffMap = await fetchStaffMap(env);
  const inv = formatInvoice(invoicePage, staffMap);
  const staff = staffMap[inv.staffId];

  // バンク情報など追加プロパティを取得
  const staffPage = staff ? await notionFetch(env, `/pages/${staff.id}`) : null;
  const bankInfo = staffPage ? (staffPage.properties['振込先']?.rich_text || []).map(t => t.plain_text).join('\n') : '';

  const html = renderInvoiceHtml(inv, staff, bankInfo);
  return new Response(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
    }
  });
}

function renderInvoiceHtml(inv, staff, bankInfo) {
  const fmtYen = (n) => '¥' + Number(n || 0).toLocaleString('ja-JP');
  const fmtDate = (s) => {
    if (!s) return '-';
    const d = new Date(s);
    return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
  };

  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<title>${inv.invoiceNo}</title>
<style>
@page { size: A4; margin: 20mm; }
* { margin: 0; padding: 0; box-sizing: border-box; }
body {
  font-family: 'Noto Serif JP', 'Yu Mincho', '游明朝', serif;
  color: #2c2419;
  line-height: 1.6;
  font-size: 12pt;
  background: white;
  padding: 30mm 20mm;
}
.invoice-wrap {
  max-width: 720px;
  margin: 0 auto;
  background: white;
}
.header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  border-bottom: 2px solid #6b5641;
  padding-bottom: 16px;
  margin-bottom: 32px;
}
.title-block h1 {
  font-size: 28pt;
  font-weight: 500;
  letter-spacing: 0.15em;
  color: #6b5641;
  margin-bottom: 4px;
}
.title-block .sub {
  font-family: 'Cormorant Garamond', serif;
  font-size: 11pt;
  letter-spacing: 0.3em;
  color: #8fa085;
  text-transform: uppercase;
}
.meta-block {
  text-align: right;
  font-size: 10pt;
  color: #4d493f;
}
.meta-block .invoice-no {
  font-family: 'Cormorant Garamond', serif;
  font-size: 13pt;
  letter-spacing: 0.05em;
  color: #6b5641;
  margin-bottom: 6px;
}
.parties {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 32px;
  margin-bottom: 28px;
}
.party-block {
  font-size: 10pt;
}
.party-label {
  font-size: 9pt;
  color: #8f8a7c;
  letter-spacing: 0.15em;
  margin-bottom: 6px;
}
.party-name {
  font-size: 14pt;
  color: #6b5641;
  margin-bottom: 8px;
  letter-spacing: 0.05em;
}
.party-info {
  font-size: 9.5pt;
  color: #4d493f;
  line-height: 1.7;
  white-space: pre-line;
}
.summary-card {
  background: #faf7ef;
  border: 1px solid #e9e4d5;
  border-radius: 8px;
  padding: 22px 28px;
  margin-bottom: 28px;
}
.summary-row {
  display: flex;
  justify-content: space-between;
  padding: 6px 0;
  font-size: 10.5pt;
}
.summary-row.total {
  border-top: 1px solid #c9bba0;
  margin-top: 12px;
  padding-top: 16px;
  font-size: 13pt;
  font-weight: 500;
  color: #6b5641;
}
.summary-row .num {
  font-family: 'Cormorant Garamond', serif;
}
.detail-table {
  width: 100%;
  border-collapse: collapse;
  margin-bottom: 28px;
  font-size: 10pt;
}
.detail-table th, .detail-table td {
  padding: 10px 12px;
  text-align: left;
  border-bottom: 1px solid #e9e4d5;
}
.detail-table th {
  background: #f4f1e9;
  color: #4d493f;
  font-size: 9pt;
  font-weight: 500;
  letter-spacing: 0.1em;
}
.detail-table td.num {
  text-align: right;
  font-family: 'Cormorant Garamond', serif;
  color: #6b5641;
}
.bank-section {
  background: #faf7ef;
  border-left: 3px solid #8fa085;
  padding: 16px 20px;
  margin-bottom: 28px;
  font-size: 10pt;
  white-space: pre-line;
}
.bank-section .label {
  font-size: 9pt;
  color: #8f8a7c;
  letter-spacing: 0.15em;
  margin-bottom: 6px;
}
.notes {
  font-size: 9pt;
  color: #8f8a7c;
  margin-bottom: 24px;
  line-height: 1.8;
}
.footer {
  margin-top: 40px;
  text-align: center;
  font-size: 9pt;
  color: #8f8a7c;
  letter-spacing: 0.1em;
  border-top: 1px solid #e9e4d5;
  padding-top: 16px;
}
.footer .brand {
  font-family: 'Cormorant Garamond', serif;
  font-size: 11pt;
  letter-spacing: 0.3em;
  color: #6b5641;
  margin-bottom: 4px;
}
</style>
</head>
<body>
<div class="invoice-wrap">

  <div class="header">
    <div class="title-block">
      <h1>請求書</h1>
      <div class="sub">Invoice</div>
    </div>
    <div class="meta-block">
      <div class="invoice-no">${escapeHtml(inv.invoiceNo)}</div>
      <div>発行日: ${fmtDate(inv.closingDate)}</div>
      <div>支払期日: ${fmtDate(inv.paymentDueDate)}</div>
    </div>
  </div>

  <div class="parties">
    <div class="party-block">
      <div class="party-label">請求先</div>
      <div class="party-name">MinaTech 株式会社 御中</div>
      <div class="party-info">SORA - HAIR &amp; EYELASH -
〒253-0055
神奈川県茅ヶ崎市中海岸1丁目2-43
サザンマンションB棟 2F</div>
    </div>
    <div class="party-block" style="text-align:right;">
      <div class="party-label">請求者</div>
      <div class="party-name">${escapeHtml(staff?.name || '')}</div>
    </div>
  </div>

  <div class="summary-card">
    <div class="summary-row">
      <span>対象期間</span>
      <span>${fmtDate(inv.periodStart)} 〜 ${fmtDate(inv.periodEnd)}</span>
    </div>
    <div class="summary-row">
      <span>件数</span>
      <span class="num">${inv.visitCount} 件</span>
    </div>
    <div class="summary-row total">
      <span>ご請求金額（税込）</span>
      <span class="num">${fmtYen(inv.feeAmount)}</span>
    </div>
  </div>

  <table class="detail-table">
    <thead>
      <tr>
        <th>項目</th>
        <th style="text-align:right;">金額</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td>施術売上合計（税抜）</td>
        <td class="num">${fmtYen(inv.salesExclTax)}</td>
      </tr>
      <tr>
        <td>${Math.round((inv.commissionRate || 0) * 100)}% 報酬</td>
        <td class="num">${fmtYen(inv.feeAmount)}</td>
      </tr>
      <tr style="background:#faf7ef;">
        <td><strong>合計（税込）</strong></td>
        <td class="num"><strong>${fmtYen(inv.feeAmount)}</strong></td>
      </tr>
    </tbody>
  </table>

  ${bankInfo ? `
  <div class="bank-section">
    <div class="label">お振込先</div>
    ${escapeHtml(bankInfo)}
  </div>
  ` : ''}

  <div class="notes">
    ※本請求書は完全歩合契約に基づく報酬請求書です。<br>
    ※税抜売上の${Math.round((inv.commissionRate || 0) * 100)}%を報酬として請求しております。<br>
    ${inv.note ? '※' + escapeHtml(inv.note) + '<br>' : ''}
  </div>

  <div class="footer">
    <div class="brand">SORA - HAIR &amp; EYELASH -</div>
    <div>本書面に関するお問い合わせは MinaTech株式会社 までご連絡ください</div>
  </div>

</div>
</body>
</html>`;
}

function escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
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
