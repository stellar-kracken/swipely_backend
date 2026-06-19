import { existsSync } from "fs";
import { dirname, join, relative } from "path";
import type { ZodTypeAny } from "zod";
import {
  AssetHealthFixtureSchema,
  AssetsFixtureSchema,
  BridgesFixtureSchema,
} from "./schemas.js";

function findRepoRoot(start: string = process.cwd()): string {
  let dir = start;
  let parent = dirname(dir);
  while (parent !== dir) {
    if (existsSync(join(dir, "e2e", "fixtures"))) return dir;
    dir = parent;
    parent = dirname(dir);
  }
  return existsSync(join(dir, "e2e", "fixtures")) ? dir : start;
}

export const REPO_ROOT = findRepoRoot();

const FIXTURES_DIR = join(REPO_ROOT, "e2e", "fixtures");

export interface FixtureRegistryEntry {
  name: string;
  file: string;
  schema: ZodTypeAny;
  description: string;
}

export const fixtureRegistry: FixtureRegistryEntry[] = [
  {
    name: "assets",
    file: join(FIXTURES_DIR, "assets.json"),
    schema: AssetsFixtureSchema,
    description: "Asset listing payload (GET /api/v1/assets)",
  },
  {
    name: "bridges",
    file: join(FIXTURES_DIR, "bridges.json"),
    schema: BridgesFixtureSchema,
    description: "Bridge status payload (GET /api/v1/bridges)",
  },
  {
    name: "asset-health",
    file: join(FIXTURES_DIR, "asset-health.json"),
    schema: AssetHealthFixtureSchema,
    description: "Per-asset health scores (GET /api/v1/assets/:symbol/health)",
  },
];

export function toRepoRelative(file: string): string {
  return relative(REPO_ROOT, file);
}
