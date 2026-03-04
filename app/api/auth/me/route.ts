import { NextResponse } from "next/server";
import { fetchSpotifyMe, getValidUserAccessToken } from "@/lib/spotify-auth";

export async function GET() {
  try {
    const accessToken = await getValidUserAccessToken();
    if (!accessToken) {
      return NextResponse.json({ status: "deslogado" }, { status: 401 });
    }

    const me = await fetchSpotifyMe(accessToken);
    return NextResponse.json({
      status: "logado",
      provider: "spotify",
      user: {
        id: me.id,
        displayName: me.display_name ?? null,
      },
    });
  } catch {
    return NextResponse.json({ status: "deslogado" }, { status: 401 });
  }
}
