PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS users (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 name TEXT NOT NULL,
 phone TEXT NOT NULL,
 cep TEXT NOT NULL,
 city TEXT NOT NULL,
 address TEXT NOT NULL,
 username TEXT UNIQUE NOT NULL,
 password_hash TEXT NOT NULL,
 password_salt TEXT NOT NULL,
 recovery_hash TEXT NOT NULL,
 recovery_salt TEXT NOT NULL,
 recovery_failed_attempts INTEGER NOT NULL DEFAULT 0,
 recovery_locked_until TEXT,
 role TEXT NOT NULL CHECK(role IN ('client','professional','admin')) DEFAULT 'client',
 latitude REAL,
 longitude REAL,
 created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE TABLE IF NOT EXISTS professionals (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 user_id INTEGER UNIQUE NOT NULL,
 name TEXT NOT NULL,
 category TEXT NOT NULL,
 description TEXT,
 phone TEXT,
 city TEXT,
 address TEXT,
 latitude REAL,
 longitude REAL,
 exact_location INTEGER NOT NULL DEFAULT 0,
 rating REAL DEFAULT 0,
 review_count INTEGER DEFAULT 0,
 plan TEXT DEFAULT 'free',
 active INTEGER DEFAULT 1,
 FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_professionals_location ON professionals(latitude,longitude);
CREATE INDEX IF NOT EXISTS idx_professionals_category ON professionals(category);
CREATE TABLE IF NOT EXISTS services (id INTEGER PRIMARY KEY AUTOINCREMENT,professional_id INTEGER NOT NULL,title TEXT NOT NULL,description TEXT,price_from REAL,FOREIGN KEY(professional_id) REFERENCES professionals(id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS reviews (id INTEGER PRIMARY KEY AUTOINCREMENT,professional_id INTEGER NOT NULL,client_id INTEGER NOT NULL,rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),comment TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP,FOREIGN KEY(professional_id) REFERENCES professionals(id) ON DELETE CASCADE,FOREIGN KEY(client_id) REFERENCES users(id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS quote_requests (id INTEGER PRIMARY KEY AUTOINCREMENT,client_id INTEGER NOT NULL,category TEXT,description TEXT,latitude REAL,longitude REAL,status TEXT DEFAULT 'open',created_at TEXT DEFAULT CURRENT_TIMESTAMP,FOREIGN KEY(client_id) REFERENCES users(id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS subscriptions (id INTEGER PRIMARY KEY AUTOINCREMENT,professional_id INTEGER NOT NULL,plan TEXT,status TEXT,provider TEXT DEFAULT 'asaas',provider_subscription_id TEXT,expires_at TEXT,FOREIGN KEY(professional_id) REFERENCES professionals(id) ON DELETE CASCADE);
