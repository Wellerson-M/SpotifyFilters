# Spotify Filters

Aplicação para organizar músicas curtidas do Spotify e transformar isso em sugestões de playlists com apoio de IA.

Stack principal:
- Next.js (App Router) + TypeScript
- Prisma + SQLite
- Spotify Web API (OAuth PKCE)
- OpenAI API (modo automático) e fluxo manual via ChatGPT

## Ideia do projeto

O app importa suas músicas curtidas, enriquece dados musicais, classifica vibe e sugere playlists.
Você pode:
- usar IA automática (OpenAI API), ou
- usar modo manual (exporta pacote, pede sugestão no ChatGPT e importa o retorno).

Também existe fluxo para atualizar playlists existentes com músicas novas.

## Funcionalidades

- Login Spotify com OAuth PKCE
- Importação de curtidas com paginação
- Persistência de tracks/artists/features em SQLite
- Análise de vibe por faixa (tags, resumo, embedding)
- Sugestão de playlists por clustering
- Criação de playlists no Spotify
- Edição/exclusão de sugestões
- Atualização de playlists existentes com novas músicas
- Exportação/importação manual para ChatGPT
- Limpeza de playlists de debug (`_debug`)

## Fluxo recomendado

1. Conectar Spotify
2. Importar curtidas
3. Buscar características (Spotify)
4. Analisar vibe com IA (ou usar fluxo manual)
5. Sugerir playlists
6. Criar selecionadas
7. Quando tiver músicas novas: importar novamente e usar "Atualizar existentes"

## Setup local

1. Instalar dependências:

```bash
npm install
```

2. Copiar o ambiente:

```bash
copy .env.example .env
```

3. Ajustar variáveis no `.env`:
- `DATABASE_URL`
- `SPOTIFY_CLIENT_ID`
- `SPOTIFY_REDIRECT_BASE_URL`
- `OPENAI_API_KEY` (se for usar modo automático)

4. Rodar migrations:

```bash
npm run prisma:migrate
```

5. Iniciar app:

```bash
npm run dev
```
URL: `http://127.0.0.1:3001`

ou (limpando cache `.next`):

```bash
npm run dev:clean
```
URL: `http://127.0.0.1:3001`

Para rodar em modo producao local:

```bash
npm run build
npm run start
```
URL: `http://127.0.0.1:3001`

## Scripts

- `npm run dev`
- `npm run dev:clean`
- `npm run build`
- `npm run start`
- `npm run test`
- `npm run prisma:migrate`
- `npm run prisma:studio`

## Endpoints principais

- Auth: `/api/auth/login`, `/api/auth/callback`, `/api/auth/me`, `/api/auth/logout`
- Import: `/api/import/liked`
- Enriquecimento: `/api/enrich/audio-features`
- Análise: `/api/analyze/vibe`
- Sugestões: `/api/playlists/suggest`, `/api/playlists/suggest/[id]`
- Criação/sincronização: `/api/playlists/create`, `/api/playlists/sync-existing`
- Manual ChatGPT: `/api/manual/chatgpt-export`, `/api/manual/chatgpt-import`
- Utilitários: `/api/playlists/cleanup-debug`, `/api/health`
