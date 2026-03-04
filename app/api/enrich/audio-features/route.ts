import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getValidUserAccessToken } from "@/lib/spotify-auth";

const BATCH_SIZE = 100;
const MAX_RETRIES = 5;
const BASE_DELAY_MS = 800;

type SpotifyAudioFeaturesItem = {
  id: string;
  danceability: number;
  energy: number;
  key: number;
  loudness: number;
  mode: number;
  speechiness: number;
  acousticness: number;
  instrumentalness: number;
  liveness: number;
  valence: number;
  tempo: number;
  time_signature: number;
};

type SpotifyAudioFeaturesResponse = {
  audio_features: Array<SpotifyAudioFeaturesItem | null>;
};

type MissingTrack = {
  id: string;
  spotifyId: string;
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchAudioFeaturesBatch(accessToken: string, spotifyIds: string[]) {
  const url = new URL("https://api.spotify.com/v1/audio-features");
  url.searchParams.set("ids", spotifyIds.join(","));

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    const response = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      cache: "no-store",
    });

    if (response.ok) {
      return (await response.json()) as SpotifyAudioFeaturesResponse;
    }

    if (response.status === 429 && attempt < MAX_RETRIES) {
      const retryAfterHeader = response.headers.get("Retry-After");
      const retryAfterSeconds = retryAfterHeader ? Number(retryAfterHeader) : NaN;
      const retryDelayMs = Number.isFinite(retryAfterSeconds)
        ? Math.max(0, retryAfterSeconds * 1000)
        : BASE_DELAY_MS * 2 ** attempt;
      await sleep(retryDelayMs);
      continue;
    }

    if (response.status >= 500 && attempt < MAX_RETRIES) {
      await sleep(BASE_DELAY_MS * 2 ** attempt);
      continue;
    }

    if (response.status === 403) {
      throw new Error(
        "Spotify retornou 403 para audio-features. Seu app pode estar em Development Mode sem permissoes para este endpoint.",
      );
    }

    throw new Error(`Falha ao buscar audio features: ${response.status}`);
  }

  throw new Error("Limite de tentativas excedido ao buscar audio features.");
}

function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

export async function GET() {
  const missingCount = await db.track.count({
    where: { audioFeatures: null },
  });

  const totalTracks = await db.track.count();
  return NextResponse.json({
    data: {
      missingCount,
      totalTracks,
      completedCount: Math.max(totalTracks - missingCount, 0),
    },
  });
}

export async function POST() {
  try {
    const token = await getValidUserAccessToken();
    if (!token) {
      return NextResponse.json(
        { status: "deslogado", error: "Conecte sua conta Spotify primeiro." },
        { status: 401 },
      );
    }

    const missingTracks = (await db.track.findMany({
      where: { audioFeatures: null },
      select: {
        id: true,
        spotifyId: true,
      },
      orderBy: {
        createdAt: "asc",
      },
    })) as MissingTrack[];

    if (missingTracks.length === 0) {
      return NextResponse.json({
        status: "ok",
        data: {
          missingBefore: 0,
          persisted: 0,
          missingAfter: 0,
        },
      });
    }

    const trackBySpotifyId = new Map(
      missingTracks.map((track) => [track.spotifyId, track.id]),
    );
    const spotifyIdChunks = chunkArray(
      missingTracks.map((track) => track.spotifyId),
      BATCH_SIZE,
    );

    let persisted = 0;

    for (const spotifyIdChunk of spotifyIdChunks) {
      const accessToken = await getValidUserAccessToken();
      if (!accessToken) {
        return NextResponse.json(
          { status: "deslogado", error: "Sessao Spotify expirada durante enriquecimento." },
          { status: 401 },
        );
      }

      const payload = await fetchAudioFeaturesBatch(accessToken, spotifyIdChunk);

      for (const feature of payload.audio_features) {
        if (!feature) {
          continue;
        }

        const trackId = trackBySpotifyId.get(feature.id);
        if (!trackId) {
          continue;
        }

        await db.audioFeatures.upsert({
          where: { trackId },
          update: {
            danceability: feature.danceability,
            energy: feature.energy,
            key: feature.key,
            loudness: feature.loudness,
            mode: feature.mode,
            speechiness: feature.speechiness,
            acousticness: feature.acousticness,
            instrumentalness: feature.instrumentalness,
            liveness: feature.liveness,
            valence: feature.valence,
            tempo: feature.tempo,
            timeSignature: feature.time_signature,
          },
          create: {
            trackId,
            danceability: feature.danceability,
            energy: feature.energy,
            key: feature.key,
            loudness: feature.loudness,
            mode: feature.mode,
            speechiness: feature.speechiness,
            acousticness: feature.acousticness,
            instrumentalness: feature.instrumentalness,
            liveness: feature.liveness,
            valence: feature.valence,
            tempo: feature.tempo,
            timeSignature: feature.time_signature,
          },
        });

        persisted += 1;
      }
    }

    const missingAfter = await db.track.count({
      where: { audioFeatures: null },
    });

    return NextResponse.json({
      status: "ok",
      data: {
        missingBefore: missingTracks.length,
        persisted,
        missingAfter,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha inesperada ao enriquecer audio features.";
    return NextResponse.json({ status: "error", error: message }, { status: 500 });
  }
}
