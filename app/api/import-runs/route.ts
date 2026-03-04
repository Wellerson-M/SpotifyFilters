import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function GET() {
  const runs = await db.importRun.findMany({
    orderBy: { createdAt: "desc" },
    take: 20,
  });

  return NextResponse.json({ data: runs });
}

export async function POST() {
  const run = await db.importRun.create({
    data: {
      source: "spotify",
      status: "pending",
      startedAt: new Date(),
    },
  });

  return NextResponse.json({ data: run }, { status: 201 });
}
