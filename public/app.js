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
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000); // 15s

  let res;
  try {
    res = await fetch(path, {
      ...options,
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        "x-app-password": getPassword(),
        ...(options.headers || {}),
      },
    });
  } catch (networkErr) {
    throw new Error(
      networkErr.name === "AbortError"
        ? "O servidor demorou demais pra responder (timeout)."
        : "Não foi possível conectar ao servidor."
    );
  } finally {
    clearTimeout(timeoutId);
  }

  if (res.status === 401) {
    localStorage.removeItem("bugalert_password");
    showLogin("Senha incorreta. Tente novamente.");
    throw new Error("unauthorized");
  }

  if (!res.ok) {
    let detail = `Erro do servidor (HTTP ${res.status}).`;
    try {
      const body = await res.json();
      if (body?.error) detail = body.error;
    } catch (_) {
      // resposta não era JSON (ex: página de erro do Vercel) — mantém a mensagem padrão
    }
    throw new Error(detail);
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
  $("#login-error").textContent = "Entrando...";
  try {
    await apiFetch("/api/config");
    showApp();
  } catch (e) {
    if (e.message !== "unauthorized") {
      $("#login-error").textContent = e.message;
    }
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
    if (btn.dataset.tab === "coupons") loadCoupons();
    if (btn.dataset.tab === "chart") loadChart();
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
  } catch (e) { console.error(e); }
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
  } catch (e) { console.error(e); }
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

// ---------- Coupons ----------
function timeLeft(timestamp) {
  const expiresAt = new Date(timestamp).getTime() + 24 * 60 * 60 * 1000;
  const diffMs = expiresAt - Date.now();
  if (diffMs <= 0) return "expirando...";
  const hours = Math.floor(diffMs / 3600000);
  const mins = Math.floor((diffMs % 3600000) / 60000);
  return `expira em ${hours}h ${mins}min`;
}

async function loadCoupons() {
  const listEl = $("#coupons-list");
  try {
    const data = await apiFetch("/api/coupons");
    const items = data.items || [];
    if (items.length === 0) {
      listEl.innerHTML = '<div class="empty">Nenhum cupom ativo no momento</div>';
      return;
    }
    listEl.innerHTML = items
      .map((item) => {
        const storeLabel = item.store ? ` · ${item.store}` : "";
        const codeBox = item.couponCode
          ? `<div class="coupon-code-box">
               <span class="coupon-code-label">Código</span>
               <span class="coupon-code">${escapeHtml(item.couponCode)}</span>
               <button class="copy-code-btn" data-code="${escapeHtml(item.couponCode)}">Copiar</button>
             </div>`
          : "";
        const storeLinkBtn = item.storeLink
          ? `<a href="${item.storeLink}" target="_blank" rel="noopener" class="store-link-btn">Ir para a loja →</a>`
          : "";
        return `
      <div class="history-item coupon-card">
        <div class="meta">
          <span>${item.channel}${storeLabel}</span>
          <span>${timeLeft(item.timestamp)}</span>
        </div>
        <span class="keyword-badge" style="background:#2a9d8f;">CUPOM</span>
        ${codeBox}
        <div class="text">${escapeHtml(item.text)}</div>
        <div class="coupon-actions">
          ${storeLinkBtn}
          <a href="${item.link}" target="_blank" rel="noopener">Ver no Telegram →</a>
        </div>
      </div>
    `;
      })
      .join("");
  } catch (e) { console.error(e); }
}

$("#coupons-list").addEventListener("click", async (ev) => {
  const btn = ev.target.closest(".copy-code-btn");
  if (!btn) return;
  try {
    await navigator.clipboard.writeText(btn.dataset.code);
    const original = btn.textContent;
    btn.textContent = "Copiado ✔";
    setTimeout(() => (btn.textContent = original), 1500);
  } catch (e) {
    console.error(e);
  }
});

$("#refresh-coupons-btn").addEventListener("click", loadCoupons);

// ---------- Chart ----------
let priceChartInstance = null;
const CHART_COLORS = ["#e63946", "#457b9d", "#2a9d8f", "#e9c46a", "#a855f7", "#f4a261"];

function populateChannelFilter() {
  const select = $("#chart-channel-filter");
  const current = select.value;
  select.innerHTML = '<option value="">Todos os grupos</option>';
  state.channels.forEach((c) => {
    const opt = document.createElement("option");
    opt.value = c;
    opt.textContent = c;
    select.appendChild(opt);
  });
  select.value = current || "";
}

async function loadChart() {
  populateChannelFilter();
  const data = await apiFetch("/api/history?limit=200");
  let items = (data.items || []).filter((i) => typeof i.price === "number");

  const filterChannel = $("#chart-channel-filter").value;
  if (filterChannel) {
    items = items.filter((i) => i.channel === filterChannel);
  }

  items.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

  const canvas = $("#price-chart");
  const emptyMsg = $("#chart-empty");

  if (items.length === 0) {
    canvas.classList.add("hidden");
    emptyMsg.classList.remove("hidden");
    if (priceChartInstance) {
      priceChartInstance.destroy();
      priceChartInstance = null;
    }
    return;
  }
  canvas.classList.remove("hidden");
  emptyMsg.classList.add("hidden");

  // agrupa por canal, um dataset (linha) por grupo
  const byChannel = {};
  items.forEach((item) => {
    if (!byChannel[item.channel]) byChannel[item.channel] = [];
    byChannel[item.channel].push({
      x: item.timestamp,
      y: item.price,
    });
  });

  const datasets = Object.keys(byChannel).map((channel, idx) => ({
    label: channel,
    data: byChannel[channel],
    borderColor: CHART_COLORS[idx % CHART_COLORS.length],
    backgroundColor: CHART_COLORS[idx % CHART_COLORS.length],
    tension: 0.2,
    spanGaps: true,
  }));

  if (priceChartInstance) {
    priceChartInstance.destroy();
  }

  priceChartInstance = new Chart(canvas, {
    type: "line",
    data: { datasets },
    options: {
      responsive: true,
      scales: {
        x: {
          type: "time",
          time: { tooltipFormat: "dd/MM HH:mm" },
          ticks: { color: "#9a9aa5" },
          grid: { color: "#2a2a34" },
        },
        y: {
          ticks: { color: "#9a9aa5", callback: (v) => `R$ ${v}` },
          grid: { color: "#2a2a34" },
        },
      },
      plugins: {
        legend: { labels: { color: "#f1f1f1" } },
      },
    },
  });
}

$("#chart-channel-filter").addEventListener("change", loadChart);

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
