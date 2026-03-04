ALTER TABLE "Track" ADD COLUMN "albumImageUrl" TEXT;
ALTER TABLE "PlaylistSuggestion" ADD COLUMN "spotifyPlaylistId" TEXT;
ALTER TABLE "PlaylistSuggestion" ADD COLUMN "spotifyPlaylistUrl" TEXT;
ALTER TABLE "PlaylistSuggestion" ADD COLUMN "lastSyncedAt" DATETIME;
CREATE UNIQUE INDEX "PlaylistSuggestion_spotifyPlaylistId_key" ON "PlaylistSuggestion"("spotifyPlaylistId");
