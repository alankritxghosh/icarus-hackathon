# Drawing worker (Modal)

Reads one page of a vector PDF drawing with poppler and returns its shapes (SVG) and words (XHTML with boxes). It owns
no scene state and decides nothing about walls or rooms: `packages/spatial/src/pdfEvidence.ts` reads the views into
evidence in the browser, and `auditAgainstDrawing` compares a model with it. CPU only, no weights, scales to zero.

**Not deployed.** Deploying creates a Modal app and a secret in the author's workspace.

```bash
modal secret create icarus-drawing DRAWING_WORKER_TOKEN=<a long random string>
modal deploy app.py                      # prints the endpoint URL
wrangler secret put DRAWING_WORKER_URL   # in apps/edge, the printed URL
wrangler secret put DRAWING_WORKER_TOKEN # the same token
```

Without those two secrets the edge answers `/api/drawing/views` with 503 "reading drawings is not set up".

Check the extraction without Modal: `../reconstruct/.venv/bin/python app.py sheet.pdf` (needs poppler on the PATH).

Limits: PDFs up to 8 MB, page 1 to 50, 60 s per poppler call. The SVG of a dense CAD sheet is several megabytes.
