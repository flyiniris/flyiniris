# fi-video-serve

Cloudflare Worker that serves HLS video streams and thumbnails from R2, handles couple authentication via JWT, and streams authorized MP4 downloads.

## Prerequisites

- Node.js 18+
- Wrangler CLI: `npm install -g wrangler`
- Authenticated with Cloudflare: `wrangler login`

## Setup

```bash
cd delivery/workers/video-serve
npm install
```

### Create R2 bucket

```bash
wrangler r2 bucket create fi-films
```

### Create KV namespace

```bash
wrangler kv:namespace create PASSWORDS
```

Copy the output ID and replace `REPLACE_WITH_KV_NAMESPACE_ID` in `wrangler.toml`.

### Set JWT secret

```bash
wrangler secret put JWT_SECRET
```

Enter a strong random string when prompted.

### Add a couple password

```bash
wrangler kv:key put --binding=PASSWORDS "amanda-boris" "ab083125"
```

## Deploy

```bash
wrangler deploy
```

## Local development

```bash
wrangler dev
```

## Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/couples/{slug}/hls/{video-id}/*` | No | HLS playlists and segments |
| GET | `/couples/{slug}/thumbs/{video-id}.jpg` | No | Video thumbnails |
| POST | `/couples/{slug}/auth` | No | Validate password, get JWT |
| POST | `/couples/{slug}/download/{video-id}` | JWT | Stream original MP4 |

### Auth flow

1. POST to `/couples/amanda-boris/auth` with body `{"password":"ab083125"}`
2. Receive `{"token":"eyJ..."}`
3. POST to `/couples/amanda-boris/download/highlight` with header `Authorization: Bearer eyJ...`
4. Receive the MP4 file as a download

### CORS

Requests from `*.flyiniris.com` origins are reflected. All other origins receive `Access-Control-Allow-Origin: *`.

### Caching

- `.ts` segments and `.jpg` thumbnails: `max-age=31536000` (1 year)
- `.m3u8` playlists: `max-age=3600` (1 hour)
- Downloads: no caching
