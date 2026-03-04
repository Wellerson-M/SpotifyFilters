import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  exchangeCodeForToken,
  saveSpotifyToken,
} from "@/lib/spotify-auth";

function clearOAuthCookies(cookieStore: Awaited<ReturnType<typeof cookies>>) {
  cookieStore.delete("spotify_pkce_verifier");
  cookieStore.delete("spotify_auth_state");
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");
  const cookieStore = await cookies();

  if (error) {
    clearOAuthCookies(cookieStore);
    const redirectUrl = new URL("/", process.env.SPOTIFY_REDIRECT_BASE_URL ?? url.origin);
    redirectUrl.searchParams.set("auth", "error");
    return NextResponse.redirect(redirectUrl);
  }

  const savedState = cookieStore.get("spotify_auth_state")?.value;
  const verifier = cookieStore.get("spotify_pkce_verifier")?.value;

  if (!code || !state || !savedState || state !== savedState || !verifier) {
    clearOAuthCookies(cookieStore);
    const redirectUrl = new URL("/", process.env.SPOTIFY_REDIRECT_BASE_URL ?? url.origin);
    redirectUrl.searchParams.set("auth", "invalid_callback");
    return NextResponse.redirect(redirectUrl);
  }

  try {
    const token = await exchangeCodeForToken({
      code,
      codeVerifier: verifier,
      requestUrl: request.url,
    });

    await saveSpotifyToken({
      token,
    });

    clearOAuthCookies(cookieStore);

    const redirectUrl = new URL("/", process.env.SPOTIFY_REDIRECT_BASE_URL ?? url.origin);
    redirectUrl.searchParams.set("auth", "ok");
    return NextResponse.redirect(redirectUrl);
  } catch {
    clearOAuthCookies(cookieStore);
    const redirectUrl = new URL("/", process.env.SPOTIFY_REDIRECT_BASE_URL ?? url.origin);
    redirectUrl.searchParams.set("auth", "failed");
    return NextResponse.redirect(redirectUrl);
  }
}
