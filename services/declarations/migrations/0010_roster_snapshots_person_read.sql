-- A declarant reads their own roster snapshots across Commissions (`withPerson`), never writes
-- (ADR-018), as with their obligations (migration 0002). A reset setting reads back as '' on a
-- pooled connection, hence nullif.
CREATE POLICY "roster_snapshots_person_read" ON "roster_snapshots" FOR SELECT
	USING ("person_id" = nullif(current_setting('app.person', true), '')::uuid);
