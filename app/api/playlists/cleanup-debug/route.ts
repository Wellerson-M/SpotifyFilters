import { NextResponse } from "next/server";
import { getValidUserAccessToken } from "@/lib/spotify-auth";

type SpotifyPlaylistListResponse = {
  items?: Array<{ id: string; name: string }>;
  next?: string | null;
};

const MAX_RETRIES = 4;
const BASE_DELAY_MS = 600;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function spotifyRequest(
  url: string,
  accessToken: string,
  options: RequestInit = {},
  notOkMessage = "Spotify API error",
) {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    const response = await fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        ...(options.headers ?? {}),
      },
      cache: "no-store",
    });
    if (response.ok) {
      return response;
    }
    if ((response.status === 429 || response.status >= 500) && attempt < MAX_RETRIES) {
      const retryAfter = Number(response.headers.get("Retry-After"));
      const delayMs = Number.isFinite(retryAfter)
        ? Math.max(0, retryAfter * 1000)
        : BASE_DELAY_MS * 2 ** attempt;
      await sleep(delayMs);
      continue;
    }
    const text = await response.text().catch(() => "");
    throw new Error(text ? `${notOkMessage}: ${response.status} - ${text}` : `${notOkMessage}: ${response.status}`);
  }
  throw new Error(`Tentativas esgotadas: ${notOkMessage}`);
}

export async function POST(request: Request) {
  try {
    const accessToken = await getValidUserAccessToken();
    if (!accessToken) {
      return NextResponse.json(
        { status: "deslogado", error: "Conecte sua conta Spotify primeiro." },
        { status: 401 },
      );
    }

    const body = (await request.json().catch(() => ({}))) as { prefix?: string };
    const prefix = typeof body.prefix === "string" && body.prefix.trim() ? body.prefix.trim() : "_debug";

    const candidates: Array<{ id: string; name: string }> = [];
    let url: string | null = "https://api.spotify.com/v1/me/playlists?limit=50";
    while (url) {
      const response = await spotifyRequest(url, accessToken, { method: "GET" }, "Falha ao listar playlists");
      const payload = (await response.json()) as SpotifyPlaylistListResponse;
      for (const item of payload.items ?? []) {
        if (typeof item.name === "string" && item.name.startsWith(prefix)) {
          candidates.push({ id: item.id, name: item.name });
        }
      }
      url = payload.next ?? null;
    }

    const removed: Array<{ id: string; name: string }> = [];
    const failed: Array<{ id: string; reason: string }> = [];
    for (const playlist of candidates) {
      try {
        await spotifyRequest(
          `https://api.spotify.com/v1/playlists/${encodeURIComponent(playlist.id)}/followers`,
          accessToken,
          { method: "DELETE" },
          "Falha ao remover playlist debug",
        );
        removed.push(playlist);
      } catch (error) {
        failed.push({
          id: playlist.id,
          reason: error instanceof Error ? error.message : "Erro desconhecido ao remover playlist.",
        });
      }
    }

    return NextResponse.json({
      status: "ok",
      data: {
        prefix,
        found: candidates.length,
        removed: removed.length,
        failed,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha inesperada ao limpar playlists debug.";
    return NextResponse.json({ status: "error", error: message }, { status: 500 });
  }
}
