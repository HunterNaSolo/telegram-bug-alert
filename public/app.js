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

const TAG_COLORS = ["#ff6b6b", "#4ecdc4", "#ffd93d", "#a78bfa", "#38bdf8", "#fb923c", "#a3e635", "#f472b6"];

function tagColor(tag) {
  let hash = 0;
  for (let i = 0; i < tag.length; i++) hash = tag.charCodeAt(i) + ((hash << 5) - hash);
  return TAG_COLORS[Math.abs(hash) % TAG_COLORS.length];
}

let allHistoryItems = [];

function populateHistoryKeywordFilter() {
  const select = $("#history-keyword-filter");
  const current = select.value;
  const keywords = [...new Set(allHistoryItems.map((i) => i.keyword).filter(Boolean))];
  select.innerHTML = '<option value="">Todas as palavras-chave</option>';
  keywords.forEach((k) => {
    const opt = document.createElement("option");
    opt.value = k;
    opt.textContent = k;
    select.appendChild(opt);
  });
  select.value = keywords.includes(current) ? current : "";
}

function renderHistoryList() {
  const listEl = $("#history-list");
  const filter = $("#history-keyword-filter").value;
  const items = filter ? allHistoryItems.filter((i) => i.keyword === filter) : allHistoryItems;

  if (items.length === 0) {
    listEl.innerHTML = '<div class="empty">Nenhum alerta encontrado com esse filtro</div>';
    return;
  }
  listEl.innerHTML = items
    .map((item) => {
      const priceHtml =
        typeof item.price === "number"
          ? `<span class="deal-price-label">Preço encontrado</span><div class="deal-price">${formatMoney(item.price)}</div>`
          : "";
      return `
    <div class="deal-card">
      <div class="deal-card-header">
        <div class="deal-card-header-left">
          <span class="deal-tag" style="background:${tagColor(item.keyword)}">${escapeHtml(item.keyword)}</span>
          <span class="deal-channel">${escapeHtml(item.channel)}</span>
        </div>
        <span class="deal-time">${timeAgo(item.timestamp)}</span>
      </div>
      ${priceHtml}
      <div class="deal-text">${escapeHtml(item.text)}</div>
      <a class="deal-link" href="${item.link}" target="_blank" rel="noopener">Abrir no Telegram →</a>
    </div>
  `;
    })
    .join("");
}

async function loadHistory() {
  try {
    const data = await apiFetch("/api/history?limit=100");
    allHistoryItems = data.items || [];
    populateHistoryKeywordFilter();
    renderHistoryList();
  } catch (e) {
    console.error(e);
  }
}

$("#history-keyword-filter").addEventListener("change", renderHistoryList);

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
      <div class="deal-card">
        <div class="deal-card-header">
          <div class="deal-card-header-left">
            <span class="deal-tag" style="background:#4ecdc4">CUPOM</span>
            <span class="deal-channel">${escapeHtml(item.channel)}${storeLabel}</span>
          </div>
          <span class="deal-time">${timeLeft(item.timestamp)}</span>
        </div>
        ${codeBox}
        <div class="deal-text">${escapeHtml(item.text)}</div>
        <div class="coupon-actions">
          ${storeLinkBtn}
          <a class="deal-link" href="${item.link}" target="_blank" rel="noopener">Ver no Telegram →</a>
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

function formatMoney(v) {
  return `R$ ${v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function productLabel(text) {
  const firstLine = (text || "").split("\n").map((l) => l.trim()).find(Boolean) || "";
  return firstLine.length > 70 ? firstLine.slice(0, 70) + "…" : firstLine;
}

function extractSize(text) {
  const match = (text || "").match(/(\d+(?:[.,]\d+)?)\s?(ml|mililitros?|l|litros?|kg|quilos?|g|gramas?)\b/i);
  if (!match) return null;
  const num = match[1].replace(",", ".");
  const unitRaw = match[2].toLowerCase();
  let unit = "UN";
  if (unitRaw.startsWith("ml") || unitRaw.startsWith("mili")) unit = "ML";
  else if (unitRaw.startsWith("l")) unit = "L";
  else if (unitRaw.startsWith("kg") || unitRaw.startsWith("quilo")) unit = "KG";
  else if (unitRaw.startsWith("g")) unit = "G";
  // normaliza "5.0" -> "5", e garante que vírgula/ponto viram sempre a mesma chave
  const cleanNum = parseFloat(num).toString();
  return `${cleanNum}${unit}`;
}

function groupingKey(text) {
  // Agrupa por tamanho/quantidade quando dá pra identificar (ex: "5L", "900ML")
  // — é o que geralmente diferencia produtos que caem na mesma tag, tipo
  // sabão de 900ml vs 5L. Sem tamanho identificável, cai pro texto resumido.
  return extractSize(text) || productLabel(text);
}

function populateTagFilter(allItems) {
  const select = $("#chart-product-filter");
  const current = select.value;
  const channelFilter = $("#chart-channel-filter").value;

  const pool = channelFilter ? allItems.filter((i) => i.channel === channelFilter) : allItems;
  const seen = new Set();
  const tags = [];
  pool.forEach((item) => {
    const tag = item.keyword;
    if (tag && !seen.has(tag)) {
      seen.add(tag);
      tags.push(tag);
    }
  });

  select.innerHTML = '<option value="">Todas as tags</option>';
  tags.forEach((t) => {
    const opt = document.createElement("option");
    opt.value = t;
    opt.textContent = t;
    select.appendChild(opt);
  });
  select.value = tags.includes(current) ? current : "";
}

function updateSummary(items) {
  const summaryEl = $("#chart-summary");
  if (items.length === 0) {
    summaryEl.classList.add("hidden");
    return;
  }
  summaryEl.classList.remove("hidden");
  const prices = items.map((i) => i.price);
  const current = prices[prices.length - 1];
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const first = prices[0];
  const changePct = first === 0 ? 0 : ((current - first) / first) * 100;

  $("#stat-current").textContent = formatMoney(current);
  $("#stat-min").textContent = formatMoney(min);
  $("#stat-max").textContent = formatMoney(max);

  const changeEl = $("#stat-change");
  const sign = changePct > 0 ? "+" : "";
  changeEl.textContent = `${sign}${changePct.toFixed(1)}%`;
  changeEl.className = "chart-stat-value " + (changePct < 0 ? "stat-low" : changePct > 0 ? "stat-high" : "");
}

function renderPricePattern(items) {
  const prices = items.map((i) => i.price);
  const min = Math.min(...prices);
  const threshold = min * 1.05; // considera "perto da mínima" até 5% acima dela
  const lows = items
    .filter((i) => i.price <= threshold)
    .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

  const freqPct = (lows.length / items.length) * 100;
  $("#stat-freq").textContent = `${lows.length} de ${items.length} (${freqPct.toFixed(0)}%)`;

  const lastLow = lows[lows.length - 1];
  $("#stat-last-low").textContent = lastLow
    ? new Date(lastLow.timestamp).toLocaleDateString("pt-BR")
    : "—";

  const noteEl = $("#chart-pattern-note");

  if (lows.length < 2) {
    $("#stat-interval").textContent = "—";
    $("#stat-next-low").textContent = "—";
    noteEl.textContent =
      "Só vimos o preço perto da mínima 1 vez (ou nenhuma) até agora — ainda não dá pra estimar um intervalo. Quanto mais alertas forem chegando, mais confiável essa estimativa fica.";
    return;
  }

  const gaps = [];
  for (let i = 1; i < lows.length; i++) {
    const days = (new Date(lows[i].timestamp) - new Date(lows[i - 1].timestamp)) / 86400000;
    gaps.push(days);
  }
  const avgGapDays = gaps.reduce((a, b) => a + b, 0) / gaps.length;

  $("#stat-interval").textContent = `${Math.round(avgGapDays)} dia(s)`;

  const nextEstimate = new Date(new Date(lastLow.timestamp).getTime() + avgGapDays * 86400000);
  const today = new Date();
  const daysFromNow = Math.round((nextEstimate - today) / 86400000);

  $("#stat-next-low").textContent = nextEstimate.toLocaleDateString("pt-BR");

  noteEl.textContent =
    daysFromNow > 0
      ? `Baseado no padrão até agora (${lows.length} vezes perto da mínima, a cada ${Math.round(avgGapDays)} dias em média), a próxima janela parecida deve ficar perto de ${nextEstimate.toLocaleDateString("pt-BR")} — não é garantido, é só o retrato do que já aconteceu.`
      : `O padrão sugere que já passou da janela esperada — pode ser que role de novo a qualquer momento, ou o padrão mudou. Isso não é uma previsão confiável, só um retrato do histórico.`;
}

async function loadChart() {
  const canvas = $("#price-chart");
  const emptyMsg = $("#chart-empty");
  const summaryEl = $("#chart-summary");

  try {
    populateChannelFilter();
    const data = await apiFetch("/api/history?limit=2000");
    let allItems = (data.items || []).filter((i) => typeof i.price === "number");

    const periodDays = parseInt($("#chart-period-filter").value, 10);
    if (periodDays > 0) {
      const cutoff = Date.now() - periodDays * 24 * 60 * 60 * 1000;
      allItems = allItems.filter((i) => new Date(i.timestamp).getTime() >= cutoff);
    }

    populateTagFilter(allItems);

    let items = allItems;
    const filterChannel = $("#chart-channel-filter").value;
    if (filterChannel) {
      items = items.filter((i) => i.channel === filterChannel);
    }
    const filterTag = $("#chart-product-filter").value;
    if (filterTag) {
      items = items.filter((i) => i.keyword === filterTag);
    }

    items.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

    if (items.length === 0) {
      canvas.classList.add("hidden");
      emptyMsg.classList.remove("hidden");
      summaryEl.classList.add("hidden");
      emptyMsg.textContent = "Nenhum preço detectado ainda nos alertas encontrados";
      if (priceChartInstance) {
        priceChartInstance.destroy();
        priceChartInstance = null;
      }
      return;
    }
    canvas.classList.remove("hidden");
    emptyMsg.classList.add("hidden");

    // Mostra resumo e padrão da mínima quando uma tag específica está selecionada
    const patternCard = $("#chart-pattern-card");
    if (filterTag) {
      updateSummary(items);
      renderPricePattern(items);
      patternCard.classList.remove("hidden");
    } else {
      summaryEl.classList.add("hidden");
      patternCard.classList.add("hidden");
    }

    // agrupa por canal, um dataset (linha) por grupo
    const byChannel = {};
    items.forEach((item) => {
      if (!byChannel[item.channel]) byChannel[item.channel] = [];
      byChannel[item.channel].push({
        x: item.timestamp,
        y: item.price,
      });
    });

    if (typeof Chart === "undefined") {
      throw new Error("Biblioteca de gráficos não carregou (Chart.js).");
    }

    const channelNames = Object.keys(byChannel);
    const datasets = channelNames.map((channel, idx) => {
      const color = CHART_COLORS[idx % CHART_COLORS.length];
      return {
        label: channel,
        data: byChannel[channel],
        borderColor: color,
        borderWidth: 2.5,
        pointRadius: 3,
        pointHoverRadius: 6,
        pointBackgroundColor: color,
        pointBorderColor: "#0f0f14",
        pointBorderWidth: 1.5,
        tension: 0.3,
        spanGaps: true,
        fill: true,
        backgroundColor: (ctx) => {
          const { chart } = ctx;
          const { ctx: c, chartArea } = chart;
          if (!chartArea) return `${color}22`;
          const gradient = c.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
          gradient.addColorStop(0, `${color}55`);
          gradient.addColorStop(1, `${color}02`);
          return gradient;
        },
      };
    });

    if (priceChartInstance) {
      priceChartInstance.destroy();
    }

    priceChartInstance = new Chart(canvas, {
      type: "line",
      data: { datasets },
      options: {
        responsive: true,
        interaction: { mode: "index", intersect: false },
        scales: {
          x: {
            type: "time",
            time: { tooltipFormat: "dd/MM HH:mm" },
            ticks: { color: "#9a9aa5" },
            grid: { color: "#20202a" },
            border: { color: "#2a2a34" },
          },
          y: {
            ticks: { color: "#9a9aa5", callback: (v) => `R$ ${v}` },
            grid: { color: "#20202a" },
            border: { color: "#2a2a34" },
          },
        },
        plugins: {
          legend: {
            display: channelNames.length > 1,
            labels: { color: "#f1f1f1", usePointStyle: true, boxWidth: 8 },
          },
          tooltip: {
            backgroundColor: "#1a1a22",
            titleColor: "#f1f1f1",
            bodyColor: "#f1f1f1",
            borderColor: "#2a2a34",
            borderWidth: 1,
            padding: 10,
            displayColors: true,
            callbacks: {
              label: (ctx) => `${ctx.dataset.label}: ${formatMoney(ctx.parsed.y)}`,
            },
          },
        },
      },
    });
  } catch (e) {
    console.error(e);
    canvas.classList.add("hidden");
    summaryEl.classList.add("hidden");
    emptyMsg.classList.remove("hidden");
    emptyMsg.textContent = `Não foi possível carregar o gráfico: ${e.message}`;
  }
}

$("#chart-channel-filter").addEventListener("change", loadChart);
$("#chart-product-filter").addEventListener("change", loadChart);
$("#chart-period-filter").addEventListener("change", loadChart);

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
