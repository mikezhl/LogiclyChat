import fs from "node:fs";
import path from "node:path";

const TRANSCRIBER_RUNTIME_LOG_PATH = path.join(process.cwd(), "logs", "workers.log");
const MAX_LOG_DATA_LENGTH = 4000;

function stringifyLogData(data: unknown) {
  const seen = new WeakSet<object>();

  const serialized = JSON.stringify(data, (_key, value) => {
    if (value instanceof Error) {
      return {
        name: value.name,
        message: value.message,
        stack: value.stack,
      };
    }

    if (typeof value === "bigint") {
      return value.toString();
    }

    if (typeof value === "object" && value !== null) {
      if (seen.has(value)) {
        return "[Circular]";
      }
      seen.add(value);
    }

    return value;
  });

  if (!serialized) {
    return "";
  }

  if (serialized.length <= MAX_LOG_DATA_LENGTH) {
    return serialized;
  }

  return `${serialized.slice(0, MAX_LOG_DATA_LENGTH)}...<truncated>`;
}

export function appendTranscriberRuntimeLog(source: string, message: string, data?: unknown) {
  const logDir = path.dirname(TRANSCRIBER_RUNTIME_LOG_PATH);
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }

  const timestamp = new Date().toISOString();
  const dataStr = data === undefined ? "" : ` ${stringifyLogData(data)}`;
  fs.appendFileSync(TRANSCRIBER_RUNTIME_LOG_PATH, `[${timestamp}] [${source}] ${message}${dataStr}\n`);
}
