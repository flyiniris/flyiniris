# Couple Page Runbook

The single recipe for "Sierra & Sean delivered a wedding, now ship the
couple's page." Use this when a wedding's MP4s are final.

For schema details, worker internals, troubleshooting, and the long
form of every step below, see [workflow-guide.md](workflow-guide.md).

## When to run this

When Sierra hands Sean the final-cut MP4s for a couple. The end result
is a private page at `https://flyiniris.com/films/<slug>/` that the
couple can stream and download from with their password.

## TL;DR happy path (Sean's RTX laptop, ~20 min for an 8-clip catalog)

**1. Put MP4s in a clean folder.** Filenames become the video ids.
Lowercase, hyphens for spaces, no special characters.

```
C:\Videos\<slug>\
  teaser.mp4
  highlight.mp4
  ceremony.mp4
  speeches.mp4
  ...
```

**2. Create the couple config.** Copy the sample and edit.

```powershell
Copy-Item "C:\Users\flyin\Claude Projects\Landing Page\flyiniris\delivery\sample\amanda-boris.json" "C:\Users\flyin\Claude Projects\Landing Page\flyiniris\delivery\live\<slug>.json"
```

In the new file: set `slug`, `coupleNames` ("Name1 & Name2"),
`weddingDate`, `password`. Add one `videos[]` entry per MP4 file.
Mark up to 5 with `"hero": true` (typically teaser, highlight, plus
story-session if delivered).

**3. Transcode, upload, set password, generate, ship.**

```powershell
cd "C:\Users\flyin\Claude Projects\Landing Page\flyiniris\delivery\scripts"
.\transcode.ps1 -InputDir "C:\Videos\<slug>" -ConfigFile "..\live\<slug>.json" -OutputDir ".\output"
.\upload.ps1 -CoupleSlug "<slug>" -OutputDir ".\output" -OriginalDir "C:\Videos\<slug>"
cd ..\workers\video-serve
wrangler kv key put --binding=PASSWORDS "<slug>" "<password-from-config>"
cd ..\..\..
node delivery/generate-film-page.js delivery/live/<slug>.json
git add films/<slug>/ ; git commit -m "Add <Couple Names> film delivery page" ; git push
```

Page is live at `https://flyiniris.com/films/<slug>/` within 60 to 90
seconds of the push.

## Verify before sending the URL to the couple

- [ ] Hit `flyiniris.com/films/<slug>/`, hard reload (Ctrl+Shift+R).
- [ ] Hero videos play, thumbnails render at 16:9 before click.
- [ ] Watch the Full Day plays through, fullscreen persists across clips.
- [ ] Download password works. Try one download.
- [ ] Open on phone. Layout looks right.

If anything looks wrong, see [workflow-guide.md](workflow-guide.md)
section "Troubleshooting."

## Prerequisites (one-time per machine)

Sean's laptop already has all of these. If you set this up on a fresh
machine, install:

| Tool | Purpose | Where |
|------|---------|-------|
| Node.js 18+ | Runs the generator | nodejs.org |
| ffmpeg with NVENC | HLS transcode | gyan.dev/ffmpeg/builds (full build) |
| rclone | R2 uploads | rclone.org/downloads, then `rclone config` to add the `r2fi` remote with the Cloudflare R2 API token |
| git | Repo + push | git-scm.com plus GitHub credentials |
| wrangler CLI | KV password set | `npm install -g wrangler` then `wrangler login` |
| PowerShell 7 | Scripting | Built into Windows 11 |
| NVIDIA GPU (RTX recommended) | NVENC transcode | Optional but transcode is roughly 10x slower without it |

Repo path: `C:\Users\flyin\Claude Projects\Landing Page\flyiniris\`.

## Sierra automation: what would it take to give her control?

Right now this runbook requires Sean to run 7 commands across ffmpeg,
rclone, wrangler, and git. Sierra cannot do this from her machine
without setup. Four realistic paths, easiest to hardest.

### Path A: One wrapper script (~1 to 2 hours of build)

A single PowerShell script that takes a slug and an input folder and
runs all 7 steps in sequence. Sierra sees one prompt for the couple's
password and that's it.

```powershell
.\new-couple.ps1 -Slug rachel-brandon -InputDir "C:\Videos\rachel-brandon" -CoupleNames "Rachel & Brandon" -WeddingDate "October 12, 2024"
```

What Sierra needs on her own machine:
- All the prerequisites in the table above (Node, ffmpeg, rclone, git,
  wrangler) installed once.
- All the credentials (rclone R2 token, GitHub auth, Cloudflare login)
  configured once.
- An NVIDIA GPU, or patience for CPU transcoding.
- The repo cloned to her machine.

What Sean needs to build:
- One PowerShell wrapper script (`delivery/scripts/new-couple.ps1`).
- A short setup doc for Sierra covering the prereqs and the folder
  conventions.

Cheapest path. Unblocks Sierra completely if her hardware can transcode.

### Path B: Drag-drop GUI on Sierra's machine (~1 to 2 days of build)

Same wrapper logic as Path A, but wrapped in a tiny local app (Tauri
or Electron) with a drag-drop area for video files and a small form for
couple metadata. No terminal commands. Same prerequisites, same GPU
note, same machine setup.

Worth doing only if Sierra finds the script intimidating after trying
Path A.

### Path C: Web admin on iris-studio with cloud transcode (~3 to 5 days)

Sierra logs into iris-studio (Sean's CRM), creates a couple, uploads
MP4s through her browser. The system pushes originals to R2, sends
them to a transcode service (Cloudflare Stream is the obvious pick at
roughly 1 cent per minute of transcoded video, so a 30-minute catalog
costs about 30 cents), and ships the page when transcode finishes.

Tradeoffs:
- Most build effort.
- Costs money per minute. Worth it for convenience and removing all
  hardware requirements from Sierra.
- Removes the GPU dependency entirely.

Recommended only after a few couples have shipped via Path A or B and
Sean confirms Sierra wants to be the primary operator long term.

### Path D: Hybrid (recommended starting point)

1. Build Path A this week (~2 hours).
2. Sierra does the next 1 to 2 couples herself with the script.
3. If she's comfortable, stay on Path A.
4. If she wants zero terminal, build Path B.
5. If GPU or install requirements become a blocker, jump to Path C.

Avoids over-building before knowing what Sierra actually wants.

## Files to know

| File | Purpose |
|------|---------|
| `delivery/templates/couple-page.html` | Canonical Netflix-style page template. All layout, player, modal, download edits happen here. |
| `delivery/templates/sw.js` | Service worker template. Cache version (`fi-shell-vN`) bumps when the template changes. |
| `delivery/generate-film-page.js` | Node generator. Stamps the template into `films/<slug>/` from the per-couple JSON. |
| `delivery/live/<slug>.json` | Per-couple config. Gitignored. Source of truth for that couple's videos and download password. |
| `delivery/scripts/transcode.ps1` | NVENC HLS transcoder. |
| `delivery/scripts/upload.ps1` | rclone uploader to R2. |
| `delivery/workers/video-serve/` | The Cloudflare Worker at video.flyiniris.com. Serves HLS, thumbnails, password-gated downloads. |
| `films/<slug>/` | Generated couple pages. Auto-deploys via Cloudflare Pages on push to main. |

## When the template changes

If you edit `delivery/templates/couple-page.html` (layout, player, etc.):

1. Bump the cache version in `delivery/templates/sw.js` (e.g., `v22` -> `v23`).
2. Regenerate every existing couple page:

   ```powershell
   Get-ChildItem "C:\Users\flyin\Claude Projects\Landing Page\flyiniris\delivery\live\*.json" | ForEach-Object {
     node "C:\Users\flyin\Claude Projects\Landing Page\flyiniris\delivery\generate-film-page.js" $_.FullName
   }
   ```

3. Commit (template + sw + all regenerated `films/<slug>/` outputs) and push.
4. Couples pick up the new template on next visit (hard reload pulls the bumped SW).

## What to do if a couple says "I can't see my videos"

1. Have them hard-reload: Ctrl+Shift+R on desktop, force-quit and reopen on phone. 90% of "broken" reports clear here (stale service worker).
2. Check the page actually loads: hit `flyiniris.com/films/<slug>/` yourself.
3. Check the worker is alive: `curl -sI https://video.flyiniris.com/couples/<slug>/thumbs/teaser.jpg` should return 200.
4. Check R2 has the files: `rclone lsd r2fi:fi-films/couples/<slug>/hls/`.
5. If the password is the issue: `wrangler kv key get --binding=PASSWORDS <slug>` from `delivery/workers/video-serve/`.

Past gotchas worth knowing about (all fixed in current template, but
useful context if a regression ever appears):

- Hero thumbnails sized too tall before click. Fixed by locking
  `.hero-player-wrap` aspect-ratio at the container level (commit
  `caef290`). Do NOT add `aspect-ratio` or `!important` to the
  `media-player` element itself, that pattern broke playback in v14
  and v17 (commit `97bd3c5` rollback).
- Poster image visible in the player after click, especially in
  fullscreen and Watch the Full Day. Fixed by JS poster-hide in
  `configureHls()` (commit `9edbe5a`).
- Watch the Full Day exiting fullscreen on every clip transition.
  Fixed by keeping the same `<media-player>` element alive across
  advances and only swapping `src` (commit `718bf81`). The `ended`
  event is not a user gesture, so re-requesting fullscreen on a fresh
  element gets rejected by the browser.
