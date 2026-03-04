import { NextResponse } from "next/server";
import { db } from "@/lib/db";

type ChatGptPlaylist = {
  title?: unknown;
  description?: unknown;
  rationale?: unknown;
  track_spotify_ids?: unknown;
};

type ChatGptPlaylistUpdate = {
  existing_title?: unknown;
  description?: unknown;
  rationale?: unknown;
  add_track_spotify_ids?: unknown;
  remove_track_spotify_ids?: unknown;
};

type ChatGptPayload = {
  playlists?: unknown;
  playlist_updates?: unknown;
};

function extractJson(input: string): unknown {
  const trimmed = input.trim();
  if (trimmed.startsWith("{")) {
    return JSON.parse(trimmed);
  }

  const fenced =
    trimmed.match(/```json\s*([\s\S]*?)```/i) ?? trimmed.match(/```\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    return JSON.parse(fenced[1].trim());
  }

  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first >= 0 && last > first) {
    return JSON.parse(trimmed.slice(first, last + 1));
  }

  throw new Error("Nao foi possivel encontrar JSON valido no texto enviado.");
}

function normalizePlaylists(parsed: unknown): Array<{
  title: string;
  description: string | null;
  rationale: string | null;
  trackSpotifyIds: string[];
}> {
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Payload invalido.");
  }

  const payload = parsed as ChatGptPayload;
  if (!Array.isArray(payload.playlists)) {
    throw new Error("Campo 'playlists' deve ser um array.");
  }

  const normalized: Array<{
    title: string;
    description: string | null;
    rationale: string | null;
    trackSpotifyIds: string[];
  }> = [];

  for (const raw of payload.playlists) {
    const playlist = raw as ChatGptPlaylist;
    const title = typeof playlist.title === "string" ? playlist.title.trim() : "";
    if (!title) {
      continue;
    }

    const ids = Array.isArray(playlist.track_spotify_ids)
      ? playlist.track_spotify_ids.filter(
          (item): item is string => typeof item === "string" && item.trim().length > 0,
        )
      : [];

    if (ids.length === 0) {
      continue;
    }

    normalized.push({
      title,
      description:
        typeof playlist.description === "string" && playlist.description.trim()
          ? playlist.description.trim()
          : null,
      rationale:
        typeof playlist.rationale === "string" && playlist.rationale.trim()
          ? playlist.rationale.trim()
          : null,
      trackSpotifyIds: Array.from(new Set(ids)),
    });
  }

  if (normalized.length === 0) {
    throw new Error("Nenhuma playlist valida encontrada no payload.");
  }

  return normalized;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { input?: string };
    const input = typeof body.input === "string" ? body.input : "";
    if (!input.trim()) {
      return NextResponse.json({ status: "error", error: "Envie o texto/JSON do ChatGPT." }, { status: 400 });
    }

    const parsed = extractJson(input);
    const payloadObj = parsed as ChatGptPayload;
    const playlists = Array.isArray(payloadObj.playlists) ? normalizePlaylists(parsed) : [];
    const playlistUpdates = normalizePlaylistUpdates(parsed);

    if (playlists.length === 0 && playlistUpdates.length === 0) {
      return NextResponse.json(
        {
          status: "error",
          error: "Nenhuma playlist valida encontrada no payload (playlists ou playlist_updates).",
        },
        { status: 400 },
      );
    }

    const allSpotifyIds = Array.from(
      new Set([
        ...playlists.flatMap((playlist) => playlist.trackSpotifyIds),
        ...playlistUpdates.flatMap((update) => [...update.addTrackSpotifyIds, ...update.removeTrackSpotifyIds]),
      ]),
    );
    const tracks = await db.track.findMany({
      where: {
        spotifyId: { in: allSpotifyIds },
      },
      select: {
        id: true,
        spotifyId: true,
      },
    });

    const trackIdBySpotifyId = new Map(tracks.map((track) => [track.spotifyId, track.id]));

    const created: Array<{ id: string; title: string; mappedTracks: number; missingTracks: number }> = [];
    for (const playlist of playlists) {
      const trackIds = playlist.trackSpotifyIds
        .map((spotifyId) => trackIdBySpotifyId.get(spotifyId))
        .filter((value): value is string => Boolean(value));

      if (trackIds.length === 0) {
        continue;
      }

      const row = await db.playlistSuggestion.create({
        data: {
          name: playlist.title,
          title: playlist.title,
          description: playlist.description,
          rationale: playlist.rationale,
          trackIds,
        },
        select: { id: true },
      });

      created.push({
        id: row.id,
        title: playlist.title,
        mappedTracks: trackIds.length,
        missingTracks: Math.max(playlist.trackSpotifyIds.length - trackIds.length, 0),
      });
    }

    const existingSuggestions = await db.playlistSuggestion.findMany({
      select: { id: true, title: true, name: true, trackIds: true },
    });
    const suggestionByTitle = new Map(
      existingSuggestions.map((row) => [normalizeTitle(row.title ?? row.name), row]),
    );

    const updated: Array<{
      id: string;
      title: string;
      addedTracks: number;
      removedTracks: number;
      missingAddTracks: number;
      missingRemoveTracks: number;
    }> = [];
    const updateNotFound: string[] = [];

    for (const update of playlistUpdates) {
      const key = normalizeTitle(update.existingTitle);
      const row = suggestionByTitle.get(key);
      if (!row) {
        updateNotFound.push(update.existingTitle);
        continue;
      }

      const currentTrackIds = Array.isArray(row.trackIds)
        ? row.trackIds.filter((value): value is string => typeof value === "string" && value.length > 0)
        : [];
      const currentSet = new Set(currentTrackIds);

      const addMapped = update.addTrackSpotifyIds
        .map((spotifyId) => trackIdBySpotifyId.get(spotifyId))
        .filter((value): value is string => Boolean(value));
      const removeMapped = update.removeTrackSpotifyIds
        .map((spotifyId) => trackIdBySpotifyId.get(spotifyId))
        .filter((value): value is string => Boolean(value));

      let added = 0;
      for (const trackId of addMapped) {
        if (!currentSet.has(trackId)) {
          currentSet.add(trackId);
          added += 1;
        }
      }

      let removed = 0;
      for (const trackId of removeMapped) {
        if (currentSet.has(trackId)) {
          currentSet.delete(trackId);
          removed += 1;
        }
      }

      await db.playlistSuggestion.update({
        where: { id: row.id },
        data: {
          trackIds: Array.from(currentSet),
          description: update.description,
          rationale: update.rationale,
        },
      });

      updated.push({
        id: row.id,
        title: row.title ?? row.name,
        addedTracks: added,
        removedTracks: removed,
        missingAddTracks: Math.max(update.addTrackSpotifyIds.length - addMapped.length, 0),
        missingRemoveTracks: Math.max(update.removeTrackSpotifyIds.length - removeMapped.length, 0),
      });
    }

    if (created.length === 0 && updated.length === 0) {
      return NextResponse.json(
        {
          status: "error",
          error:
            "Nenhuma alteracao aplicada. Verifique se os track_spotify_ids existem no banco e se existing_title bate com playlists existentes.",
        },
        { status: 400 },
      );
    }

    return NextResponse.json({
      status: "ok",
      data: {
        received: playlists.length + playlistUpdates.length,
        created: created.length,
        updated: updated.length,
        playlists: created,
        playlistUpdates: updated,
        updateNotFound,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha ao importar resposta manual do ChatGPT.";
    return NextResponse.json({ status: "error", error: message }, { status: 500 });
  }
}

function normalizeTitle(value: string) {
  return value.trim().toLowerCase();
}

function normalizePlaylistUpdates(parsed: unknown): Array<{
  existingTitle: string;
  description: string | null;
  rationale: string | null;
  addTrackSpotifyIds: string[];
  removeTrackSpotifyIds: string[];
}> {
  if (!parsed || typeof parsed !== "object") {
    return [];
  }
  const payload = parsed as ChatGptPayload;
  if (!Array.isArray(payload.playlist_updates)) {
    return [];
  }

  const updates: Array<{
    existingTitle: string;
    description: string | null;
    rationale: string | null;
    addTrackSpotifyIds: string[];
    removeTrackSpotifyIds: string[];
  }> = [];

  for (const raw of payload.playlist_updates) {
    const update = raw as ChatGptPlaylistUpdate;
    const existingTitle =
      typeof update.existing_title === "string" && update.existing_title.trim()
        ? update.existing_title.trim()
        : "";
    if (!existingTitle) {
      continue;
    }

    const addTrackSpotifyIds = Array.isArray(update.add_track_spotify_ids)
      ? Array.from(
          new Set(
            update.add_track_spotify_ids.filter(
              (item): item is string => typeof item === "string" && item.trim().length > 0,
            ),
          ),
        )
      : [];

    const removeTrackSpotifyIds = Array.isArray(update.remove_track_spotify_ids)
      ? Array.from(
          new Set(
            update.remove_track_spotify_ids.filter(
              (item): item is string => typeof item === "string" && item.trim().length > 0,
            ),
          ),
        )
      : [];

    updates.push({
      existingTitle,
      description:
        typeof update.description === "string" && update.description.trim()
          ? update.description.trim()
          : null,
      rationale:
        typeof update.rationale === "string" && update.rationale.trim()
          ? update.rationale.trim()
          : null,
      addTrackSpotifyIds,
      removeTrackSpotifyIds,
    });
  }

  return updates;
}
