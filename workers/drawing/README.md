# Drawing worker (Modal)

Reads one page of a vector PDF drawing with poppler and returns its shapes (SVG) and words (XHTML with boxes). It owns
no scene state and decides nothing about walls or rooms: `packages/spatial/src/pdfEvidence.ts` reads the views into
evidence in the browser, and `auditAgainstDrawing` compares a model with it. CPU only, no weights, scales to zero.

**Deployed 30 Oct 2026** as the Modal app `icarus-drawing` (workspace `alankritxghosh`), with the secret `icarus-drawing` holding `DRAWING_WORKER_TOKEN`. The endpoint URL and token are not in this repository: they are in `apps/edge/.dev.vars` (git-ignored) for local runs. Redeploy with `modal deploy app.py`. Tested live: no token and a wrong token give 401, a file that is not a PDF gives 400, a real A3 CAD sheet gives its views in about 10 s cold.

The production edge Worker is **not deployed**, so its two secrets are not set yet. When it is (needs `wrangler login`, then the
author's go-ahead to deploy publicly):

```bash
wrangler secret put DRAWING_WORKER_URL    # in apps/edge
wrangler secret put DRAWING_WORKER_TOKEN  # the same token as the Modal secret
```

Without those two secrets the edge answers `/api/drawing/views` with 503 "reading drawings is not set up".

Check the extraction without Modal: `../reconstruct/.venv/bin/python app.py sheet.pdf` (needs poppler on the PATH).

Limits: PDFs up to 8 MB, page 1 to 50, 60 s per poppler call. The SVG of a dense CAD sheet is several megabytes.

The worker's poppler (Debian package) is older than a current Homebrew build and writes fills as `style="fill:rgb(...)"`
instead of `fill="rgb(...)"`; the extractor reads both. On the same sheet both give 53 wall shapes with identical
bounds; the older one read 23 labels with 15 printed sizes, the newer 22 with 17.
