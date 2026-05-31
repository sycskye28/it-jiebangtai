import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "../src/db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbDir = path.resolve(__dirname, "../db");

const files = (await fs.readdir(dbDir)).filter((file) => file.endsWith(".sql")).sort();

try {
  await pool.query("CREATE TABLE IF NOT EXISTS schema_migrations (filename TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())");
  for (const file of files) {
    const exists = await pool.query("SELECT 1 FROM schema_migrations WHERE filename = $1", [file]);
    if (exists.rowCount) {
      console.info(`skip ${file}`);
      continue;
    }
    const sql = await fs.readFile(path.join(dbDir, file), "utf8");
    await pool.query("BEGIN");
    try {
      await pool.query(sql);
      await pool.query("INSERT INTO schema_migrations (filename) VALUES ($1)", [file]);
      await pool.query("COMMIT");
      console.info(`applied ${file}`);
    } catch (error) {
      await pool.query("ROLLBACK");
      throw error;
    }
  }
} finally {
  await pool.end();
}
