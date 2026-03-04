import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function POST() {
  await db.authToken.deleteMany({
    where: { provider: "spotify" },
  });

  const cookieStore = await cookies();
  cookieStore.delete("spotify_pkce_verifier");
  cookieStore.delete("spotify_auth_state");

  return NextResponse.json({ status: "ok", message: "Logout realizado." });
}
