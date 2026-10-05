-- A law enforcement request is not the declarant's to see (product decision, 2026-10-05; #614):
-- not notified, not in "Who accessed my declaration", not among their notices. The person context
-- no longer reads any law enforcement request, granted or not, so its register entries are hidden
-- from the declarant by the database too (access_register_subject_read checks the request is
-- readable). Access officers, the requesting officer and the audit trail are unchanged.
DROP POLICY "lea_requests_person_read" ON "lea_requests";
