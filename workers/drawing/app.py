"""
Reads the shapes and text of a vector PDF drawing on Modal, for the drawing audit.

This worker only extracts: it runs poppler (`pdftocairo -svg`, `pdftotext -bbox-layout`) and returns the two views
of one page. It owns no scene state and decides nothing about walls or rooms; `packages/spatial/src/pdfEvidence.ts`
reads the views into evidence, so the rules live in one place. CPU only, no weights, scales to zero.

NOT DEPLOYED. Deploying creates a Modal app and a secret in the author's workspace, which needs their say-so:

    modal secret create icarus-drawing DRAWING_WORKER_TOKEN=<a long random string>
    modal deploy app.py

Then give the edge Worker the printed URL and the same token (`DRAWING_WORKER_URL`, `DRAWING_WORKER_TOKEN`).
Test the extraction without deploying: `python app.py sheet.pdf` (needs poppler on the PATH).
"""

from __future__ import annotations

import hmac
import base64
import os
import subprocess
import sys
import tempfile

import modal

MAX_PDF_BYTES = 8 * 1024 * 1024

app = modal.App("icarus-drawing")
image = modal.Image.debian_slim(python_version="3.12").apt_install("poppler-utils").pip_install("fastapi[standard]")


def views(pdf: bytes, page: int = 1) -> dict:
    """The SVG of a page's shapes and the XHTML of its words, from poppler. Raises ValueError for a bad file."""
    if not pdf.startswith(b"%PDF-"):
        raise ValueError("that is not a PDF")
    if len(pdf) > MAX_PDF_BYTES:
        raise ValueError("that PDF is too large")
    if not 1 <= page <= 50:
        raise ValueError("page out of range")
    with tempfile.TemporaryDirectory() as d:
        src = os.path.join(d, "sheet.pdf")
        with open(src, "wb") as f:
            f.write(pdf)
        p = str(page)
        try:
            subprocess.run(["pdftocairo", "-svg", "-f", p, "-l", p, src, os.path.join(d, "page.svg")], check=True, capture_output=True, timeout=60)
            subprocess.run(["pdftocairo", "-png", "-scale-to", "1600", "-singlefile", "-f", p, "-l", p, src, os.path.join(d, "page")], check=True, capture_output=True, timeout=60)
            subprocess.run(["pdftotext", "-bbox-layout", "-f", p, "-l", p, src, os.path.join(d, "page.html")], check=True, capture_output=True, timeout=60)
        except (subprocess.CalledProcessError, subprocess.TimeoutExpired) as e:
            raise ValueError("poppler could not read that PDF") from e
        with open(os.path.join(d, "page.svg"), encoding="utf-8") as f:
            svg = f.read()
        with open(os.path.join(d, "page.html"), encoding="utf-8") as f:
            bbox = f.read()
        with open(os.path.join(d, "page.png"), "rb") as f:
            png = base64.b64encode(f.read()).decode("ascii")
    return {"svg": svg, "bboxHtml": bbox, "pngBase64": png, "page": page}


with image.imports():
    from fastapi import HTTPException, Request


@app.function(image=image, secrets=[modal.Secret.from_name("icarus-drawing")], timeout=120, max_containers=2, scaledown_window=30)
@modal.fastapi_endpoint(method="POST")
async def read(request: Request, page: int = 1):
    token = os.environ.get("DRAWING_WORKER_TOKEN", "")
    given = request.headers.get("authorization", "").removeprefix("Bearer ")
    if not token or not hmac.compare_digest(given.encode(), token.encode()):
        raise HTTPException(status_code=401, detail="unauthorised")
    try:
        return views(await request.body(), page)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


if __name__ == "__main__":
    # Local check with no Modal involved: print how big each view is.
    with open(sys.argv[1], "rb") as f:
        out = views(f.read())
    print({"svg_bytes": len(out["svg"]), "bbox_bytes": len(out["bboxHtml"])})
