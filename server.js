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
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ──────────────────────────────────────────────
// Middleware xác thực API key (cho plugin gửi data lên)
// ──────────────────────────────────────────────
function requireApiKey(req, res, next) {
  const key = req.headers['x-api-key'];
  if (key !== API_KEY) {
    return res.status(401).json({ error: 'Invalid API key' });
  }
  next();
}

// ══════════════════════════════════════════════
//  API ENDPOINTS — Dành cho Plugin gửi data lên
// ══════════════════════════════════════════════

// Plugin gửi snapshot giá hiện tại (mỗi 10s)
app.post('/api/sync/snapshot', requireApiKey, (req, res) => {
  try {
    const { items } = req.body;
    if (!items || !Array.isArray(items)) {
      return res.status(400).json({ error: 'Invalid items array' });
    }

    db.saveSnapshot(items);

    // Phát real-time tới mọi client đang xem web
    io.emit('priceUpdate', items);

    res.json({ success: true, itemsUpdated: items.length });
  } catch (err) {
    console.error('Error in /api/sync/snapshot:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Plugin gửi danh sách giao dịch mới
app.post('/api/sync/transactions', requireApiKey, (req, res) => {
  try {
    const { transactions } = req.body;
    if (!transactions || !Array.isArray(transactions)) {
      return res.status(400).json({ error: 'Invalid transactions array' });
    }

    db.saveTransactions(transactions);

    // Phát real-time
    io.emit('newTransactions', transactions);

    res.json({ success: true, transactionsAdded: transactions.length });
  } catch (err) {
    console.error('Error in /api/sync/transactions:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ══════════════════════════════════════════════
//  API ENDPOINTS — Dành cho Website đọc data
// ══════════════════════════════════════════════

// Lấy toàn bộ danh sách item + giá hiện tại
app.get('/api/items', (req, res) => {
  try {
    const items = db.getAllItems();
    res.json(items);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Lấy chi tiết 1 item
app.get('/api/items/:material', (req, res) => {
  try {
    const item = db.getItem(req.params.material.toUpperCase());
    if (!item) return res.status(404).json({ error: 'Item not found' });
    res.json(item);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Lấy lịch sử giá của 1 item (cho biểu đồ candlestick)
// hours: số giờ muốn lấy lại (mặc định 24h)
app.get('/api/items/:material/history', (req, res) => {
  try {
    const hours = parseInt(req.query.hours) || 24;
    const since = Date.now() - (hours * 60 * 60 * 1000);
    const history = db.getPriceHistory(req.params.material.toUpperCase(), since);
    res.json(history);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Lấy giao dịch gần đây nhất (toàn server)
app.get('/api/transactions', (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const transactions = db.getRecentTransactions(limit);
    res.json(transactions);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Lấy giao dịch của 1 item cụ thể
app.get('/api/items/:material/transactions', (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 100;
    const transactions = db.getItemTransactions(req.params.material.toUpperCase(), limit);
    res.json(transactions);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Bảng xếp hạng item biến động giá nhiều nhất
app.get('/api/top-movers', (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    const movers = db.getTopMovers(limit);
    res.json(movers);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ══════════════════════════════════════════════
//  ADMIN ENDPOINTS — Đổi giá thủ công từ web
// ══════════════════════════════════════════════

app.post('/api/admin/login', (req, res) => {
  const { password } = req.body;
  if (password === ADMIN_PASSWORD) {
    res.json({ success: true, token: API_KEY }); // đơn giản hoá — dùng chung API_KEY làm token
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

    // Cập nhật trực tiếp trong DB
    const item = db.getItem(material.toUpperCase());
    if (!item) return res.status(404).json({ error: 'Item không tồn tại' });

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
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ──────────────────────────────────────────────
// WebSocket connection
// ──────────────────────────────────────────────
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);
  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

// Fallback — serve index.html cho mọi route khác (SPA)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

server.listen(PORT, () => {
  console.log(`╔═══════════════════════════════════════╗`);
  console.log(`║  DynamicShop Backend đang chạy!       ║`);
  console.log(`║  Port: ${PORT}                            ║`);
  console.log(`╚═══════════════════════════════════════╝`);
});
