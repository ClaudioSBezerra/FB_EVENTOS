-- FB_EVENTOS — Better Auth extras (Phase 0, Plan 04).
--
-- Adds the columns + table Better Auth's twoFactor plugin requires:
--   - user.two_factor_enabled boolean DEFAULT false
--   - two_factor (id, user_id, secret, backup_codes)
--
-- NOT tenant-scoped — 2FA is a user-level setting and follows the user
-- across all orgs. No RLS policy, no ALTER TABLE ... FORCE ROW LEVEL SECURITY.
--
-- user.consent_ip stays NULLABLE — populated server-side by the
-- recordConsentMetadata Server Action (src/lib/actions/consent.ts), NOT by
-- Better Auth's signUp payload. This matches src/auth/server.ts
-- additionalFields where consentIp is required:false.

--> statement-breakpoint
CREATE TABLE "two_factor" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"secret" text NOT NULL,
	"backup_codes" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "two_factor_enabled" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "two_factor" ADD CONSTRAINT "two_factor_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;