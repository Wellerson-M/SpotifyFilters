import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  buildSpotifyAuthorizeUrl,
  generateOAuthState,
  generatePkcePair,
} from "@/lib/spotify-auth";

const COOKIE_MAX_AGE_SECONDS = 10 * 60;

export async function GET(request: Request) {
  const { verifier, challenge } = generatePkcePair();
  const state = generateOAuthState();

  const cookieStore = await cookies();
  cookieStore.set("spotify_pkce_verifier", verifier, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: COOKIE_MAX_AGE_SECONDS,
  });
  cookieStore.set("spotify_auth_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: COOKIE_MAX_AGE_SECONDS,
  });

  const authorizeUrl = buildSpotifyAuthorizeUrl({
    requestUrl: request.url,
    state,
    codeChallenge: challenge,
  });

  return NextResponse.redirect(authorizeUrl);
}
