import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getValidUserAccessToken } from "@/lib/spotify-auth";

type SpotifySavedTrackItem = {
  added_at: string;
  track: {
    id: string;
    name: string;
    duration_ms: number;
    preview_url: string | null;
    album?: {
      name?: string | null;
      images?: Array<{ url?: string | null }>;
    } | null;
    artists: Array<{
      id: string;
      name: string;
    }>;
  } | null;
};

type SpotifySavedTracksResponse = {
  items: SpotifySavedTrackItem[];
  next: string | null;
  total: number;
};

const PAGE_SIZE = 50;

async function fetchSavedTracksPage(accessToken: string, offset: number) {
  const url = new URL("https://api.spotify.com/v1/me/tracks");
  url.searchParams.set("limit", String(PAGE_SIZE));
  url.searchParams.set("offset", String(offset));

  const response = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Falha ao listar curtidas: ${response.status}`);
  }

  return (await response.json()) as SpotifySavedTracksResponse;
}

export async function POST() {
  const initialToken = await getValidUserAccessToken();
  if (!initialToken) {
    return NextResponse.json(
      { status: "deslogado", error: "Conecte sua conta Spotify primeiro." },
      { status: 401 },
    );
  }

  const run = await db.importRun.create({
    data: {
      source: "spotify-liked",
      status: "running",
      startedAt: new Date(),
    },
  });

  let totalTracks = 0;
  let createdTracks = 0;
  let updatedTracks = 0;

  try {
    let offset = 0;
    let hasNext = true;

    while (hasNext) {
      const accessToken = await getValidUserAccessToken();
      if (!accessToken) {
        throw new Error("Sessao Spotify expirada.");
      }

      const page = await fetchSavedTracksPage(accessToken, offset);
      totalTracks = page.total;

      for (const item of page.items) {
        const track = item.track;
        if (!track || !track.id) {
          continue;
        }

        const firstArtist = track.artists[0];
        let artistId: string | null = null;

        if (firstArtist?.id) {
          const artist = await db.artist.upsert({
            where: { spotifyId: firstArtist.id },
            update: { name: firstArtist.name },
            create: {
              spotifyId: firstArtist.id,
              name: firstArtist.name,
            },
          });
          artistId = artist.id;
        }

        const existing = await db.track.findUnique({
          where: { spotifyId: track.id },
          select: { id: true },
        });

        if (existing) {
          await db.track.update({
            where: { spotifyId: track.id },
            data: {
              name: track.name,
              albumName: track.album?.name ?? null,
              albumImageUrl: track.album?.images?.[0]?.url ?? null,
              durationMs: track.duration_ms,
              previewUrl: track.preview_url,
              importedAt: new Date(item.added_at),
              artistId,
              importRunId: run.id,
            },
          });
          updatedTracks += 1;
        } else {
          await db.track.create({
            data: {
              spotifyId: track.id,
              name: track.name,
              albumName: track.album?.name ?? null,
              albumImageUrl: track.album?.images?.[0]?.url ?? null,
              durationMs: track.duration_ms,
              previewUrl: track.preview_url,
              importedAt: new Date(item.added_at),
              artistId,
              importRunId: run.id,
            },
          });
          createdTracks += 1;
        }
      }

      offset += PAGE_SIZE;
      hasNext = page.next !== null;
    }

    const completed = await db.importRun.update({
      where: { id: run.id },
      data: {
        status: "completed",
        completedAt: new Date(),
        totalTracks,
        createdTracks,
        updatedTracks,
      },
    });

    return NextResponse.json({
      status: "ok",
      data: completed,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro desconhecido";

    const failed = await db.importRun.update({
      where: { id: run.id },
      data: {
        status: "failed",
        completedAt: new Date(),
        totalTracks,
        createdTracks,
        updatedTracks,
        errorMessage: message,
      },
    });

    return NextResponse.json(
      {
        status: "error",
        error: "Falha ao importar curtidas.",
        data: failed,
      },
      { status: 500 },
    );
  }
}
