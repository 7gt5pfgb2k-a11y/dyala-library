// Tables are created automatically on the first request (CREATE TABLE IF NOT EXISTS).
export const SCHEMA: string[] = [
  `CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'reader',
    pw TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS books (
    id TEXT PRIMARY KEY,
    owner_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    author TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    category TEXT NOT NULL DEFAULT '',
    shelf TEXT NOT NULL DEFAULT '',
    pages INTEGER NOT NULL DEFAULT 0,
    color TEXT NOT NULL DEFAULT '#c9704a',
    note TEXT NOT NULL DEFAULT '',
    pdf_key TEXT,
    pdf_size INTEGER NOT NULL DEFAULT 0,
    has_cover INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_books_owner ON books(owner_id)`,
  `CREATE TABLE IF NOT EXISTS book_pages (
    book_id TEXT NOT NULL,
    n INTEGER NOT NULL,
    text TEXT NOT NULL,
    PRIMARY KEY (book_id, n)
  )`,
  `CREATE TABLE IF NOT EXISTS progress (
    user_id INTEGER NOT NULL,
    book_id TEXT NOT NULL,
    last_page INTEGER NOT NULL DEFAULT 1,
    bookmarks TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'reading',
    percent INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, book_id)
  )`,
  `CREATE TABLE IF NOT EXISTS reading_log (
    user_id INTEGER NOT NULL,
    day TEXT NOT NULL,
    seconds INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, day)
  )`,
  `CREATE TABLE IF NOT EXISTS settings (
    user_id INTEGER PRIMARY KEY,
    goal_minutes INTEGER NOT NULL DEFAULT 15
  )`,
  `CREATE TABLE IF NOT EXISTS shelves (
    owner_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    PRIMARY KEY (owner_id, name)
  )`,
  `CREATE TABLE IF NOT EXISTS ai_usage (
    user_id INTEGER NOT NULL,
    day TEXT NOT NULL,
    count INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, day)
  )`,
  `CREATE TABLE IF NOT EXISTS writings (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    body TEXT NOT NULL DEFAULT '',
    updated_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS app_secrets (k TEXT PRIMARY KEY, v TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS login_fail (
    key TEXT PRIMARY KEY,
    count INTEGER NOT NULL,
    ts INTEGER NOT NULL
  )`,
];
