import { mkdtemp, rm, stat, copyFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const GS_PROFILE_BY_MODE = {
  screen: "/screen",
  ebook: "/ebook",
  printer: "/printer",
  prepress: "/prepress",
};

function parseMode(rawMode) {
  const normalized = String(rawMode || "lossless").trim().toLowerCase();
  if (
    normalized === "none" ||
    normalized === "off" ||
    normalized === "disabled" ||
    normalized === "false"
  ) {
    return "none";
  }

  if (normalized === "lossless") return "lossless";
  if (normalized in GS_PROFILE_BY_MODE) return normalized;
  return "lossless";
}

function parseStrict(rawValue) {
  const normalized = String(rawValue || "").trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

function parseAllowLarger(rawValue) {
  const normalized = String(rawValue || "").trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

function runCommand(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => reject(error));
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} exited with code ${code}${stderr ? `: ${stderr.trim()}` : ""}`));
    });
  });
}

async function tryQpdfLinearize(inputPath, outputPath) {
  await runCommand("qpdf", ["--linearize", "--object-streams=generate", inputPath, outputPath]);
}

async function tryGhostscriptCompress(inputPath, outputPath, gsProfile) {
  await runCommand("gs", [
    "-sDEVICE=pdfwrite",
    "-dCompatibilityLevel=1.6",
    "-dNOPAUSE",
    "-dBATCH",
    "-dQUIET",
    `-dPDFSETTINGS=${gsProfile}`,
    `-sOutputFile=${outputPath}`,
    inputPath,
  ]);
}

export async function optimizePdfInPlace(filePath) {
  const mode = parseMode(process.env.PDF_OPTIMIZE_MODE);
  const strict = parseStrict(process.env.PDF_OPTIMIZE_STRICT);
  const allowLarger = parseAllowLarger(process.env.PDF_OPTIMIZE_ALLOW_LARGER);

  if (mode === "none") {
    return {
      mode,
      attempted: false,
      optimized: false,
      skippedReason: "mode-none",
      beforeBytes: null,
      afterBytes: null,
      deltaBytes: 0,
      savingsBytes: 0,
      savingsPercent: 0,
      operations: [],
      warnings: [],
    };
  }

  const warnings = [];
  const operations = [];
  const beforeStats = await stat(filePath);
  const tmpRoot = await mkdtemp(path.join(tmpdir(), "lesson-pdf-opt-"));

  try {
    let currentInput = filePath;

    const qpdfOut = path.join(tmpRoot, "qpdf-linearized.pdf");
    try {
      await tryQpdfLinearize(currentInput, qpdfOut);
      currentInput = qpdfOut;
      operations.push("qpdf-linearize");
    } catch (error) {
      const message = `qpdf optimization unavailable: ${error instanceof Error ? error.message : String(error)}`;
      if (strict) throw new Error(message);
      warnings.push(message);
    }

    if (mode !== "lossless") {
      const gsProfile = GS_PROFILE_BY_MODE[mode];
      const gsOut = path.join(tmpRoot, `ghostscript-${mode}.pdf`);
      try {
        await tryGhostscriptCompress(currentInput, gsOut, gsProfile);
        currentInput = gsOut;
        operations.push(`ghostscript-${mode}`);
      } catch (error) {
        const message = `ghostscript compression unavailable: ${error instanceof Error ? error.message : String(error)}`;
        if (strict) throw new Error(message);
        warnings.push(message);
      }
    }

    let optimized = false;
    let skippedReason = null;

    if (currentInput !== filePath) {
      const candidateStats = await stat(currentInput);
      if (allowLarger || candidateStats.size <= beforeStats.size) {
        await copyFile(currentInput, filePath);
        optimized = true;
      } else {
        skippedReason = "larger-output";
      }
    }

    const afterStats = await stat(filePath);
    const deltaBytes = afterStats.size - beforeStats.size;
    const savingsBytes = beforeStats.size - afterStats.size;
    const savingsPercent = beforeStats.size > 0 ? (savingsBytes / beforeStats.size) * 100 : 0;

    return {
      mode,
      attempted: operations.length > 0,
      optimized,
      skippedReason,
      beforeBytes: beforeStats.size,
      afterBytes: afterStats.size,
      deltaBytes,
      savingsBytes,
      savingsPercent,
      operations,
      warnings,
    };
  } finally {
    await rm(tmpRoot, { recursive: true, force: true }).catch(() => {});
  }
}
