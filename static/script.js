// ─── GLOBAL STATE ───────────────────────────────────────────
const App = {
    user: null,
    currentPage: 'dashboard'
};

// ─── API HELPER ─────────────────────────────────────────────
// Django rejects POST/PUT/DELETE without the CSRF token from its cookie
function csrfToken() {
    return document.cookie.match(/(?:^|; )csrftoken=([^;]*)/)?.[1] || '';
}

async function api(path, options = {}) {
    const res = await fetch(path, {
        headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrfToken() },
        credentials: 'include',
        ...options
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data;
}

// ─── TOAST ──────────────────────────────────────────────────
let toastTimer;
function showToast(msg, type = 'success') {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.className = `toast ${type}`;
    t.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.add('hidden'), 3000);
}

// ─── AUTH ────────────────────────────────────────────────────
function switchTab(tab) {
    document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
    document.getElementById(`tab-${tab}`).classList.add('active');
    document.getElementById('form-login').classList.toggle('hidden', tab !== 'login');
    document.getElementById('form-signup').classList.toggle('hidden', tab !== 'signup');
}

async function doLogin() {
    const username = document.getElementById('login-username').value.trim();
    const password = document.getElementById('login-password').value;
    const errEl = document.getElementById('auth-error');
    errEl.textContent = '';
    try {
        const data = await api('/login', {
            method: 'POST',
            body: JSON.stringify({ username, password })
        });
        App.user = data;
        enterApp(data.username);
    } catch (e) {
        errEl.textContent = e.message;
    }
}

async function doSignup() {
    const username = document.getElementById('signup-username').value.trim();
    const email = document.getElementById('signup-email').value.trim();
    const password = document.getElementById('signup-password').value;
    const errEl = document.getElementById('signup-error');
    errEl.textContent = '';
    try {
        const data = await api('/signup', {
            method: 'POST',
            body: JSON.stringify({ username, email, password })
        });
        App.user = data;
        enterApp(data.username);
    } catch (e) {
        errEl.textContent = e.message;
    }
}

async function doLogout() {
    await api('/logout', { method: 'POST' });
    App.user = null;
    document.getElementById('app-shell').classList.add('hidden');
    document.getElementById('auth-screen').classList.remove('hidden');
}

function enterApp(username) {
    document.getElementById('auth-screen').classList.add('hidden');
    document.getElementById('app-shell').classList.remove('hidden');
    document.getElementById('sidebar-username').textContent = username;
    document.getElementById('sidebar-avatar').textContent = username[0].toUpperCase();
    setGreeting();
    navigate('dashboard');
}

function setGreeting() {
    const h = new Date().getHours();
    const greet = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
    document.getElementById('dashboard-greeting').textContent = `${greet} — ready to focus?`;
}

// ─── NAVIGATION ─────────────────────────────────────────────
function navigate(page) {
    document.querySelectorAll('.page').forEach(p => p.classList.add('hidden'));
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    document.getElementById(`page-${page}`).classList.remove('hidden');
    document.querySelector(`[data-page="${page}"]`)?.classList.add('active');
    App.currentPage = page;

    if (page === 'dashboard') loadDashboard();
    if (page === 'planner') loadTasks();
    if (page === 'schedule') loadSchedule();
    if (page === 'analytics') loadAnalytics();
}

// ─── KEYBOARD SHORTCUTS ──────────────────────────────────────
document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeTaskModal();
});

// ─── AUTO-LOGIN CHECK ────────────────────────────────────────
window.addEventListener('DOMContentLoaded', async () => {
    try {
        const data = await api('/me');
        App.user = data;
        enterApp(data.username);
    } catch {
        // not logged in, show auth
    }
});

// ─── ENTER KEY SUPPORT ───────────────────────────────────────
document.getElementById('login-password').addEventListener('keydown', e => {
    if (e.key === 'Enter') doLogin();
});