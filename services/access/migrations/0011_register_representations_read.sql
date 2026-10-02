-- The declarant's representations are not the applicant's to read (Act s.36(3)): the database
-- keeps their register entry from the applicant too, not only the service's timeline filter
-- (ADR-006, ADR-018 decision 6). On a Form K request the person context reads an entry of kind
-- `representations` only as the declarant the request is about; every other entry as before.
DROP POLICY "access_register_subject_read" ON "access_register";
--> statement-breakpoint
CREATE POLICY "access_register_subject_read" ON "access_register" FOR SELECT
	USING (
		("subject_kind" = 'access-request' AND EXISTS (
			SELECT 1 FROM "access_requests" r
			WHERE r."id" = "subject_id"
				AND (
					"kind" <> 'representations'
					OR r."resolved_person_id" = nullif(current_setting('app.person', true), '')::uuid
				)
		))
		OR ("subject_kind" = 'lea-request' AND EXISTS (SELECT 1 FROM "lea_requests" l WHERE l."id" = "subject_id"))
		OR ("subject_kind" = 'self-access' AND "person_id" = nullif(current_setting('app.person', true), '')::uuid)
	);
