/**
 * SORA Dashboard - メインアプリケーション
 */
(function () {
    'use strict';

    let currentPage = 'home';
    const _cache = {};

    // ============================================
    // Initialization
    // ============================================
    function init() {
        if (!AUTH.isAuthenticated()) {
            showLogin();
            return;
        }
        showDashboard();
        bindNav();
        bindRefresh();
        bindLogout();
        loadPage('home');
    }

    function showLogin() {
        document.getElementById('login-screen').style.display = 'flex';
        document.querySelectorAll('.page').forEach(p => p.style.display = 'none');
        const form = document.getElementById('login-form');
        const errEl = document.getElementById('login-error');
        const btn = form.querySelector('button');
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            errEl.textContent = '';
            btn.disabled = true;
            btn.textContent = 'ログイン中...';
            try {
                await AUTH.login(document.getElementById('password').value);
                location.reload();
            } catch (err) {
                errEl.textContent = err.message || 'ログインに失敗しました';
                btn.disabled = false;
                btn.textContent = 'ログイン';
            }
        });
    }

    function showDashboard() {
        document.getElementById('login-screen').style.display = 'none';
    }

    // ============================================
    // Navigation
    // ============================================
    function bindNav() {
        document.querySelectorAll('.nav-item[data-page]').forEach(item => {
            item.addEventListener('click', (e) => {
                e.preventDefault();
                const page = item.getAttribute('data-page');
                if (page) navigateTo(page);
            });
        });
    }

    function navigateTo(page) {
        currentPage = page;
        document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
        document.querySelector(`.nav-item[data-page="${page}"]`)?.classList.add('active');
        document.querySelectorAll('.page').forEach(p => p.style.display = 'none');
        const el = document.getElementById(`page-${page}`);
        if (el) el.style.display = 'block';

        const titles = { home: 'ホーム', sales: '売上', staff: 'スタッフ', menu: 'メニュー' };
        document.getElementById('page-title').textContent = titles[page] || page;
        loadPage(page);
    }

    function bindRefresh() {
        document.getElementById('btn-refresh').addEventListener('click', () => {
            for (const k in _cache) delete _cache[k];
            loadPage(currentPage);
        });
    }

    function bindLogout() {
        document.getElementById('btn-logout').addEventListener('click', () => {
            AUTH.logout();
        });
    }

    // ============================================
    // Page loaders
    // ============================================
    async function loadPage(page) {
        showLoading(true);
        try {
            switch (page) {
                case 'home': await loadHome(); break;
                case 'sales': await loadSales(); break;
                case 'staff': await loadStaff(); break;
                case 'menu': await loadMenu(); break;
            }
            updateLastUpdated();
        } catch (err) {
            console.error('Load error:', err);
            alert('データ取得エラー: ' + err.message);
        } finally {
            showLoading(false);
        }
    }

    async function getCached(key, fetcher) {
        if (!_cache[key]) {
            _cache[key] = await fetcher();
        }
        return _cache[key];
    }

    async function loadHome() {
        const [summary, sales, recent] = await Promise.all([
            getCached('summary', () => API.summary()),
            getCached('sales', () => API.sales()),
            getCached('recent', () => API.recent())
        ]);

        // KPIs
        document.getElementById('kpi-this-month').textContent = FORMAT.yen(summary.thisMonth.sales);
        document.getElementById('kpi-this-visits').textContent = `${summary.thisMonth.visits}件`;
        document.getElementById('kpi-this-avg').textContent = `平均単価 ${FORMAT.yen(summary.thisMonth.avgPerVisit)}`;
        document.getElementById('kpi-ytd').textContent = FORMAT.yen(summary.ytd.sales);
        document.getElementById('kpi-customers').textContent = `${summary.customerCount}人`;

        const diffEl = document.getElementById('kpi-diff');
        if (summary.diffPercent != null) {
            const diffYen = FORMAT.yen(Math.abs(summary.diff));
            const sign = summary.diff >= 0 ? '↑' : '↓';
            diffEl.textContent = `前月比 ${sign} ${diffYen}（${FORMAT.pct(summary.diffPercent)}）`;
            diffEl.className = 'kpi-diff ' + (summary.diff >= 0 ? 'up' : 'down');
        } else {
            diffEl.textContent = '前月実績なし';
            diffEl.className = 'kpi-diff';
        }

        // Monthly chart
        makeLineChart(
            'chart-monthly',
            sales.monthSeries.map(d => FORMAT.monthLabel(d.month)),
            sales.monthSeries.map(d => d.sales),
            '月別売上'
        );

        // Daily chart (本月だけ)
        const thisMonth = sales.daySeries.filter(d => d.day.startsWith(summary.thisMonth.sales !== undefined ? new Date().toISOString().slice(0, 7) : ''));
        const dayData = thisMonth.length ? thisMonth : sales.daySeries;
        makeBarChart(
            'chart-daily',
            dayData.map(d => FORMAT.date(d.day)),
            dayData.map(d => d.sales),
            '日別売上'
        );

        // Recent table
        const tbody = document.querySelector('#recent-table tbody');
        tbody.innerHTML = recent.recent.map(r => `
            <tr>
                <td>${FORMAT.dateLong(r.date)}</td>
                <td>${escapeHtml(r.title)}</td>
                <td>${escapeHtml(r.staff || '-')}</td>
                <td>${escapeHtml(r.menu || '-')}</td>
                <td class="num">${FORMAT.yen(r.fee)}</td>
                <td><span class="tag">${escapeHtml(r.status || '-')}</span></td>
            </tr>
        `).join('') || '<tr><td colspan="6" style="text-align:center;color:#999;padding:2rem;">データなし</td></tr>';
    }

    async function loadSales() {
        const sales = await getCached('sales', () => API.sales());
        makeBarChart(
            'sales-monthly',
            sales.monthSeries.map(d => FORMAT.monthLabel(d.month)),
            sales.monthSeries.map(d => d.sales),
            '月別売上'
        );
        makeLineChart(
            'sales-daily',
            sales.daySeries.map(d => FORMAT.date(d.day)),
            sales.daySeries.map(d => d.sales),
            '日別売上'
        );
    }

    async function loadStaff() {
        const data = await getCached('staff', () => API.staff());
        const labels = data.staff.map(s => s.name);
        const sales = data.staff.map(s => s.sales);
        const counts = data.staff.map(s => s.count);

        makeHorizontalBarChart('staff-bar', labels, sales, 'スタッフ別売上');
        makePieChart('staff-pie', labels, counts, 'スタッフ別件数');

        const tbody = document.querySelector('#staff-table tbody');
        tbody.innerHTML = data.staff.map((s, i) => `
            <tr>
                <td>${i + 1}</td>
                <td>${escapeHtml(s.name)}</td>
                <td class="num">${FORMAT.yen(s.sales)}</td>
                <td class="num">${s.count}</td>
                <td class="num">${FORMAT.yen(s.count ? Math.floor(s.sales / s.count) : 0)}</td>
            </tr>
        `).join('') || '<tr><td colspan="5" style="text-align:center;color:#999;padding:2rem;">データなし</td></tr>';
    }

    async function loadMenu() {
        const data = await getCached('menu', () => API.menu());
        const top10 = data.menu.slice(0, 10);
        const labels = top10.map(m => m.name);
        const sales = top10.map(m => m.sales);
        const counts = top10.map(m => m.count);

        makeHorizontalBarChart('menu-bar', labels, sales, 'メニュー別売上');
        makePieChart('menu-pie', labels, counts, 'メニュー別件数');

        const tbody = document.querySelector('#menu-table tbody');
        tbody.innerHTML = data.menu.map((m, i) => `
            <tr>
                <td>${i + 1}</td>
                <td>${escapeHtml(m.name)}</td>
                <td class="num">${FORMAT.yen(m.sales)}</td>
                <td class="num">${m.count}</td>
                <td class="num">${FORMAT.yen(m.count ? Math.floor(m.sales / m.count) : 0)}</td>
            </tr>
        `).join('') || '<tr><td colspan="5" style="text-align:center;color:#999;padding:2rem;">データなし</td></tr>';
    }

    // ============================================
    // Utilities
    // ============================================
    function showLoading(show) {
        document.getElementById('loading').style.display = show ? 'flex' : 'none';
    }

    function updateLastUpdated() {
        const now = new Date();
        document.getElementById('last-updated').textContent =
            `最終更新: ${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
    }

    function escapeHtml(s) {
        if (!s) return '';
        return String(s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    // Start
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
