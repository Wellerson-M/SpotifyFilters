import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { assertOpenAIConfigured, openai } from "@/lib/openai-client";
import { balanceTracksByArtist, chooseBestKmeans, type VectorItem } from "@/lib/playlist-suggest";
import { getValidUserAccessToken } from "@/lib/spotify-auth";

const PLAYLIST_MODEL = process.env.OPENAI_PLAYLIST_MODEL ?? "gpt-4.1-mini";

type SuggestionShape = {
  title: string;
  description: string;
  rationale: string;
};

function parseEmbedding(raw: unknown): number[] | null {
  if (!Array.isArray(raw)) {
    return null;
  }
  const values = raw.filter((entry) => typeof entry === "number") as number[];
  return values.length > 0 ? values : null;
}

async function generateSuggestionPayload(input: {
  sampleTracks: Array<{ name: string; artistName: string | null }>;
  topTags: string[];
}): Promise<SuggestionShape> {
  const sample = input.sampleTracks
    .slice(0, 12)
    .map((track) => `${track.name} - ${track.artistName ?? "artista desconhecido"}`)
    .join("\n");

  const prompt = [
    "Voce cria sugestoes de playlist em portugues.",
    "Retorne JSON valido com campos: title, description, rationale.",
    "title: curto e memoravel.",
    "description: 1-2 frases.",
    "rationale: 1-2 frases explicando por que essas faixas combinam.",
    `tags principais: ${input.topTags.join(", ") || "sem tags"}`,
    "amostra de faixas:",
    sample,
  ].join("\n");

  const response = await openai.chat.completions.create({
    model: PLAYLIST_MODEL,
    temperature: 0.6,
    response_format: { type: "json_object" },
    messages: [{ role: "user", content: prompt }],
  });

  const content = response.choices[0]?.message?.content ?? "{}";
  const parsed = JSON.parse(content) as Partial<SuggestionShape>;

  return {
    title: parsed.title?.trim() || "Mix sugerido",
    description: parsed.description?.trim() || "Selecao com faixas de vibe parecida.",
    rationale: parsed.rationale?.trim() || "Agrupamento baseado em embeddings de vibe.",
  };
}

function topTagsFromTracks(tracks: Array<{ tags: unknown }>) {
  const freq = new Map<string, number>();
  for (const track of tracks) {
    if (!Array.isArray(track.tags)) {
      continue;
    }
    for (const tag of track.tags) {
      if (typeof tag !== "string") {
        continue;
      }
      freq.set(tag, (freq.get(tag) ?? 0) + 1);
    }
  }
  return Array.from(freq.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([tag]) => tag);
}

function normalizeTrackIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.filter((value): value is string => typeof value === "string" && value.length > 0);
}

function buildFallbackCoverDataUrl(title: string) {
  const seed = Array.from(title).reduce((acc, char) => acc + char.charCodeAt(0), 0);
  const hueA = seed % 360;
  const hueB = (seed * 7) % 360;
  const bars = Array.from({ length: 8 }, (_, index) => 24 + ((seed + index * 17) % 78));
  const waves = Array.from({ length: 3 }, (_, index) => {
    const y = 52 + index * 23;
    const bend = 14 + ((seed + index * 9) % 18);
    return `M22 ${y} C52 ${y - bend}, 108 ${y + bend}, 138 ${y}`;
  });
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="160" height="160" viewBox="0 0 160 160">
      <defs>
        <linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="hsl(${hueA},70%,56%)" />
          <stop offset="100%" stop-color="hsl(${hueB},70%,38%)" />
        </linearGradient>
        <linearGradient id="bars" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stop-color="rgba(255,255,255,0.92)" />
          <stop offset="100%" stop-color="rgba(255,255,255,0.55)" />
        </linearGradient>
      </defs>
      <rect width="160" height="160" fill="url(#g)" rx="18" />
      <rect x="14" y="16" width="132" height="128" rx="16" fill="rgba(8,12,18,0.14)" />
      ${waves
        .map(
          (d) =>
            `<path d="${d}" fill="none" stroke="rgba(255,255,255,0.22)" stroke-width="3.2" stroke-linecap="round"/>`,
        )
        .join("")}
      ${bars
        .map((height, index) => {
          const width = 10;
          const gap = 5;
          const startX = 26;
          const x = startX + index * (width + gap);
          const y = 132 - height;
          return `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="4" fill="url(#bars)" />`;
        })
        .join("")}
      <circle cx="131" cy="28" r="7" fill="rgba(255,255,255,0.22)" />
    </svg>
  `
    .replace(/\n\s+/g, "")
    .trim();
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

type SpotifyTrackImageResponse = {
  tracks?: Array<{
    id: string;
    album?: {
      images?: Array<{ url?: string }>;
    };
  } | null>;
};

async function hydrateMissingAlbumCovers(
  tracks: Array<{ id: string; spotifyId: string; albumImageUrl: string | null }>,
) {
  const missing = tracks.filter((track) => !track.albumImageUrl).slice(0, 100);
  if (missing.length === 0) {
    return new Map<string, string>();
  }

  const accessToken = await getValidUserAccessToken();
  if (!accessToken) {
    return new Map<string, string>();
  }

  const url = new URL("https://api.spotify.com/v1/tracks");
  url.searchParams.set("ids", missing.map((track) => track.spotifyId).join(","));
  const response = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  if (!response.ok) {
    return new Map<string, string>();
  }

  const payload = (await response.json()) as SpotifyTrackImageResponse;
  const imageBySpotifyId = new Map<string, string>();
  for (const row of payload.tracks ?? []) {
    const imageUrl = row?.album?.images?.[0]?.url;
    if (!row?.id || !imageUrl) {
      continue;
    }
    imageBySpotifyId.set(row.id, imageUrl);
  }

  if (imageBySpotifyId.size > 0) {
    for (const track of missing) {
      const nextUrl = imageBySpotifyId.get(track.spotifyId);
      if (!nextUrl) {
        continue;
      }
      await db.track.update({
        where: { id: track.id },
        data: { albumImageUrl: nextUrl },
      });
    }
  }

  return imageBySpotifyId;
}

export async function GET() {
  const suggestions = await db.playlistSuggestion.findMany({
    orderBy: { createdAt: "desc" },
    take: 40,
  });

  const allTrackIds = Array.from(
    new Set(suggestions.flatMap((item) => normalizeTrackIds(item.trackIds))),
  );
  const tracks = allTrackIds.length
    ? await db.track.findMany({
        where: { id: { in: allTrackIds } },
        select: { id: true, spotifyId: true, albumImageUrl: true, name: true, artist: { select: { name: true } } },
      })
    : [];

  const hydratedImageBySpotifyId = await hydrateMissingAlbumCovers(
    tracks.map((track) => ({
      id: track.id,
      spotifyId: track.spotifyId,
      albumImageUrl: track.albumImageUrl,
    })),
  );

  const coverByTrackId = new Map(
    tracks
      .map((track) => ({
        id: track.id,
        image:
          (typeof track.albumImageUrl === "string" && track.albumImageUrl.length > 0
            ? track.albumImageUrl
            : hydratedImageBySpotifyId.get(track.spotifyId)) ?? null,
      }))
      .filter((track) => Boolean(track.image))
      .map((track) => [track.id, track.image as string]),
  );
  const trackById = new Map(
    tracks.map((track) => [
      track.id,
      {
        id: track.id,
        name: track.name,
        artistName: track.artist?.name ?? null,
      },
    ]),
  );

  const data = suggestions.map((item) => {
    const trackIds = normalizeTrackIds(item.trackIds);
    const title = item.title ?? item.name;
    const coverImageUrl =
      trackIds.map((id) => coverByTrackId.get(id)).find((value) => Boolean(value)) ??
      buildFallbackCoverDataUrl(title);
    const sampleTracks = trackIds
      .map((id) => trackById.get(id))
      .filter((value): value is { id: string; name: string; artistName: string | null } => Boolean(value))
      .slice(0, 6);
    return {
      ...item,
      coverImageUrl,
      sampleTracks,
    };
  });

  return NextResponse.json({ data });
}

export async function POST() {
  assertOpenAIConfigured();

  const rows = await db.vibeAnalysis.findMany({
    include: {
      track: {
        include: { artist: true },
      },
    },
  });

  const vectors: VectorItem<{
    trackId: string;
    trackName: string;
    artistName: string | null;
    tags: unknown;
  }>[] = [];

  for (const row of rows) {
    const embedding = parseEmbedding(row.embedding);
    if (!embedding) {
      continue;
    }
    vectors.push({
      vector: embedding,
      item: {
        trackId: row.trackId,
        trackName: row.track.name,
        artistName: row.track.artist?.name ?? null,
        tags: row.tags,
      },
    });
  }

  if (vectors.length < 8) {
    return NextResponse.json(
      {
        status: "error",
        error: "Embeddings insuficientes para montar playlists (minimo recomendado: 8).",
      },
      { status: 400 },
    );
  }

  const best = chooseBestKmeans(vectors, 8, 16, 4);
  const createdIds: string[] = [];

  for (const cluster of best.clusters) {
    if (cluster.length === 0) {
      continue;
    }

    const selected = balanceTracksByArtist(
      cluster.map((entry) => ({
        trackId: entry.trackId,
        trackName: entry.trackName,
        artistName: entry.artistName,
      })),
      30,
      80,
    );

    if (selected.length < 5) {
      continue;
    }

    const topTags = topTagsFromTracks(cluster);
    let payload: SuggestionShape;
    try {
      payload = await generateSuggestionPayload({
        sampleTracks: selected.map((track) => ({
          name: track.trackName,
          artistName: track.artistName,
        })),
        topTags,
      });
    } catch {
      payload = {
        title: "Mix sugerido",
        description: "Selecao com faixas de vibe parecida.",
        rationale: "Agrupamento por similaridade de embeddings e tags.",
      };
    }

    const created = await db.playlistSuggestion.create({
      data: {
        name: payload.title,
        title: payload.title,
        description: payload.description,
        trackIds: selected.map((track) => track.trackId),
        rationale: payload.rationale,
      },
      select: { id: true },
    });
    createdIds.push(created.id);
  }

  return NextResponse.json({
    status: "ok",
    data: {
      k: best.k,
      generated: createdIds.length,
      suggestionIds: createdIds,
    },
  });
}

type DeleteBody = {
  suggestionIds?: string[];
};

export async function DELETE(request: Request) {
  const body = (await request.json().catch(() => ({}))) as DeleteBody;
  const suggestionIds = Array.isArray(body.suggestionIds)
    ? body.suggestionIds.filter((id): id is string => typeof id === "string" && id.length > 0)
    : [];

  if (suggestionIds.length === 0) {
    return NextResponse.json(
      { status: "error", error: "Nenhuma sugestao selecionada para exclusao." },
      { status: 400 },
    );
  }

  const deleted = await db.playlistSuggestion.deleteMany({
    where: { id: { in: suggestionIds } },
  });

  return NextResponse.json({
    status: "ok",
    data: {
      requested: suggestionIds.length,
      deleted: deleted.count,
    },
  });
}
