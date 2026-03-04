import { describe, expect, it } from "vitest";
import { balanceTracksByArtist, chooseBestKmeans } from "./playlist-suggest";

describe("playlist-suggest utils", () => {
  it("balanceTracksByArtist limita repeticao por artista", () => {
    const tracks = Array.from({ length: 20 }, (_, i) => ({
      id: String(i),
      artistName: i < 12 ? "A" : "B",
    }));
    const selected = balanceTracksByArtist(tracks, 10, 10);
    const byArtist = selected.reduce<Record<string, number>>((acc, track) => {
      const key = track.artistName ?? "unknown";
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    }, {});
    expect(selected).toHaveLength(10);
    expect(byArtist.A ?? 0).toBeGreaterThan(0);
    expect(byArtist.B ?? 0).toBeGreaterThan(0);
  });

  it("chooseBestKmeans retorna clusters para range de K", () => {
    const data = Array.from({ length: 24 }, (_, i) => ({
      item: { id: i },
      vector: [i < 12 ? 0.1 + i * 0.01 : 0.9 + i * 0.01, i < 12 ? 0.2 : 0.8],
    }));

    const result = chooseBestKmeans(data, 2, 4, 2);
    expect(result.k).toBeGreaterThanOrEqual(2);
    expect(result.k).toBeLessThanOrEqual(4);
    expect(result.assignments).toHaveLength(24);
    expect(result.clusters.reduce((sum, cluster) => sum + cluster.length, 0)).toBe(24);
  });
});
