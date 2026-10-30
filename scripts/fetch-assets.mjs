// Fetches the CC0 models, PBR textures and HDRI skies listed in assets/manifest.json from the Poly Haven public API into
// apps/web/public/assets/{models,textures,hdri}, verifying every file's size and MD5, and rewrites assets/LICENSES.md.
import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const API = "https://api.polyhaven.com";
const HEADERS = { "User-Agent": "icarus-hackathon-asset-fetch" };
const OUT = "apps/web/public/assets/models";
const TEXTURES = "apps/web/public/assets/textures";
const HDRI = "apps/web/public/assets/hdri";
const manifest = JSON.parse(await readFile("assets/manifest.json", "utf8"));

async function json(url) {
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return res.json();
}

async function download(file, to) {
  try {
    if ((await stat(to)).size === file.size) return false;
  } catch {}
  const res = await fetch(file.url, { headers: HEADERS });
  if (!res.ok) throw new Error(`${file.url}: ${res.status}`);
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.length !== file.size)
    throw new Error(`${to}: size ${bytes.length}, expected ${file.size}`);
  if (createHash("md5").update(bytes).digest("hex") !== file.md5)
    throw new Error(`${to}: checksum mismatch`);
  await mkdir(dirname(to), { recursive: true });
  await writeFile(to, bytes);
  return true;
}

const rows = [];
let total = 0;
for (const id of manifest.models) {
  const [info, files] = await Promise.all([json(`${API}/info/${id}`), json(`${API}/files/${id}`)]);
  const gltf = files.gltf[manifest.resolution].gltf;
  const root = join(OUT, id);
  await download(gltf, join(root, `${id}.gltf`));
  total += gltf.size;
  for (const [rel, file] of Object.entries(gltf.include ?? {})) {
    await download(file, join(root, rel));
    total += file.size;
  }
  rows.push(
    `| ${id} | ${info.name} | ${info.authors ? Object.keys(info.authors).join(", ") : ""} | https://polyhaven.com/a/${id} |`,
  );
  console.log(`ok ${id}`);
}

const textureRows = [];
for (const id of manifest.textures ?? []) {
  const [info, files] = await Promise.all([json(`${API}/info/${id}`), json(`${API}/files/${id}`)]);
  for (const [map, short] of Object.entries(manifest.textureMaps)) {
    const file = files[map][manifest.textureResolution].jpg;
    await download(file, join(TEXTURES, id, `${id}_${short}_${manifest.textureResolution}.jpg`));
    total += file.size;
  }
  textureRows.push(
    `| ${id} | ${info.name} | ${info.authors ? Object.keys(info.authors).join(", ") : ""} | https://polyhaven.com/a/${id} |`,
  );
  console.log(`ok texture ${id}`);
}
const hdriRows = [];
for (const { id, resolution } of manifest.hdris ?? []) {
  const [info, files] = await Promise.all([json(`${API}/info/${id}`), json(`${API}/files/${id}`)]);
  const file = files.hdri[resolution].hdr;
  await download(file, join(HDRI, `${id}_${resolution}.hdr`));
  total += file.size;
  hdriRows.push(
    `| ${id} | ${info.name} | ${info.authors ? Object.keys(info.authors).join(", ") : ""} | https://polyhaven.com/a/${id} |`,
  );
  console.log(`ok hdri ${id}`);
}

const fetched = new Date().toISOString().slice(0, 10);
await writeFile(
  "assets/LICENSES.md",
  `# Third-party assets

All assets below are CC0 1.0 (public domain) from Poly Haven (https://polyhaven.com), fetched on ${fetched}
at ${manifest.resolution} resolution by \`scripts/fetch-assets.mjs\` from \`assets/manifest.json\`, with size and
MD5 verified against Poly Haven's API. Poly Haven asks that its use is made visible to users; the product
shows a credit.

| Id | Name | Author(s) | Source |
| --- | --- | --- | --- |
${rows.join("\n")}

## Textures (1k diffuse, ARM and normal maps)

| Id | Name | Author(s) | Source |
| --- | --- | --- | --- |
${textureRows.join("\n")}

## Sky (HDRI)

| Id | Name | Author(s) | Source |
| --- | --- | --- | --- |
${hdriRows.join("\n")}
`,
);
console.log(
  `${manifest.models.length} models, ${(manifest.textures ?? []).length} textures, ${(manifest.hdris ?? []).length} sky, ${(total / 1e6).toFixed(1)} MB`,
);
