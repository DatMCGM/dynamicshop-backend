const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const db = require('./database');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

const PORT = process.env.PORT || 3000;
const API_KEY = process.env.API_KEY || 'change-this-secret-key-123';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

app.use(cors());
// type: () => true ép body-parser luôn parse JSON, bất kể Content-Type header
// (plugin Java gửi "application/json; utf-8" — thiếu "charset=" nên không chuẩn HTTP,
// khiến express.json() mặc định bỏ qua và req.body bị rỗng -> lỗi 400 "Missing items field")
app.use(express.json({ limit: '10mb', type: () => true }));

// Bắt lỗi parse JSON (nếu body gửi lên không phải JSON hợp lệ) để tránh crash server
app.use((err, req, res, next) => {
  if (err && err.type === 'entity.parse.failed') {
    console.error(`[JSON parse error] ${req.method} ${req.path} —`, err.message);
    return res.status(400).json({ error: 'Invalid JSON body' });
  }
  next(err);
});

app.use(express.static(path.join(__dirname, 'public')));

// ── Middleware xác thực API key ──────────────────────────────
function requireApiKey(req, res, next) {
  const key = req.headers['x-api-key'];
  if (key !== API_KEY) {
    return res.status(401).json({ error: 'Invalid API key' });
  }
  next();
}

// ── Debug middleware — log mọi request từ plugin ─────────────
app.use('/api/sync', (req, res, next) => {
  console.log(`[SYNC] ${req.method} ${req.path} — body keys: ${Object.keys(req.body || {}).join(', ')}`);
  next();
});

// ══════════════════════════════════════════════════════════════
//  API — Plugin gửi data lên
// ══════════════════════════════════════════════════════════════

// Nhận snapshot giá (mỗi 10 giây từ plugin)
app.post('/api/sync/snapshot', requireApiKey, (req, res) => {
  try {
    const body = req.body;

    // Hỗ trợ cả 2 format: { items: [...] } hoặc { items: {...} }
    let items = body.items;

    if (!items) {
      console.warn('[SYNC] Không có field "items" trong body:', JSON.stringify(body).substring(0, 200));
      return res.status(400).json({ error: 'Missing items field', received: Object.keys(body) });
    }

    // Nếu items là object (map) thay vì array → convert
    if (!Array.isArray(items)) {
      items = Object.values(items);
    }

    if (items.length === 0) {
      return res.json({ success: true, itemsUpdated: 0, message: 'No items to update' });
    }

    db.saveSnapshot(items);
    io.emit('priceUpdate', items);

    console.log(`[SYNC] Snapshot OK — ${items.length} items`);
    res.json({ success: true, itemsUpdated: items.length });

  } catch (err) {
    console.error('[SYNC] Snapshot error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Nhận danh sách giao dịch
app.post('/api/sync/transactions', requireApiKey, (req, res) => {
  try {
    const body = req.body;
    let transactions = body.transactions;

    if (!transactions) {
      return res.status(400).json({ error: 'Missing transactions field' });
    }

    if (!Array.isArray(transactions)) {
      transactions = Object.values(transactions);
    }

    if (transactions.length > 0) {
      db.saveTransactions(transactions);
      io.emit('newTransactions', transactions);
    }

    res.json({ success: true, transactionsAdded: transactions.length });

  } catch (err) {
    console.error('[SYNC] Transaction error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ══════════════════════════════════════════════════════════════
//  API — Website đọc data
// ══════════════════════════════════════════════════════════════

app.get('/api/items', (req, res) => {
  try { res.json(db.getAllItems()); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/items/:material', (req, res) => {
  try {
    const item = db.getItem(req.params.material.toUpperCase());
    if (!item) return res.status(404).json({ error: 'Item not found' });
    res.json(item);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/items/:material/history', (req, res) => {
  try {
    const hours = parseInt(req.query.hours) || 24;
    const since = Date.now() - (hours * 60 * 60 * 1000);
    res.json(db.getPriceHistory(req.params.material.toUpperCase(), since));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/transactions', (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    res.json(db.getRecentTransactions(limit));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/items/:material/transactions', (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 100;
    res.json(db.getItemTransactions(req.params.material.toUpperCase(), limit));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/top-movers', (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    res.json(db.getTopMovers(limit));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ══════════════════════════════════════════════════════════════
//  ADMIN API
// ══════════════════════════════════════════════════════════════

app.post('/api/admin/login', (req, res) => {
  const { password } = req.body;
  if (password === ADMIN_PASSWORD) {
    res.json({ success: true, token: API_KEY });
  } else {
    res.status(401).json({ error: 'Sai mật khẩu' });
  }
});

app.post('/api/admin/set-price', requireApiKey, (req, res) => {
  try {
    const { material, buyPrice, sellPrice } = req.body;
    if (!material || buyPrice == null || sellPrice == null) {
      return res.status(400).json({ error: 'Thiếu thông tin' });
    }

    const item = db.getItem(material.toUpperCase());
    if (!item) return res.status(404).json({ error: 'Item không tồn tại trong DB' });

    db.saveSnapshot([{
      item: material.toUpperCase(),
      displayName: item.display_name,
      baseBuy: item.base_buy,
      baseSell: item.base_sell,
      currentBuy: buyPrice,
      currentSell: sellPrice,
      totalBought: item.total_bought,
      totalSold: item.total_sold,
      buyChangePercent: ((buyPrice - item.base_buy) / item.base_buy) * 100,
      sellChangePercent: ((sellPrice - item.base_sell) / item.base_sell) * 100
    }]);

    io.emit('priceUpdate', [{ item: material.toUpperCase(), currentBuy: buyPrice, currentSell: sellPrice }]);
    res.json({ success: true });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ── WebSocket ─────────────────────────────────────────────────
io.on('connection', (socket) => {
  console.log('[WS] Client connected:', socket.id);
  socket.on('disconnect', () => console.log('[WS] Client disconnected:', socket.id));
});

// ── Fallback SPA ──────────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

server.listen(PORT, () => {
  console.log(`╔═══════════════════════════════════════╗`);
  console.log(`║  DynamicShop Backend đang chạy!       ║`);
  console.log(`║  Port: ${PORT}                            ║`);
  console.log(`╚═══════════════════════════════════════╝`);
});
