/**
 * SORA Dashboard - 認証管理
 */
const AUTH = {
    TOKEN_KEY: 'sora_dashboard_token',

    getToken() {
        return localStorage.getItem(this.TOKEN_KEY);
    },

    setToken(token) {
        localStorage.setItem(this.TOKEN_KEY, token);
    },

    clearToken() {
        localStorage.removeItem(this.TOKEN_KEY);
    },

    isAuthenticated() {
        return !!this.getToken();
    },

    async login(password) {
        const r = await fetch(`${CONFIG.API_BASE}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password })
        });
        if (!r.ok) {
            const err = await r.json().catch(() => ({}));
            throw new Error(err.error || 'Login failed');
        }
        const data = await r.json();
        this.setToken(data.token);
        return data.token;
    },

    logout() {
        this.clearToken();
        location.reload();
    }
};
