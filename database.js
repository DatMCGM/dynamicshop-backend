const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, 'dynamicshop.db'));
db.pragma('journal_mode = WAL');

// ──────────────────────────────────────────────
// Khởi tạo các bảng
// ──────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS items (
    material TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    base_buy REAL NOT NULL,
    base_sell REAL NOT NULL,
    current_buy REAL NOT NULL,
    current_sell REAL NOT NULL,
    total_bought INTEGER DEFAULT 0,
    total_sold INTEGER DEFAULT 0,
    buy_change_percent REAL DEFAULT 0,
    sell_change_percent REAL DEFAULT 0,
    updated_at INTEGER NOT NULL
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    material TEXT NOT NULL,
    type TEXT NOT NULL,
    amount INTEGER NOT NULL,
    buy_price REAL NOT NULL,
    sell_price REAL NOT NULL,
    timestamp INTEGER NOT NULL
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS price_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    material TEXT NOT NULL,
    buy_price REAL NOT NULL,
    sell_price REAL NOT NULL,
    timestamp INTEGER NOT NULL
  )
`);

// Index để query nhanh hơn
db.exec(`CREATE INDEX IF NOT EXISTS idx_tx_material ON transactions(material)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_tx_timestamp ON transactions(timestamp)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_history_material ON price_history(material)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_history_timestamp ON price_history(timestamp)`);

// ──────────────────────────────────────────────
// Prepared statements
// ──────────────────────────────────────────────

const upsertItem = db.prepare(`
  INSERT INTO items (material, display_name, base_buy, base_sell, current_buy, current_sell,
                      total_bought, total_sold, buy_change_percent, sell_change_percent, updated_at)
  VALUES (@material, @displayName, @baseBuy, @baseSell, @currentBuy, @currentSell,
          @totalBought, @totalSold, @buyChangePercent, @sellChangePercent, @updatedAt)
  ON CONFLICT(material) DO UPDATE SET
    display_name = @displayName,
    current_buy = @currentBuy,
    current_sell = @currentSell,
    total_bought = @totalBought,
    total_sold = @totalSold,
    buy_change_percent = @buyChangePercent,
    sell_change_percent = @sellChangePercent,
    updated_at = @updatedAt
`);

const insertTransaction = db.prepare(`
  INSERT INTO transactions (material, type, amount, buy_price, sell_price, timestamp)
  VALUES (@material, @type, @amount, @buyPrice, @sellPrice, @timestamp)
`);

const insertHistory = db.prepare(`
  INSERT INTO price_history (material, buy_price, sell_price, timestamp)
  VALUES (@material, @buyPrice, @sellPrice, @timestamp)
`);

const getAllItems = db.prepare(`SELECT * FROM items ORDER BY display_name`);

const getItem = db.prepare(`SELECT * FROM items WHERE material = ?`);

const getRecentTransactions = db.prepare(`
  SELECT * FROM transactions ORDER BY timestamp DESC LIMIT ?
`);

const getItemTransactions = db.prepare(`
  SELECT * FROM transactions WHERE material = ? ORDER BY timestamp DESC LIMIT ?
`);

const getPriceHistory = db.prepare(`
  SELECT * FROM price_history WHERE material = ? AND timestamp > ? ORDER BY timestamp ASC
`);

const getTopMovers = db.prepare(`
  SELECT *, ABS(buy_change_percent) as abs_change
  FROM items ORDER BY abs_change DESC LIMIT ?
`);

// ──────────────────────────────────────────────
// Functions
// ──────────────────────────────────────────────

function saveSnapshot(items) {
  const now = Date.now();
  const transaction = db.transaction((items) => {
    for (const item of items) {
      upsertItem.run({
        material: item.item,
        displayName: item.displayName,
        baseBuy: item.baseBuy,
        baseSell: item.baseSell,
        currentBuy: item.currentBuy,
        currentSell: item.currentSell,
        totalBought: item.totalBought,
        totalSold: item.totalSold,
        buyChangePercent: item.buyChangePercent,
        sellChangePercent: item.sellChangePercent,
        updatedAt: now
      });

      // Lưu vào lịch sử giá (cho biểu đồ)
      insertHistory.run({
        material: item.item,
        buyPrice: item.currentBuy,
        sellPrice: item.currentSell,
        timestamp: now
      });
    }
  });
  transaction(items);
}

function saveTransactions(transactions) {
  const insertMany = db.transaction((txs) => {
    for (const tx of txs) {
      insertTransaction.run({
        material: tx.item,
        type: tx.type,
        amount: tx.amount,
        buyPrice: tx.buyPrice,
        sellPrice: tx.sellPrice,
        timestamp: tx.timestamp
      });
    }
  });
  insertMany(transactions);
}

module.exports = {
  db,
  saveSnapshot,
  saveTransactions,
  getAllItems: () => getAllItems.all(),
  getItem: (material) => getItem.get(material),
  getRecentTransactions: (limit = 50) => getRecentTransactions.all(limit),
  getItemTransactions: (material, limit = 100) => getItemTransactions.all(material, limit),
  getPriceHistory: (material, sinceTimestamp) => getPriceHistory.all(material, sinceTimestamp),
  getTopMovers: (limit = 10) => getTopMovers.all(limit)
};
