import { randomBytes, createHash } from "node:crypto";
import { db } from "@/lib/db";

const SPOTIFY_AUTH_URL = "https://accounts.spotify.com/authorize";
const SPOTIFY_TOKEN_URL = "https://accounts.spotify.com/api/token";
const SPOTIFY_API_BASE = "https://api.spotify.com/v1";
const AUTH_PROVIDER = "spotify";
const REFRESH_BUFFER_SECONDS = 60;

export const SPOTIFY_SCOPES = [
  "user-library-read",
  "playlist-read-private",
  "playlist-modify-private",
  "playlist-modify-public",
  "user-read-private",
];

type SpotifyTokenResponse = {
  access_token: string;
  token_type: string;
  scope?: string;
  expires_in: number;
  refresh_token?: string;
};

type SpotifyMeResponse = {
  id: string;
  display_name?: string;
  email?: string;
};

export function generatePkcePair() {
  const verifier = randomBytes(64).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export function generateOAuthState() {
  return randomBytes(32).toString("hex");
}

export function getSpotifyCallbackUrl(requestUrl: string): string {
  const baseUrl = process.env.SPOTIFY_REDIRECT_BASE_URL ?? new URL(requestUrl).origin;
  return `${baseUrl}/api/auth/callback`;
}

export function buildSpotifyAuthorizeUrl(params: {
  requestUrl: string;
  state: string;
  codeChallenge: string;
}): string {
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  if (!clientId) {
    throw new Error("SPOTIFY_CLIENT_ID nao configurado.");
  }

  const callbackUrl = getSpotifyCallbackUrl(params.requestUrl);
  const url = new URL(SPOTIFY_AUTH_URL);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("scope", SPOTIFY_SCOPES.join(" "));
  url.searchParams.set("redirect_uri", callbackUrl);
  url.searchParams.set("state", params.state);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("code_challenge", params.codeChallenge);
  return url.toString();
}

async function requestSpotifyToken(body: URLSearchParams): Promise<SpotifyTokenResponse> {
  const response = await fetch(SPOTIFY_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Falha no token Spotify: ${response.status}`);
  }

  return (await response.json()) as SpotifyTokenResponse;
}

export async function exchangeCodeForToken(params: {
  code: string;
  codeVerifier: string;
  requestUrl: string;
}) {
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  if (!clientId) {
    throw new Error("SPOTIFY_CLIENT_ID nao configurado.");
  }

  const callbackUrl = getSpotifyCallbackUrl(params.requestUrl);
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: params.code,
    redirect_uri: callbackUrl,
    client_id: clientId,
    code_verifier: params.codeVerifier,
  });

  return requestSpotifyToken(body);
}

export async function refreshSpotifyAccessToken(refreshToken: string) {
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  if (!clientId) {
    throw new Error("SPOTIFY_CLIENT_ID nao configurado.");
  }

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: clientId,
  });

  return requestSpotifyToken(body);
}

export async function fetchSpotifyMe(accessToken: string): Promise<SpotifyMeResponse> {
  const response = await fetch(`${SPOTIFY_API_BASE}/me`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Falha ao consultar /me: ${response.status}`);
  }

  return (await response.json()) as SpotifyMeResponse;
}

export async function saveSpotifyToken(params: {
  token: SpotifyTokenResponse;
  spotifyUserId?: string;
}) {
  const expiresAt = new Date(Date.now() + params.token.expires_in * 1000);
  const refreshToken = params.token.refresh_token;

  if (!refreshToken) {
    throw new Error("Spotify nao retornou refresh_token.");
  }

  await db.authToken.upsert({
    where: { provider: AUTH_PROVIDER },
    update: {
      spotifyUserId: params.spotifyUserId,
      accessToken: params.token.access_token,
      refreshToken,
      tokenType: params.token.token_type,
      scope: params.token.scope,
      expiresAt,
    },
    create: {
      provider: AUTH_PROVIDER,
      spotifyUserId: params.spotifyUserId,
      accessToken: params.token.access_token,
      refreshToken,
      tokenType: params.token.token_type,
      scope: params.token.scope,
      expiresAt,
    },
  });
}

export async function getValidUserAccessToken(): Promise<string | null> {
  const stored = await db.authToken.findUnique({
    where: { provider: AUTH_PROVIDER },
  });

  if (!stored) {
    return null;
  }

  const refreshBoundary = new Date(Date.now() + REFRESH_BUFFER_SECONDS * 1000);
  if (stored.expiresAt > refreshBoundary) {
    return stored.accessToken;
  }

  const refreshed = await refreshSpotifyAccessToken(stored.refreshToken);
  const nextExpiresAt = new Date(Date.now() + refreshed.expires_in * 1000);
  const nextRefreshToken = refreshed.refresh_token ?? stored.refreshToken;

  const updated = await db.authToken.update({
    where: { provider: AUTH_PROVIDER },
    data: {
      accessToken: refreshed.access_token,
      tokenType: refreshed.token_type,
      scope: refreshed.scope ?? stored.scope,
      refreshToken: nextRefreshToken,
      expiresAt: nextExpiresAt,
    },
  });

  return updated.accessToken;
}
