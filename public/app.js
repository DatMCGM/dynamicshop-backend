// ════════════════════════════════════════════════════════════
//  DynamicShop Exchange — Frontend Logic
// ════════════════════════════════════════════════════════════

const socket = io();
let allItems = [];
let selectedMaterial = null;
let currentRangeHours = 24;
let priceChart = null;
let adminToken = null;

const fmtUSD = (n) => '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtPct = (n) => (n >= 0 ? '+' : '') + Number(n).toFixed(1) + '%';
const fmtNum = (n) => Number(n).toLocaleString('en-US');

function colorForChange(pct) {
  if (pct > 0.3) return 'up';
  if (pct < -0.3) return 'down';
  return 'flat';
}

// ── Connection status ─────────────────────────────────────
socket.on('connect', () => {
  document.getElementById('connDot').classList.add('live');
  document.getElementById('connText').textContent = 'Trực tiếp';
});
socket.on('disconnect', () => {
  document.getElementById('connDot').classList.remove('live');
  document.getElementById('connText').textContent = 'Mất kết nối';
});

// ── Load initial data ─────────────────────────────────────
async function loadItems() {
  try {
    const res = await fetch('/api/items');
    allItems = await res.json();

    if (allItems.length === 0) {
      document.getElementById('itemGrid').innerHTML =
        '<div class="empty-state">Chưa có dữ liệu. Hãy đảm bảo plugin DynamicShop đang chạy và kết nối tới backend này.</div>';
      return;
    }

    if (!selectedMaterial) selectedMaterial = allItems[0].material;

    renderItemGrid();
    renderTicker();
    renderChart();
    populateAdminSelect();
  } catch (err) {
    console.error('Lỗi tải items:', err);
  }
}

async function loadTopMovers() {
  try {
    const res = await fetch('/api/top-movers?limit=8');
    const movers = await res.json();
    renderTopMovers(movers);
  } catch (err) {
    console.error('Lỗi tải top movers:', err);
  }
}

async function loadRecentTx() {
  try {
    const res = await fetch('/api/transactions?limit=20');
    const txs = await res.json();
    renderRecentTx(txs);
  } catch (err) {
    console.error('Lỗi tải giao dịch:', err);
  }
}

// ── Render: Ticker bar ────────────────────────────────────
function renderTicker() {
  const track = document.getElementById('tickerTrack');
  const doubled = [...allItems, ...allItems];
  track.innerHTML = doubled.map(item => {
    const cls = colorForChange(item.buy_change_percent);
    const arrow = cls === 'up' ? '▲' : cls === 'down' ? '▼' : '–';
    return `
      <span class="ticker-item">
        <span class="sym">${item.material}</span>
        <span class="val">${fmtUSD(item.current_buy)}</span>
        <span class="chg ${cls}">${arrow} ${fmtPct(item.buy_change_percent)}</span>
      </span>`;
  }).join('');
}

// ── Render: Item grid ─────────────────────────────────────
function renderItemGrid() {
  const grid = document.getElementById('itemGrid');
  document.getElementById('itemCount').textContent = allItems.length + ' items';

  grid.innerHTML = allItems.map(item => {
    const cls = colorForChange(item.buy_change_percent);
    const selected = item.material === selectedMaterial ? 'selected' : '';
    return `
      <div class="item-card ${selected}" data-material="${item.material}">
        <div class="name">${item.display_name}</div>
        <div class="mat">${item.material}</div>
        <div class="price-row">
          <span class="price">${fmtUSD(item.current_buy)}</span>
          <span class="chg ${cls}">${fmtPct(item.buy_change_percent)}</span>
        </div>
      </div>`;
  }).join('');

  grid.querySelectorAll('.item-card').forEach(card => {
    card.addEventListener('click', () => {
      selectedMaterial = card.dataset.material;
      renderItemGrid();
      renderChart();
    });
  });
}

// ── Render: Top movers ────────────────────────────────────
function renderTopMovers(movers) {
  const el = document.getElementById('topMovers');
  if (!movers.length) {
    el.innerHTML = '<div class="empty-state">Chưa có dữ liệu</div>';
    return;
  }
  el.innerHTML = movers.map((item, i) => {
    const cls = colorForChange(item.buy_change_percent);
    return `
      <div class="mover-row">
        <span class="mover-rank">${i + 1}</span>
        <span class="mover-name">${item.display_name}</span>
        <span class="chg ${cls}">${fmtPct(item.buy_change_percent)}</span>
      </div>`;
  }).join('');
}

// ── Render: Recent transactions ───────────────────────────
function renderRecentTx(txs) {
  const el = document.getElementById('recentTx');
  if (!txs.length) {
    el.innerHTML = '<div class="empty-state">Chưa có giao dịch nào</div>';
    return;
  }
  el.innerHTML = txs.map(tx => {
    const typeClass = tx.type === 'BUY' ? 'buy' : 'sell';
    const typeLabel = tx.type === 'BUY' ? 'MUA' : tx.type === 'SELL' ? 'BÁN' : tx.type;
    const time = new Date(tx.timestamp).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
    return `
      <div class="tx-row">
        <span class="tx-type ${typeClass}">${typeLabel}</span>
        <span class="tx-meta">${tx.material} ×${tx.amount}</span>
        <span class="tx-time">${time}</span>
      </div>`;
  }).join('');
}

// ── Render: Price chart ───────────────────────────────────
async function renderChart() {
  const item = allItems.find(i => i.material === selectedMaterial);
  if (!item) return;

  document.getElementById('chartItemName').textContent = item.display_name;
  document.getElementById('chartItemPrice').textContent = fmtUSD(item.current_buy);

  const chgCls = colorForChange(item.buy_change_percent);
  const chgEl = document.getElementById('chartItemChg');
  chgEl.textContent = fmtPct(item.buy_change_percent);
  chgEl.className = 'chg-pill chg ' + chgCls;

  document.getElementById('statBuy').textContent = fmtUSD(item.current_buy);
  document.getElementById('statSell').textContent = fmtUSD(item.current_sell);
  document.getElementById('statBought').textContent = fmtNum(item.total_bought);
  document.getElementById('statSold').textContent = fmtNum(item.total_sold);

  try {
    const res = await fetch(`/api/items/${selectedMaterial}/history?hours=${currentRangeHours}`);
    const history = await res.json();

    const labels = history.map(h => new Date(h.timestamp));
    const buyData = history.map(h => h.buy_price);
    const sellData = history.map(h => h.sell_price);

    const isUp = item.buy_change_percent >= 0;
    const lineColor = isUp ? '#3ddc84' : '#ff5c5c';

    const ctx = document.getElementById('priceChart').getContext('2d');

    if (priceChart) priceChart.destroy();

    const gradient = ctx.createLinearGradient(0, 0, 0, 320);
    gradient.addColorStop(0, isUp ? 'rgba(61,220,132,0.25)' : 'rgba(255,92,92,0.25)');
    gradient.addColorStop(1, 'rgba(0,0,0,0)');

    priceChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'Giá Mua',
            data: buyData,
            borderColor: lineColor,
            backgroundColor: gradient,
            borderWidth: 2,
            pointRadius: 0,
            pointHoverRadius: 4,
            tension: 0.25,
            fill: true
          },
          {
            label: 'Giá Bán',
            data: sellData,
            borderColor: '#5ec8e0',
            borderWidth: 1.5,
            borderDash: [4, 3],
            pointRadius: 0,
            pointHoverRadius: 4,
            tension: 0.25,
            fill: false
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: {
            labels: { color: '#8b95a7', font: { family: 'JetBrains Mono', size: 11 }, boxWidth: 12 }
          },
          tooltip: {
            backgroundColor: '#161b24',
            titleColor: '#e7ecf3',
            bodyColor: '#e7ecf3',
            borderColor: '#232a36',
            borderWidth: 1,
            padding: 10,
            titleFont: { family: 'JetBrains Mono', size: 11 },
            bodyFont: { family: 'JetBrains Mono', size: 12 },
            callbacks: {
              label: (ctx) => `${ctx.dataset.label}: $${ctx.parsed.y.toFixed(2)}`
            }
          }
        },
        scales: {
          x: {
            type: 'time',
            time: { unit: currentRangeHours <= 6 ? 'minute' : currentRangeHours <= 24 ? 'hour' : 'day' },
            grid: { color: '#1a2028' },
            ticks: { color: '#4d5667', font: { family: 'JetBrains Mono', size: 10 }, maxTicksLimit: 8 }
          },
          y: {
            grid: { color: '#1a2028' },
            ticks: {
              color: '#4d5667',
              font: { family: 'JetBrains Mono', size: 10 },
              callback: (v) => '$' + v
            }
          }
        }
      }
    });
  } catch (err) {
    console.error('Lỗi tải biểu đồ:', err);
  }
}

// ── Range toggle ───────────────────────────────────────────
document.getElementById('rangeToggle').addEventListener('click', (e) => {
  if (e.target.tagName !== 'BUTTON') return;
  document.querySelectorAll('#rangeToggle button').forEach(b => b.classList.remove('active'));
  e.target.classList.add('active');
  currentRangeHours = parseInt(e.target.dataset.hours);
  renderChart();
});

// ── WebSocket real-time updates ───────────────────────────
socket.on('priceUpdate', (items) => {
  items.forEach(updated => {
    const idx = allItems.findIndex(i => i.material === updated.item);
    if (idx !== -1) {
      allItems[idx].current_buy = updated.currentBuy;
      allItems[idx].current_sell = updated.currentSell;
      if (updated.buyChangePercent !== undefined) allItems[idx].buy_change_percent = updated.buyChangePercent;
      if (updated.sellChangePercent !== undefined) allItems[idx].sell_change_percent = updated.sellChangePercent;
      if (updated.totalBought !== undefined) allItems[idx].total_bought = updated.totalBought;
      if (updated.totalSold !== undefined) allItems[idx].total_sold = updated.totalSold;
    }
  });
  renderItemGrid();
  renderTicker();
  if (items.some(i => i.item === selectedMaterial)) {
    renderChart();
  }
});

socket.on('newTransactions', () => {
  loadRecentTx();
  loadTopMovers();
});

// ── Admin panel ────────────────────────────────────────────
const modalOverlay = document.getElementById('modalOverlay');
const loginModal = document.getElementById('loginModal');
const priceModal = document.getElementById('priceModal');

document.getElementById('adminFab').addEventListener('click', () => {
  modalOverlay.classList.add('show');
  if (adminToken) {
    loginModal.style.display = 'none';
    priceModal.style.display = 'block';
  } else {
    loginModal.style.display = 'block';
    priceModal.style.display = 'none';
  }
});

document.getElementById('cancelLogin').addEventListener('click', () => {
  modalOverlay.classList.remove('show');
});

document.getElementById('closePriceModal').addEventListener('click', () => {
  modalOverlay.classList.remove('show');
});

document.getElementById('submitLogin').addEventListener('click', async () => {
  const password = document.getElementById('adminPassword').value;
  const errEl = document.getElementById('loginErr');
  errEl.textContent = '';

  try {
    const res = await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password })
    });
    const data = await res.json();
    if (res.ok) {
      adminToken = data.token;
      loginModal.style.display = 'none';
      priceModal.style.display = 'block';
      document.getElementById('adminPassword').value = '';
    } else {
      errEl.textContent = data.error || 'Sai mật khẩu';
    }
  } catch (err) {
    errEl.textContent = 'Lỗi kết nối server';
  }
});

function populateAdminSelect() {
  const select = document.getElementById('priceItemSelect');
  select.innerHTML = allItems.map(item =>
    `<option value="${item.material}">${item.display_name} (${item.material})</option>`
  ).join('');
}

document.getElementById('submitPrice').addEventListener('click', async () => {
  const material = document.getElementById('priceItemSelect').value;
  const buyPrice = parseFloat(document.getElementById('newBuyPrice').value);
  const sellPrice = parseFloat(document.getElementById('newSellPrice').value);
  const errEl = document.getElementById('priceErr');
  errEl.textContent = '';

  if (isNaN(buyPrice) || isNaN(sellPrice)) {
    errEl.textContent = 'Vui lòng nhập giá hợp lệ';
    return;
  }

  try {
    const res = await fetch('/api/admin/set-price', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': adminToken },
      body: JSON.stringify({ material, buyPrice, sellPrice })
    });
    const data = await res.json();
    if (res.ok) {
      modalOverlay.classList.remove('show');
      loadItems();
    } else {
      errEl.textContent = data.error || 'Lỗi cập nhật giá';
    }
  } catch (err) {
    errEl.textContent = 'Lỗi kết nối server';
  }
});

modalOverlay.addEventListener('click', (e) => {
  if (e.target === modalOverlay) modalOverlay.classList.remove('show');
});

// ── Init ───────────────────────────────────────────────────
loadItems();
loadTopMovers();
loadRecentTx();

setInterval(loadTopMovers, 15000);
setInterval(loadRecentTx, 10000);
