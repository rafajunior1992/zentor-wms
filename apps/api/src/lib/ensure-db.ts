import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { prisma } from "./prisma.js";
import { ensureDefaultUsers } from "../services/ensure-default-users.js";
import {
  printHomologQaGuide,
  runHomologQaSeedForDefaultTenant,
} from "../services/homolog-qa-seed.js";

/** apps/api — funciona a partir de dist/lib ou src/lib */
const apiRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
const schemaPath = join(apiRoot, "prisma", "schema.prisma");
const requireFromApi = createRequire(join(apiRoot, "package.json"));

function resolvePackageCli(pkg: string): string {
  const pkgJsonPath = requireFromApi.resolve(`${pkg}/package.json`);
  const pkgJson = requireFromApi(pkgJsonPath) as {
    bin?: string | Record<string, string>;
  };
  const binField = pkgJson.bin;
  const binRel =
    typeof binField === "string"
      ? binField
      : (binField?.[pkg] ?? Object.values(binField ?? {})[0]);
  if (!binRel) {
    throw new Error(`Pacote ${pkg} sem bin`);
  }
  return join(dirname(pkgJsonPath), binRel);
}

function runCli(pkg: string, args: string[]) {
  const entry = resolvePackageCli(pkg);
  execFileSync(process.execPath, [entry, ...args], {
    cwd: apiRoot,
    env: process.env,
    stdio: "inherit",
  });
}

/**
 * Aplica schema Prisma (+ seed se banco vazio) antes de aceitar tráfego.
 * Roda dentro do `node .../index.js` — independente de Docker/Nixpacks CMD.
 * Desligar: WMS_SKIP_DB_ENSURE=1
 */
export async function ensureDatabaseReady(): Promise<void> {
  if (
    process.env.WMS_SKIP_DB_ENSURE === "1" ||
    process.env.WMS_SKIP_DB_ENSURE === "true"
  ) {
    console.log("[ensure-db] pulado (WMS_SKIP_DB_ENSURE)");
    return;
  }

  if (!process.env.DATABASE_URL) {
    console.warn("[ensure-db] DATABASE_URL ausente — pulando");
    return;
  }

  const { existsSync } = await import("node:fs");
  if (!existsSync(schemaPath)) {
    throw new Error(
      `[ensure-db] schema não encontrado em ${schemaPath} (cwd apiRoot=${apiRoot})`,
    );
  }

  console.log("[ensure-db] aplicando schema (prisma db push)...");
  runCli("prisma", ["db", "push", "--skip-generate", "--schema", schemaPath]);

  const forceFullSeed =
    process.env.WMS_FORCE_FULL_SEED === "1" ||
    process.env.WMS_FORCE_FULL_SEED === "true";

  let tenantCount = 0;
  try {
    tenantCount = await prisma.tenant.count();
  } catch (err) {
    console.warn(
      "[ensure-db] falha ao contar tenants após push:",
      err instanceof Error ? err.message : err,
    );
  }

  console.log("[ensure-db] garantindo usuários padrão (super-admin, adm da conta, operador)...");
  try {
    const defaultUsers = await ensureDefaultUsers(prisma);
    console.log(
      `[ensure-db] usuários prontos: platform=${defaultUsers.platformAdminEmail}, tenantAdmin=${defaultUsers.tenantAdminEmail}, operador=${defaultUsers.operadorEmail}`,
    );
  } catch (err) {
    console.warn(
      "[ensure-db] falha ao garantir usuários padrão:",
      err instanceof Error ? err.message : err,
    );
  }

  if (tenantCount === 0 || forceFullSeed) {
    console.log(
      forceFullSeed
        ? "[ensure-db] WMS_FORCE_FULL_SEED=1 — rodando seed completo..."
        : "[ensure-db] banco sem tenants — rodando seed completo...",
    );
    runCli("tsx", ["prisma/seed.ts"]);
  } else {
    // Homolog com banco já populado: refresca só QA-H-* no boot (in-process)
    console.log("[ensure-db] atualizando pedidos QA-H-*...");
    try {
      const result = await runHomologQaSeedForDefaultTenant(prisma);
      printHomologQaGuide(result);
    } catch (err) {
      console.warn(
        "[ensure-db] falha ao atualizar QA-H-*:",
        err instanceof Error ? err.message : err,
      );
    }
  }

  console.log("[ensure-db] ok");
}
