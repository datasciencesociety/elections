import Database from "better-sqlite3";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const DB_PATH = resolve(import.meta.dirname, "../../elections.db");

if (!existsSync(DB_PATH)) {
  console.error(
    `elections.db not found at ${DB_PATH}. Download it from GitHub Releases and place it at the repo root.`
  );
  process.exit(1);
}

const db = new Database(DB_PATH, { readonly: true });
db.pragma("journal_mode = WAL");

export default db;
