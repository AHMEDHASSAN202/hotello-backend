import { MigrationInterface, QueryRunner } from "typeorm";

export class Baseline1785315376369 implements MigrationInterface {
    name = 'Baseline1785315376369'

    public async up(queryRunner: QueryRunner): Promise<void> {
        // uuid primary keys use uuid_generate_v4(); make the baseline
        // self-contained on any fresh database instead of relying on the
        // driver auto-installing the extension on connect.
        await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);
        await queryRunner.query(`
            CREATE TABLE "roles" (
                "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
                "name" character varying NOT NULL,
                "description" text,
                "permissions" text array NOT NULL DEFAULT '{}',
                "isSystem" boolean NOT NULL DEFAULT false,
                "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
                "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
                CONSTRAINT "UQ_648e3f5447f725579d7d4ffdfb7" UNIQUE ("name"),
                CONSTRAINT "PK_c1433d71a4838793a49dcad46ab" PRIMARY KEY ("id")
            )
        `);
        await queryRunner.query(`
            CREATE TABLE "admins" (
                "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
                "name" character varying NOT NULL,
                "email" character varying NOT NULL,
                "passwordHash" character varying NOT NULL,
                "refreshTokenHash" text,
                "isActive" boolean NOT NULL DEFAULT true,
                "preferredLanguage" character varying(2) NOT NULL DEFAULT 'en',
                "lastLoginAt" TIMESTAMP WITH TIME ZONE,
                "roleId" uuid NOT NULL,
                "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
                "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
                CONSTRAINT "UQ_051db7d37d478a69a7432df1479" UNIQUE ("email"),
                CONSTRAINT "PK_e3b38270c97a854c48d2e80874e" PRIMARY KEY ("id")
            )
        `);
        await queryRunner.query(`
            CREATE TABLE "hotels" (
                "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
                "nameEn" character varying NOT NULL,
                "nameAr" character varying NOT NULL,
                "slug" character varying NOT NULL,
                "status" character varying NOT NULL DEFAULT 'active',
                "logoPath" text,
                "starRating" integer,
                "contactEmail" character varying NOT NULL,
                "contactPhone" character varying NOT NULL,
                "address" text,
                "city" character varying NOT NULL,
                "country" character varying NOT NULL DEFAULT 'Egypt',
                "timezone" character varying NOT NULL DEFAULT 'Africa/Cairo',
                "defaultLanguage" character varying NOT NULL DEFAULT 'ar',
                "currency" character varying NOT NULL DEFAULT 'EGP',
                "roomsCount" integer NOT NULL DEFAULT '0',
                "staffUsersCount" integer NOT NULL DEFAULT '0',
                "monthlyGuestRequests" integer NOT NULL DEFAULT '0',
                "suspensionReason" text,
                "suspensionNote" text,
                "suspendedAt" TIMESTAMP WITH TIME ZONE,
                "suspendedById" uuid,
                "onboardedById" uuid,
                "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
                "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
                CONSTRAINT "UQ_4b1e0a5251af116f478314ce1c9" UNIQUE ("slug"),
                CONSTRAINT "PK_2bb06797684115a1ba7c705fc7b" PRIMARY KEY ("id")
            )
        `);
        await queryRunner.query(`
            CREATE TABLE "tenant_users" (
                "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
                "hotelId" uuid NOT NULL,
                "name" character varying NOT NULL,
                "email" character varying NOT NULL,
                "role" character varying NOT NULL DEFAULT 'owner',
                "permissions" jsonb NOT NULL DEFAULT '["*"]',
                "status" character varying NOT NULL DEFAULT 'pending',
                "passwordHash" text,
                "setupTokenHash" text,
                "setupTokenExpiresAt" TIMESTAMP WITH TIME ZONE,
                "lastLoginAt" TIMESTAMP WITH TIME ZONE,
                "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
                "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
                CONSTRAINT "UQ_fae37b5b2b62cbce0f173e77bd1" UNIQUE ("email"),
                CONSTRAINT "PK_8ce1bc9e3a5887c234900365447" PRIMARY KEY ("id")
            )
        `);
        await queryRunner.query(`
            CREATE TABLE "plans" (
                "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
                "nameEn" character varying NOT NULL,
                "nameAr" character varying NOT NULL,
                "descriptionEn" text,
                "descriptionAr" text,
                "monthlyPrice" numeric(10, 2) NOT NULL,
                "yearlyPrice" numeric(10, 2),
                "currency" character varying NOT NULL DEFAULT 'EGP',
                "maxRooms" integer,
                "maxStaffUsers" integer,
                "maxGuestRequestsPerMonth" integer,
                "enabledModules" text array NOT NULL DEFAULT '{}',
                "status" character varying NOT NULL DEFAULT 'active',
                "isTrial" boolean NOT NULL DEFAULT false,
                "trialDurationDays" integer,
                "createdById" uuid,
                "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
                "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
                CONSTRAINT "PK_3720521a81c7c24fe9b7202ba61" PRIMARY KEY ("id")
            )
        `);
        await queryRunner.query(`
            CREATE TABLE "subscriptions" (
                "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
                "hotelId" uuid NOT NULL,
                "planId" uuid NOT NULL,
                "billingCycle" character varying NOT NULL,
                "status" character varying NOT NULL,
                "startDate" TIMESTAMP WITH TIME ZONE NOT NULL,
                "endDate" TIMESTAMP WITH TIME ZONE,
                "nextRenewalAt" TIMESTAMP WITH TIME ZONE,
                "trialEndsAt" TIMESTAMP WITH TIME ZONE,
                "changedById" uuid,
                "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
                "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
                CONSTRAINT "PK_a87248d73155605cf782be9ee5e" PRIMARY KEY ("id")
            )
        `);
        await queryRunner.query(`
            CREATE TABLE "notification_outbox" (
                "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
                "type" character varying NOT NULL,
                "channel" character varying NOT NULL DEFAULT 'email',
                "recipientName" character varying NOT NULL,
                "recipientEmail" character varying NOT NULL,
                "hotelId" uuid,
                "tenantUserId" uuid,
                "language" character varying NOT NULL,
                "subject" text NOT NULL,
                "bodyHtml" text NOT NULL,
                "variables" jsonb,
                "dedupeKey" text,
                "status" character varying NOT NULL DEFAULT 'pending',
                "attemptCount" integer NOT NULL DEFAULT '0',
                "nextAttemptAt" TIMESTAMP WITH TIME ZONE,
                "lastError" text,
                "attempts" jsonb NOT NULL DEFAULT '[]',
                "sentAt" TIMESTAMP WITH TIME ZONE,
                "resendOfId" uuid,
                "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
                "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
                CONSTRAINT "PK_83d47c7dba1da2d038749fe757e" PRIMARY KEY ("id")
            )
        `);
        await queryRunner.query(`
            CREATE UNIQUE INDEX "IDX_34c39c9e7fef8c917f1ad12868" ON "notification_outbox" ("dedupeKey")
        `);
        await queryRunner.query(`
            CREATE INDEX "IDX_4d1b7ff56a7de12ab75883a03c" ON "notification_outbox" ("createdAt")
        `);
        await queryRunner.query(`
            CREATE INDEX "IDX_27389303688435831d5f6dc3d8" ON "notification_outbox" ("hotelId", "createdAt")
        `);
        await queryRunner.query(`
            CREATE INDEX "IDX_a1ae5413f0c15b23a392ea8f97" ON "notification_outbox" ("status", "nextAttemptAt")
        `);
        await queryRunner.query(`
            CREATE TABLE "audit_logs" (
                "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
                "action" character varying NOT NULL,
                "entityType" character varying NOT NULL,
                "entityId" uuid NOT NULL,
                "actorId" uuid,
                "metadata" jsonb,
                "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
                CONSTRAINT "PK_1bb179d048bbc581caa3b013439" PRIMARY KEY ("id")
            )
        `);
        await queryRunner.query(`
            ALTER TABLE "admins"
            ADD CONSTRAINT "FK_d27f7a7f01967e4a5e8ba73ebb0" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE NO ACTION ON UPDATE NO ACTION
        `);
        await queryRunner.query(`
            ALTER TABLE "hotels"
            ADD CONSTRAINT "FK_36bcf753c68b4b2a7ff10ffc1b0" FOREIGN KEY ("suspendedById") REFERENCES "admins"("id") ON DELETE NO ACTION ON UPDATE NO ACTION
        `);
        await queryRunner.query(`
            ALTER TABLE "hotels"
            ADD CONSTRAINT "FK_1702d7344a8c9353efb4d84ecb3" FOREIGN KEY ("onboardedById") REFERENCES "admins"("id") ON DELETE NO ACTION ON UPDATE NO ACTION
        `);
        await queryRunner.query(`
            ALTER TABLE "tenant_users"
            ADD CONSTRAINT "FK_c2e0f4f70f1911b035c03be1986" FOREIGN KEY ("hotelId") REFERENCES "hotels"("id") ON DELETE NO ACTION ON UPDATE NO ACTION
        `);
        await queryRunner.query(`
            ALTER TABLE "plans"
            ADD CONSTRAINT "FK_b0f1aa0ca6b4c987fd49cc29544" FOREIGN KEY ("createdById") REFERENCES "admins"("id") ON DELETE NO ACTION ON UPDATE NO ACTION
        `);
        await queryRunner.query(`
            ALTER TABLE "subscriptions"
            ADD CONSTRAINT "FK_91d72988eab42a0d3d43fec59ef" FOREIGN KEY ("hotelId") REFERENCES "hotels"("id") ON DELETE NO ACTION ON UPDATE NO ACTION
        `);
        await queryRunner.query(`
            ALTER TABLE "subscriptions"
            ADD CONSTRAINT "FK_7536cba909dd7584a4640cad7d5" FOREIGN KEY ("planId") REFERENCES "plans"("id") ON DELETE NO ACTION ON UPDATE NO ACTION
        `);
        await queryRunner.query(`
            ALTER TABLE "notification_outbox"
            ADD CONSTRAINT "FK_10c1efe35f71e50d44c47fd5547" FOREIGN KEY ("hotelId") REFERENCES "hotels"("id") ON DELETE NO ACTION ON UPDATE NO ACTION
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            ALTER TABLE "notification_outbox" DROP CONSTRAINT "FK_10c1efe35f71e50d44c47fd5547"
        `);
        await queryRunner.query(`
            ALTER TABLE "subscriptions" DROP CONSTRAINT "FK_7536cba909dd7584a4640cad7d5"
        `);
        await queryRunner.query(`
            ALTER TABLE "subscriptions" DROP CONSTRAINT "FK_91d72988eab42a0d3d43fec59ef"
        `);
        await queryRunner.query(`
            ALTER TABLE "plans" DROP CONSTRAINT "FK_b0f1aa0ca6b4c987fd49cc29544"
        `);
        await queryRunner.query(`
            ALTER TABLE "tenant_users" DROP CONSTRAINT "FK_c2e0f4f70f1911b035c03be1986"
        `);
        await queryRunner.query(`
            ALTER TABLE "hotels" DROP CONSTRAINT "FK_1702d7344a8c9353efb4d84ecb3"
        `);
        await queryRunner.query(`
            ALTER TABLE "hotels" DROP CONSTRAINT "FK_36bcf753c68b4b2a7ff10ffc1b0"
        `);
        await queryRunner.query(`
            ALTER TABLE "admins" DROP CONSTRAINT "FK_d27f7a7f01967e4a5e8ba73ebb0"
        `);
        await queryRunner.query(`
            DROP TABLE "audit_logs"
        `);
        await queryRunner.query(`
            DROP INDEX "public"."IDX_a1ae5413f0c15b23a392ea8f97"
        `);
        await queryRunner.query(`
            DROP INDEX "public"."IDX_27389303688435831d5f6dc3d8"
        `);
        await queryRunner.query(`
            DROP INDEX "public"."IDX_4d1b7ff56a7de12ab75883a03c"
        `);
        await queryRunner.query(`
            DROP INDEX "public"."IDX_34c39c9e7fef8c917f1ad12868"
        `);
        await queryRunner.query(`
            DROP TABLE "notification_outbox"
        `);
        await queryRunner.query(`
            DROP TABLE "subscriptions"
        `);
        await queryRunner.query(`
            DROP TABLE "plans"
        `);
        await queryRunner.query(`
            DROP TABLE "tenant_users"
        `);
        await queryRunner.query(`
            DROP TABLE "hotels"
        `);
        await queryRunner.query(`
            DROP TABLE "admins"
        `);
        await queryRunner.query(`
            DROP TABLE "roles"
        `);
    }

}
