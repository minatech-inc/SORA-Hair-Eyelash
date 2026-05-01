/**
 * SORA Dashboard - API クライアント
 */
const API = {
    async request(path) {
        const r = await fetch(`${CONFIG.API_BASE}${path}`, {
            headers: {
                'Authorization': `Bearer ${AUTH.getToken()}`,
                'Content-Type': 'application/json'
            }
        });
        if (r.status === 401) {
            AUTH.clearToken();
            location.reload();
            return null;
        }
        if (!r.ok) {
            const err = await r.json().catch(() => ({}));
            throw new Error(err.error || `API error ${r.status}`);
        }
        return r.json();
    },

    summary() { return this.request('/api/summary'); },
    sales() { return this.request('/api/sales'); },
    staff() { return this.request('/api/staff'); },
    menu() { return this.request('/api/menu'); },
    recent() { return this.request('/api/recent'); },

    // Attendance (auth required for read)
    attendanceToday() { return this.request('/api/attendance/today'); },
    attendanceSummary() { return this.request('/api/attendance/summary'); },

    // Public (no auth)
    async staffList() {
        const r = await fetch(`${CONFIG.API_BASE}/api/attendance/staff-list`);
        if (!r.ok) throw new Error('スタッフ一覧の取得に失敗');
        return r.json();
    },
    async punch(staffId, pin, type) {
        const r = await fetch(`${CONFIG.API_BASE}/api/attendance/punch`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ staff_id: staffId, pin, type }),
        });
        const data = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(data.error || '打刻に失敗しました');
        return data;
    },

    // Invoices (auth required for admin)
    invoiceList() { return this.request('/api/invoices/list'); },
    async invoiceGenerate(yearMonth, dryRun = false) {
        const r = await fetch(`${CONFIG.API_BASE}/api/invoices/generate`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${AUTH.getToken()}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ year_month: yearMonth, dry_run: dryRun }),
        });
        const data = await r.json();
        if (!r.ok) throw new Error(data.error || '生成失敗');
        return data;
    },
    async invoiceOwnerApprove(invoiceId) {
        return this._postAuth('/api/invoices/owner-approve', { invoice_id: invoiceId });
    },
    async invoiceReject(invoiceId, reason) {
        return this._postAuth('/api/invoices/reject', { invoice_id: invoiceId, reason });
    },
    async invoiceMarkPaid(invoiceId) {
        return this._postAuth('/api/invoices/mark-paid', { invoice_id: invoiceId });
    },
    async _postAuth(path, body) {
        const r = await fetch(`${CONFIG.API_BASE}${path}`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${AUTH.getToken()}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(body),
        });
        const data = await r.json();
        if (!r.ok) throw new Error(data.error || 'エラー');
        return data;
    },
    // Staff invoice (PIN auth)
    async staffInvoices(staffId, pin) {
        const r = await fetch(`${CONFIG.API_BASE}/api/invoices/staff-list`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ staff_id: staffId, pin }),
        });
        const data = await r.json();
        if (!r.ok) throw new Error(data.error || 'エラー');
        return data;
    },
    async staffApproveInvoice(invoiceId, staffId, pin) {
        const r = await fetch(`${CONFIG.API_BASE}/api/invoices/staff-approve`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ invoice_id: invoiceId, staff_id: staffId, pin }),
        });
        const data = await r.json();
        if (!r.ok) throw new Error(data.error || 'エラー');
        return data;
    }
};

const FORMAT = {
    yen(n) {
        if (n == null || isNaN(n)) return '¥0';
        return '¥' + Number(n).toLocaleString('ja-JP');
    },
    pct(n) {
        if (n == null || isNaN(n)) return '-';
        return (n > 0 ? '+' : '') + n + '%';
    },
    date(s) {
        if (!s) return '-';
        const d = new Date(s);
        return `${d.getMonth() + 1}/${d.getDate()}`;
    },
    dateLong(s) {
        if (!s) return '-';
        const d = new Date(s);
        return `${d.getFullYear()}/${(d.getMonth() + 1).toString().padStart(2, '0')}/${d.getDate().toString().padStart(2, '0')} ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
    },
    monthLabel(ym) {
        const [y, m] = ym.split('-');
        return `${y}/${m}`;
    }
};
