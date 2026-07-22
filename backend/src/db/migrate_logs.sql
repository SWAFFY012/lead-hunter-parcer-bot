CREATE TABLE IF NOT EXISTS system_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  module TEXT NOT NULL, -- 'parser', 'sender', 'ai', 'system'
  level TEXT NOT NULL DEFAULT 'error', -- 'error', 'warn', 'info'
  message TEXT NOT NULL,
  details TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
