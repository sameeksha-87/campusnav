document.addEventListener("DOMContentLoaded", () => {
    const chatToggleBtn = document.getElementById("chat-toggle-btn");
    const chatWidget = document.getElementById("chat-widget-card");
    const chatCloseBtn = document.getElementById("chat-close-btn");
    const chatMessagesContainer = document.getElementById("chat-messages");
    const chatInput = document.getElementById("chat-input");
    const chatSendBtn = document.getElementById("chat-send-btn");
    const chatDebugToggle = document.getElementById("chat-debug-toggle");

    if (!chatToggleBtn || !chatWidget) return;

    let showDebug = true; // Enabled by default during development per prompt

    // Toggle chat widget view
    chatToggleBtn.addEventListener("click", () => {
        chatWidget.classList.toggle("hidden");
        if (!chatWidget.classList.contains("hidden")) {
            chatInput.focus();
        }
    });

    chatCloseBtn.addEventListener("click", () => {
        chatWidget.classList.add("hidden");
    });

    if (chatDebugToggle) {
        chatDebugToggle.addEventListener("change", (e) => {
            showDebug = e.target.checked;
            document.querySelectorAll(".chat-debug-box").forEach(box => {
                box.style.display = showDebug ? "block" : "none";
            });
        });
    }

    // Helper: append message
    function appendMessage(sender, text, matches = null) {
        const msgDiv = document.createElement("div");
        msgDiv.className = `chat-msg ${sender}-msg`;

        const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

        if (sender === "user") {
            msgDiv.innerHTML = `
                <div class="msg-bubble user-bubble">
                    <div class="msg-text">${escapeHtml(text)}</div>
                    <span class="msg-time">${timeStr}</span>
                </div>
            `;
        } else {
            let debugHtml = "";
            if (matches && matches.length > 0) {
                const matchItems = matches.map((m, idx) => `
                    <div class="debug-match-item">
                        <div class="match-rank">#${idx + 1} Match <span class="match-score">Similarity: ${m.score}</span></div>
                        <div class="match-q"><strong>Q:</strong> ${escapeHtml(m.question)}</div>
                        <div class="match-src"><span>Source: ${m.source}</span> | <span>${m.entity}</span></div>
                    </div>
                `).join("");

                debugHtml = `
                    <div class="chat-debug-box" style="display: ${showDebug ? 'block' : 'none'};">
                        <div class="debug-header"><i class="fa-solid fa-bug"></i> Top 3 Vector Matches (Cosine Sim)</div>
                        ${matchItems}
                    </div>
                `;
            }

            // Convert markdown bolding, italics, code blocks & linebreaks in answer
            const formattedAnswer = text
                .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
                .replace(/\*(.*?)\*/g, '<em>$1</em>')
                .replace(/`(.*?)`/g, '<code>$1</code>')
                .replace(/\n/g, '<br>');

            msgDiv.innerHTML = `
                <div class="msg-avatar"><i class="fa-solid fa-robot"></i></div>
                <div class="msg-bubble bot-bubble">
                    <div class="msg-text">${formattedAnswer}</div>
                    ${debugHtml}
                    <span class="msg-time">${timeStr}</span>
                </div>
            `;
        }

        chatMessagesContainer.appendChild(msgDiv);
        chatMessagesContainer.scrollTop = chatMessagesContainer.scrollHeight;
    }

    function appendTypingIndicator() {
        const typingDiv = document.createElement("div");
        typingDiv.className = "chat-msg bot-msg typing-msg";
        typingDiv.id = "chat-typing-indicator";
        typingDiv.innerHTML = `
            <div class="msg-avatar"><i class="fa-solid fa-robot"></i></div>
            <div class="msg-bubble bot-bubble typing-bubble">
                <span class="dot"></span><span class="dot"></span><span class="dot"></span>
            </div>
        `;
        chatMessagesContainer.appendChild(typingDiv);
        chatMessagesContainer.scrollTop = chatMessagesContainer.scrollHeight;
    }

    function removeTypingIndicator() {
        const el = document.getElementById("chat-typing-indicator");
        if (el) el.remove();
    }

    function escapeHtml(str) {
        return str
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    async function handleSendQuery(queryText) {
        const text = queryText || chatInput.value.trim();
        if (!text) return;

        appendMessage("user", text);
        chatInput.value = "";
        appendTypingIndicator();

        try {
            const apiEndpoint = window.location.port === "3000" ? "/query" : "http://localhost:3000/query";
            const response = await fetch(apiEndpoint, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ question: text })
            });

            removeTypingIndicator();

            if (!response.ok) {
                const errData = await response.json().catch(() => ({}));
                appendMessage("bot", `Sorry, I encountered an issue fetching the answer: ${errData.error || response.statusText}`);
                return;
            }

            const data = await response.json();
            appendMessage("bot", data.answer, data.matches);
        } catch (err) {
            removeTypingIndicator();
            appendMessage("bot", "Network error connecting to the Semantic RAG server. Make sure the backend is running (`npm run dev`).");
        }
    }

    chatSendBtn.addEventListener("click", () => handleSendQuery());
    chatInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
            e.preventDefault();
            handleSendQuery();
        }
    });

    // Quick Chip Listeners
    document.querySelectorAll(".chat-chip").forEach(chip => {
        chip.addEventListener("click", () => {
            const q = chip.getAttribute("data-question");
            handleSendQuery(q);
        });
    });
});
