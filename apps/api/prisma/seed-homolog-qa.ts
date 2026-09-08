/**
 * Re-export para o seed Prisma / CLI — implementação em src/services.
 */
export {
  printHomologQaGuide,
  seedHomologQaBatch,
  runHomologQaSeedForDefaultTenant,
  type SeedHomologQaInput,
  type SeedHomologQaResult,
} from "../src/services/homolog-qa-seed.js";
