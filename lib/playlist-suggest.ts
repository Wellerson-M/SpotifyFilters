export type VectorItem<T> = {
  item: T;
  vector: number[];
};

export type ClusterResult<T> = {
  k: number;
  assignments: number[];
  centroids: number[][];
  clusters: T[][];
  score: number;
};

function squaredDistance(a: number[], b: number[]) {
  let total = 0;
  for (let i = 0; i < a.length; i += 1) {
    const diff = a[i] - b[i];
    total += diff * diff;
  }
  return total;
}

function meanVector(vectors: number[][]): number[] {
  const size = vectors[0]?.length ?? 0;
  const acc = new Array<number>(size).fill(0);
  for (const vector of vectors) {
    for (let i = 0; i < size; i += 1) {
      acc[i] += vector[i];
    }
  }
  return acc.map((value) => value / vectors.length);
}

function assignPoints(vectors: number[][], centroids: number[][]): number[] {
  return vectors.map((vector) => {
    let bestIndex = 0;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let i = 0; i < centroids.length; i += 1) {
      const dist = squaredDistance(vector, centroids[i]);
      if (dist < bestDistance) {
        bestDistance = dist;
        bestIndex = i;
      }
    }
    return bestIndex;
  });
}

function randomUniqueIndexes(total: number, count: number) {
  const indices = Array.from({ length: total }, (_, i) => i);
  for (let i = indices.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }
  return indices.slice(0, count);
}

function recalcCentroids(vectors: number[][], assignments: number[], k: number): number[][] {
  const groups = Array.from({ length: k }, () => [] as number[][]);
  assignments.forEach((cluster, idx) => groups[cluster].push(vectors[idx]));

  return groups.map((clusterVectors, index) => {
    if (clusterVectors.length > 0) {
      return meanVector(clusterVectors);
    }
    const fallback = vectors[Math.floor(Math.random() * vectors.length)];
    return fallback.slice();
  });
}

function kmeans(vectors: number[][], k: number, maxIterations = 60) {
  const seedIndexes = randomUniqueIndexes(vectors.length, k);
  let centroids = seedIndexes.map((index) => vectors[index].slice());
  let assignments = assignPoints(vectors, centroids);

  for (let i = 0; i < maxIterations; i += 1) {
    const nextCentroids = recalcCentroids(vectors, assignments, k);
    const nextAssignments = assignPoints(vectors, nextCentroids);
    const changed = nextAssignments.some((value, idx) => value !== assignments[idx]);
    centroids = nextCentroids;
    assignments = nextAssignments;
    if (!changed) {
      break;
    }
  }

  return { centroids, assignments };
}

function evaluateHeuristic(vectors: number[][], assignments: number[], centroids: number[][], k: number) {
  const clusterSizes = new Array<number>(k).fill(0);
  let compactness = 0;
  assignments.forEach((cluster, index) => {
    clusterSizes[cluster] += 1;
    compactness += squaredDistance(vectors[index], centroids[cluster]);
  });

  const target = vectors.length / k;
  const balancePenalty =
    clusterSizes.reduce((sum, size) => sum + Math.abs(size - target), 0) / Math.max(vectors.length, 1);

  return compactness / Math.max(vectors.length, 1) + balancePenalty;
}

export function chooseBestKmeans<T>(
  items: VectorItem<T>[],
  minK = 8,
  maxK = 16,
  restartsPerK = 4,
): ClusterResult<T> {
  if (items.length < 2) {
    throw new Error("Sao necessarios pelo menos 2 embeddings para clusterizacao.");
  }

  const vectors = items.map((entry) => entry.vector);
  const maxAllowedK = Math.min(maxK, items.length);
  const minAllowedK = Math.min(minK, maxAllowedK);

  let best: ClusterResult<T> | null = null;

  for (let k = minAllowedK; k <= maxAllowedK; k += 1) {
    for (let restart = 0; restart < restartsPerK; restart += 1) {
      const { centroids, assignments } = kmeans(vectors, k);
      const score = evaluateHeuristic(vectors, assignments, centroids, k);
      if (!best || score < best.score) {
        const clusters = Array.from({ length: k }, () => [] as T[]);
        assignments.forEach((clusterIndex, itemIndex) => {
          clusters[clusterIndex].push(items[itemIndex].item);
        });
        best = { k, assignments, centroids, clusters, score };
      }
    }
  }

  if (!best) {
    throw new Error("Nao foi possivel gerar clusters.");
  }

  return best;
}

export function balanceTracksByArtist<T extends { artistName: string | null }>(
  tracks: T[],
  minTracks = 30,
  maxTracks = 80,
): T[] {
  const target = Math.max(Math.min(tracks.length, maxTracks), Math.min(minTracks, tracks.length));
  if (target <= 0) {
    return [];
  }

  const chosen: T[] = [];
  const artistCount = new Map<string, number>();

  const sorted = tracks.slice();

  const canTake = (track: T, cap: number) => {
    const key = track.artistName ?? "__unknown__";
    return (artistCount.get(key) ?? 0) < cap;
  };

  const take = (track: T) => {
    const key = track.artistName ?? "__unknown__";
    artistCount.set(key, (artistCount.get(key) ?? 0) + 1);
    chosen.push(track);
  };

  for (const cap of [1, 2, 999]) {
    for (const track of sorted) {
      if (chosen.length >= target) {
        return chosen;
      }
      if (chosen.includes(track)) {
        continue;
      }
      if (canTake(track, cap)) {
        take(track);
      }
    }
  }

  return chosen;
}
