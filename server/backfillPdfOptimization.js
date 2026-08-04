import { access, stat } from "node:fs/promises";
import path from "node:path";
import { getAllLessons } from "./db.js";
import { optimizePdfInPlace } from "./pdfOptimize.js";

const STORAGE_ROOT = process.env.STORAGE_ROOT ? path.resolve(process.env.STORAGE_ROOT) : "";
const UPLOADS_DIR = STORAGE_ROOT
  ? path.join(STORAGE_ROOT, "uploads")
  : path.join(import.meta.dirname, "uploads");

const args = new Set(process.argv.slice(2));
const isDryRun = args.has("--dry-run");
const failOnError = args.has("--fail-on-error");

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  const precision = value >= 10 || unitIndex === 0 ? 0 : 1;
  return `${value.toFixed(precision)} ${units[unitIndex]}`;
}

function formatSignedBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes === 0) return "0 B";
  const sign = bytes > 0 ? "+" : "-";
  return `${sign}${formatBytes(Math.abs(bytes))}`;
}

async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const lessons = getAllLessons();
  let processed = 0;
  let optimized = 0;
  let missing = 0;
  let warnings = 0;
  let errors = 0;
  let skippedLarger = 0;
  let totalBefore = 0;
  let totalAfter = 0;

  console.log(`[pdf-backfill] found ${lessons.length} lesson(s) in database.`);
  console.log(`[pdf-backfill] uploads directory: ${UPLOADS_DIR}`);
  if (isDryRun) {
    console.log("[pdf-backfill] dry run enabled: files will not be modified.");
  }

  for (const lesson of lessons) {
    const filePath = path.join(UPLOADS_DIR, lesson.fileName);
    const exists = await fileExists(filePath);

    if (!exists) {
      missing += 1;
      console.warn(`[pdf-backfill] missing file for lesson ${lesson.id}: ${filePath}`);
      continue;
    }

    processed += 1;

    if (isDryRun) {
      const currentStats = await stat(filePath);
      totalBefore += currentStats.size;
      totalAfter += currentStats.size;
      console.log(
        `[pdf-backfill] would optimize ${lesson.fileName} (${formatBytes(currentStats.size)})`
      );
      continue;
    }

    try {
      const result = await optimizePdfInPlace(filePath);
      totalBefore += result.beforeBytes ?? 0;
      totalAfter += result.afterBytes ?? result.beforeBytes ?? 0;

      if (result.warnings.length > 0) {
        warnings += result.warnings.length;
        console.warn(`[pdf-backfill] warnings for ${lesson.fileName}: ${result.warnings.join(" | ")}`);
      }

      if (result.optimized) {
        optimized += 1;
        console.log(
          `[pdf-backfill] optimized ${lesson.fileName}: ${formatBytes(
            result.beforeBytes ?? 0
          )} -> ${formatBytes(result.afterBytes ?? 0)} (delta ${formatSignedBytes(result.deltaBytes ?? 0)})`
        );
      } else if (result.attempted && result.skippedReason === "larger-output") {
        skippedLarger += 1;
        console.log(
          `[pdf-backfill] kept original ${lesson.fileName}: candidate was larger (delta ${formatSignedBytes(
            result.deltaBytes ?? 0
          )})`
        );
      } else {
        console.log(`[pdf-backfill] skipped optimization for ${lesson.fileName} (mode=${result.mode}).`);
      }
    } catch (error) {
      errors += 1;
      console.error(
        `[pdf-backfill] failed ${lesson.fileName}: ${error instanceof Error ? error.message : String(error)}`
      );
      if (failOnError) {
        process.exit(1);
      }
    }
  }

  const netDeltaBytes = totalAfter - totalBefore;
  const savingsBytes = totalBefore - totalAfter;
  const savingsPercent = totalBefore > 0 ? (savingsBytes / totalBefore) * 100 : 0;

  console.log("[pdf-backfill] summary");
  console.log(`  processed: ${processed}`);
  console.log(`  optimized: ${optimized}`);
  console.log(`  missing:   ${missing}`);
  console.log(`  warnings:  ${warnings}`);
  console.log(`  errors:    ${errors}`);
  console.log(`  kept:      ${skippedLarger} (candidate larger)`);
  console.log(`  total in:  ${formatBytes(totalBefore)}`);
  console.log(`  total out: ${formatBytes(totalAfter)}`);
  console.log(`  net delta: ${formatSignedBytes(netDeltaBytes)} (saved ${savingsPercent.toFixed(2)}%)`);

  if (errors > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(`[pdf-backfill] fatal error: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
