CREATE TABLE IF NOT EXISTS quest_rate_slot (
  singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
  next_ms INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS quest_cache (
  name TEXT PRIMARY KEY,
  retrieved_at TEXT NOT NULL,
  value TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS quest_notes (
  id TEXT PRIMARY KEY,
  account TEXT NOT NULL,
  created_at TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL
);
