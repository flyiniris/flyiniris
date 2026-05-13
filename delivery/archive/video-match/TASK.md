# Video Matching Engine — Build Task

## Goal
Build a Cloudflare Worker that serves personalized video recommendations based on couple data. This Worker will be called by the email system and the website to determine which films to show each couple.

## Architecture
- **Worker name:** fi-video-match
- **KV Namespace:** FI_MATCH (for view tracking per couple)
- **Endpoint:** POST /match
- **Input:** couple data (vibe, priority, budget, region, season, venue_type, email)
- **Output:** ranked list of film slugs with metadata, excluding already-viewed films

## Film Index Data
Read from: C:\Users\flyin\.openclaw\workspace\film-index.json
This gets uploaded to a KV key `film-index` or hardcoded in the Worker.

## Matching Logic
Read from: C:\Users\flyin\.openclaw\workspace\video-matching-engine.md
Implement the scoring algorithm described there.

## API Endpoints

### POST /match
Request:
```json
{
  "email": "couple@email.com",
  "vibe": "elegant-timeless",        // from quiz: elegant-timeless | big-energy | warm-intimate | mix
  "priority": "cinematic",            // from quiz: raw-emotion | cinematic | energy | story | all
  "budget": "5-8k",                   // from quiz: under-3k | 3-5k | 5-8k | 8k-plus
  "region": "door-county",            // optional: detected from venue
  "season": "fall",                   // optional: from wedding date
  "venueType": "outdoor",             // optional: from venue
  "guestSize": "medium",              // optional
  "count": 3,                         // how many films to return
  "excludeSlugs": []                  // additional slugs to exclude
}
```

Response:
```json
{
  "films": [
    {
      "slug": "rachel-michael-woolf",
      "couple": "Rachel & Michael Woolf",
      "description": "Door County Love",
      "venueName": "Thyme Restaurant",
      "venueCity": "Sister Bay, WI",
      "score": 14,
      "hlsUrl": "https://media.flyiniris.com/couples/rachel-michael-woolf/hls/teaser/master.m3u8",
      "thumbUrl": "https://media.flyiniris.com/couples/rachel-michael-woolf/thumbs/thumb.jpg",
      "filmUrl": "https://flyiniris.com/films/rachel-michael-woolf"
    }
  ],
  "totalMatched": 14,
  "viewedCount": 0
}
```

### POST /viewed
Track that a couple has seen a film:
```json
{
  "email": "couple@email.com",
  "slug": "rachel-michael-woolf"
}
```

### GET /viewed?email=couple@email.com
Get list of films this couple has already seen.

## Workers KV Structure
- Key: `viewed:{email}` → JSON array of slugs
- Key: `film-index` → full film index JSON

## Deployment
- Use wrangler in: C:\Users\flyin\Claude Projects\Landing Page\flyiniris\delivery\workers\video-match\
- Bind to R2 bucket FI_FILMS and KV namespace FI_MATCH
- Custom domain: match.flyiniris.com (or subdomain of media.flyiniris.com)

## Existing Infrastructure
- Video serve worker: C:\Users\flyin\Claude Projects\Landing Page\flyiniris\delivery\workers\video-serve\
- Use same wrangler patterns and Cloudflare account
- Account ID: b3269400156817c0292ea7f07141f369
- Wrangler already authenticated

## Film Index (hardcode in worker for now)
```json
[film-index.json contents — read from workspace]
```

## Quiz Answer Mappings
See video-matching-engine.md for the full mapping tables.

## Important Notes
- DO NOT break the existing video-serve worker
- Use the same CORS patterns
- Keep it simple — this is a scoring engine, not AI
- Film index can be hardcoded for now (14 films)
- View tracking is per-email in KV
