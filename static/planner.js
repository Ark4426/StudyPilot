// ─── PLANNER / TASKS ─────────────────────────────────────────
let allTasks = [];
let currentFilter = 'all';

async function loadTasks() {
    try {
        allTasks = await api('/tasks');
        renderTasks(allTasks);
    } catch (e) { showToast('Failed to load tasks', 'error'); }
}

function filterTasks(filter, btn) {
    currentFilter = filter;
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const filtered = filter === 'all' ? allTasks : allTasks.filter(t => t.status === filter);
    renderTasks(filtered);
}

function renderTasks(tasks) {
    const grid = document.getElementById('tasks-grid');
    if (!tasks.length) {
        grid.innerHTML = `
      <div class="empty-state" style="grid-column:1/-1">
        <div class="empty-icon">◫</div>
        <p>No tasks here. Add one to get started!</p>
      </div>`;
        return;
    }
    grid.innerHTML = tasks.map(t => buildTaskCard(t)).join('');
}

function buildTaskCard(t) {
    const dots = [1, 2, 3, 4, 5].map(i =>
        `<span class="dot${i <= t.difficulty ? ' filled' : ''}"></span>`
    ).join('');

    const dueClass = isDueUrgent(t.due_date) ? 'color:var(--red)' : '';

    return `
    <div class="task-card ${t.status === 'completed' ? 'completed' : ''}" id="task-${t.id}">
      <div class="task-card-top">
        <div class="task-card-title">${escHtml(t.title)}</div>
        <div class="task-card-actions">
          ${t.status !== 'completed' ? `<button class="icon-btn complete" onclick="completeTask(${t.id})" title="Mark done">✓</button>` : ''}
          <button class="icon-btn" onclick="openTaskModal(${t.id})" title="Edit">✎</button>
          <button class="icon-btn delete" onclick="deleteTask(${t.id})" title="Delete">✕</button>
        </div>
      </div>
      <div class="task-card-meta">
        <span class="meta-tag subject">${escHtml(t.subject)}</span>
        <span class="meta-tag due" style="${dueClass}">Due ${t.due_date}</span>
        <span class="meta-tag">${t.estimated_time}h</span>
      </div>
      <div style="display:flex;align-items:center;gap:6px;margin-top:4px">
        <span style="font-size:.72rem;color:var(--text-muted);font-family:var(--font-mono)">Difficulty</span>
        <div class="difficulty-dots">${dots}</div>
      </div>
      <div class="task-card-footer">
        <span class="task-mini-badge badge-${t.status}">${t.status}</span>
        <button class="btn-ghost" style="font-size:.75rem;padding:5px 10px"
          onclick="previewFocusForTask(${t.id},${t.difficulty},${t.estimated_time})">⚡ Focus</button>
      </div>
    </div>`;
}

function isDueUrgent(dateStr) {
    const due = new Date(dateStr);
    const today = new Date();
    const diff = (due - today) / (1000 * 60 * 60 * 24);
    return diff <= 2;
}

async function previewFocusForTask(taskId, difficulty, estimatedTime) {
    const hour = new Date().getHours();
    try {
        const result = await api('/predict-focus', {
            method: 'POST',
            body: JSON.stringify({ hour_of_day: hour, difficulty, estimated_time: estimatedTime, task_id: taskId })
        });
        const colors = { HIGH: 'var(--green)', MEDIUM: 'var(--accent)', LOW: 'var(--red)' };
        showToast(`Focus: ${result.focus_level} (${Math.round(result.confidence * 100)}%)`, 'success');
    } catch (e) { showToast(e.message, 'error'); }
}

// ─── TASK MODAL ──────────────────────────────────────────────
function openTaskModal(taskId = null) {
    const modal = document.getElementById('task-modal');
    document.getElementById('task-id').value = '';
    document.getElementById('task-title').value = '';
    document.getElementById('task-subject').value = '';
    document.getElementById('task-due').value = '';
    document.getElementById('task-difficulty').value = 3;
    document.getElementById('diff-val').textContent = 3;
    document.getElementById('task-time').value = 1.5;
    document.getElementById('task-priority').value = 3;
    document.getElementById('pri-val').textContent = 3;
    document.getElementById('focus-prediction-box').classList.add('hidden');
    document.getElementById('modal-title').textContent = taskId ? 'Edit Task' : 'New Task';

    if (taskId) {
        const t = allTasks.find(x => x.id === taskId);
        if (t) {
            document.getElementById('task-id').value = t.id;
            document.getElementById('task-title').value = t.title;
            document.getElementById('task-subject').value = t.subject;
            document.getElementById('task-due').value = t.due_date;
            document.getElementById('task-difficulty').value = t.difficulty;
            document.getElementById('diff-val').textContent = t.difficulty;
            document.getElementById('task-time').value = t.estimated_time;
            document.getElementById('task-priority').value = t.priority || 3;
            document.getElementById('pri-val').textContent = t.priority || 3;
        }
    }

    modal.classList.remove('hidden');
}

function closeTaskModal() {
    document.getElementById('task-modal').classList.add('hidden');
}

async function saveTask() {
    const id = document.getElementById('task-id').value;
    const payload = {
        title: document.getElementById('task-title').value.trim(),
        subject: document.getElementById('task-subject').value.trim(),
        due_date: document.getElementById('task-due').value,
        difficulty: parseInt(document.getElementById('task-difficulty').value),
        estimated_time: parseFloat(document.getElementById('task-time').value),
        priority: parseInt(document.getElementById('task-priority').value)
    };

    if (!payload.title || !payload.subject || !payload.due_date) {
        showToast('Please fill in all required fields', 'error');
        return;
    }

    try {
        if (id) {
            await api(`/tasks/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
            showToast('Task updated!');
        } else {
            await api('/tasks', { method: 'POST', body: JSON.stringify(payload) });
            showToast('Task created!');
        }
        closeTaskModal();
        await loadTasks();
    } catch (e) { showToast(e.message, 'error'); }
}

async function completeTask(id) {
    try {
        await api(`/tasks/${id}`, { method: 'PUT', body: JSON.stringify({ status: 'completed' }) });
        showToast('Task completed! 🎉');
        await loadTasks();
    } catch (e) { showToast(e.message, 'error'); }
}

async function deleteTask(id) {
    if (!confirm('Delete this task?')) return;
    try {
        await api(`/tasks/${id}`, { method: 'DELETE' });
        showToast('Task deleted');
        await loadTasks();
    } catch (e) { showToast(e.message, 'error'); }
}

// ─── INLINE FOCUS PREVIEW IN MODAL ──────────────────────────
async function previewFocus() {
    const hour = new Date().getHours();
    const difficulty = parseInt(document.getElementById('task-difficulty').value);
    const estimated_time = parseFloat(document.getElementById('task-time').value);

    try {
        const result = await api('/predict-focus', {
            method: 'POST',
            body: JSON.stringify({ hour_of_day: hour, difficulty, estimated_time })
        });

        const box = document.getElementById('focus-prediction-box');
        const level = document.getElementById('fp-level');
        const bars = document.getElementById('fp-bars');

        const colors = { HIGH: 'var(--green)', MEDIUM: 'var(--accent)', LOW: 'var(--red)' };
        level.textContent = result.focus_level;
        level.style.color = colors[result.focus_level];

        const probs = result.probabilities || {};
        bars.innerHTML = Object.entries(probs).map(([label, pct]) => `
      <div class="fp-bar-row">
        <span class="fp-bar-label">${label}</span>
        <div class="fp-bar-track">
          <div class="fp-bar-fill" style="width:${Math.round(pct * 100)}%;background:${colors[label]}"></div>
        </div>
        <span class="fp-bar-pct">${Math.round(pct * 100)}%</span>
      </div>
    `).join('');

        box.classList.remove('hidden');
    } catch (e) { showToast(e.message, 'error'); }
}