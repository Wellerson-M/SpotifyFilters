"use client";

import { useEffect, useMemo, useState } from "react";

type MeResponse = {
  status: "logado" | "deslogado";
  user?: {
    id: string;
    displayName: string | null;
  };
};

type ImportResponse = {
  status: "ok" | "error";
  data?: {
    id: string;
    status: string;
    totalTracks: number;
    createdTracks: number;
    updatedTracks: number;
    startedAt: string;
    completedAt: string | null;
  };
  error?: string;
};

type MissingAudioFeaturesResponse = {
  data: {
    missingCount: number;
    totalTracks: number;
    completedCount: number;
  };
};

type EnrichAudioFeaturesResponse = {
  status: "ok" | "error" | "deslogado";
  data?: {
    missingBefore: number;
    persisted: number;
    missingAfter: number;
  };
  error?: string;
};

type AnalyzeVibeProgressResponse = {
  data: {
    missingCount: number;
    blockedCount: number;
  };
};

type AnalyzeVibeResponse = {
  status: "ok" | "error" | "deslogado";
  data?: {
    pending: number;
    processed: number;
    failed: number;
    remaining?: number;
    sampleError?: string | null;
    promptVersion: string;
    modelName: string;
  };
  error?: string;
};

type PlaylistSuggestionItem = {
  id: string;
  name: string;
  title: string | null;
  description: string | null;
  coverImageUrl?: string | null;
  spotifyPlaylistId?: string | null;
  spotifyPlaylistUrl?: string | null;
  lastSyncedAt?: string | null;
  sampleTracks?: Array<{
    id: string;
    name: string;
    artistName: string | null;
  }>;
  track_ids?: unknown;
  trackIds?: unknown;
  rationale: string | null;
  createdAt: string;
};

type PlaylistSuggestionListResponse = {
  data: PlaylistSuggestionItem[];
};

type PlaylistSuggestResponse = {
  status: "ok" | "error";
  data?: {
    k: number;
    generated: number;
    suggestionIds: string[];
  };
  error?: string;
};

type PlaylistDeleteManyResponse = {
  status: "ok" | "error";
  data?: {
    requested: number;
    deleted: number;
  };
  error?: string;
};

type PlaylistCreateResponse = {
  status: "ok" | "error" | "deslogado";
  data?: {
    requested: number;
    created: number;
    playlists: Array<{
      suggestionId: string;
      playlistId: string;
      playlistUrl: string | null;
      tracksAdded: number;
    }>;
    failed?: Array<{
      suggestionId: string;
      reason: string;
    }>;
  };
  error?: string;
};

type PlaylistSyncResponse = {
  status: "ok" | "error" | "deslogado";
  data?: {
    requested: number;
    updated: number;
    synced: Array<{
      suggestionId: string;
      playlistId: string;
      addedTracks: number;
    }>;
    failed: Array<{
      suggestionId: string;
      reason: string;
    }>;
  };
  error?: string;
};

type CleanupDebugResponse = {
  status: "ok" | "error" | "deslogado";
  data?: {
    prefix: string;
    found: number;
    removed: number;
    failed: Array<{ id: string; reason: string }>;
  };
  error?: string;
};

type ChatGptImportResponse = {
  status: "ok" | "error";
  data?: {
    received: number;
    created: number;
    playlists: Array<{
      id: string;
      title: string;
      mappedTracks: number;
      missingTracks: number;
    }>;
  };
  error?: string;
};

export default function HomePage() {
  const [loadingMe, setLoadingMe] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [importing, setImporting] = useState(false);
  const [loadingMissing, setLoadingMissing] = useState(false);
  const [enriching, setEnriching] = useState(false);
  const [missingAudioFeatures, setMissingAudioFeatures] = useState<number | null>(null);
  const [loadingVibeProgress, setLoadingVibeProgress] = useState(false);
  const [analyzingVibe, setAnalyzingVibe] = useState(false);
  const [exportingManualPack, setExportingManualPack] = useState(false);
  const [analyzeLimit, setAnalyzeLimit] = useState(600);
  const [analyzeOrder, setAnalyzeOrder] = useState<"recent" | "oldest">("recent");
  const [missingVibe, setMissingVibe] = useState<number | null>(null);
  const [blockedVibe, setBlockedVibe] = useState<number | null>(null);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [generatingSuggestions, setGeneratingSuggestions] = useState(false);
  const [creatingPlaylists, setCreatingPlaylists] = useState(false);
  const [syncingPlaylists, setSyncingPlaylists] = useState(false);
  const [editingSuggestionId, setEditingSuggestionId] = useState<string | null>(null);
  const [deletingSuggestionId, setDeletingSuggestionId] = useState<string | null>(null);
  const [deletingSelectedSuggestions, setDeletingSelectedSuggestions] = useState(false);
  const [importingManualGpt, setImportingManualGpt] = useState(false);
  const [cleaningDebugPlaylists, setCleaningDebugPlaylists] = useState(false);
  const [manualGptInput, setManualGptInput] = useState("");
  const [suggestions, setSuggestions] = useState<PlaylistSuggestionItem[]>([]);
  const [selectedSuggestionIds, setSelectedSuggestionIds] = useState<string[]>([]);
  const [createdPlaylistLinks, setCreatedPlaylistLinks] = useState<
    Array<{ suggestionId: string; playlistUrl: string | null; playlistId: string }>
  >([]);
  const [me, setMe] = useState<MeResponse | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [lastOpenAiError, setLastOpenAiError] = useState<string | null>(null);

  const isLogged = useMemo(() => me?.status === "logado", [me]);
  const latestLogs = useMemo(() => logs.slice(0, 6), [logs]);
  const allSuggestionIds = useMemo(() => suggestions.map((item) => item.id), [suggestions]);
  const hasAllSuggestionsSelected =
    allSuggestionIds.length > 0 &&
    allSuggestionIds.every((id) => selectedSuggestionIds.includes(id));

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const auth = params.get("auth");
    if (auth === "ok") {
      appendLog("Login Spotify concluido.");
      void checkSession();
      window.history.replaceState({}, "", "/");
    } else if (auth === "invalid_callback") {
      appendErrorWithCreditHint("Falha no callback OAuth. Tente logar novamente.");
      window.history.replaceState({}, "", "/");
    } else if (auth === "failed" || auth === "error") {
      appendErrorWithCreditHint("Falha ao autenticar no Spotify.");
      window.history.replaceState({}, "", "/");
    }

    void refreshMissingAudioFeatures();
    void refreshVibeProgress();
    void refreshSuggestions();
  }, []);

  function appendLog(message: string) {
    setLogs((prev) => [`${new Date().toLocaleTimeString()} - ${message}`, ...prev]);
  }

  function isOpenAiCreditError(message: string) {
    const text = message.toLowerCase();
    return (
      text.includes("quota") ||
      text.includes("billing") ||
      text.includes("credit") ||
      text.includes("openai") ||
      (text.includes("429") && !text.includes("spotify"))
    );
  }

  function appendErrorWithCreditHint(message: string) {
    appendLog(message);
    if (isOpenAiCreditError(message)) {
      setLastOpenAiError(message);
      appendLog("Dica: verifique os creditos na OpenAI.");
    }
  }

  async function checkSession() {
    setLoadingMe(true);
    appendLog("Verificando sessao Spotify...");
    try {
      const response = await fetch("/api/auth/me", { cache: "no-store" });
      const data = (await response.json()) as MeResponse;
      setMe(data);
      appendLog(data.status === "logado" ? "Usuario autenticado." : "Usuario deslogado.");
    } catch {
      appendErrorWithCreditHint("Falha ao verificar autenticacao.");
    } finally {
      setLoadingMe(false);
    }
  }

  function connectSpotify() {
    appendLog("Redirecionando para login do Spotify...");
    window.location.href = "/api/auth/login";
  }

  async function logoutSpotify() {
    setLoggingOut(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      setMe({ status: "deslogado" });
      appendLog("Logout do Spotify realizado.");
    } catch {
      appendErrorWithCreditHint("Falha ao deslogar do Spotify.");
    } finally {
      setLoggingOut(false);
    }
  }

  async function refreshMissingAudioFeatures() {
    setLoadingMissing(true);
    try {
      const response = await fetch("/api/enrich/audio-features", { cache: "no-store" });
      const data = (await response.json()) as MissingAudioFeaturesResponse;
      setMissingAudioFeatures(data.data.missingCount);
    } catch {
      appendErrorWithCreditHint("Falha ao carregar contador de caracteristicas faltantes.");
    } finally {
      setLoadingMissing(false);
    }
  }

  async function refreshVibeProgress() {
    setLoadingVibeProgress(true);
    try {
      const response = await fetch("/api/analyze/vibe", { cache: "no-store" });
      const data = (await response.json()) as AnalyzeVibeProgressResponse;
      setMissingVibe(data.data.missingCount);
      setBlockedVibe(data.data.blockedCount);
    } catch {
      appendErrorWithCreditHint("Falha ao carregar progresso de vibe.");
    } finally {
      setLoadingVibeProgress(false);
    }
  }

  async function refreshSuggestions() {
    setLoadingSuggestions(true);
    try {
      const response = await fetch("/api/playlists/suggest", { cache: "no-store" });
      const data = (await response.json()) as PlaylistSuggestionListResponse;
      setSuggestions(data.data);
    } catch {
      appendErrorWithCreditHint("Falha ao carregar sugestoes de playlist.");
    } finally {
      setLoadingSuggestions(false);
    }
  }

  async function importLikedTracks() {
    setImporting(true);
    appendLog("Iniciando importacao de curtidas...");
    try {
      const response = await fetch("/api/import/liked", { method: "POST" });
      const data = (await response.json()) as ImportResponse;
      if (!response.ok || data.status !== "ok" || !data.data) {
        appendErrorWithCreditHint(data.error ?? "Falha na importacao.");
        return;
      }
      appendLog(
        `Importacao concluida. Total=${data.data.totalTracks}, novos=${data.data.createdTracks}, atualizados=${data.data.updatedTracks}.`,
      );
      await refreshMissingAudioFeatures();
      await refreshVibeProgress();
    } catch {
      appendErrorWithCreditHint("Erro de rede ao importar curtidas.");
    } finally {
      setImporting(false);
    }
  }

  async function enrichAudioFeatures() {
    setEnriching(true);
    appendLog("Buscando caracteristicas no Spotify...");
    try {
      const response = await fetch("/api/enrich/audio-features", { method: "POST" });
      const rawText = await response.text();
      const data = (rawText ? JSON.parse(rawText) : {}) as EnrichAudioFeaturesResponse;
      if (!response.ok || data.status !== "ok" || !data.data) {
        appendErrorWithCreditHint(data.error ?? "Falha ao enriquecer caracteristicas.");
        return;
      }
      setMissingAudioFeatures(data.data.missingAfter);
      appendLog(
        `Enriquecimento concluido. Processadas=${data.data.missingBefore}, persistidas=${data.data.persisted}, faltando=${data.data.missingAfter}.`,
      );
      await refreshVibeProgress();
    } catch (error) {
      appendErrorWithCreditHint(
        error instanceof Error ? error.message : "Erro de rede ao buscar caracteristicas.",
      );
    } finally {
      setEnriching(false);
    }
  }

  async function analyzeVibe() {
    setAnalyzingVibe(true);
    appendLog("Iniciando analise de vibe com IA...");
    try {
      const response = await fetch("/api/analyze/vibe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ limit: analyzeLimit, order: analyzeOrder }),
      });
      const data = (await response.json()) as AnalyzeVibeResponse;
      if (!response.ok || data.status !== "ok" || !data.data) {
        appendErrorWithCreditHint(data.error ?? "Falha ao analisar vibe.");
        return;
      }
      appendLog(
        `Analise concluida. Pendentes=${data.data.pending}, processados=${data.data.processed}, falhas=${data.data.failed}, restantes=${data.data.remaining ?? 0}.`,
      );
      if (data.data.sampleError) {
        setLastOpenAiError(data.data.sampleError);
        appendErrorWithCreditHint(`Motivo exemplo de falha: ${data.data.sampleError}`);
      }
      await refreshVibeProgress();
    } catch {
      appendErrorWithCreditHint("Erro de rede ao analisar vibe.");
    } finally {
      setAnalyzingVibe(false);
    }
  }

  async function generatePlaylistSuggestions() {
    setGeneratingSuggestions(true);
    appendLog("Gerando sugestoes de playlists com clustering...");
    try {
      const response = await fetch("/api/playlists/suggest", { method: "POST" });
      const data = (await response.json()) as PlaylistSuggestResponse;
      if (!response.ok || data.status !== "ok" || !data.data) {
        appendErrorWithCreditHint(data.error ?? "Falha ao gerar sugestoes de playlist.");
        return;
      }
      appendLog(`Sugestoes geradas: ${data.data.generated} (K=${data.data.k}).`);
      await refreshSuggestions();
    } catch {
      appendErrorWithCreditHint("Erro de rede ao gerar sugestoes de playlists.");
    } finally {
      setGeneratingSuggestions(false);
    }
  }

  function toggleSuggestionSelection(id: string) {
    setSelectedSuggestionIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id],
    );
  }

  function toggleSelectAllSuggestions() {
    setSelectedSuggestionIds((prev) => {
      if (allSuggestionIds.length === 0) {
        return prev;
      }
      const alreadyAllSelected = allSuggestionIds.every((id) => prev.includes(id));
      return alreadyAllSelected ? [] : allSuggestionIds;
    });
  }

  async function createSelectedPlaylists() {
    if (selectedSuggestionIds.length === 0) {
      appendLog("Selecione pelo menos uma sugestao para criar.");
      return;
    }
    setCreatingPlaylists(true);
    appendLog(`Criando ${selectedSuggestionIds.length} playlist(s) no Spotify...`);
    try {
      const response = await fetch("/api/playlists/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ suggestionIds: selectedSuggestionIds }),
      });
      const data = (await response.json()) as PlaylistCreateResponse;
      if (!response.ok || data.status !== "ok" || !data.data) {
        const failures = Array.isArray(data.data?.failed) ? data.data?.failed : [];
        if (failures.length > 0) {
          appendErrorWithCreditHint(`Falha ao criar playlists: ${failures[0].reason}`);
        }
        appendErrorWithCreditHint(data.error ?? "Falha ao criar playlists no Spotify.");
        return;
      }
      const payload = data.data;
      appendLog(`Playlists criadas: ${payload.created}/${payload.requested}.`);
      if (Array.isArray(payload.failed) && payload.failed.length > 0) {
        appendLog(`Algumas falharam. Exemplo: ${payload.failed[0].reason}`);
      }
      setCreatedPlaylistLinks((prev) => [
        ...payload.playlists.map((item) => ({
          suggestionId: item.suggestionId,
          playlistUrl: item.playlistUrl,
          playlistId: item.playlistId,
        })),
        ...prev,
      ]);
      await refreshSuggestions();
    } catch {
      appendErrorWithCreditHint("Erro de rede ao criar playlists no Spotify.");
    } finally {
      setCreatingPlaylists(false);
    }
  }

  async function syncExistingPlaylists() {
    setSyncingPlaylists(true);
    appendLog("Sincronizando playlists existentes com musicas novas...");
    try {
      const response = await fetch("/api/playlists/sync-existing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ limitPerPlaylist: 20 }),
      });
      const data = (await response.json()) as PlaylistSyncResponse;
      if (!response.ok || data.status !== "ok" || !data.data) {
        appendErrorWithCreditHint(data.error ?? "Falha ao sincronizar playlists existentes.");
        return;
      }
      appendLog(
        `Sincronizacao concluida. Atualizadas=${data.data.updated}/${data.data.requested}.`,
      );
      const totalAdded = data.data.synced.reduce((sum, item) => sum + item.addedTracks, 0);
      appendLog(`Faixas novas adicionadas nas playlists: ${totalAdded}.`);
      await refreshSuggestions();
    } catch {
      appendErrorWithCreditHint("Erro de rede ao sincronizar playlists existentes.");
    } finally {
      setSyncingPlaylists(false);
    }
  }

  async function deleteSuggestion(id: string) {
    setDeletingSuggestionId(id);
    try {
      const response = await fetch(`/api/playlists/suggest/${id}`, { method: "DELETE" });
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        appendErrorWithCreditHint(data.error ?? "Falha ao excluir sugestao.");
        return;
      }
      appendLog("Sugestao excluida.");
      setSelectedSuggestionIds((prev) => prev.filter((item) => item !== id));
      await refreshSuggestions();
    } catch {
      appendErrorWithCreditHint("Erro de rede ao excluir sugestao.");
    } finally {
      setDeletingSuggestionId(null);
    }
  }

  async function deleteSelectedSuggestions() {
    if (selectedSuggestionIds.length === 0) {
      appendLog("Selecione pelo menos uma sugestao para excluir.");
      return;
    }

    const confirmed = window.confirm(
      `Excluir ${selectedSuggestionIds.length} sugestao(oes) selecionada(s)?`,
    );
    if (!confirmed) {
      return;
    }

    setDeletingSelectedSuggestions(true);
    try {
      const response = await fetch("/api/playlists/suggest", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ suggestionIds: selectedSuggestionIds }),
      });
      const data = (await response.json()) as PlaylistDeleteManyResponse;
      if (!response.ok || data.status !== "ok" || !data.data) {
        appendErrorWithCreditHint(data.error ?? "Falha ao excluir sugestoes selecionadas.");
        return;
      }
      appendLog(`Sugestoes excluidas: ${data.data.deleted}/${data.data.requested}.`);
      setSelectedSuggestionIds([]);
      await refreshSuggestions();
    } catch {
      appendErrorWithCreditHint("Erro de rede ao excluir sugestoes selecionadas.");
    } finally {
      setDeletingSelectedSuggestions(false);
    }
  }

  async function editSuggestion(item: PlaylistSuggestionItem) {
    const currentTitle = item.title ?? item.name;
    const nextTitle = window.prompt("Novo titulo da playlist:", currentTitle)?.trim();
    if (!nextTitle) {
      return;
    }
    const nextDescription = window.prompt("Nova descricao (opcional):", item.description ?? "") ?? "";
    const nextRationale = window.prompt("Rationale/observacao (opcional):", item.rationale ?? "") ?? "";

    setEditingSuggestionId(item.id);
    try {
      const response = await fetch(`/api/playlists/suggest/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: nextTitle,
          description: nextDescription,
          rationale: nextRationale,
        }),
      });
      const data = (await response.json().catch(() => ({}))) as { status?: string; error?: string };
      if (!response.ok || data.status === "error") {
        appendErrorWithCreditHint(data.error ?? "Falha ao alterar sugestao.");
        return;
      }
      appendLog(`Sugestao atualizada: ${nextTitle}.`);
      await refreshSuggestions();
    } catch {
      appendErrorWithCreditHint("Erro de rede ao alterar sugestao.");
    } finally {
      setEditingSuggestionId(null);
    }
  }

  async function importChatGptSuggestion() {
    if (!manualGptInput.trim()) {
      appendLog("Cole a resposta do ChatGPT para importar.");
      return;
    }

    setImportingManualGpt(true);
    appendLog("Importando resposta manual do ChatGPT...");
    try {
      const response = await fetch("/api/manual/chatgpt-import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input: manualGptInput }),
      });
      const data = (await response.json()) as ChatGptImportResponse;
      if (!response.ok || data.status !== "ok" || !data.data) {
        appendErrorWithCreditHint(data.error ?? "Falha ao importar resposta do ChatGPT.");
        return;
      }

      appendLog(
        `Importacao concluida. Recebidas=${data.data.received}, salvas=${data.data.created}.`,
      );
      setManualGptInput("");
      await refreshSuggestions();
    } catch {
      appendErrorWithCreditHint("Erro de rede ao importar resposta do ChatGPT.");
    } finally {
      setImportingManualGpt(false);
    }
  }

  async function exportManualPack(format: "txt" | "json") {
    setExportingManualPack(true);
    appendLog(`Gerando pacote manual para ChatGPT (${format.toUpperCase()})...`);
    try {
      const params = new URLSearchParams({
        format,
        limit: String(analyzeLimit),
        order: analyzeOrder,
      });
      const response = await fetch(`/api/manual/chatgpt-export?${params.toString()}`);
      if (!response.ok) {
        const text = await response.text();
        appendErrorWithCreditHint(text || "Falha ao exportar pacote manual.");
        return;
      }

      const blob = await response.blob();
      const href = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = href;
      link.download = `chatgpt_playlist_payload_${analyzeOrder}_${analyzeLimit}.${format}`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(href);
      appendLog("Pacote manual baixado com sucesso.");
    } catch {
      appendErrorWithCreditHint("Erro de rede ao exportar pacote manual.");
    } finally {
      setExportingManualPack(false);
    }
  }

  async function cleanupDebugPlaylists() {
    const confirmed = window.confirm(
      "Remover playlists com prefixo _debug da sua conta Spotify?",
    );
    if (!confirmed) {
      return;
    }
    setCleaningDebugPlaylists(true);
    appendLog("Limpando playlists _debug...");
    try {
      const response = await fetch("/api/playlists/cleanup-debug", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prefix: "_debug" }),
      });
      const data = (await response.json()) as CleanupDebugResponse;
      if (!response.ok || data.status !== "ok" || !data.data) {
        appendErrorWithCreditHint(data.error ?? "Falha ao limpar playlists debug.");
        return;
      }
      appendLog(
        `Limpeza debug concluida. Encontradas=${data.data.found}, removidas=${data.data.removed}.`,
      );
      if (data.data.failed.length > 0) {
        appendLog(`Algumas falharam. Exemplo: ${data.data.failed[0].reason}`);
      }
    } catch {
      appendErrorWithCreditHint("Erro de rede ao limpar playlists debug.");
    } finally {
      setCleaningDebugPlaylists(false);
    }
  }

  function getSuggestionTrackCount(item: PlaylistSuggestionItem) {
    const value = Array.isArray(item.trackIds)
      ? item.trackIds
      : Array.isArray(item.track_ids)
        ? item.track_ids
        : [];
    return value.length;
  }

  return (
    <main className="dashboardShell">
      <aside className="leftRail glassPanel">
        <h1 className="brandTitle">
          <span className="brandLogo" aria-hidden>
            <svg viewBox="0 0 168 168" width="26" height="26">
              <circle cx="84" cy="84" r="84" fill="#1DB954" />
              <path
                d="M121 120c-2 0-3-1-4-2-9-6-20-10-34-10-7 0-15 1-24 3-2 1-4-1-4-3-1-2 1-4 3-4 10-3 19-4 28-4 15 0 28 4 39 11 2 1 3 4 1 6-1 2-3 3-5 3z"
                fill="#0A0A0A"
              />
              <path
                d="M128 102c-2 0-3 0-4-1-11-7-27-11-42-11-10 0-20 1-30 4-2 1-5-1-5-3-1-3 1-5 3-6 11-3 22-4 33-4 17 0 34 4 47 13 2 1 3 4 2 6-1 1-3 2-4 2z"
                fill="#0A0A0A"
              />
              <path
                d="M133 84c-2 0-3 0-4-1-13-8-33-13-50-13-11 0-23 2-35 5-2 1-5-1-6-4 0-2 2-5 4-5 13-4 26-6 39-6 19 0 41 5 56 15 2 1 3 4 2 6-1 2-3 3-6 3z"
                fill="#0A0A0A"
              />
            </svg>
          </span>{" "}
          Spotify Filters
        </h1>
        <p className="brandSub">Analise, agrupe e crie playlists automaticamente.</p>

        <div className="railSection">
          <p className="railLabel">Navegacao</p>
          <button type="button" className="railBtn" onClick={checkSession} disabled={loadingMe}>
            {loadingMe ? "Verificando..." : "Verificar login"}
          </button>
          <button type="button" className="railBtn" onClick={connectSpotify}>
            Conectar Spotify
          </button>
          <button type="button" className="railBtn" onClick={logoutSpotify} disabled={loggingOut}>
            {loggingOut ? "Deslogando..." : "Deslogar Spotify"}
          </button>
        </div>

        <div className="railSection">
          <p className="railLabel">Conta</p>
          <p className="statusLine">
            Status: <strong>{isLogged ? "Logado" : "Deslogado"}</strong>
          </p>
          <p className="statusLine">Usuario: {me?.user?.displayName ?? "-"}</p>
        </div>
      </aside>

      <section className="centerContent">
        <div className="panelHeader">
          <h2>Analise</h2>
          <p>Depois da analise, deixe-nos sugerir playlists personalizadas para voce.</p>
        </div>

        <div className="actionGrid">
          <article className="actionCard glowPink">
            <h3>Importar Curtidas</h3>
            <p>Obtem suas musicas curtidas e salva no banco.</p>
            <button type="button" onClick={importLikedTracks} disabled={!isLogged || importing}>
              {importing ? "Importando..." : "Importar"}
            </button>
          </article>

          <article className="actionCard glowAmber">
            <h3>Atualizar Caracteristicas</h3>
            <p>Busca audio features (quando permitido) e atualiza o contador.</p>
            <div className="cardActions">
              <button type="button" onClick={enrichAudioFeatures} disabled={!isLogged || enriching}>
                {enriching ? "Buscando..." : "Buscar"}
              </button>
              <button type="button" onClick={refreshMissingAudioFeatures} disabled={loadingMissing}>
                {loadingMissing ? "..." : "Atualizar"}
              </button>
            </div>
          </article>

          <article className="actionCard glowBlue">
            <h3>Analisar Vibe com IA</h3>
            <p>Gera tags, descricao e embedding da vibe por faixa.</p>
            <div className="cardControls">
              <label>
                Limite
                <input
                  type="number"
                  min={1}
                  max={2000}
                  value={analyzeLimit}
                  onChange={(event) =>
                    setAnalyzeLimit(Math.max(1, Math.min(2000, Number(event.target.value) || 1)))
                  }
                />
              </label>
              <label>
                Ordem
                <select
                  value={analyzeOrder}
                  onChange={(event) => setAnalyzeOrder(event.target.value as "recent" | "oldest")}
                >
                  <option value="recent">Mais recentes</option>
                  <option value="oldest">Mais antigas</option>
                </select>
              </label>
            </div>
            <button type="button" onClick={analyzeVibe} disabled={!isLogged || analyzingVibe}>
              {analyzingVibe ? "Analisando..." : "Analisar"}
            </button>
          </article>
        </div>

        <details className="manualPanel glassPanel">
          <summary>Modo manual ChatGPT (avancado)</summary>
          <div className="manualGrid">
            <article className="actionCard">
              <h3>Exportar pacote</h3>
              <p>Baixe prompt + dados das musicas para usar no ChatGPT manualmente.</p>
              <div className="cardActions">
                <button
                  type="button"
                  onClick={() => exportManualPack("txt")}
                  disabled={!isLogged || exportingManualPack}
                >
                  TXT
                </button>
                <button
                  type="button"
                  onClick={() => exportManualPack("json")}
                  disabled={!isLogged || exportingManualPack}
                >
                  JSON
                </button>
              </div>
            </article>

            <article className="actionCard">
              <h3>Importar retorno</h3>
              <p>Cole aqui o JSON de playlists sugerido pelo ChatGPT.</p>
              <textarea
                className="manualTextarea"
                value={manualGptInput}
                onChange={(event) => setManualGptInput(event.target.value)}
                placeholder='Ex: {"playlist_updates":[{"existing_title":"R&B Urbano BR","add_track_spotify_ids":["..."],"remove_track_spotify_ids":[],"rationale":"..."}]}'
              />
              <button type="button" onClick={importChatGptSuggestion} disabled={importingManualGpt}>
                {importingManualGpt ? "Importando..." : "Importar resposta do ChatGPT"}
              </button>
            </article>
          </div>
          <div className="manualTools">
            <button
              type="button"
              className="ghostDangerBtn"
              onClick={cleanupDebugPlaylists}
              disabled={!isLogged || cleaningDebugPlaylists}
            >
              {cleaningDebugPlaylists ? "Limpando..." : "Limpar playlists _debug"}
            </button>
          </div>
        </details>

        <div className="contentGrid">
          <section className="glassPanel playlistsPanel">
            <div className="panelRow">
              <h3>Sugestoes de Playlist</h3>
              <div className="cardActions">
                <button
                  type="button"
                  onClick={generatePlaylistSuggestions}
                  disabled={!isLogged || generatingSuggestions}
                >
                  {generatingSuggestions ? "Sugerindo..." : "Sugerir"}
                </button>
                <button
                  type="button"
                  onClick={syncExistingPlaylists}
                  disabled={!isLogged || syncingPlaylists}
                >
                  {syncingPlaylists ? "Sincronizando..." : "Atualizar existentes"}
                </button>
                <button
                  type="button"
                  onClick={toggleSelectAllSuggestions}
                  disabled={suggestions.length === 0}
                >
                  {hasAllSuggestionsSelected ? "Limpar selecao" : "Selecionar todas"}
                </button>
              </div>
            </div>

            {loadingSuggestions ? <p>Carregando sugestoes...</p> : null}
            {!loadingSuggestions && suggestions.length === 0 ? (
              <p>Nenhuma sugestao gerada ainda.</p>
            ) : null}

            <div className="suggestionList">
              {suggestions.slice(0, 8).map((item) => {
                const title = item.title ?? item.name;
                return (
                  <label key={item.id} className="playlistItem">
                    {item.coverImageUrl ? (
                      <img
                        src={item.coverImageUrl}
                        alt={`Capa de ${title}`}
                        className="playlistCover"
                        loading="lazy"
                      />
                    ) : (
                      <div className="playlistThumb">{title.slice(0, 1).toUpperCase()}</div>
                    )}
                    <div className="playlistMeta">
                      <strong>{title}</strong>
                      <p>{item.description ?? "Sem descricao"}</p>
                      <p>Faixas: {getSuggestionTrackCount(item)}</p>
                      {Array.isArray(item.sampleTracks) && item.sampleTracks.length > 0 ? (
                        <details className="trackPreview">
                          <summary>Ver faixas</summary>
                          {item.sampleTracks.map((track) => (
                            <p key={track.id}>
                              {track.name}
                              {track.artistName ? ` - ${track.artistName}` : ""}
                            </p>
                          ))}
                        </details>
                      ) : null}
                      {item.spotifyPlaylistId ? (
                        <p>
                          Spotify:{" "}
                          {item.spotifyPlaylistUrl ? (
                            <a href={item.spotifyPlaylistUrl} target="_blank" rel="noreferrer">
                              playlist criada
                            </a>
                          ) : (
                            "criada"
                          )}
                        </p>
                      ) : (
                        <p>Spotify: ainda nao criada</p>
                      )}
                    </div>
                    <div className="playlistActions">
                      <input
                        type="checkbox"
                        checked={selectedSuggestionIds.includes(item.id)}
                        onChange={() => toggleSuggestionSelection(item.id)}
                      />
                      <button
                        type="button"
                        onClick={() => editSuggestion(item)}
                        disabled={editingSuggestionId === item.id}
                      >
                        {editingSuggestionId === item.id ? "..." : "Alterar"}
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteSuggestion(item.id)}
                        disabled={deletingSuggestionId === item.id}
                      >
                        {deletingSuggestionId === item.id ? "..." : "Excluir"}
                      </button>
                    </div>
                  </label>
                );
              })}
            </div>

            <button
              type="button"
              className="primaryCta"
              onClick={createSelectedPlaylists}
              disabled={!isLogged || creatingPlaylists || selectedSuggestionIds.length === 0}
            >
              {creatingPlaylists ? "Criando..." : "Criar Selecionadas"}
            </button>
            {selectedSuggestionIds.length > 1 ? (
              <button
                type="button"
                className="dangerCta"
                onClick={deleteSelectedSuggestions}
                disabled={deletingSelectedSuggestions}
              >
                {deletingSelectedSuggestions ? "Excluindo..." : "Excluir Selecionadas"}
              </button>
            ) : null}
          </section>

          <section className="glassPanel logPanel">
            <h3>Log</h3>
            {latestLogs.length === 0 ? <p>Nenhum evento ainda.</p> : null}
            {latestLogs.map((line) => (
              <p key={line}>{line}</p>
            ))}
          </section>
        </div>
      </section>

      <aside className="rightRail glassPanel">
        <h3>Status</h3>
        <div className="metricCard">
          <span>Caracteristicas faltantes</span>
          <strong>{missingAudioFeatures ?? "N/A"}</strong>
        </div>
        <div className="metricCard">
          <span>Vibes pendentes</span>
          <strong>{missingVibe ?? "N/A"}</strong>
        </div>
        <div className="metricCard">
          <span>Sem audio features</span>
          <strong>{blockedVibe ?? "N/A"}</strong>
        </div>
        <div className="metricCard">
          <span>Selecionadas p/ criar</span>
          <strong>{selectedSuggestionIds.length}</strong>
        </div>
        <div className="metricCard">
          <span>Credito GPT</span>
          <p className="smallError">{lastOpenAiError ?? "Sem erros recentes."}</p>
        </div>

        {createdPlaylistLinks.length > 0 ? (
          <div className="metricCard">
            <span>Ultimas playlists criadas</span>
            {createdPlaylistLinks.slice(0, 5).map((item) => (
              <p key={`${item.suggestionId}-${item.playlistId}`}>
                {item.playlistUrl ? (
                  <a href={item.playlistUrl} target="_blank" rel="noreferrer">
                    Abrir {item.playlistId}
                  </a>
                ) : (
                  <>ID: {item.playlistId}</>
                )}
              </p>
            ))}
          </div>
        ) : null}
      </aside>
    </main>
  );
}
