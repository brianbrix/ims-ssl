import express from "express";
import cors from "cors";
import multer from "multer";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { unlink } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getAllLessons, getLessonById, insertLesson, deleteLessonById } from "./db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOADS_DIR = path.join(__dirname, "uploads");
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "sabbath-admin";
const PORT = process.env.PORT || 3001;
const HOST = process.env.HOST || "0.0.0.0";
const PUBLIC_API_BASE_URL = (process.env.PUBLIC_API_BASE_URL || "").replace(/\/$/, "");
const CORS_ORIGIN = process.env.CORS_ORIGIN || "*";

if (!existsSync(UPLOADS_DIR)) mkdirSync(UPLOADS_DIR, { recursive: true });

function getApiBase(req) {
  if (PUBLIC_API_BASE_URL) return PUBLIC_API_BASE_URL;
  return `${req.protocol}://${req.get("host")}`;
}

function lessonToDto(lesson, req) {
  return {
    ...lesson,
    fileUrl: `${getApiBase(req)}/api/lessons/${lesson.id}/file`,
  };
}

function requireAdmin(req, res, next) {
  const auth = req.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (token !== ADMIN_TOKEN) {
    return res.status(401).json({ error: "Invalid admin passcode." });
  }
  next();
}

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOADS_DIR,
    filename: (_req, _file, cb) => cb(null, `${randomUUID()}.pdf`),
  }),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype !== "application/pdf") {
      return cb(new Error("Only PDF files are allowed."));
    }
    cb(null, true);
  },
});

const app = express();
app.set("trust proxy", true);
app.use(
  cors({
    origin:
      CORS_ORIGIN === "*"
        ? true
        : CORS_ORIGIN.split(",")
            .map((origin) => origin.trim())
            .filter(Boolean),
  })
);
app.use(express.json());

app.get("/api/lessons", (req, res) => {
  const lessons = getAllLessons();
  res.json(lessons.map((lesson) => lessonToDto(lesson, req)));
});

app.post("/api/lessons", requireAdmin, upload.single("file"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "A PDF file is required." });
  }

  const title = (req.body.title || "").trim() || req.file.originalname;
  const period = (req.body.period || "").trim();

  const lesson = {
    id: path.parse(req.file.filename).name,
    title,
    period,
    originalName: req.file.originalname,
    fileName: req.file.filename,
    uploadedAt: new Date().toISOString(),
  };

  insertLesson(lesson);

  res.status(201).json(lessonToDto(lesson, req));
});

app.get("/api/lessons/:id", (req, res) => {
  const lesson = getLessonById(req.params.id);
  if (!lesson) return res.status(404).json({ error: "Lesson not found." });
  res.json(lessonToDto(lesson, req));
});

app.get("/api/lessons/:id/file", (req, res) => {
  const lesson = getLessonById(req.params.id);
  if (!lesson) return res.status(404).json({ error: "Lesson not found." });

  res.sendFile(path.join(UPLOADS_DIR, lesson.fileName), {
    headers: { "Content-Type": "application/pdf" },
  });
});

app.delete("/api/lessons/:id", requireAdmin, async (req, res) => {
  const lesson = getLessonById(req.params.id);
  if (!lesson) return res.status(404).json({ error: "Lesson not found." });

  await unlink(path.join(UPLOADS_DIR, lesson.fileName)).catch(() => {});
  deleteLessonById(req.params.id);

  res.status(204).end();
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(400).json({ error: err.message || "Unexpected error." });
});

app.listen(PORT, HOST, () => {
  console.log(`Sabbath School Reader API listening on http://${HOST}:${PORT}`);
  if (PUBLIC_API_BASE_URL) {
    console.log(`Using public API base URL ${PUBLIC_API_BASE_URL}`);
  }
  if (!process.env.ADMIN_TOKEN) {
    console.log(`Using default admin passcode "${ADMIN_TOKEN}" (set ADMIN_TOKEN env var to change it).`);
  }
});
