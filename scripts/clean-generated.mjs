import { rm, stat } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const generatedTargets = [
  "dist",
  "dist-ssr",
  "coverage",
  ".cache",
  ".tmp",
  "tmp",
  "node_modules/.vite",
  "qa/.tmp",
  "qa/tmp",
  "src-tauri/target",
  "src-tauri/gen/schemas",
];

function resolveSafeTarget(target) {
  const absoluteTarget = resolve(repositoryRoot, target);
  const repositoryPrefix = `${repositoryRoot}${sep}`;
  if (absoluteTarget === repositoryRoot || !absoluteTarget.startsWith(repositoryPrefix)) {
    throw new Error(`Refusing to clean unsafe path: ${target}`);
  }
  return absoluteTarget;
}

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

for (const target of generatedTargets) {
  const absoluteTarget = resolveSafeTarget(target);
  const displayPath = relative(repositoryRoot, absoluteTarget).replaceAll("\\", "/");
  if (!(await exists(absoluteTarget))) {
    console.log(`skip    ${displayPath}`);
    continue;
  }
  await rm(absoluteTarget, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  console.log(`removed ${displayPath}`);
}
