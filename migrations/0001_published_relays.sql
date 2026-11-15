CREATE TABLE published_relays (
  slug TEXT PRIMARY KEY,
  config TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1
);
