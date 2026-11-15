import { NextResponse } from "next/server";
import { getLogSources, TIME_RANGES } from "@/lib/sources";

export async function GET() {
  try {
    return NextResponse.json({
      sources: getLogSources().map(({ id, label, service, env }) => ({
        id,
        label,
        service,
        env,
      })),
      timeRanges: TIME_RANGES.map(({ id, label }) => ({ id, label })),
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to load sources";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
