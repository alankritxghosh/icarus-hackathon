# Drawing worker (Modal)

Reads one page of a vector PDF drawing with poppler and returns its shapes (SVG) and words (XHTML with boxes). It owns
no scene state and decides nothing about walls or rooms: `packages/spatial/src/pdfEvidence.ts` reads the views into
evidence in the browser, and `auditAgainstDrawing` compares a model with it. CPU only, no weights, scales to zero.

**Deployed 30 Oct 2026** as the Modal app `icarus-drawing` (workspace `alankritxghosh`), with the secret `icarus-drawing` holding `DRAWING_WORKER_TOKEN`. The endpoint URL and token are not in this repository: they are in `apps/edge/.dev.vars` (git-ignored) for local runs. Redeploy with `modal deploy app.py`. Tested live: no token and a wrong token give 401, a file that is not a PDF gives 400, a real A3 CAD sheet gives its views in about 10 s cold.

The edge Worker `icarus-edge` was deployed on 30 Oct 2026 (Cloudflare account of the author, a `workers.dev` address with nothing
linking to it) and has both secrets, `DRAWING_WORKER_URL` and `DRAWING_WORKER_TOKEN`. Tested live with a real A3 CAD sheet:
200 with its views in about 6.5 s, 400 for a non-PDF or a bad page, 405 for a GET. To change a secret:

```bash
cd apps/edge && wrangler secret put DRAWING_WORKER_TOKEN   # and rotate the Modal secret `icarus-drawing` to match
```

Without those two secrets the edge would answer `/api/drawing/views` with 503 "reading drawings is not set up".

Check the extraction without Modal: `../reconstruct/.venv/bin/python app.py sheet.pdf` (needs poppler on the PATH).

Limits: PDFs up to 8 MB, page 1 to 50, 60 s per poppler call. The SVG of a dense CAD sheet is several megabytes.

The worker's poppler (Debian package) is older than a current Homebrew build and writes fills as `style="fill:rgb(...)"`
instead of `fill="rgb(...)"`; the extractor reads both. On the same sheet both give 53 wall shapes with identical
bounds; the older one read 23 labels with 15 printed sizes, the newer 22 with 17.

**Abuse:** the edge route takes any PDF from anyone who finds the address, and each call costs a few seconds of Modal CPU. It
is capped (8 MB, `max_containers=2`), but there is no per-caller rate limit yet; add a Cloudflare rate-limiting rule before
the address is public.
