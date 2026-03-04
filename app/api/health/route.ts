import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    status: "ok",
    service: "spotify-filters",
    timestamp: new Date().toISOString(),
  });
}
