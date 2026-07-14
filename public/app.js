const $ = (sel) => document.querySelector(sel);

let state = { channels: [], keywords: [] };

// ---------- Login ----------
function getPassword() {
  return localStorage.getItem("bugalert_password") || "";
}

function setPassword(pw) {
  localStorage.setItem("bugalert_password", pw);
}

async function apiFetch(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "x-app-password": getPassword(),
      ...(options.headers || {}),
    },
  });
  if (res.status === 401) {
    localStorage.removeItem("bugalert_password");
    showLogin("Senha incorreta. Tente novamente.");
    throw new Error("unauthorized");
  }
  return res.json();
}

function showLogin(errorMsg) {
  $("#login-screen").classList.remove("hidden");
  $("#app-screen").classList.add("hidden");
  $("#login-error").textContent = errorMsg || "";
}

function showApp() {
  $("#login-screen").classList.add("hidden");
  $("#app-screen").classList.remove("hidden");
  loadConfig();
  loadHistory();
}

$("#login-btn").addEventListener("click", async () => {
  const pw = $("#password-input").value.trim();
  if (!pw) return;
  setPassword(pw);
  try {
    await apiFetch("/api/config");
    showApp();
  } catch (e) {
    // erro já tratado no apiFetch
  }
});

$("#logout-btn").addEventListener("click", () => {
  localStorage.removeItem("bugalert_password");
  showLogin();
});

// ---------- Tabs ----------
document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".tab-content").forEach((c) => c.classList.remove("active"));
    btn.classList.add("active");
    $(`#tab-${btn.dataset.tab}`).classList.add("active");
    if (btn.dataset.tab === "history") loadHistory();
  });
});

// ---------- Config ----------
function renderChips(listEl, items, onRemove) {
  listEl.innerHTML = "";
  if (items.length === 0) {
    listEl.innerHTML = '<span class="hint">Nenhum ainda</span>';
    return;
  }
  items.forEach((item, idx) => {
    const chip = document.createElement("div");
    chip.className = "chip";
    chip.innerHTML = `<span>${item}</span>`;
    const removeBtn = document.createElement("button");
    removeBtn.textContent = "×";
    removeBtn.addEventListener("click", () => onRemove(idx));
    chip.appendChild(removeBtn);
    listEl.appendChild(chip);
  });
}

function renderConfig() {
  renderChips($("#channels-list"), state.channels, (idx) => {
    state.channels.splice(idx, 1);
    renderConfig();
  });
  renderChips($("#keywords-list"), state.keywords, (idx) => {
    state.keywords.splice(idx, 1);
    renderConfig();
  });
}

async function loadConfig() {
  try {
    const data = await apiFetch("/api/config");
    state.channels = data.channels || [];
    state.keywords = data.keywords || [];
    renderConfig();
  } catch (e) {}
}

$("#add-channel-btn").addEventListener("click", () => {
  const input = $("#channel-input");
  let val = input.value.trim().replace(/^@/, "");
  if (!val) return;
  if (!state.channels.includes(val)) state.channels.push(val);
  input.value = "";
  renderConfig();
});

$("#add-keyword-btn").addEventListener("click", () => {
  const input = $("#keyword-input");
  const val = input.value.trim();
  if (!val) return;
  if (!state.keywords.includes(val)) state.keywords.push(val);
  input.value = "";
  renderConfig();
});

$("#save-config-btn").addEventListener("click", async () => {
  const statusEl = $("#save-status");
  statusEl.textContent = "Salvando...";
  try {
    await apiFetch("/api/config", {
      method: "POST",
      body: JSON.stringify({ channels: state.channels, keywords: state.keywords }),
    });
    statusEl.textContent = "Salvo com sucesso ✔";
    setTimeout(() => (statusEl.textContent = ""), 3000);
  } catch (e) {
    statusEl.textContent = "Erro ao salvar";
  }
});

// ---------- History ----------
function timeAgo(iso) {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "agora mesmo";
  if (mins < 60) return `${mins} min atrás`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h atrás`;
  return `${Math.floor(hours / 24)}d atrás`;
}

async function loadHistory() {
  const listEl = $("#history-list");
  try {
    const data = await apiFetch("/api/history?limit=100");
    const items = data.items || [];
    if (items.length === 0) {
      listEl.innerHTML = '<div class="empty">Nenhum alerta encontrado ainda</div>';
      return;
    }
    listEl.innerHTML = items
      .map(
        (item) => `
      <div class="history-item">
        <div class="meta">
          <span>${item.channel}</span>
          <span>${timeAgo(item.timestamp)}</span>
        </div>
        <span class="keyword-badge">${item.keyword}</span>
        <div class="text">${escapeHtml(item.text)}</div>
        <a href="${item.link}" target="_blank" rel="noopener">Abrir no Telegram →</a>
      </div>
    `
      )
      .join("");
  } catch (e) {}
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

$("#refresh-history-btn").addEventListener("click", loadHistory);

$("#clear-history-btn").addEventListener("click", async () => {
  if (!confirm("Tem certeza que quer apagar todo o histórico?")) return;
  await apiFetch("/api/history", { method: "DELETE" });
  loadHistory();
});

// ---------- Init ----------
if (getPassword()) {
  apiFetch("/api/config")
    .then(() => showApp())
    .catch(() => showLogin());
} else {
  showLogin();
}

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch(() => {});
}
