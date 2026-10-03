-- EACC (`app.tenant` `eacc`, spec 09) reads every Commission's submitted Form M and its
-- acknowledgement of receipt (S9, its intake's report viewer) and the referral packages every
-- Commission sends it (S12, its referrals intake); no other Commission document. The service also
-- checks the EACC role (readers.ts). Its verification records follow through
-- `verification_records_person_read`, whose subquery is itself under these policies.
CREATE POLICY "issued_documents_eacc_read" ON "issued_documents" FOR SELECT
	USING ("type" IN ('form-m', 'compliance-report-receipt', 'referral-package') AND current_setting('app.tenant', true) = 'eacc');