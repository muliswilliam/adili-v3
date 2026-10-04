-- Ask Adili's conversations (spec 11) are the declarant's own, like their drafts (0012, ADR-018):
-- read and written through `app.person` (`withPerson`), across Commissions; a message follows its
-- conversation. No staff route reads them, so there is no tenant policy. The platform context
-- (the expiry sweep) may read and delete conversations, never their messages, which go with
-- them by the foreign key's cascade. A reset setting reads back as '' on a pooled connection,
-- hence nullif. FORCE applies the policies to the service's own role, which owns the tables.
ALTER TABLE "assistant_conversations" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "assistant_conversations" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "assistant_conversations_person" ON "assistant_conversations"
	USING ("person_id" = nullif(current_setting('app.person', true), '')::uuid)
	WITH CHECK ("person_id" = nullif(current_setting('app.person', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "assistant_conversations_platform_read" ON "assistant_conversations" FOR SELECT
	USING (current_setting('app.tenant', true) = 'platform');
--> statement-breakpoint
CREATE POLICY "assistant_conversations_platform_expiry" ON "assistant_conversations" FOR DELETE
	USING (current_setting('app.tenant', true) = 'platform' AND "expires_at" IS NOT NULL);
--> statement-breakpoint
ALTER TABLE "assistant_messages" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "assistant_messages" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "assistant_messages_person" ON "assistant_messages"
	USING (EXISTS (
		SELECT 1 FROM "assistant_conversations" c
		WHERE c."id" = "conversation_id" AND c."person_id" = nullif(current_setting('app.person', true), '')::uuid
	))
	WITH CHECK (EXISTS (
		SELECT 1 FROM "assistant_conversations" c
		WHERE c."id" = "conversation_id" AND c."person_id" = nullif(current_setting('app.person', true), '')::uuid
	));
