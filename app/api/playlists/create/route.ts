import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getValidUserAccessToken } from "@/lib/spotify-auth";

type CreateBody = {
  suggestionIds?: string[];
};

type SpotifyCreatePlaylist = {
  id: string;
  external_urls?: { spotify?: string };
};

const MAX_RETRIES = 5;
const BASE_DELAY_MS = 700;
const SPOTIFY_ADD_TRACKS_403_HINT =
  "Spotify bloqueou a adicao de faixas (403). No Spotify Dashboard, confirme API Web habilitada, usuario adicionado em User Management (modo Development) e refaca login no app.";

function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

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

    const rawBody = await response.text().catch(() => "");
    let detail = rawBody;
    try {
      const parsed = JSON.parse(rawBody) as { error?: { message?: string } | string };
      if (typeof parsed.error === "string") {
        detail = parsed.error;
      } else if (parsed.error?.message) {
        detail = parsed.error.message;
      }
    } catch {
      // keep raw response body
    }

    const message = detail ? `${notOkMessage}: ${response.status} - ${detail}` : `${notOkMessage}: ${response.status}`;
    throw new Error(message);
  }

  throw new Error(`Tentativas esgotadas: ${notOkMessage}`);
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as CreateBody;
    const suggestionIds = Array.isArray(body.suggestionIds)
      ? body.suggestionIds.filter((id): id is string => typeof id === "string" && id.length > 0)
      : [];

    if (suggestionIds.length === 0) {
      return NextResponse.json({ status: "error", error: "Nenhuma sugestao selecionada." }, { status: 400 });
    }

    const accessToken = await getValidUserAccessToken();
    if (!accessToken) {
      return NextResponse.json(
        { status: "deslogado", error: "Conecte sua conta Spotify primeiro." },
        { status: 401 },
      );
    }

    const suggestions = await db.playlistSuggestion.findMany({
      where: { id: { in: suggestionIds } },
      orderBy: { createdAt: "asc" },
    });

    if (suggestions.length === 0) {
      return NextResponse.json({ status: "error", error: "Sugestoes nao encontradas." }, { status: 404 });
    }

    const created: Array<{
      suggestionId: string;
      playlistId: string;
      playlistUrl: string | null;
      tracksAdded: number;
    }> = [];
    const failed: Array<{
      suggestionId: string;
      reason: string;
    }> = [];

    for (const suggestion of suggestions) {
      let createdPlaylist: SpotifyCreatePlaylist | null = null;
      try {
        const trackIdsRaw = Array.isArray(suggestion.trackIds)
          ? (suggestion.trackIds as string[])
          : [];
        if (trackIdsRaw.length === 0) {
          failed.push({ suggestionId: suggestion.id, reason: "Sugestao sem tracks mapeadas." });
          continue;
        }

        const tracks = await db.track.findMany({
          where: { id: { in: trackIdsRaw } },
          select: { spotifyId: true },
        });
        const uris = tracks.map((track) => `spotify:track:${track.spotifyId}`);
        if (uris.length === 0) {
          failed.push({ suggestionId: suggestion.id, reason: "Nenhuma track valida para envio ao Spotify." });
          continue;
        }

        const createPlaylistResponse = await spotifyRequest(
          "https://api.spotify.com/v1/me/playlists",
          accessToken,
          {
            method: "POST",
            body: JSON.stringify({
              name: suggestion.title ?? suggestion.name,
              description: suggestion.description ?? "Playlist gerada automaticamente pelo Spotify Filters",
              public: false,
            }),
          },
          "Falha ao criar playlist",
        );
        const playlist = (await createPlaylistResponse.json()) as SpotifyCreatePlaylist;
        createdPlaylist = playlist;

        for (const uriChunk of chunkArray(uris, 100)) {
          await spotifyRequest(
            `https://api.spotify.com/v1/playlists/${encodeURIComponent(playlist.id)}/items`,
            accessToken,
            {
              method: "POST",
              body: JSON.stringify({ uris: uriChunk }),
            },
            "Falha ao adicionar faixas na playlist",
          );
        }

        created.push({
          suggestionId: suggestion.id,
          playlistId: playlist.id,
          playlistUrl: playlist.external_urls?.spotify ?? null,
          tracksAdded: uris.length,
        });

        await db.playlistSuggestion.update({
          where: { id: suggestion.id },
          data: {
            spotifyPlaylistId: playlist.id,
            spotifyPlaylistUrl: playlist.external_urls?.spotify ?? null,
            lastSyncedAt: new Date(),
          },
        });
      } catch (error) {
        if (createdPlaylist?.id) {
          await spotifyRequest(
            `https://api.spotify.com/v1/playlists/${encodeURIComponent(createdPlaylist.id)}/followers`,
            accessToken,
            { method: "DELETE" },
            "Falha ao remover playlist vazia apos erro",
          ).catch(() => undefined);
        }
        const rawReason =
          error instanceof Error ? error.message : "Falha desconhecida ao criar playlist.";
        const reason =
          rawReason.includes("Falha ao adicionar faixas na playlist: 403")
            ? `${rawReason}. ${SPOTIFY_ADD_TRACKS_403_HINT}`
            : rawReason;
        failed.push({
          suggestionId: suggestion.id,
          reason,
        });
      }
    }

    if (created.length === 0) {
      const sample = failed[0]?.reason ?? "Falha ao criar playlists.";
      return NextResponse.json(
        {
          status: "error",
          error: sample,
          data: { requested: suggestionIds.length, created: 0, failed },
        },
        { status: 400 },
      );
    }

    return NextResponse.json({
      status: "ok",
      data: {
        requested: suggestionIds.length,
        created: created.length,
        playlists: created,
        failed,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha inesperada ao criar playlists.";
    return NextResponse.json({ status: "error", error: message }, { status: 500 });
  }
}
