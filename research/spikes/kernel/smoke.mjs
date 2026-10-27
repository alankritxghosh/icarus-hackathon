import { loadAll, resultArea } from "./libs.mjs";
const libs = await loadAll();
const A = [[[[0,0],[4000,0],[4000,3000],[0,3000]]]];
const B = [[[[2000,1000],[6000,1000],[6000,5000],[2000,5000]]]];
for (const l of libs) {
  console.log(l.name, l.version, "∩", resultArea(l, l.intersection(A,B)), "∪", resultArea(l, l.union(A,B)), "A\\B", resultArea(l, l.difference(A,B)), "offset", l.offset ? resultArea(l, l.offset(A, 100)) : "n/a");
}
console.log("expected ∩ 2000*2000=4000000  ∪ 12000000+16000000-4000000=24000000  A\\B 8000000  offset (4200*3200)=13440000");
