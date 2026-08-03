import Database from "better-sqlite3";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";

const STORAGE_ROOT = process.env.STORAGE_ROOT ? path.resolve(process.env.STORAGE_ROOT) : "";
const DATA_DIR = STORAGE_ROOT ? path.join(STORAGE_ROOT, "data") : path.join(import.meta.dirname, "data");
const DB_FILE = path.join(DATA_DIR, "lessons.db");
const LEGACY_JSON_FILE = STORAGE_ROOT
  ? path.join(import.meta.dirname, "data", "lessons.json")
  : path.join(DATA_DIR, "lessons.json");

if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(DB_FILE);
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS lessons (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    period TEXT NOT NULL DEFAULT '',
    originalName TEXT NOT NULL,
    fileName TEXT NOT NULL,
    uploadedAt TEXT NOT NULL
  )
`);

// One-time migration from the legacy JSON store, if present and DB is empty.
const existingCount = db.prepare("SELECT COUNT(*) AS count FROM lessons").get().count;
if (existingCount === 0 && existsSync(LEGACY_JSON_FILE)) {
  try {
    const legacyLessons = JSON.parse(readFileSync(LEGACY_JSON_FILE, "utf-8"));
    const insert = db.prepare(
      `INSERT OR IGNORE INTO lessons (id, title, period, originalName, fileName, uploadedAt)
       VALUES (@id, @title, @period, @originalName, @fileName, @uploadedAt)`
    );
    const insertMany = db.transaction((lessons) => {
      for (const lesson of lessons) insert.run(lesson);
    });
    insertMany(legacyLessons);
    console.log(`Migrated ${legacyLessons.length} lesson(s) from lessons.json into SQLite.`);
  } catch (err) {
    console.error("Failed to migrate legacy lessons.json:", err.message);
  }
}

export function getAllLessons() {
  return db.prepare("SELECT * FROM lessons ORDER BY uploadedAt DESC").all();
}

export function getLessonById(id) {
  return db.prepare("SELECT * FROM lessons WHERE id = ?").get(id);
}

export function insertLesson(lesson) {
  db.prepare(
    `INSERT INTO lessons (id, title, period, originalName, fileName, uploadedAt)
     VALUES (@id, @title, @period, @originalName, @fileName, @uploadedAt)`
  ).run(lesson);
  return lesson;
}

export function deleteLessonById(id) {
  const result = db.prepare("DELETE FROM lessons WHERE id = ?").run(id);
  return result.changes > 0;
}
