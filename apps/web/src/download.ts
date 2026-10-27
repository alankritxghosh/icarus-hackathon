import type { Built } from "./design";

/** Hands bytes to the browser as a file the person can keep. */
export function saveFile(name: string, data: BlobPart, type: string) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** A file-name-safe stem for an office: its brief's first words. */
export function fileStem(built: Built, brief: string): string {
  const words = brief
    .replace(/[^A-Za-z0-9 ]+/g, " ")
    .trim()
    .split(/\s+/)
    .slice(0, 5)
    .join("-");
  return `icarus-${(words || "office").toLowerCase()}-${built.plan.shell.w}x${built.plan.shell.h}m`;
}
