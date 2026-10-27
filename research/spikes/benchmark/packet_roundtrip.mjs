// End-to-end check of the review packet: open it in a simulated browser, fill the form the way a
// reviewer would, press "Download", and confirm the downloaded JSON analyses correctly.
// The answers below are INVENTED (a planted preference for plan B), so the result says nothing about Icarus.
import { JSDOM } from "jsdom";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const html = readFileSync(new URL("../../results/packet/packet.html", import.meta.url), "utf8");
let captured = "";
const dom = new JSDOM(html, { runScripts: "dangerously", pretendToBeVisual: true,
  beforeParse(w) {
    w.URL.createObjectURL = (b) => { captured = b.__text; return "blob:x"; };
    w.Blob = class { constructor(parts) { this.__text = parts.join(""); } };
    w.HTMLAnchorElement.prototype.click = () => {};
  } });
const d = dom.window.document;
const pairs = [...d.querySelectorAll("section.card h2")].map((h) => h.textContent);
console.log("pairs in packet:", pairs.length, "svg plans:", d.querySelectorAll("svg").length, "selects:", d.querySelectorAll("select").length);
d.getElementById("who").value = "synthetic-reviewer";
for (const p of pairs) {
  d.querySelector(`input[name="pref-${p}"][value="B"]`).checked = true;
  for (const sel of d.querySelectorAll(`select[data-pair="${p}"]`)) { sel.value = sel.dataset.side === "B" ? "4" : "3"; }
}
dom.window.save();
const out = JSON.parse(captured);
console.log("downloaded:", out.reviewer, out.pairs.length, "pairs; first:", JSON.stringify(out.pairs[0]));
mkdirSync(new URL("../../results/packet-test/", import.meta.url), { recursive: true });
writeFileSync(new URL("../../results/packet-test/ratings.json", import.meta.url), JSON.stringify([out]));
