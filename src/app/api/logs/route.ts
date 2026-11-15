import { NextRequest, NextResponse } from "next/server";
import { queryLogs } from "@/lib/grafana";
import { TIME_RANGES, type TimeRangeId } from "@/lib/sources";

export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;
    const sourceId = params.get("sourceId");
    const search = params.get("search") ?? "";
    const rangeId = (params.get("range") ?? "1h") as TimeRangeId;
    const limit = Number(params.get("limit") ?? "100");
    const beforeMsRaw = params.get("beforeMs");

    if (!sourceId) {
      return NextResponse.json(
        { error: "sourceId is required" },
        { status: 400 },
      );
    }

    const range = TIME_RANGES.find((item) => item.id === rangeId);
    if (!range) {
      return NextResponse.json({ error: "Invalid range" }, { status: 400 });
    }

    const toMs = Date.now();
    const fromMs = toMs - range.ms;
    const beforeMs = beforeMsRaw ? Number(beforeMsRaw) : undefined;

    if (beforeMsRaw && !Number.isFinite(beforeMs)) {
      return NextResponse.json({ error: "Invalid beforeMs" }, { status: 400 });
    }

    const result = await queryLogs({
      sourceId,
      search,
      limit: Number.isFinite(limit) ? limit : 100,
      fromMs,
      toMs,
      beforeMs,
    });

    return NextResponse.json({
      source: {
        id: result.source.id,
        label: result.source.label,
        service: result.source.service,
        env: result.source.env,
      },
      range: range.id,
      search,
      entries: result.entries,
      nextBeforeMs: result.nextBeforeMs,
      fetchedAt: new Date().toISOString(),
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to query logs";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
