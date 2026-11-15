import { getSourceById, type LogSource } from "./sources";

export type LogEntry = {
  time: string;
  timeMs: number;
  message: string;
  level: string | null;
};

type GrafanaFrame = {
  schema?: {
    fields?: Array<{ name?: string }>;
  };
  data?: {
    values?: unknown[][];
  };
};

type GrafanaQueryResponse = {
  results?: {
    A?: {
      status?: number;
      error?: string;
      frames?: GrafanaFrame[];
    };
  };
};

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing environment variable: ${name}`);
  }
  return value;
}

function escapeKustoString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function buildQuery(options: {
  source: LogSource;
  search: string;
  limit: number;
  beforeMs?: number;
}): string {
  const search = options.search.trim();
  const lines = [
    "ContainerLogV2",
    `| where PodNamespace == "${escapeKustoString(options.source.namespace)}"`,
    `| where PodName startswith "${escapeKustoString(options.source.podPrefix)}"`,
  ];

  if (options.beforeMs) {
    const beforeIso = new Date(options.beforeMs).toISOString();
    lines.push(`| where TimeGenerated < datetime(${beforeIso})`);
  }

  if (search) {
    lines.push(
      `| where LogMessage contains "${escapeKustoString(search)}"`,
    );
  }

  lines.push("| project TimeGenerated, LogMessage");
  lines.push("| order by TimeGenerated desc");
  lines.push(`| take ${options.limit}`);

  return lines.join("\n");
}

function detectLevel(message: string): string | null {
  try {
    const parsed = JSON.parse(message) as {
      level?: number | string;
      severity?: string;
    };
    if (typeof parsed.level === "string") return parsed.level.toLowerCase();
    if (typeof parsed.severity === "string") return parsed.severity.toLowerCase();
    if (typeof parsed.level === "number") {
      if (parsed.level >= 50) return "error";
      if (parsed.level >= 40) return "warn";
      if (parsed.level >= 30) return "info";
      return "debug";
    }
  } catch {
    // plain text logs
  }

  const lower = message.toLowerCase();
  if (/\berror\b|\bfatal\b|\bexception\b/.test(lower)) return "error";
  if (/\bwarn(ing)?\b/.test(lower)) return "warn";
  if (/\bdebug\b/.test(lower)) return "debug";
  if (/\binfo\b/.test(lower)) return "info";
  return null;
}

function toIso(value: unknown): { iso: string; ms: number } | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    // Azure/Grafana may return ms or ns-ish epoch; treat large values carefully
    const ms = value > 1e14 ? Math.floor(value / 1e6) : value;
    return { iso: new Date(ms).toISOString(), ms };
  }

  if (typeof value === "string" && value.trim()) {
    const ms = Date.parse(value);
    if (!Number.isNaN(ms)) {
      return { iso: new Date(ms).toISOString(), ms };
    }
  }

  return null;
}

function parseFrames(frames: GrafanaFrame[] | undefined): LogEntry[] {
  const frame = frames?.[0];
  if (!frame) return [];

  const fields = frame.schema?.fields ?? [];
  const values = frame.data?.values ?? [];
  const timeIdx = fields.findIndex((field) => field.name === "TimeGenerated");
  const messageIdx = fields.findIndex((field) => field.name === "LogMessage");

  if (timeIdx < 0 || messageIdx < 0) return [];

  const times = values[timeIdx] ?? [];
  const messages = values[messageIdx] ?? [];
  const count = Math.min(times.length, messages.length);
  const entries: LogEntry[] = [];

  for (let i = 0; i < count; i += 1) {
    const parsedTime = toIso(times[i]);
    const message = String(messages[i] ?? "");
    if (!parsedTime) continue;

    entries.push({
      time: parsedTime.iso,
      timeMs: parsedTime.ms,
      message,
      level: detectLevel(message),
    });
  }

  return entries;
}

export async function queryLogs(options: {
  sourceId: string;
  search?: string;
  limit?: number;
  fromMs: number;
  toMs: number;
  beforeMs?: number;
}): Promise<{
  source: LogSource;
  entries: LogEntry[];
  nextBeforeMs: number | null;
}> {
  const source = getSourceById(options.sourceId);
  if (!source) {
    throw new Error(`Unknown source: ${options.sourceId}`);
  }

  const limit = Math.min(Math.max(options.limit ?? 100, 1), 500);
  const grafanaUrl = requireEnv("GRAFANA_URL").replace(/\/$/, "");
  const token = requireEnv("GRAFANA_TOKEN");
  const datasourceUid =
    process.env.GRAFANA_DATASOURCE_UID ?? "azure-monitor-oob";

  const query = buildQuery({
    source,
    search: options.search ?? "",
    limit,
    beforeMs: options.beforeMs,
  });

  const response = await fetch(`${grafanaUrl}/api/ds/query`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: String(options.fromMs),
      to: String(options.toMs),
      queries: [
        {
          refId: "A",
          datasource: {
            type: "grafana-azure-monitor-datasource",
            uid: datasourceUid,
          },
          queryType: "Azure Log Analytics",
          azureLogAnalytics: {
            resultFormat: "logs",
            query,
            resources: [source.resourceId],
            timeColumn: "TimeGenerated",
          },
        },
      ],
    }),
    cache: "no-store",
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Grafana query failed (${response.status}): ${body}`);
  }

  const payload = (await response.json()) as GrafanaQueryResponse;
  const result = payload.results?.A;

  if (result?.error) {
    throw new Error(result.error);
  }

  const entries = parseFrames(result?.frames);
  const oldest = entries[entries.length - 1];
  const nextBeforeMs =
    entries.length >= limit && oldest ? oldest.timeMs : null;

  return { source, entries, nextBeforeMs };
}
