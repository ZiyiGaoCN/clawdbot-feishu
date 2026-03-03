import * as fs from "fs";
import * as path from "path";

const LOG_DIR = "/tmp/openclaw/feishu";

let fd: number | null = null;
let currentDate: string | null = null;
let patched = false;

function todayStr(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function ensureFd(): number | null {
  const today = todayStr();
  if (fd !== null && currentDate === today) return fd;
  // Day rolled over — close old fd and open new file
  if (fd !== null) {
    try { fs.closeSync(fd); } catch { /* ignore */ }
    fd = null;
  }
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    fd = fs.openSync(path.join(LOG_DIR, `${today}.log`), "a");
    currentDate = today;
    return fd;
  } catch {
    return null;
  }
}

function ts(): string {
  return new Date().toISOString();
}

function formatArgs(args: unknown[]): string {
  return args
    .map((a) =>
      typeof a === "string"
        ? a
        : a instanceof Error
          ? a.stack ?? String(a)
          : JSON.stringify(a),
    )
    .join(" ");
}

function writeLine(level: string, args: unknown[]) {
  const handle = ensureFd();
  if (handle === null) return;
  const line = `${ts()} [${level}] ${formatArgs(args)}\n`;
  try {
    fs.writeSync(handle, line);
  } catch {
    fd = null;
  }
}

/**
 * Monkey-patch console.log / console.error / console.warn so every call
 * also appends a timestamped line to /tmp/openclaw/feishu/YYYY-MM-DD.log.
 * Safe to call multiple times — only patches once.
 */
export function installFileLogger() {
  if (patched) return;
  patched = true;

  const origLog = console.log;
  const origError = console.error;
  const origWarn = console.warn;

  console.log = function (...args: unknown[]) {
    writeLine("INFO", args);
    origLog.apply(console, args);
  };

  console.error = function (...args: unknown[]) {
    writeLine("ERROR", args);
    origError.apply(console, args);
  };

  console.warn = function (...args: unknown[]) {
    writeLine("WARN", args);
    origWarn.apply(console, args);
  };
}

const patchedRuntimes = new WeakSet<object>();

/**
 * Patch a RuntimeEnv's .log and .error in place so they also write to the
 * file log.  Idempotent — safe to call multiple times on the same object.
 */
export function patchRuntimeLog(runtime: { log: (...a: unknown[]) => void; error: (...a: unknown[]) => void }) {
  if (patchedRuntimes.has(runtime)) return;
  patchedRuntimes.add(runtime);

  const origLog = runtime.log;
  const origError = runtime.error;

  runtime.log = (...args: unknown[]) => {
    writeLine("INFO", args);
    origLog(...args);
  };

  runtime.error = (...args: unknown[]) => {
    writeLine("ERROR", args);
    origError(...args);
  };
}
