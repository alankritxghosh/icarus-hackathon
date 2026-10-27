import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createKernel, type Kernel } from "../src/kernel";

let cached: Promise<Kernel> | undefined;
/** One kernel per test file: reads the wasm from the installed package. */
export function testKernel(): Promise<Kernel> {
  cached ??= (async () => {
    const wasm = createRequire(import.meta.url).resolve("clipper2-wasm/dist/umd/clipper2z.wasm");
    return createKernel({ wasmBinary: readFileSync(wasm) });
  })();
  return cached;
}
