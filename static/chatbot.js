// ─── AI STUDY TUTOR CHAT ─────────────────────────────────────
const CHATBOT_EXTERNAL_URL = 'https://ai-learning-path-study.zapier.app/';
const chatHistory = [];

function openChatbotTab() {
    window.open(CHATBOT_EXTERNAL_URL, '_blank', 'noopener,noreferrer');
}

function sendSuggestion(btn) {
    const text = btn.textContent.trim();
    document.getElementById('chat-input').value = text;
    sendChatMessage();
}

function handleChatKey(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendChatMessage();
    }
}

function autoResizeChat(el) {
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 140) + 'px';
}

async function sendChatMessage() {
    const input = document.getElementById('chat-input');
    const text = input.value.trim();
    if (!text) return;

    // Hide suggestions after first message
    document.querySelector('.chat-suggestions').style.display = 'none';

    appendMsg('user', text);
    chatHistory.push({ role: 'user', content: text });
    input.value = '';
    input.style.height = 'auto';

    const sendBtn = document.getElementById('chat-send-btn');
    sendBtn.disabled = true;

    const typingEl = appendTyping();

    try {
        const response = await fetch('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrfToken() },
            credentials: 'include',
            body: JSON.stringify({ messages: chatHistory })
        });

        removeTyping(typingEl);

        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            appendMsg('bot', `Sorry, I couldn't connect. ${err.error || 'Please try again.'}`);
            return;
        }

        const data = await response.json();
        const reply = data.reply || 'Sorry, I got an empty response.';
        chatHistory.push({ role: 'assistant', content: reply });
        appendMsg('bot', reply);
    } catch (e) {
        removeTyping(typingEl);
        appendMsg('bot', 'Connection error. Make sure the server is running and try again.');
    } finally {
        sendBtn.disabled = false;
        input.focus();
    }
}

function appendMsg(role, text) {
    const messages = document.getElementById('chat-messages');
    const isBot = role === 'bot';

    const avatarHtml = isBot
        ? `<div class="chat-avatar bot-avatar">⬡</div>`
        : `<div class="chat-avatar user-avatar-chat">${(App.user?.username?.[0] || 'U').toUpperCase()}</div>`;

    const div = document.createElement('div');
    div.className = `chat-msg ${role}`;
    div.innerHTML = `
    ${avatarHtml}
    <div class="chat-bubble">${escHtml(text)}</div>
  `;
    messages.appendChild(div);
    messages.scrollTop = messages.scrollHeight;
    return div;
}

function appendTyping() {
    const messages = document.getElementById('chat-messages');
    const div = document.createElement('div');
    div.className = 'chat-msg bot';
    div.innerHTML = `
    <div class="chat-avatar bot-avatar">⬡</div>
    <div class="chat-bubble chat-typing">
      <span class="typing-dot"></span>
      <span class="typing-dot"></span>
      <span class="typing-dot"></span>
    </div>
  `;
    messages.appendChild(div);
    messages.scrollTop = messages.scrollHeight;
    return div;
}

function removeTyping(el) {
    el?.remove();
}

// Animate FAB on load
window.addEventListener('DOMContentLoaded', () => {
    const fab = document.querySelector('.chatbot-fab');
    if (!fab) return;
    setTimeout(() => {
        fab.style.transform = 'scale(1.15)';
        setTimeout(() => { fab.style.transform = ''; }, 300);
    }, 2000);
});