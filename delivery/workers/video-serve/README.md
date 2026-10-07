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
wrangler kv namespace create PASSWORDS
```

Copy the output ID and replace `REPLACE_WITH_KV_NAMESPACE_ID` in `wrangler.toml`.

### Set JWT secret

```bash
wrangler secret put JWT_SECRET
```

Enter a strong random string when prompted.

### Add a couple password

```bash
wrangler kv key put --binding=PASSWORDS "<slug>" "<password>"
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
| POST | `/couples/{slug}/auth` | No | `{password}` or `{link_key}`, returns a JWT |
| POST | `/couples/{slug}/download/{video-id}` | JWT header | Stream original MP4 |
| GET, HEAD | `/couples/{slug}/file/{video-id}?t=<jwt>&name=` | JWT query | Original MP4 as an attachment, Range supported |
| GET | `/photos/{kind}/{slug}` | No | Public gallery listing (no R2 keys or checksums), max-age 60 |
| GET, HEAD | `/photos/{kind}/{slug}/web/{pid}.jpg`, `/thumb/{pid}.jpg` | No | 2048 px and 600 px copies, max-age 1 day |
| POST | `/photos/{kind}/{slug}/auth` | No | Same as the couples auth, against the gallery's auth slug |
| GET, HEAD | `/photos/{kind}/{slug}/original/{pid}?t=<jwt>` | JWT query | Original photo as an attachment, Range supported |
| GET, HEAD | `/photos/{kind}/{slug}/zip?t=<jwt>[&chapter=]` | JWT query | Streamed store-only ZIP64 of the originals, exact Content-Length |

### Photo galleries (board #24)

`kind` is `couple` (shown on `flyiniris.com/films/<slug>/#photos`) or `gallery`
(business and one-off galleries on `flyiniris.com/gallery/<slug>/`). Every
photo route 404s until the approve step in iris-automation writes the live
pointer `photo-live/<kind>/<slug>.json`; deleting it unpublishes. The pointer
names a gallery id whose `galleries/<gid>/manifest.json` (written by
FI-Pipeline) lists the photos.

The auth slug is the couple slug for `couple`, and `gallery:<slug>` for
`gallery`: the PASSWORDS key, the `rl:<authSlug>:<ip>` rate limit key, the
signed link HMAC and the JWT `slug` claim all use it. So a couple's films
token also opens their photos, and never a business gallery of the same name.

Originals live in one of two places. Uploads land in `photo-originals/<gid>/`
(unlocked, so a wrong upload can still be deleted). After Sean approves,
FI-Pipeline copies them server side to `photo-archive/<gid>/` (the prefix
under the R2 bucket lock), checks every copy, and only then deletes the
upload copy. Test galleries use `photo-originals-test/` and
`photo-archive-test/` (never locked). Single downloads and zips try the
archive first and fall back to the upload prefix, so they keep working before,
during and after the move. In a zip, whichever prefix answered last is tried
first for the next photo, so a not-yet-archived gallery costs one extra R2
read per zip, not one per photo.

A zip of more than 950 photos is refused (413) and offered per chapter
instead, so one download never hits the per-request subrequest ceiling.
Run the tests with `npm test` (Node 22 and Python 3 on PATH).

### Auth flow

1. POST to `/couples/<slug>/auth` with body `{"password":"<password>"}`
2. Receive `{"token":"eyJ..."}`
3. POST to `/couples/<slug>/download/highlight` with header `Authorization: Bearer eyJ...`
4. Receive the MP4 file as a download

### CORS

Requests from `*.flyiniris.com` origins are reflected. All other origins receive `Access-Control-Allow-Origin: *`.

### Caching

- `.ts` segments and `.jpg` thumbnails: `max-age=31536000` (1 year)
- `.m3u8` playlists: `max-age=3600` (1 hour)
- Downloads: no caching
