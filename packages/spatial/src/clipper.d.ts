declare module "clipper2-wasm/dist/umd/clipper2z.js" {
  import type { MainModule } from "clipper2-wasm/dist/clipper2z";

  const factory: (options?: { wasmBinary?: ArrayBuffer | Uint8Array }) => Promise<MainModule>;
  export default factory;
}
