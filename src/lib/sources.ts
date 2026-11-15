import { readFileSync, statSync } from "node:fs";
import path from "node:path";

export type LogSource = {
  id: string;
  label: string;
  service: string;
  env: "production" | "staging" | "development";
  namespace: string;
  podPrefix: string;
  resourceId: string;
};

const ENVS = ["production", "staging", "development"] as const;

type SourceEnv = LogSource["env"];

const DEFAULT_SOURCES_PATH = path.join(process.cwd(), "config", "sources.json");

function sourcesFilePath(): string {
  const override = process.env.SOURCES_PATH?.trim();
  return override || DEFAULT_SOURCES_PATH;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireString(
  record: Record<string, unknown>,
  key: string,
  where: string,
): string {
  const value = record[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${where} is missing a non-empty "${key}"`);
  }
  return value;
}

function isSourceEnv(value: string): value is SourceEnv {
  return (ENVS as readonly string[]).includes(value);
}

function parseSources(raw: unknown, filePath: string): LogSource[] {
  if (!isRecord(raw)) {
    throw new Error(`${filePath} must be a JSON object`);
  }

  if (!isRecord(raw.clusters)) {
    throw new Error(`${filePath} must include a "clusters" object`);
  }

  const clusters = new Map<string, string>();
  for (const [name, resourceId] of Object.entries(raw.clusters)) {
    if (typeof resourceId !== "string" || resourceId.trim() === "") {
      throw new Error(
        `${filePath} cluster "${name}" must be a non-empty resource id`,
      );
    }
    clusters.set(name, resourceId);
  }

  if (!Array.isArray(raw.sources)) {
    throw new Error(`${filePath} must include a "sources" array`);
  }

  const seen = new Set<string>();

  return raw.sources.map((entry, index) => {
    const where = `${filePath} sources[${index}]`;
    if (!isRecord(entry)) {
      throw new Error(`${where} must be an object`);
    }

    const id = requireString(entry, "id", where);
    if (seen.has(id)) {
      throw new Error(`${filePath} has a duplicate source id "${id}"`);
    }
    seen.add(id);

    const env = requireString(entry, "env", where);
    if (!isSourceEnv(env)) {
      throw new Error(
        `${where} has env "${env}". Expected one of: ${ENVS.join(", ")}`,
      );
    }

    const cluster = requireString(entry, "cluster", where);
    const resourceId = clusters.get(cluster);
    if (!resourceId) {
      throw new Error(`${where} references unknown cluster "${cluster}"`);
    }

    return {
      id,
      label: requireString(entry, "label", where),
      service: requireString(entry, "service", where),
      env,
      namespace: requireString(entry, "namespace", where),
      podPrefix: requireString(entry, "podPrefix", where),
      resourceId,
    };
  });
}

let cached: { path: string; mtimeMs: number; sources: LogSource[] } | null =
  null;

export function getLogSources(): LogSource[] {
  const filePath = sourcesFilePath();

  let mtimeMs: number;
  try {
    mtimeMs = statSync(filePath).mtimeMs;
  } catch (error) {
    const code =
      error instanceof Error && "code" in error
        ? (error as NodeJS.ErrnoException).code
        : undefined;
    if (code === "ENOENT") {
      throw new Error(
        `Missing sources file at ${filePath}. Copy config/sources.example.json to config/sources.json and fill in the cluster resource ids.`,
      );
    }
    throw error;
  }

  if (cached && cached.path === filePath && cached.mtimeMs === mtimeMs) {
    return cached.sources;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(filePath, "utf8")) as unknown;
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`Invalid JSON in ${filePath}: ${error.message}`);
    }
    throw error;
  }

  const sources = parseSources(parsed, filePath);
  cached = { path: filePath, mtimeMs, sources };
  return sources;
}

export function getSourceById(id: string): LogSource | undefined {
  return getLogSources().find((source) => source.id === id);
}

export const TIME_RANGES = [
  { id: "15m", label: "Last 15 minutes", ms: 15 * 60 * 1000 },
  { id: "1h", label: "Last 1 hour", ms: 60 * 60 * 1000 },
  { id: "6h", label: "Last 6 hours", ms: 6 * 60 * 60 * 1000 },
  { id: "24h", label: "Last 24 hours", ms: 24 * 60 * 60 * 1000 },
  { id: "7d", label: "Last 7 days", ms: 7 * 24 * 60 * 60 * 1000 },
] as const;

export type TimeRangeId = (typeof TIME_RANGES)[number]["id"];
