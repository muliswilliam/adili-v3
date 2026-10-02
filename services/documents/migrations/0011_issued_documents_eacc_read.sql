-- EACC (`app.tenant` `eacc`, spec 09) reads the referral packages every Commission issues, to
-- download them from its referrals intake; no other Commission document. The service also checks
-- the EACC role (pulled-payloads.ts `eaccReaders`). Its verification records follow through
-- `verification_records_person_read`, whose subquery is itself under these policies.
CREATE POLICY "issued_documents_eacc_read" ON "issued_documents" FOR SELECT
	USING ("type" = 'referral-package' AND current_setting('app.tenant', true) = 'eacc');
