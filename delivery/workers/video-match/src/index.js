// fi-video-match — Cloudflare Worker
// Personalized video matching engine for Flyin' Iris

const FILMS = [
  {"slug":"marie-matt","couple":"Marie & Matt","date":"6.7.25","venueName":"Westmoor Country Club","venueCity":"Brookfield, WI","coupleLastNames":"Frederick","description":"Old Money Vibes","venueType":"country-club","region":"waukesha","season":"summer","vibe":["romantic","timeless","elegant","intimate","whimsical"],"guestSize":"large","emotionalTone":"cinematic-epic","package":"ss-experience"},
  {"slug":"kayla-jason","couple":"Kayla & Jason","date":"6.14.25","venueName":"The Covenant at Murray Mansion","venueCity":"Racine, WI","coupleLastNames":"Neuroth","description":"Young, Wild & Free","venueType":"estate","region":"racine","season":"summer","vibe":["romantic","intimate","adventurous","classic"],"guestSize":"large","emotionalTone":"joyful","package":"ss-experience"},
  {"slug":"allie-matt","couple":"Matt & Allie","date":"6.21.25","venueName":"10 South","venueCity":"Janesville, WI","coupleLastNames":"Hoslet","description":"Bloopers Please!","venueType":"ballroom","region":"janesville","season":"summer","vibe":["modern","grand","adventurous"],"guestSize":"large","emotionalTone":"joyful","package":"ss-experience"},
  {"slug":"sally-aj","couple":"Sally & AJ","date":"7.5.25","venueName":"10 South","venueCity":"Janesville, WI","coupleLastNames":"Svendsen","description":"Goofy & Cute","venueType":"ballroom","region":"janesville","season":"summer","vibe":["romantic","elegant","grand","classic"],"guestSize":"large","emotionalTone":"cinematic-epic","package":"ss-experience"},
  {"slug":"taylor-kane","couple":"Taylor & Kane","date":"7.19.25","venueName":"Green Bay Country Club","venueCity":"Green Bay, WI","coupleLastNames":"Kampmeier","description":"Strong Energy","venueType":"country-club","region":"green-bay","season":"summer","vibe":["romantic","modern","elegant","grand","adventurous"],"guestSize":"large","emotionalTone":"party","package":"ss-experience"},
  {"slug":"kate-thomas","couple":"Kate & Thomas","date":"7.25.25","venueName":"Peck & Bushel","venueCity":"Colgate, WI","coupleLastNames":"Schuerman","description":"The Perfect Pear 🍐","venueType":"outdoor","region":"milwaukee","season":"summer","vibe":["romantic","elegant","rustic","intimate","whimsical"],"guestSize":"large","emotionalTone":"quiet-intimate","package":"ss-experience"},
  {"slug":"sandra-chas","couple":"Sandra & Chas","date":"8.2.25","venueName":"Terrace 167","venueCity":"Richfield, WI","coupleLastNames":"Arredondo","description":"Latino Especial 🔥","venueType":"ballroom","region":"milwaukee","season":"summer","vibe":["modern","elegant","cultural","adventurous"],"guestSize":"medium","emotionalTone":"party","package":"ss-experience"},
  {"slug":"amanda-boris","couple":"Amanda & Boris","date":"8.31.25","venueName":"Mercantile Hall","venueCity":"Burlington, WI","coupleLastNames":"Romanov","description":"Mazeltoff 🕎","venueType":"industrial","region":"racine","season":"summer","vibe":["romantic","intimate","cultural","adventurous","whimsical"],"guestSize":"medium","emotionalTone":"joyful","package":"ss-experience"},
  {"slug":"izzy-hunter","couple":"Izzy & Hunter","date":"9.6.25","venueName":"The Gage","venueCity":"West Allis, WI","coupleLastNames":"Albanese","description":"Young & In Love","venueType":"industrial","region":"milwaukee","season":"fall","vibe":["modern","elegant","grand","adventurous"],"guestSize":"large","emotionalTone":"cinematic-epic","package":"ss-experience"},
  {"slug":"emily-bobby","couple":"Emily & Bobby","date":"9.19.25","venueName":"Monona Terrace","venueCity":"Madison, WI","coupleLastNames":"Mackenzie","description":"Epic Madison Wedding","venueType":"lakefront","region":"madison","season":"fall","vibe":["romantic","timeless","elegant","grand","adventurous"],"guestSize":"large","emotionalTone":"cinematic-epic","package":"ss-experience"},
  {"slug":"rachel-michael-woolf","couple":"Rachel & Michael Woolf","date":"10.4.25","venueName":"Thyme Restaurant","venueCity":"Sister Bay, WI","coupleLastNames":"Woolf","description":"Door County Love","venueType":"outdoor","region":"door-county","season":"fall","vibe":["romantic","timeless","elegant","rustic","intimate"],"guestSize":"medium","emotionalTone":"tearjerker","package":"ss-experience"},
  {"slug":"rachel-michael-street","couple":"Rachel & Michael Street","date":"11.29.25","venueName":"10 South","venueCity":"Janesville, WI","coupleLastNames":"Street","description":"Mr. Officer 👮","venueType":"ballroom","region":"janesville","season":"winter","vibe":["romantic","timeless","elegant","classic"],"guestSize":"large","emotionalTone":"quiet-intimate","package":"ss-experience"},
  {"slug":"taylor-austin","couple":"Taylor & Austin","date":"12.13.25","venueName":"The Fields Reserve","venueCity":"Stoughton, WI","coupleLastNames":"Stoltenburg","description":"A Wisconsin Love Story ❄️","venueType":"barn","region":"stoughton","season":"winter","vibe":["romantic","timeless","rustic","intimate"],"guestSize":"large","emotionalTone":"tearjerker","package":"ss-experience"},
  {"slug":"olivia-austin","couple":"Olivia & Austin","date":"8.10.24","venueName":"","venueCity":"","coupleLastNames":"","description":"A Marine Marries His Duchess","venueType":"industrial","region":"milwaukee","season":"summer","vibe":["romantic","modern","timeless","elegant","intimate","grand","adventurous"],"guestSize":"medium","emotionalTone":"cinematic-epic","package":"ss-experience"},
  {"slug":"sarah-cody","couple":"Sarah & Cody","date":"7.25.24","venueName":"The Bowery","venueCity":"Rubicon, WI","coupleLastNames":"Foerster","description":"We Filmed Our Best Friend's Wedding","venueType":"barn","region":"milwaukee","season":"summer","vibe":["grand","adventurous","glamorous","fun"],"guestSize":"large","emotionalTone":"party-vibes","package":"ss-experience"}
];

// Quiz answer → film tag mappings
const VIBE_MAP = {
  "elegant-timeless": ["timeless", "elegant", "classic"],
  "big-energy": ["adventurous", "grand", "modern", "cultural"],
  "warm-intimate": ["intimate", "romantic", "rustic", "whimsical"],
  "mix": ["romantic", "elegant", "grand", "adventurous"]
};

const PRIORITY_MAP = {
  "raw-emotion": ["tearjerker", "quiet-intimate"],
  "cinematic": ["cinematic-epic"],
  "energy": ["party", "joyful"],
  "story": ["tearjerker", "quiet-intimate"],
  "all": ["cinematic-epic", "tearjerker", "joyful", "party", "quiet-intimate"]
};

const MEDIA_BASE = "https://media.flyiniris.com";
const SITE_BASE = "https://flyiniris.com";

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return handleOptions(request);

    const url = new URL(request.url);
    const path = url.pathname;

    try {
      // POST /match — get personalized film recommendations
      if (path === "/match" && request.method === "POST") {
        return handleMatch(request, env);
      }

      // POST /viewed — track that a couple saw a film
      if (path === "/viewed" && request.method === "POST") {
        return handleTrackViewed(request, env);
      }

      // GET /viewed?email=... — get list of viewed films
      if (path === "/viewed" && request.method === "GET") {
        return handleGetViewed(request, env);
      }

      // GET /films — return all films metadata
      if (path === "/films" && request.method === "GET") {
        return handleGetFilms(request);
      }

      return jsonResponse({ error: "Not found" }, 404, request);
    } catch (err) {
      return jsonResponse({ error: "Internal server error", detail: err.message }, 500, request);
    }
  }
};

// ---------------------------------------------------------------------------
// Matching Engine
// ---------------------------------------------------------------------------

function scoreFilm(film, query) {
  let score = 0;

  // Vibe match (highest weight — 3 pts per matching vibe tag)
  if (query.vibe && VIBE_MAP[query.vibe]) {
    const mappedVibes = VIBE_MAP[query.vibe];
    for (const v of mappedVibes) {
      if (film.vibe.includes(v)) score += 3;
    }
  }

  // Emotional tone match (2 pts)
  if (query.priority && PRIORITY_MAP[query.priority]) {
    const mappedTones = PRIORITY_MAP[query.priority];
    if (mappedTones.includes(film.emotionalTone)) score += 2;
  }

  // Region match (4 pts — biggest bonus, same area = instant trust)
  if (query.region && film.region === query.region) score += 4;

  // Season match (2 pts)
  if (query.season && film.season === query.season) score += 2;

  // Venue type match (3 pts)
  if (query.venueType && film.venueType === query.venueType) score += 3;

  // Guest size match (1 pt — minor tiebreaker)
  if (query.guestSize && film.guestSize === query.guestSize) score += 1;

  return score;
}

async function handleMatch(request, env) {
  const body = await request.json();
  const {
    email, vibe, priority, budget, region, season,
    venueType, guestSize, count = 3, excludeSlugs = []
  } = body;

  // Get already-viewed films for this email
  let viewed = [];
  if (email && env.FI_MATCH) {
    const stored = await env.FI_MATCH.get(`viewed:${email.toLowerCase()}`);
    if (stored) viewed = JSON.parse(stored);
  }

  // Combine exclude lists
  const allExcluded = new Set([...viewed, ...excludeSlugs]);

  // Score all films
  const scored = FILMS.map(film => ({
    ...film,
    score: scoreFilm(film, { vibe, priority, region, season, venueType, guestSize }),
    excluded: allExcluded.has(film.slug)
  }));

  // Filter out excluded, sort by score descending
  const available = scored
    .filter(f => !f.excluded)
    .sort((a, b) => b.score - a.score);

  // Take top N
  const selected = available.slice(0, count).map(f => ({
    slug: f.slug,
    couple: f.couple,
    description: f.description,
    venueName: f.venueName,
    venueCity: f.venueCity,
    venueType: f.venueType,
    region: f.region,
    season: f.season,
    vibe: f.vibe,
    emotionalTone: f.emotionalTone,
    score: f.score,
    hlsUrl: `${MEDIA_BASE}/couples/${f.slug}/hls/teaser/master.m3u8`,
    thumbUrl: `${MEDIA_BASE}/couples/${f.slug}/thumbs/thumb.jpg`,
    filmUrl: `${SITE_BASE}/films/${f.slug}`
  }));

  // Auto-track these as viewed if email provided
  if (email && env.FI_MATCH) {
    const newViewed = [...viewed, ...selected.map(s => s.slug)];
    await env.FI_MATCH.put(
      `viewed:${email.toLowerCase()}`,
      JSON.stringify([...new Set(newViewed)])
    );
  }

  return jsonResponse({
    films: selected,
    totalFilms: FILMS.length,
    totalMatched: available.length,
    viewedCount: viewed.length,
    query: { vibe, priority, budget, region, season, venueType, guestSize }
  }, 200, request);
}

// ---------------------------------------------------------------------------
// View Tracking
// ---------------------------------------------------------------------------

async function handleTrackViewed(request, env) {
  const body = await request.json();
  const { email, slug } = body;

  if (!email || !slug) {
    return jsonResponse({ error: "email and slug required" }, 400, request);
  }

  const key = `viewed:${email.toLowerCase()}`;
  let viewed = [];
  if (env.FI_MATCH) {
    const stored = await env.FI_MATCH.get(key);
    if (stored) viewed = JSON.parse(stored);
  }

  if (!viewed.includes(slug)) {
    viewed.push(slug);
    await env.FI_MATCH.put(key, JSON.stringify(viewed));
  }

  return jsonResponse({ viewed }, 200, request);
}

async function handleGetViewed(request, env) {
  const url = new URL(request.url);
  const email = url.searchParams.get("email");

  if (!email) {
    return jsonResponse({ error: "email query param required" }, 400, request);
  }

  let viewed = [];
  if (env.FI_MATCH) {
    const stored = await env.FI_MATCH.get(`viewed:${email.toLowerCase()}`);
    if (stored) viewed = JSON.parse(stored);
  }

  return jsonResponse({ email, viewed }, 200, request);
}

// ---------------------------------------------------------------------------
// Films List
// ---------------------------------------------------------------------------

function handleGetFilms(request) {
  const films = FILMS.map(f => ({
    slug: f.slug,
    couple: f.couple,
    description: f.description,
    venueName: f.venueName,
    venueCity: f.venueCity,
    venueType: f.venueType,
    region: f.region,
    season: f.season,
    vibe: f.vibe,
    emotionalTone: f.emotionalTone,
    guestSize: f.guestSize,
    hlsUrl: `${MEDIA_BASE}/couples/${f.slug}/hls/teaser/master.m3u8`,
    thumbUrl: `${MEDIA_BASE}/couples/${f.slug}/thumbs/thumb.jpg`,
    filmUrl: `${SITE_BASE}/films/${f.slug}`
  }));

  return jsonResponse({ films, total: films.length }, 200, request);
}

// ---------------------------------------------------------------------------
// CORS & Response helpers
// ---------------------------------------------------------------------------

function cors(request) {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization"
  };
}

function handleOptions(request) {
  return new Response(null, { status: 204, headers: { ...cors(request), "Access-Control-Max-Age": "86400" } });
}

function jsonResponse(data, status = 200, request = null) {
  const headers = { "Content-Type": "application/json" };
  if (request) Object.assign(headers, cors(request));
  return new Response(JSON.stringify(data), { status, headers });
}
