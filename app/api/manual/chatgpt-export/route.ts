import { NextResponse } from "next/server";
import { db } from "@/lib/db";

function parseLimit(raw: string | null) {
  const value = raw ? Number(raw) : 600;
  if (!Number.isFinite(value)) return 600;
  return Math.max(1, Math.min(2000, Math.floor(value)));
}

function normalizeOrder(raw: string | null): "recent" | "oldest" {
  return raw === "oldest" ? "oldest" : "recent";
}

function normalizeFormat(raw: string | null): "txt" | "json" {
  return raw === "json" ? "json" : "txt";
}

function getCoverageTargets(totalTracks: number) {
  if (totalTracks >= 1000) {
    return { minPlaylists: 12, minCoveragePercent: 70, minTracksPerPlaylist: 35 };
  }
  if (totalTracks >= 600) {
    return { minPlaylists: 9, minCoveragePercent: 65, minTracksPerPlaylist: 30 };
  }
  if (totalTracks >= 250) {
    return { minPlaylists: 6, minCoveragePercent: 60, minTracksPerPlaylist: 24 };
  }
  if (totalTracks >= 80) {
    return { minPlaylists: 3, minCoveragePercent: 55, minTracksPerPlaylist: 18 };
  }
  return { minPlaylists: 1, minCoveragePercent: 45, minTracksPerPlaylist: 12 };
}

function buildManualPrompt(hasExistingSuggestions: boolean, totalTracks: number) {
  const targets = getCoverageTargets(totalTracks);
  const outputSection = hasExistingSuggestions
    ? [
        "Formato de saida (JSON valido - use SOMENTE playlist_updates):",
        "{",
        '  "playlist_updates": [',
        "    {",
        '      "existing_title": "string",',
        '      "add_track_spotify_ids": ["string"],',
        '      "remove_track_spotify_ids": ["string"],',
        '      "rationale": "string",',
        '      "description": "string (opcional)"',
        "    }",
        "  ]",
        "}",
      ]
    : [
        "Formato de saida (JSON valido - use SOMENTE playlists):",
        "{",
        '  "playlists": [',
        "    {",
        '      "title": "string",',
        '      "description": "string",',
        '      "rationale": "string",',
        '      "track_spotify_ids": ["string"]',
        "    }",
        "  ]",
        "}",
      ];

  const modeRules = hasExistingSuggestions
    ? [
        "Regra de modo ativa:",
        "- existing_suggestions tem itens -> resposta deve conter apenas 'playlist_updates'.",
        "- existing_title deve bater exatamente com playlist existente no contexto.",
        "- Nao use chave 'playlists' nesta rodada.",
      ]
    : [
        "Regra de modo ativa:",
        "- existing_suggestions esta vazio -> resposta deve conter apenas 'playlists'.",
        "- Nao use chave 'playlist_updates' nesta rodada.",
      ];

  const modeSpecificRule = hasExistingSuggestions
    ? "- Use add_track_spotify_ids para acrescentar e remove_track_spotify_ids para tirar faixas que nao combinam."
    : "- Use track_spotify_ids para definir as faixas de cada nova playlist.";

  const coverageRules = hasExistingSuggestions
    ? [
        "Minimo aceitavel desta rodada (modo update):",
        `- Priorize atualizar o maximo possivel sem quebrar identidade; nao entregue resposta superficial.`,
        `- Se houver material suficiente, tente atualizar pelo menos ${Math.max(2, Math.floor(targets.minPlaylists / 2))} playlists existentes.`,
      ]
    : [
        "Minimo aceitavel desta rodada (modo criacao):",
        `- Gere pelo menos ${targets.minPlaylists} playlists (se houver material suficiente).`,
        `- Busque cobertura minima de ${targets.minCoveragePercent}% das faixas elegiveis do dataset.`,
        `- Evite playlists muito curtas; alvo minimo de ${targets.minTracksPerPlaylist} faixas por playlist (exceto casos muito nichados).`,
      ];

  return [
    "Voce e um especialista em curadoria musical orientado por dados.",
    "Use o dataset enviado como fonte principal e obrigatoria.",
    "Se a ferramenta permitir navegacao/pesquisa, voce pode enriquecer com sinais externos (reviews, comentarios publicos, recepcao cultural, contexto de epoca) para melhorar a coesao.",
    "Se navegacao NAO estiver disponivel, nao invente fatos externos: decida apenas pelo dataset.",
    "",
    "Objetivo da curadoria:",
    "- decidir de forma livre quantas playlists fazem sentido para este conjunto",
    "- voce nao precisa bater nenhum numero fixo; prefira qualidade e sentido curatorial",
    "- equilibrar artistas para evitar repeticao excessiva",
    "- priorizar coesao de vibe e narrativa sonora",
    "- definir o tamanho de cada playlist de forma natural (algumas podem ser maiores, outras menores)",
    "- excluir faixas que fujam da proposta da playlist, mesmo que sejam populares",
    "",
    "Processo recomendado:",
    "1) Entender clusters por audio_features + vibe_analysis + generos + ano.",
    "2) Definir tema de cada playlist (energia, emocao, ambiente, epoca, estilo).",
    "3) (Opcional) Enriquecer com sinais externos curtos para validar se a percepcao publica combina com o tema.",
    "4) Selecionar faixas e justificar inclusao/exclusao no rationale.",
    "",
    ...outputSection,
    "",
    ...modeRules,
    "- Nao retorne vazio se houver faixas suficientes para curadoria.",
    "",
    "Regras obrigatorias:",
    "- Nao invente IDs.",
    "- Use apenas IDs existentes no dataset de tracks.",
    modeSpecificRule,
    "- Nao inclua a mesma faixa em playlists diferentes, exceto quando realmente necessario.",
    "- Se usar contexto externo, mantenha apenas inferencias curtas e plausiveis no rationale; nao cite links.",
    "- Se estiver em duvida sobre encaixe, prefira NAO incluir a faixa.",
    "- Evite atomizar demais: so crie uma nova playlist quando houver identidade propria clara.",
    ...coverageRules,
    "",
    "Qualidade esperada:",
    "- Playlists com identidade clara (nao genericas).",
    "- Boa progressao interna (inicio/meio/fim coerentes).",
    "- Diversidade suficiente sem perder tema.",
    "",
    "Contexto abaixo (use como verdade principal):",
    "- existing_suggestions: playlists ja existentes no app e seus IDs de faixa atuais.",
    "- tracks: catalogo completo de faixas para decidir inclusao/remocao.",
  ].join("\n");
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const limit = parseLimit(url.searchParams.get("limit"));
  const order = normalizeOrder(url.searchParams.get("order"));
  const format = normalizeFormat(url.searchParams.get("format"));

  const rows = await db.track.findMany({
    include: {
      artist: true,
      audioFeatures: true,
      vibeAnalysis: true,
    },
    orderBy: {
      importedAt: order === "recent" ? "desc" : "asc",
    },
    take: limit,
  });

  const tracks = rows.map((track) => ({
    id: track.id,
    spotify_id: track.spotifyId,
    name: track.name,
    album_name: track.albumName,
    imported_at: track.importedAt.toISOString(),
    artist: track.artist
      ? {
          id: track.artist.id,
          spotify_id: track.artist.spotifyId,
          name: track.artist.name,
          genres: track.artist.genres ?? [],
          popularity: track.artist.popularity,
        }
      : null,
    audio_features: track.audioFeatures
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
      : null,
    vibe_analysis: track.vibeAnalysis
      ? {
          tags: track.vibeAnalysis.tags ?? [],
          summary: track.vibeAnalysis.summary,
          mood: track.vibeAnalysis.mood,
        }
      : null,
  }));

  const existingSuggestionRows = await db.playlistSuggestion.findMany({
    orderBy: { createdAt: "desc" },
    take: 60,
    select: {
      id: true,
      title: true,
      name: true,
      description: true,
      rationale: true,
      trackIds: true,
      spotifyPlaylistId: true,
      spotifyPlaylistUrl: true,
    },
  });
  const allSuggestionTrackIds = Array.from(
    new Set(
      existingSuggestionRows.flatMap((row) =>
        Array.isArray(row.trackIds)
          ? row.trackIds.filter((value): value is string => typeof value === "string" && value.length > 0)
          : [],
      ),
    ),
  );
  const suggestionTracks = allSuggestionTrackIds.length
    ? await db.track.findMany({
        where: { id: { in: allSuggestionTrackIds } },
        select: { id: true, spotifyId: true, name: true, artist: { select: { name: true } } },
      })
    : [];
  const trackById = new Map(
    suggestionTracks.map((track) => [
      track.id,
      {
        spotifyId: track.spotifyId,
        name: track.name,
        artistName: track.artist?.name ?? null,
      },
    ]),
  );
  const existingSuggestions = existingSuggestionRows.map((row) => {
    const rawTrackIds = Array.isArray(row.trackIds)
      ? row.trackIds.filter((value): value is string => typeof value === "string" && value.length > 0)
      : [];
    const currentTracks = rawTrackIds
      .map((id) => trackById.get(id))
      .filter(
        (
          value,
        ): value is {
          spotifyId: string;
          name: string;
          artistName: string | null;
        } => Boolean(value),
      );
    return {
      id: row.id,
      title: row.title ?? row.name,
      description: row.description,
      rationale: row.rationale,
      spotify_playlist_id: row.spotifyPlaylistId,
      spotify_playlist_url: row.spotifyPlaylistUrl,
      current_track_spotify_ids: currentTracks.map((track) => track.spotifyId),
      current_track_preview: currentTracks.slice(0, 8),
    };
  });

  const payload = {
    meta: {
      generated_at: new Date().toISOString(),
      total_tracks: tracks.length,
      order,
      limit,
      total_existing_suggestions: existingSuggestions.length,
      output_mode: existingSuggestions.length === 0 ? "create_only" : "update_only",
    },
    prompt: buildManualPrompt(existingSuggestions.length > 0, tracks.length),
    existing_suggestions: existingSuggestions,
    tracks,
  };

  if (format === "json") {
    return NextResponse.json(payload, {
      headers: {
        "Content-Disposition": `attachment; filename="chatgpt_playlist_payload_${order}_${tracks.length}.json"`,
      },
    });
  }

  const textBody = [
    "=== CHATGPT PLAYLIST PACK (SPOTIFY FILTERS) ===",
    `Gerado em: ${payload.meta.generated_at}`,
    `Faixas: ${payload.meta.total_tracks}`,
    `Ordem: ${payload.meta.order}`,
    "",
    "=== PROMPT IDEAL ===",
    payload.prompt,
    "",
    "=== DATASET (JSON) ===",
    JSON.stringify(
      { existing_suggestions: payload.existing_suggestions, tracks: payload.tracks },
      null,
      2,
    ),
  ].join("\n");

  return new NextResponse(textBody, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": `attachment; filename="chatgpt_playlist_payload_${order}_${tracks.length}.txt"`,
    },
  });
}
