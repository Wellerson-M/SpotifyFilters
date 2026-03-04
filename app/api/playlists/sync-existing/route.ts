import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getValidUserAccessToken } from "@/lib/spotify-auth";

type SyncBody = {
  suggestionIds?: string[];
  limitPerPlaylist?: number;
};

const MAX_RETRIES = 5;
const BASE_DELAY_MS = 700;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

function normalizeTrackIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.filter((value): value is string => typeof value === "string" && value.length > 0);
}

function parseEmbedding(raw: unknown): number[] | null {
  if (!Array.isArray(raw)) {
    return null;
  }
  const values = raw.filter((entry): entry is number => typeof entry === "number");
  return values.length > 0 ? values : null;
}

function cosineSimilarity(a: number[], b: number[]) {
  if (a.length === 0 || b.length === 0 || a.length !== b.length) {
    return -1;
  }
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (!Number.isFinite(denominator) || denominator <= 0) {
    return -1;
  }
  return dot / denominator;
}

function centroid(vectors: number[][]): number[] {
  if (vectors.length === 0) {
    return [];
  }
  const size = vectors[0].length;
  const total = new Array<number>(size).fill(0);
  for (const vector of vectors) {
    for (let i = 0; i < size; i += 1) {
      total[i] += vector[i];
    }
  }
  return total.map((value) => value / vectors.length);
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
      // keep raw body
    }

    const message = detail ? `${notOkMessage}: ${response.status} - ${detail}` : `${notOkMessage}: ${response.status}`;
    throw new Error(message);
  }

  throw new Error(`Tentativas esgotadas: ${notOkMessage}`);
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as SyncBody;
    const accessToken = await getValidUserAccessToken();
    if (!accessToken) {
      return NextResponse.json(
        { status: "deslogado", error: "Conecte sua conta Spotify primeiro." },
        { status: 401 },
      );
    }

    const limitPerPlaylistRaw =
      typeof body.limitPerPlaylist === "number" && Number.isFinite(body.limitPerPlaylist)
        ? Math.floor(body.limitPerPlaylist)
        : 20;
    const limitPerPlaylist = Math.max(1, Math.min(100, limitPerPlaylistRaw));
    const suggestedIds = Array.isArray(body.suggestionIds)
      ? body.suggestionIds.filter((id): id is string => typeof id === "string" && id.length > 0)
      : [];

    const suggestions = await db.playlistSuggestion.findMany({
      where: {
        spotifyPlaylistId: { not: null },
        ...(suggestedIds.length > 0 ? { id: { in: suggestedIds } } : {}),
      },
      orderBy: { updatedAt: "desc" },
      take: 50,
    });

    if (suggestions.length === 0) {
      return NextResponse.json(
        { status: "error", error: "Nenhuma playlist criada no Spotify para sincronizar." },
        { status: 400 },
      );
    }

    const vibeRows = await db.vibeAnalysis.findMany({
      include: {
        track: {
          include: { artist: true },
        },
      },
    });

    const embeddingByTrackId = new Map<string, number[]>();
    const trackSpotifyById = new Map<string, string>();
    const artistByTrackId = new Map<string, string | null>();
    for (const row of vibeRows) {
      const embedding = parseEmbedding(row.embedding);
      if (!embedding) {
        continue;
      }
      embeddingByTrackId.set(row.trackId, embedding);
      trackSpotifyById.set(row.trackId, row.track.spotifyId);
      artistByTrackId.set(row.trackId, row.track.artist?.name ?? null);
    }

    const synced: Array<{ suggestionId: string; playlistId: string; addedTracks: number }> = [];
    const failed: Array<{ suggestionId: string; reason: string }> = [];

    for (const suggestion of suggestions) {
      try {
        const playlistId = suggestion.spotifyPlaylistId;
        if (!playlistId) {
          failed.push({ suggestionId: suggestion.id, reason: "Sugestao sem ID de playlist Spotify." });
          continue;
        }

        const currentTrackIds = normalizeTrackIds(suggestion.trackIds);
        const baseVectors = currentTrackIds
          .map((trackId) => embeddingByTrackId.get(trackId))
          .filter((value): value is number[] => Array.isArray(value) && value.length > 0);
        if (baseVectors.length === 0) {
          failed.push({ suggestionId: suggestion.id, reason: "Playlist sem embeddings base para comparar." });
          continue;
        }

        const center = centroid(baseVectors);
        const currentTrackIdSet = new Set(currentTrackIds);

        const candidates = Array.from(embeddingByTrackId.entries())
          .filter(([trackId]) => !currentTrackIdSet.has(trackId))
          .map(([trackId, embedding]) => ({
            trackId,
            similarity: cosineSimilarity(embedding, center),
            artistName: artistByTrackId.get(trackId) ?? null,
          }))
          .filter((entry) => entry.similarity >= 0.55)
          .sort((a, b) => b.similarity - a.similarity);

        const additions: string[] = [];
        const artistCount = new Map<string, number>();
        for (const entry of candidates) {
          if (additions.length >= limitPerPlaylist) {
            break;
          }
          const artistKey = entry.artistName ?? "__unknown__";
          if ((artistCount.get(artistKey) ?? 0) >= 2) {
            continue;
          }
          additions.push(entry.trackId);
          artistCount.set(artistKey, (artistCount.get(artistKey) ?? 0) + 1);
        }

        if (additions.length === 0) {
          continue;
        }

        const uris = additions
          .map((trackId) => trackSpotifyById.get(trackId))
          .filter((spotifyId): spotifyId is string => typeof spotifyId === "string" && spotifyId.length > 0)
          .map((spotifyId) => `spotify:track:${spotifyId}`);
        if (uris.length === 0) {
          failed.push({ suggestionId: suggestion.id, reason: "Nao foi possivel mapear URIs Spotify das novas faixas." });
          continue;
        }

        for (const uriChunk of chunkArray(uris, 100)) {
          await spotifyRequest(
            `https://api.spotify.com/v1/playlists/${encodeURIComponent(playlistId)}/items`,
            accessToken,
            {
              method: "POST",
              body: JSON.stringify({ uris: uriChunk }),
            },
            "Falha ao atualizar playlist existente",
          );
        }

        await db.playlistSuggestion.update({
          where: { id: suggestion.id },
          data: {
            trackIds: Array.from(new Set([...currentTrackIds, ...additions])),
            lastSyncedAt: new Date(),
          },
        });

        synced.push({
          suggestionId: suggestion.id,
          playlistId,
          addedTracks: uris.length,
        });
      } catch (error) {
        failed.push({
          suggestionId: suggestion.id,
          reason: error instanceof Error ? error.message : "Falha desconhecida na sincronizacao.",
        });
      }
    }

    return NextResponse.json({
      status: "ok",
      data: {
        requested: suggestions.length,
        updated: synced.length,
        synced,
        failed,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha inesperada ao sincronizar playlists.";
    return NextResponse.json({ status: "error", error: message }, { status: 500 });
  }
}
