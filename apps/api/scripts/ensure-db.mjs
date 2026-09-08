#!/usr/bin/env node
/**
 * Garante schema Prisma no Postgres antes de subir a API.
 * Homolog (Dokploy):
 * - banco vazio → seed completo
 * - banco já populado → só recria pedidos QA-H-* (sem precisar de terminal)
 */
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const apiRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(join(apiRoot, "package.json"));

function run(cmd, args, opts = {}) {
  const result = spawnSync(cmd, args, {
    cwd: apiRoot,
    env: process.env,
    stdio: "inherit",
    shell: false,
    ...opts,
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

console.log("[ensure-db] aplicando schema (prisma db push)...");
run("pnpm", ["exec", "prisma", "db", "push", "--skip-generate"]);

let tenantCount = 0;
try {
  const { PrismaClient } = require("@prisma/client");
  const prisma = new PrismaClient();
  tenantCount = await prisma.tenant.count();
  await prisma.$disconnect();
} catch (err) {
  console.warn(
    "[ensure-db] não foi possível checar tenants:",
    err instanceof Error ? err.message : err,
  );
}

const forceFullSeed =
  process.env.WMS_FORCE_FULL_SEED === "1" ||
  process.env.WMS_FORCE_FULL_SEED === "true";

if (tenantCount === 0 || forceFullSeed) {
  console.log(
    forceFullSeed
      ? "[ensure-db] WMS_FORCE_FULL_SEED=1 — rodando seed completo..."
      : "[ensure-db] banco sem tenants — rodando seed completo...",
  );
  run("pnpm", ["run", "db:seed"]);
} else {
  console.log("[ensure-db] atualizando pedidos QA-H-*...");
  run("pnpm", ["exec", "tsx", "prisma/seed-homolog-qa-run.ts"]);
}

console.log("[ensure-db] ok");
