import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";
import {
  printHomologQaGuide,
  runHomologQaSeedForDefaultTenant,
} from "../services/homolog-qa-seed.js";

const FIXTURES_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../fixtures/labels",
);

const ALLOWED = new Set([
  "tiny-etiqueta-171579.zpl",
  "tiny-etiqueta-sample.zpl",
]);

/** Serve ZPL de fixture local (dev/seed) — sem Tiny nem QZ. */
export async function demoLabelRoutes(app: FastifyInstance) {
  app.get<{ Params: { name: string } }>(
    "/demo/labels/:name",
    async (request, reply) => {
      const name = path.basename(request.params.name);
      if (!ALLOWED.has(name)) {
        return reply.status(404).send({ error: "Etiqueta demo não encontrada" });
      }

      try {
        const content = await readFile(path.join(FIXTURES_DIR, name));
        return reply
          .header("Content-Type", "text/plain; charset=utf-8")
          .header("Cache-Control", "public, max-age=3600")
          .send(content);
      } catch {
        return reply.status(404).send({ error: "Arquivo ZPL ausente" });
      }
    },
  );

  /**
   * Homolog / QA: recria pedidos PENDING QA-H-* sem acesso ao shell do Dokploy.
   * POST https://<api>/demo/seed-homolog-qa
   */
  app.post("/demo/seed-homolog-qa", async (_request, reply) => {
    try {
      const result = await runHomologQaSeedForDefaultTenant();
      printHomologQaGuide(result);
      return {
        ok: true,
        pendingCount: result.pendingCount,
        pendingIds: result.pendingIds,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.status(500).send({ ok: false, error: message });
    }
  });
}
