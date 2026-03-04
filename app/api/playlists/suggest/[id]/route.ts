import { NextResponse } from "next/server";
import { db } from "@/lib/db";

type Params = {
  params: Promise<{ id: string }>;
};

type UpdateBody = {
  title?: string;
  description?: string | null;
  rationale?: string | null;
};

export async function DELETE(_: Request, context: Params) {
  const { id } = await context.params;
  if (!id) {
    return NextResponse.json({ status: "error", error: "ID invalido." }, { status: 400 });
  }

  const deleted = await db.playlistSuggestion.deleteMany({
    where: { id },
  });

  if (deleted.count === 0) {
    return NextResponse.json({ status: "error", error: "Sugestao nao encontrada." }, { status: 404 });
  }

  return NextResponse.json({ status: "ok" });
}

export async function PATCH(request: Request, context: Params) {
  const { id } = await context.params;
  if (!id) {
    return NextResponse.json({ status: "error", error: "ID invalido." }, { status: 400 });
  }

  const body = (await request.json().catch(() => ({}))) as UpdateBody;

  const nextTitle = typeof body.title === "string" ? body.title.trim() : "";
  const hasTitle = nextTitle.length > 0;
  const hasDescription = body.description === null || typeof body.description === "string";
  const hasRationale = body.rationale === null || typeof body.rationale === "string";

  if (!hasTitle && !hasDescription && !hasRationale) {
    return NextResponse.json(
      { status: "error", error: "Envie ao menos title, description ou rationale." },
      { status: 400 },
    );
  }

  const data: {
    name?: string;
    title?: string;
    description?: string | null;
    rationale?: string | null;
  } = {};

  if (hasTitle) {
    data.name = nextTitle;
    data.title = nextTitle;
  }
  if (hasDescription) {
    data.description = typeof body.description === "string" ? body.description.trim() || null : null;
  }
  if (hasRationale) {
    data.rationale = typeof body.rationale === "string" ? body.rationale.trim() || null : null;
  }

  const updated = await db.playlistSuggestion.updateMany({
    where: { id },
    data,
  });

  if (updated.count === 0) {
    return NextResponse.json({ status: "error", error: "Sugestao nao encontrada." }, { status: 404 });
  }

  return NextResponse.json({ status: "ok" });
}
