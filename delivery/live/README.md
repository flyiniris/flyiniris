# Live couple configs

Real per-couple delivery configs live here. Files in this directory (other than this README and `.gitkeep`) are gitignored because they contain real download passwords.

Sample configs without real credentials live at `delivery/sample/` and remain tracked.

Per the delivery page standard (`iris-automation/docs/project-knowledge-2026-05/delivery-page-standard.md` Section 6 + 7), generate a new couple's page by:

1. Copy `delivery/sample/amanda-boris.json` to `delivery/live/<slug>.json`.
2. Edit `slug`, `coupleNames`, `weddingDate`, `password`, and the `videos` array.
3. Run `node delivery/generate-film-page.js delivery/live/<slug>.json`.

The gitignore pattern is `delivery/live/*` with explicit allowlist for `.gitkeep` and `README.md`. Adding any other tracked file here requires adding it to the allowlist in `.gitignore`.
