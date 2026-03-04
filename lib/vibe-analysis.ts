export type VibeResult = {
  tags: string[];
  description: string;
};

type TrackProfile = {
  name: string;
  artists: string[];
  genres: string[];
  year: string;
  popularity: number | null;
  audioFeatures?: {
    danceability: number;
    energy: number;
    valence: number;
    acousticness: number;
    instrumentalness: number;
    speechiness: number;
    liveness: number;
    tempo: number;
    loudness: number;
  };
};

export const VIBE_PROMPT_VERSION = "v1";

export function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

export async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<void>,
) {
  if (concurrency < 1) {
    throw new Error("Concurrency deve ser >= 1.");
  }

  let cursor = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      await worker(items[index], index);
    }
  });

  await Promise.all(runners);
}

export function buildTrackProfile(profile: TrackProfile): string {
  const lines = [
    `Track: ${profile.name}`,
    `Artists: ${profile.artists.join(", ") || "desconhecido"}`,
    `Genres: ${profile.genres.join(", ") || "desconhecido"}`,
    `Year: ${profile.year}`,
    `Popularity: ${profile.popularity ?? "desconhecido"}`,
  ];

  if (profile.audioFeatures) {
    lines.push(
      "AudioFeatures:",
      `- danceability: ${profile.audioFeatures.danceability}`,
      `- energy: ${profile.audioFeatures.energy}`,
      `- valence: ${profile.audioFeatures.valence}`,
      `- acousticness: ${profile.audioFeatures.acousticness}`,
      `- instrumentalness: ${profile.audioFeatures.instrumentalness}`,
      `- speechiness: ${profile.audioFeatures.speechiness}`,
      `- liveness: ${profile.audioFeatures.liveness}`,
      `- tempo: ${profile.audioFeatures.tempo}`,
      `- loudness: ${profile.audioFeatures.loudness}`,
    );
  } else {
    lines.push("AudioFeatures: indisponivel");
  }

  return lines.join("\n");
}

function parseJsonFromText(raw: string): unknown {
  const trimmed = raw.trim();
  if (trimmed.startsWith("{")) {
    return JSON.parse(trimmed);
  }

  const match = trimmed.match(/```json\s*([\s\S]*?)```/i) ?? trimmed.match(/```([\s\S]*?)```/i);
  if (match?.[1]) {
    return JSON.parse(match[1].trim());
  }

  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first >= 0 && last > first) {
    return JSON.parse(trimmed.slice(first, last + 1));
  }

  throw new Error("Resposta da IA nao contem JSON valido.");
}

export function parseVibeResult(rawText: string): VibeResult {
  const parsed = parseJsonFromText(rawText);
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Formato de resposta invalido.");
  }

  const maybeTags = (parsed as { tags?: unknown }).tags;
  const maybeDescription = (parsed as { description?: unknown }).description;

  if (!Array.isArray(maybeTags) || !maybeTags.every((item) => typeof item === "string")) {
    throw new Error("Campo tags invalido.");
  }

  if (typeof maybeDescription !== "string" || !maybeDescription.trim()) {
    throw new Error("Campo description invalido.");
  }

  return {
    tags: maybeTags.slice(0, 8),
    description: maybeDescription.trim(),
  };
}
