import Database, { type Database as DatabaseType } from "better-sqlite3";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const DB_PATH = resolve(import.meta.dirname, "../../elections.db");

let _db: DatabaseType | null = null;

function getDb(): DatabaseType {
  if (!_db) {
    if (!existsSync(DB_PATH)) {
      throw new Error(
        `elections.db not found at ${DB_PATH}. Download it from GitHub Releases and place it at the repo root.`
      );
    }
    _db = new Database(DB_PATH, { readonly: true });
    _db.pragma("journal_mode = WAL");
  }
  return _db;
}

export default getDb;
