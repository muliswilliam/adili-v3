-- IPRS (#612): a declarant may check their own date and place of birth.
ALTER TABLE "suggestion_sets" DROP CONSTRAINT "suggestion_sets_source_check";--> statement-breakpoint
ALTER TABLE "suggestion_sets" ADD CONSTRAINT "suggestion_sets_source_check" CHECK ("suggestion_sets"."source" in ('kra', 'ntsa', 'brs', 'ardhisasa', 'iprs', 'document'));