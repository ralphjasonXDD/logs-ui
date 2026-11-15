"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";

type SourceOption = {
  id: string;
  label: string;
  service: string;
  env: string;
};

type TimeRangeOption = {
  id: string;
  label: string;
};

type LogEntry = {
  time: string;
  timeMs: number;
  message: string;
  level: string | null;
};

type LogsResponse = {
  source: SourceOption;
  range: string;
  search: string;
  entries: LogEntry[];
  nextBeforeMs: number | null;
  fetchedAt: string;
  error?: string;
};

const DEFAULT_SOURCE = "cms-production";
const DEFAULT_RANGE = "1h";

function levelClass(level: string | null): string {
  switch (level) {
    case "error":
    case "fatal":
      return "level-error";
    case "warn":
    case "warning":
      return "level-warn";
    case "debug":
    case "trace":
      return "level-debug";
    case "info":
      return "level-info";
    default:
      return "level-default";
  }
}

function formatTime(iso: string): string {
  const date = new Date(iso);
  return date.toLocaleString(undefined, {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function prettyMessage(message: string): string {
  try {
    return JSON.stringify(JSON.parse(message), null, 2);
  } catch {
    return message;
  }
}

export function LogsExplorer() {
  const [sources, setSources] = useState<SourceOption[]>([]);
  const [timeRanges, setTimeRanges] = useState<TimeRangeOption[]>([]);
  const [sourceId, setSourceId] = useState(DEFAULT_SOURCE);
  const [range, setRange] = useState(DEFAULT_RANGE);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [limit, setLimit] = useState(100);
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [nextBeforeMs, setNextBeforeMs] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});
  const [autoRefresh, setAutoRefresh] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function loadMeta() {
      try {
        const response = await fetch("/api/sources");
        const data = (await response.json()) as {
          sources?: SourceOption[];
          timeRanges?: TimeRangeOption[];
          error?: string;
        };
        if (!response.ok) {
          throw new Error(data.error || "Failed to load sources");
        }
        if (!data.sources || !data.timeRanges) {
          throw new Error("Failed to load sources");
        }
        if (cancelled) return;
        setSources(data.sources);
        setTimeRanges(data.timeRanges);
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : "Failed to load sources",
          );
        }
      }
    }

    void loadMeta();
    return () => {
      cancelled = true;
    };
  }, []);

  const selectedSource = useMemo(
    () => sources.find((source) => source.id === sourceId),
    [sources, sourceId],
  );

  const fetchLogs = useCallback(
    async (options?: { append?: boolean; beforeMs?: number | null }) => {
      const append = options?.append ?? false;
      if (append) setLoadingMore(true);
      else setLoading(true);

      setError(null);

      try {
        const params = new URLSearchParams({
          sourceId,
          range,
          search,
          limit: String(limit),
        });

        if (options?.beforeMs) {
          params.set("beforeMs", String(options.beforeMs));
        }

        const response = await fetch(`/api/logs?${params.toString()}`);
        const data = (await response.json()) as LogsResponse;

        if (!response.ok) {
          throw new Error(data.error || "Failed to fetch logs");
        }

        setEntries((prev) =>
          append ? [...prev, ...data.entries] : data.entries,
        );
        setNextBeforeMs(data.nextBeforeMs);
        setFetchedAt(data.fetchedAt);
        if (!append) setExpanded({});
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to fetch logs");
        if (!append) {
          setEntries([]);
          setNextBeforeMs(null);
        }
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [sourceId, range, search, limit],
  );

  useEffect(() => {
    void fetchLogs();
  }, [fetchLogs]);

  useEffect(() => {
    if (!autoRefresh) return;

    const id = window.setInterval(() => {
      void fetchLogs();
    }, 30000);

    return () => window.clearInterval(id);
  }, [autoRefresh, fetchLogs]);

  function onSubmitSearch(event: FormEvent) {
    event.preventDefault();
    setSearch(searchInput.trim());
  }

  function toggleExpanded(index: number) {
    setExpanded((prev) => ({ ...prev, [index]: !prev[index] }));
  }

  return (
    <div className="explorer">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden />
          <div>
            <p className="brand-kicker">Explore</p>
            <h1>Logs</h1>
          </div>
        </div>
        <div className="topbar-meta">
          {fetchedAt ? (
            <span className="meta-chip">
              Updated {new Date(fetchedAt).toLocaleTimeString()}
            </span>
          ) : null}
          <label className="toggle">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(event) => setAutoRefresh(event.target.checked)}
            />
            Auto-refresh
          </label>
        </div>
      </header>

      <section className="toolbar">
        <label className="field">
          <span>Source</span>
          <select
            value={sourceId}
            onChange={(event) => setSourceId(event.target.value)}
          >
            {sources.map((source) => (
              <option key={source.id} value={source.id}>
                {source.label}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>Time range</span>
          <select
            value={range}
            onChange={(event) => setRange(event.target.value)}
          >
            {timeRanges.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </label>

        <label className="field field-narrow">
          <span>Lines</span>
          <select
            value={limit}
            onChange={(event) => setLimit(Number(event.target.value))}
          >
            {[50, 100, 200, 500].map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>

        <form className="search-form" onSubmit={onSubmitSearch}>
          <label className="field field-grow">
            <span>Search</span>
            <input
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder='Filter log text, e.g. "error" or JWTAuthentication'
            />
          </label>
          <button type="submit" className="btn primary">
            Run query
          </button>
        </form>

        <button
          type="button"
          className="btn"
          onClick={() => void fetchLogs()}
          disabled={loading}
        >
          {loading ? "Loading…" : "Refresh"}
        </button>
      </section>

      <section className="status-row">
        <div>
          <strong>{selectedSource?.label ?? sourceId}</strong>
          <span className="muted">
            {" "}
            · {entries.length} line{entries.length === 1 ? "" : "s"}
            {search ? ` · filter “${search}”` : ""}
          </span>
        </div>
        {error ? <p className="error-text">{error}</p> : null}
      </section>

      <section className="logs-panel">
        {loading && entries.length === 0 ? (
          <div className="empty">Querying Azure Monitor via Grafana…</div>
        ) : null}

        {!loading && entries.length === 0 && !error ? (
          <div className="empty">No logs in this range.</div>
        ) : null}

        <ul className="log-list">
          {entries.map((entry, index) => {
            const open = Boolean(expanded[index]);
            return (
              <li key={`${entry.timeMs}-${index}`} className="log-row">
                <button
                  type="button"
                  className="log-main"
                  onClick={() => toggleExpanded(index)}
                >
                  <span className={`level-dot ${levelClass(entry.level)}`} />
                  <time dateTime={entry.time}>{formatTime(entry.time)}</time>
                  <span className="level-label">
                    {entry.level ?? "log"}
                  </span>
                  <code className={open ? "message open" : "message"}>
                    {open ? prettyMessage(entry.message) : entry.message}
                  </code>
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      <footer className="pager">
        <button
          type="button"
          className="btn"
          disabled={!nextBeforeMs || loadingMore || loading}
          onClick={() =>
            void fetchLogs({ append: true, beforeMs: nextBeforeMs })
          }
        >
          {loadingMore
            ? "Loading older…"
            : nextBeforeMs
              ? "Older logs →"
              : "No more pages"}
        </button>
        <p className="muted">
          Pages move backward in time using the oldest timestamp on screen.
        </p>
      </footer>
    </div>
  );
}
