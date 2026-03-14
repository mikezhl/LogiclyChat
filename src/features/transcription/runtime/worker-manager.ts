import { ChildProcess, spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { LivekitDispatchCredentials } from "@/features/transcription/service/livekit-dispatch";
import { appendTranscriberRuntimeLog } from "@/features/transcription/runtime/runtime-log";

type WorkerState = "starting" | "ready" | "failed";

type WorkerRecord = {
  instanceId: string;
  key: string;
  shortKey: string;
  process: ChildProcess;
  state: WorkerState;
  startedAt: number;
  lastUsedAt: number;
  readyPromise: Promise<void>;
  resolveReady: () => void;
  rejectReady: (error: unknown) => void;
  startupTimeout: NodeJS.Timeout;
};

type EnsureWorkerOptions = {
  waitForReady?: boolean;
  reason?: string;
};

const DEFAULT_IDLE_TIMEOUT_MS = 10 * 60 * 1000;
const DEFAULT_STARTUP_TIMEOUT_MS = 30 * 1000;
const JANITOR_INTERVAL_MS = 30 * 1000;

declare global {
  var transcriberWorkerRegistry: Map<string, WorkerRecord> | undefined;
  var transcriberWorkerJanitorTimer: NodeJS.Timeout | undefined;
}

function parsePositiveNumber(raw: string | undefined, fallback: number) {
  if (!raw) {
    return fallback;
  }

  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
}

function getIdleTimeoutMs() {
  return parsePositiveNumber(process.env.TRANSCRIBER_WORKER_IDLE_TIMEOUT_MS, DEFAULT_IDLE_TIMEOUT_MS);
}

function getStartupTimeoutMs() {
  return parsePositiveNumber(
    process.env.TRANSCRIBER_WORKER_STARTUP_TIMEOUT_MS,
    DEFAULT_STARTUP_TIMEOUT_MS,
  );
}

function getWorkerRegistry() {
  if (!global.transcriberWorkerRegistry) {
    global.transcriberWorkerRegistry = new Map<string, WorkerRecord>();
  }
  return global.transcriberWorkerRegistry;
}

function toWorkerKey(credentials: LivekitDispatchCredentials) {
  const raw = `${credentials.livekitUrl}|${credentials.livekitApiKey}|${credentials.livekitApiSecret}`;
  return crypto.createHash("sha256").update(raw).digest("hex");
}

function getSpawnCommandAndArgs() {
  const localTsxCli = path.join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs");
  if (fs.existsSync(localTsxCli)) {
    return {
      command: process.execPath,
      args: [localTsxCli, "src/features/transcription/agent/transcriber-agent.ts", "dev"],
    };
  }

  const npmExecPath = process.env.npm_execpath;
  if (npmExecPath) {
    return {
      command: process.execPath,
      args: [
        npmExecPath,
        "exec",
        "tsx",
        "src/features/transcription/agent/transcriber-agent.ts",
        "dev",
      ],
    };
  }

  return {
    command: process.platform === "win32" ? "pnpm.cmd" : "pnpm",
    args: ["exec", "tsx", "src/features/transcription/agent/transcriber-agent.ts", "dev"],
  };
}

function attachLineReader(stream: NodeJS.ReadableStream, onLine: (line: string) => void) {
  let buffer = "";
  stream.on("data", (chunk) => {
    buffer += chunk.toString();

    let newlineIndex = buffer.indexOf("\n");
    while (newlineIndex >= 0) {
      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);
      if (line) {
        onLine(line);
      }
      newlineIndex = buffer.indexOf("\n");
    }
  });
}

function stopWorker(record: WorkerRecord, reason: string) {
  appendTranscriberRuntimeLog(`dynamic-worker:${record.shortKey}`, "stopping", {
    reason,
    pid: record.process.pid ?? null,
    state: record.state,
  });
  try {
    record.process.kill();
  } catch {
    // ignore process kill errors
  }
}

function ensureJanitorRunning() {
  if (global.transcriberWorkerJanitorTimer) {
    return;
  }

  global.transcriberWorkerJanitorTimer = setInterval(() => {
    const registry = getWorkerRegistry();
    const now = Date.now();
    const idleTimeoutMs = getIdleTimeoutMs();

    for (const record of registry.values()) {
      if (record.state !== "ready") {
        continue;
      }
      if (now - record.lastUsedAt < idleTimeoutMs) {
        continue;
      }
      stopWorker(record, `idle>${idleTimeoutMs}ms`);
    }
  }, JANITOR_INTERVAL_MS);
}

function spawnWorker(
  key: string,
  credentials: LivekitDispatchCredentials,
  reason: string | undefined,
): WorkerRecord {
  const registry = getWorkerRegistry();
  const instanceId = crypto.randomUUID();
  const shortKey = key.slice(0, 12);
  const startupTimeoutMs = getStartupTimeoutMs();

  let resolveReady: (() => void) | null = null;
  let rejectReady: ((error: unknown) => void) | null = null;
  const readyPromise = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });

  const { command, args } = getSpawnCommandAndArgs();
  const child = spawn(command, args, {
    cwd: process.cwd(),
    env: {
      ...process.env,
      LIVEKIT_URL: credentials.livekitUrl,
      LIVEKIT_API_KEY: credentials.livekitApiKey,
      LIVEKIT_API_SECRET: credentials.livekitApiSecret,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  const record: WorkerRecord = {
    instanceId,
    key,
    shortKey,
    process: child,
    state: "starting",
    startedAt: Date.now(),
    lastUsedAt: Date.now(),
    readyPromise,
    resolveReady: () => {
      if (record.state === "ready") {
        return;
      }
      record.state = "ready";
      resolveReady?.();
      resolveReady = null;
      rejectReady = null;
      appendTranscriberRuntimeLog(`dynamic-worker:${record.shortKey}`, "ready", {
        pid: child.pid ?? null,
        startedAt: new Date(record.startedAt).toISOString(),
      });
    },
    rejectReady: (error: unknown) => {
      if (record.state === "ready") {
        return;
      }
      record.state = "failed";
      rejectReady?.(error);
      resolveReady = null;
      rejectReady = null;
      appendTranscriberRuntimeLog(`dynamic-worker:${record.shortKey}`, "failed", {
        error: error instanceof Error ? error.message : error,
        pid: child.pid ?? null,
      });
    },
    startupTimeout: setTimeout(() => {
      if (record.state === "ready") {
        return;
      }
      record.rejectReady(new Error(`Worker startup timeout after ${startupTimeoutMs}ms`));
      stopWorker(record, "startup-timeout");
    }, startupTimeoutMs),
  };

  const handleLogLine = (line: string, stream: "stdout" | "stderr") => {
    appendTranscriberRuntimeLog(`dynamic-worker:${record.shortKey}:${stream}`, line);
    if (line.toLowerCase().includes("registered worker")) {
      clearTimeout(record.startupTimeout);
      record.resolveReady();
    }
  };

  if (child.stdout) {
    attachLineReader(child.stdout, (line) => handleLogLine(line, "stdout"));
  }
  if (child.stderr) {
    attachLineReader(child.stderr, (line) => handleLogLine(line, "stderr"));
  }

  child.on("exit", (code, signal) => {
    clearTimeout(record.startupTimeout);

    if (record.state !== "ready") {
      record.rejectReady(
        new Error(`Worker exited before ready (code=${code ?? "null"}, signal=${signal ?? "null"})`),
      );
    }

    if (registry.get(key)?.instanceId === record.instanceId) {
      registry.delete(key);
    }
    appendTranscriberRuntimeLog(`dynamic-worker:${record.shortKey}`, "exited", {
      code,
      signal,
      reason,
      pid: child.pid ?? null,
    });
  });

  child.on("error", (error) => {
    clearTimeout(record.startupTimeout);
    record.rejectReady(error);
    stopWorker(record, "spawn-error");
  });

  appendTranscriberRuntimeLog(`dynamic-worker:${record.shortKey}`, "starting", {
    reason: reason ?? "unspecified",
    command,
    args,
    pid: child.pid ?? null,
  });

  return record;
}

export async function ensureTranscriberWorker(
  credentials: LivekitDispatchCredentials,
  options?: EnsureWorkerOptions,
) {
  ensureJanitorRunning();
  const registry = getWorkerRegistry();
  const key = toWorkerKey(credentials);

  let record = registry.get(key);
  if (!record || record.state === "failed") {
    if (record) {
      stopWorker(record, "restart-after-failure");
      registry.delete(key);
    }

    record = spawnWorker(key, credentials, options?.reason);
    registry.set(key, record);
  } else {
    appendTranscriberRuntimeLog(`dynamic-worker:${record.shortKey}`, "reusing-existing-worker", {
      reason: options?.reason ?? "unspecified",
      state: record.state,
      pid: record.process.pid ?? null,
      startedAt: new Date(record.startedAt).toISOString(),
    });
  }

  record.lastUsedAt = Date.now();

  if (options?.waitForReady !== false) {
    await record.readyPromise;
  }

  return {
    instanceId: record.instanceId,
    key: record.key,
    shortKey: record.shortKey,
    state: record.state,
    startedAt: new Date(record.startedAt).toISOString(),
  };
}

