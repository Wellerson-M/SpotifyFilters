import { describe, expect, it } from "vitest";
import {
  buildTrackProfile,
  chunkArray,
  parseVibeResult,
  runWithConcurrency,
} from "./vibe-analysis";

describe("vibe-analysis utils", () => {
  it("chunkArray divide corretamente", () => {
    const chunks = chunkArray([1, 2, 3, 4, 5], 2);
    expect(chunks).toEqual([[1, 2], [3, 4], [5]]);
  });

  it("parseVibeResult aceita JSON em bloco markdown", () => {
    const raw = "```json\n{\"tags\":[\"energetica\",\"festa\"],\"description\":\"Boa para pista.\"}\n```";
    const parsed = parseVibeResult(raw);
    expect(parsed.tags).toEqual(["energetica", "festa"]);
    expect(parsed.description).toBe("Boa para pista.");
  });

  it("runWithConcurrency respeita limite maximo", async () => {
    const items = Array.from({ length: 12 }, (_, i) => i);
    let active = 0;
    let peak = 0;

    await runWithConcurrency(items, 3, async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 15));
      active -= 1;
    });

    expect(peak).toBeLessThanOrEqual(3);
  });

  it("buildTrackProfile inclui campos obrigatorios", () => {
    const text = buildTrackProfile({
      name: "Track X",
      artists: ["Artista Y"],
      genres: ["indie"],
      year: "2021",
      popularity: 55,
      audioFeatures: {
        danceability: 0.7,
        energy: 0.8,
        valence: 0.6,
        acousticness: 0.2,
        instrumentalness: 0.01,
        speechiness: 0.05,
        liveness: 0.15,
        tempo: 120,
        loudness: -7,
      },
    });

    expect(text).toContain("Track: Track X");
    expect(text).toContain("Artists: Artista Y");
    expect(text).toContain("Genres: indie");
    expect(text).toContain("Year: 2021");
  });
});
