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
    recent() { return this.request('/api/recent'); }
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
