CREATE TABLE IF NOT EXISTS "tenants" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "tenants_slug_key" ON "tenants"("slug");

ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "cnpj" TEXT;

INSERT INTO "tenants" ("id", "name", "slug", "active", "createdAt", "updatedAt")
VALUES ('default-tenant', 'Default', 'default', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("slug") DO NOTHING;

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "isPlatformAdmin" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "tenantId" TEXT;

UPDATE "users" SET "isPlatformAdmin" = true, "tenantId" = NULL WHERE "email" = 'admin@wms.local';
UPDATE "users" SET "tenantId" = 'default-tenant' WHERE "tenantId" IS NULL AND COALESCE("isPlatformAdmin", false) = false;

ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "tenantId" TEXT;
ALTER TABLE "locations" ADD COLUMN IF NOT EXISTS "tenantId" TEXT;
ALTER TABLE "baskets" ADD COLUMN IF NOT EXISTS "tenantId" TEXT;
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "tenantId" TEXT;
ALTER TABLE "pick_waves" ADD COLUMN IF NOT EXISTS "tenantId" TEXT;
ALTER TABLE "inventory_movements" ADD COLUMN IF NOT EXISTS "tenantId" TEXT;
ALTER TABLE "purchase_receipt_sessions" ADD COLUMN IF NOT EXISTS "tenantId" TEXT;
ALTER TABLE "integration_event_logs" ADD COLUMN IF NOT EXISTS "tenantId" TEXT;

UPDATE "products" SET "tenantId" = 'default-tenant' WHERE "tenantId" IS NULL;
UPDATE "locations" SET "tenantId" = 'default-tenant' WHERE "tenantId" IS NULL;
UPDATE "baskets" SET "tenantId" = 'default-tenant' WHERE "tenantId" IS NULL;
UPDATE "orders" SET "tenantId" = 'default-tenant' WHERE "tenantId" IS NULL;
UPDATE "pick_waves" SET "tenantId" = 'default-tenant' WHERE "tenantId" IS NULL;
UPDATE "inventory_movements" SET "tenantId" = 'default-tenant' WHERE "tenantId" IS NULL;
UPDATE "purchase_receipt_sessions" SET "tenantId" = 'default-tenant' WHERE "tenantId" IS NULL;
UPDATE "integration_event_logs" SET "tenantId" = 'default-tenant' WHERE "tenantId" IS NULL;
