// ─── DASHBOARD ───────────────────────────────────────────────
let focusTrendChart = null;

async function loadDashboard() {
    await Promise.all([
        loadDashboardStats(),
        loadLiveFocus(),
        loadRecentTasks()
    ]);
}

async function loadDashboardStats() {
    try {
        const stats = await api('/stats');

        document.getElementById('val-productivity').textContent = stats.productivity_score + '%';
        document.getElementById('fill-productivity').style.width = stats.productivity_score + '%';
        document.getElementById('val-completed').textContent = stats.completed_tasks;
        document.getElementById('val-total').textContent = `of ${stats.total_tasks} total`;
        document.getElementById('val-pending').textContent = stats.pending_tasks;

        renderFocusTrendChart(stats.focus_trend);
    } catch (e) {
        console.error('Stats error:', e);
    }
}

async function loadLiveFocus() {
    try {
        const hour = new Date().getHours();
        const result = await api('/predict-focus', {
            method: 'POST',
            body: JSON.stringify({ hour_of_day: hour, difficulty: 3, estimated_time: 1.5 })
        });
        const badge = document.getElementById('live-focus-badge');
        badge.textContent = result.focus_level;
        badge.className = `focus-badge ${result.focus_level}`;
        document.getElementById('live-focus-conf').textContent =
            `${Math.round(result.confidence * 100)}% confidence`;
    } catch (e) { }
}

async function loadRecentTasks() {
    try {
        const tasks = await api('/tasks');
        const list = document.getElementById('recent-tasks-list');
        const recent = tasks.slice(0, 5);
        if (!recent.length) {
            list.innerHTML = '<div class="empty-state"><p>No tasks yet. Create your first task!</p></div>';
            return;
        }
        list.innerHTML = recent.map(t => `
      <div class="task-mini">
        <div>
          <div class="task-mini-title">${escHtml(t.title)}</div>
          <div class="task-mini-sub">${escHtml(t.subject)} · Due ${t.due_date}</div>
        </div>
        <span class="task-mini-badge badge-${t.status}">${t.status}</span>
      </div>
    `).join('');
    } catch (e) { }
}

function renderFocusTrendChart(focusTrend) {
    const ctx = document.getElementById('chart-focus-trend').getContext('2d');
    if (focusTrendChart) focusTrendChart.destroy();

    const days = Object.keys(focusTrend).sort().slice(-7);
    if (!days.length) {
        ctx.canvas.parentElement.innerHTML += '<p style="text-align:center;color:var(--text-muted);font-size:.8rem;padding:20px">No focus data yet — start predicting!</p>';
        return;
    }

    focusTrendChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: days.map(d => new Date(d).toLocaleDateString('en', { weekday: 'short', month: 'short', day: 'numeric' })),
            datasets: [
                {
                    label: 'HIGH',
                    data: days.map(d => focusTrend[d]?.HIGH || 0),
                    backgroundColor: 'rgba(34,197,94,0.7)',
                    borderRadius: 4
                },
                {
                    label: 'MEDIUM',
                    data: days.map(d => focusTrend[d]?.MEDIUM || 0),
                    backgroundColor: 'rgba(245,166,35,0.7)',
                    borderRadius: 4
                },
                {
                    label: 'LOW',
                    data: days.map(d => focusTrend[d]?.LOW || 0),
                    backgroundColor: 'rgba(239,68,68,0.7)',
                    borderRadius: 4
                }
            ]
        },
        options: chartDefaults({
            scales: {
                x: { stacked: true, grid: { display: false }, ticks: { color: '#8b95a8' } },
                y: { stacked: true, grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#8b95a8', stepSize: 1 } }
            }
        })
    });
}

function chartDefaults(extra = {}) {
    return {
        responsive: true,
        plugins: {
            legend: {
                labels: { color: '#8b95a8', font: { family: 'DM Mono', size: 11 } }
            }
        },
        ...extra
    };
}

// ─── ANALYTICS PAGE ─────────────────────────────────────────
let chartCompletions = null, chartSubjects = null, chartFocusDist = null;

async function loadAnalytics() {
    try {
        const stats = await api('/stats');
        renderCompletionsChart(stats.daily_completions);
        renderSubjectsChart(stats.subject_breakdown);
        renderFocusDistChart(stats.focus_trend);
    } catch (e) { console.error(e); }
}

function renderCompletionsChart(data) {
    const ctx = document.getElementById('chart-completions').getContext('2d');
    if (chartCompletions) chartCompletions.destroy();
    chartCompletions = new Chart(ctx, {
        type: 'line',
        data: {
            labels: data.map(d => d.day),
            datasets: [{
                label: 'Tasks Done',
                data: data.map(d => d.count),
                borderColor: '#f5a623',
                backgroundColor: 'rgba(245,166,35,0.1)',
                fill: true,
                tension: 0.4,
                pointBackgroundColor: '#f5a623',
                pointRadius: 4
            }]
        },
        options: chartDefaults({
            scales: {
                x: { grid: { display: false }, ticks: { color: '#8b95a8' } },
                y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#8b95a8', stepSize: 1 } }
            }
        })
    });
}

function renderSubjectsChart(data) {
    const ctx = document.getElementById('chart-subjects').getContext('2d');
    if (chartSubjects) chartSubjects.destroy();
    if (!data.length) return;
    chartSubjects = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: data.map(d => d.subject),
            datasets: [{
                data: data.map(d => d.total),
                backgroundColor: ['#f5a623', '#00d4ff', '#22c55e', '#a855f7', '#ef4444', '#f97316'],
                borderWidth: 0,
                hoverOffset: 6
            }]
        },
        options: chartDefaults({ cutout: '60%' })
    });
}

function renderFocusDistChart(focusTrend) {
    const ctx = document.getElementById('chart-focus-dist').getContext('2d');
    if (chartFocusDist) chartFocusDist.destroy();

    let high = 0, med = 0, low = 0;
    Object.values(focusTrend).forEach(d => {
        high += d.HIGH || 0;
        med += d.MEDIUM || 0;
        low += d.LOW || 0;
    });

    chartFocusDist = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: ['HIGH Focus', 'MEDIUM Focus', 'LOW Focus'],
            datasets: [{
                data: [high, med, low],
                backgroundColor: ['rgba(34,197,94,0.7)', 'rgba(245,166,35,0.7)', 'rgba(239,68,68,0.7)'],
                borderRadius: 6
            }]
        },
        options: chartDefaults({
            indexAxis: 'y',
            plugins: { legend: { display: false } },
            scales: {
                x: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#8b95a8' } },
                y: { grid: { display: false }, ticks: { color: '#8b95a8' } }
            }
        })
    });
}

// ─── SCHEDULE ────────────────────────────────────────────────
async function loadSchedule() {
    try {
        const data = await api('/schedule');
        renderSchedule(data);
    } catch (e) { }
}

async function generateSchedule() {
    showToast('Generating smart schedule…');
    try {
        const data = await api('/generate-schedule', { method: 'POST' });
        renderSchedule(data.schedule);
        showToast(`Schedule generated — ${data.schedule.length} slots`, 'success');
    } catch (e) { showToast(e.message, 'error'); }
}

function renderSchedule(items) {
    const list = document.getElementById('schedule-list');
    if (!items.length) {
        list.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">◷</div>
        <p>No schedule yet. Click "Generate Schedule" to create one!</p>
      </div>`;
        return;
    }
    list.innerHTML = items.map(s => `
    <div class="schedule-item">
      <div>
        <div class="schedule-time">${String(s.suggested_hour).padStart(2, '0')}:00</div>
        <div class="schedule-date">${s.suggested_date}</div>
      </div>
      <div class="schedule-info">
        <h4>${escHtml(s.task_title)}</h4>
        <p>${escHtml(s.subject)} · ${s.estimated_time}h · ${s.reason || ''}</p>
      </div>
      <div class="schedule-focus">
        <span class="focus-pill focus-${s.focus_level}">${s.focus_level}</span>
        ${s.confidence ? `<div style="font-size:.7rem;color:var(--text-muted);margin-top:4px;font-family:var(--font-mono)">${Math.round(s.confidence * 100)}%</div>` : ''}
      </div>
    </div>
  `).join('');
}

// ─── UTILS ───────────────────────────────────────────────────
function escHtml(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}