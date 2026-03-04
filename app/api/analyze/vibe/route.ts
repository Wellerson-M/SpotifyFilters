import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { assertOpenAIConfigured, openai } from "@/lib/openai-client";
import { getValidUserAccessToken } from "@/lib/spotify-auth";
import {
  buildTrackProfile,
  chunkArray,
  parseVibeResult,
  runWithConcurrency,
  VIBE_PROMPT_VERSION,
} from "@/lib/vibe-analysis";

const SPOTIFY_TRACKS_BATCH_SIZE = 50;
const SPOTIFY_ARTISTS_BATCH_SIZE = 50;
const PROCESS_BATCH_SIZE = 24;
const MAX_CONCURRENCY = 3;
const MAX_RETRIES = 5;
const BASE_DELAY_MS = 800;
const DEFAULT_VIBE_MODEL = "gpt-4.1-mini";
const DEFAULT_EMBED_MODEL = "text-embedding-3-small";
const ANALYZE_LIMIT = Number(process.env.VIBE_ANALYZE_LIMIT ?? "60");
const MAX_ANALYZE_LIMIT = 2000;

type AnalyzeBody = {
  limit?: number;
  order?: "recent" | "oldest";
};

type SpotifyTrackInfo = {
  id: string;
  album: {
    release_date?: string;
  };
};

type SpotifyTracksResponse = {
  tracks: SpotifyTrackInfo[];
};

type SpotifyArtistInfo = {
  id: string;
  genres?: string[];
  popularity?: number;
};

type SpotifyArtistsResponse = {
  artists: SpotifyArtistInfo[];
};

type AnalyzableTrack = {
  id: string;
  spotifyId: string;
  name: string;
  importedAt: Date;
  artist: {
    id: string;
    spotifyId: string;
    name: string;
    genres: unknown;
    popularity: number | null;
  } | null;
  audioFeatures: {
    danceability: number;
    energy: number;
    valence: number;
    acousticness: number;
    instrumentalness: number;
    speechiness: number;
    liveness: number;
    tempo: number;
    loudness: number;
  } | null;
  vibeAnalysis: {
    embedding: unknown;
  } | null;
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithRetry(
  url: string,
  accessToken: string,
  notOkMessage: string,
): Promise<Response> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      cache: "no-store",
    });

    if (response.ok) {
      return response;
    }

    if (response.status === 429 && attempt < MAX_RETRIES) {
      const retryAfter = Number(response.headers.get("Retry-After"));
      const delayMs = Number.isFinite(retryAfter)
        ? Math.max(0, retryAfter * 1000)
        : BASE_DELAY_MS * 2 ** attempt;
      await sleep(delayMs);
      continue;
    }

    if (response.status >= 500 && attempt < MAX_RETRIES) {
      await sleep(BASE_DELAY_MS * 2 ** attempt);
      continue;
    }

    throw new Error(`${notOkMessage}: ${response.status}`);
  }

  throw new Error(`Tentativas esgotadas: ${notOkMessage}`);
}

function extractYear(value?: string) {
  if (!value) {
    return "desconhecido";
  }
  const match = value.match(/^(\d{4})/);
  return match ? match[1] : "desconhecido";
}

async function fetchTrackYears(
  spotifyIds: string[],
  accessToken: string,
): Promise<Map<string, string>> {
  const yearByTrackSpotifyId = new Map<string, string>();
  const chunks = chunkArray(spotifyIds, SPOTIFY_TRACKS_BATCH_SIZE);

  for (const ids of chunks) {
    const url = new URL("https://api.spotify.com/v1/tracks");
    url.searchParams.set("ids", ids.join(","));
    const response = await fetchWithRetry(
      url.toString(),
      accessToken,
      "Falha ao buscar metadata de tracks",
    );
    const payload = (await response.json()) as SpotifyTracksResponse;

    for (const track of payload.tracks ?? []) {
      yearByTrackSpotifyId.set(track.id, extractYear(track.album?.release_date));
    }
  }

  return yearByTrackSpotifyId;
}

async function fetchArtistMetadata(
  artistSpotifyIds: string[],
  accessToken: string,
): Promise<Map<string, { genres: string[]; popularity: number | null }>> {
  const metadataByArtistSpotifyId = new Map<string, { genres: string[]; popularity: number | null }>();
  const chunks = chunkArray(artistSpotifyIds, SPOTIFY_ARTISTS_BATCH_SIZE);

  for (const ids of chunks) {
    const url = new URL("https://api.spotify.com/v1/artists");
    url.searchParams.set("ids", ids.join(","));
    const response = await fetchWithRetry(
      url.toString(),
      accessToken,
      "Falha ao buscar metadata de artistas",
    );
    const payload = (await response.json()) as SpotifyArtistsResponse;

    for (const artist of payload.artists ?? []) {
      metadataByArtistSpotifyId.set(artist.id, {
        genres: artist.genres ?? [],
        popularity: typeof artist.popularity === "number" ? artist.popularity : null,
      });
    }
  }

  return metadataByArtistSpotifyId;
}

async function generateVibe(trackProfileText: string, modelName: string) {
  const response = await openai.chat.completions.create({
    model: modelName,
    temperature: 0.3,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "Voce analisa o perfil musical e retorna JSON valido com este formato: {\"tags\": string[], \"description\": string}. tags deve ter de 3 a 6 itens curtos. description deve ter 1-2 frases curtas em portugues.",
      },
      {
        role: "user",
        content: `PromptVersion=${VIBE_PROMPT_VERSION}\n${trackProfileText}`,
      },
    ],
  });

  const content = response.choices[0]?.message?.content ?? "";
  return parseVibeResult(content);
}

async function generateEmbedding(input: string, modelName: string) {
  const response = await openai.embeddings.create({
    model: modelName,
    input,
  });
  return response.data[0]?.embedding ?? [];
}

export async function GET() {
  const tracks = await db.track.findMany({
    select: {
      audioFeatures: { select: { id: true } },
      vibeAnalysis: { select: { embedding: true } },
    },
  });

  const isVibePending = (track: (typeof tracks)[number]) =>
    !track.vibeAnalysis ||
    !Array.isArray(track.vibeAnalysis.embedding) ||
    track.vibeAnalysis.embedding.length === 0;

  const missingCount = tracks.filter(isVibePending).length;
  const blockedCount = tracks.filter(
    (track: (typeof tracks)[number]) => isVibePending(track) && !track.audioFeatures,
  ).length;

  return NextResponse.json({
    data: {
      missingCount,
      blockedCount,
    },
  });
}

export async function POST(request: Request) {
  try {
    let parsedBody: AnalyzeBody = {};
    try {
      parsedBody = (await request.json()) as AnalyzeBody;
    } catch {
      parsedBody = {};
    }

    assertOpenAIConfigured();

    const vibeModel = process.env.OPENAI_VIBE_MODEL ?? DEFAULT_VIBE_MODEL;
    const embeddingModel = process.env.OPENAI_EMBEDDING_MODEL ?? DEFAULT_EMBED_MODEL;
    const spotifyToken = await getValidUserAccessToken();
    const requestedLimitRaw =
      typeof parsedBody.limit === "number" && Number.isFinite(parsedBody.limit)
        ? Math.floor(parsedBody.limit)
        : ANALYZE_LIMIT;
    const requestedLimit = Math.max(1, Math.min(MAX_ANALYZE_LIMIT, requestedLimitRaw));
    const requestedOrder = parsedBody.order === "oldest" ? "oldest" : "recent";

    const allTracks = (await db.track.findMany({
      include: {
        artist: true,
        audioFeatures: true,
        vibeAnalysis: true,
      },
      orderBy: { createdAt: "asc" },
    })) as AnalyzableTrack[];

    const allPendingTracks = allTracks.filter(
      (track: (typeof allTracks)[number]) =>
        !track.vibeAnalysis ||
        !Array.isArray(track.vibeAnalysis.embedding) ||
        track.vibeAnalysis.embedding.length === 0,
    );
    const sortedPendingTracks = allPendingTracks
      .slice()
      .sort((a: (typeof allPendingTracks)[number], b: (typeof allPendingTracks)[number]) =>
        requestedOrder === "recent"
          ? b.importedAt.getTime() - a.importedAt.getTime()
          : a.importedAt.getTime() - b.importedAt.getTime(),
      );
    const pendingTracks = sortedPendingTracks.slice(0, requestedLimit);

    if (pendingTracks.length === 0) {
      return NextResponse.json({
        status: "ok",
        data: {
          pending: 0,
          processed: 0,
          failed: 0,
          remaining: 0,
        },
      });
    }

    const trackSpotifyIds = pendingTracks.map((track: (typeof pendingTracks)[number]) => track.spotifyId);
    const artistSpotifyIds: string[] = Array.from(
      new Set(
        pendingTracks
          .map((track: (typeof pendingTracks)[number]) => track.artist?.spotifyId)
          .filter(
            (value: string | null | undefined): value is string =>
              typeof value === "string" && value.length > 0,
          ),
      ),
    );

    let yearByTrackSpotifyId = new Map<string, string>();
    let artistMetaBySpotifyId = new Map<string, { genres: string[]; popularity: number | null }>();

    if (spotifyToken) {
      try {
        yearByTrackSpotifyId = await fetchTrackYears(trackSpotifyIds, spotifyToken);
      } catch {
        yearByTrackSpotifyId = new Map<string, string>();
      }

      try {
        artistMetaBySpotifyId = await fetchArtistMetadata(artistSpotifyIds, spotifyToken);
      } catch {
        artistMetaBySpotifyId = new Map<string, { genres: string[]; popularity: number | null }>();
      }
    }

    let processed = 0;
    let failed = 0;
    let sampleError: string | null = null;
    const batches = chunkArray(pendingTracks, PROCESS_BATCH_SIZE);

    for (const batch of batches) {
      await runWithConcurrency(
        batch,
        MAX_CONCURRENCY,
        async (track: (typeof batch)[number]) => {
        try {
          const artistGenresFromDb = Array.isArray(track.artist?.genres)
            ? (track.artist?.genres as string[])
            : [];
          const artistMeta = track.artist?.spotifyId
            ? artistMetaBySpotifyId.get(track.artist.spotifyId)
            : undefined;

          const genres = artistGenresFromDb.length > 0 ? artistGenresFromDb : (artistMeta?.genres ?? []);
          const popularity =
            track.artist?.popularity ??
            (typeof artistMeta?.popularity === "number" ? artistMeta.popularity : null);
          const year = yearByTrackSpotifyId.get(track.spotifyId) ?? "desconhecido";

          const profile = buildTrackProfile({
            name: track.name,
            artists: track.artist?.name ? [track.artist.name] : [],
            genres,
            year,
            popularity,
            audioFeatures: track.audioFeatures
              ? {
                  danceability: track.audioFeatures.danceability,
                  energy: track.audioFeatures.energy,
                  valence: track.audioFeatures.valence,
                  acousticness: track.audioFeatures.acousticness,
                  instrumentalness: track.audioFeatures.instrumentalness,
                  speechiness: track.audioFeatures.speechiness,
                  liveness: track.audioFeatures.liveness,
                  tempo: track.audioFeatures.tempo,
                  loudness: track.audioFeatures.loudness,
                }
              : undefined,
          });

          const vibe = await generateVibe(profile, vibeModel);
          const embeddingInput = `${profile}\n\nDescricao: ${vibe.description}\nTags: ${vibe.tags.join(", ")}`;
          const embedding = await generateEmbedding(embeddingInput, embeddingModel);

          await db.vibeAnalysis.upsert({
            where: { trackId: track.id },
            update: {
              mood: vibe.tags[0] ?? "indefinido",
              tags: vibe.tags,
              summary: vibe.description,
              model: vibeModel,
              modelName: vibeModel,
              promptVersion: VIBE_PROMPT_VERSION,
              embedding,
            },
            create: {
              trackId: track.id,
              mood: vibe.tags[0] ?? "indefinido",
              tags: vibe.tags,
              summary: vibe.description,
              model: vibeModel,
              modelName: vibeModel,
              promptVersion: VIBE_PROMPT_VERSION,
              embedding,
            },
          });

          if (track.artist?.spotifyId && artistMeta) {
            await db.artist.update({
              where: { id: track.artist.id },
              data: {
                genres: artistMeta.genres,
                popularity: artistMeta.popularity,
              },
            });
          }

          processed += 1;
        } catch (error) {
          failed += 1;
          if (!sampleError) {
            sampleError = error instanceof Error ? error.message : "Erro desconhecido na analise de vibe.";
          }
        }
        },
      );
    }

    return NextResponse.json({
      status: "ok",
      data: {
        pending: pendingTracks.length,
        processed,
        failed,
        remaining: Math.max(allPendingTracks.length - pendingTracks.length, 0),
        usedLimit: requestedLimit,
        usedOrder: requestedOrder,
        sampleError,
        promptVersion: VIBE_PROMPT_VERSION,
        modelName: vibeModel,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha inesperada na analise de vibe.";
    return NextResponse.json({ status: "error", error: message }, { status: 500 });
  }
}
