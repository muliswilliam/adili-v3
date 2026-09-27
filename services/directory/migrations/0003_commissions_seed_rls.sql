-- Statutory categories of public officers: one row per paragraph of Act s.32(2)-(14) and
-- Regs r.5(a)-(f). Descriptions follow the issuer table in docs/glossary.md.
INSERT INTO "officer_categories" ("code", "citation", "description", "sort_order") VALUES
	('act-s32-2', 'Act s.32(2)', 'Cabinet, Members of the National Assembly, the Director of Public Prosecutions, the Secretary to the Cabinet, members of the Judicial Service Commission, commissioners and holders of independent offices, and EACC members and staff of Deputy Director rank and above', 1),
	('act-s32-3', 'Act s.32(3)', 'Senators', 2),
	('act-s32-4', 'Act s.32(4)', 'County executive committee members, members of the county assembly, and members and secretary of the County Public Service Board', 3),
	('act-s32-5', 'Act s.32(5)', 'Principal Secretaries, ambassadors and diplomatic representatives, public officers under the Public Service Commission, and officers of state corporations', 4),
	('act-s32-6', 'Act s.32(6)', 'Officers under a County Public Service Board, and officers of county corporations', 5),
	('act-s32-7', 'Act s.32(7)', 'Judges, magistrates and judiciary staff', 6),
	('act-s32-8', 'Act s.32(8)', 'Parliament staff', 7),
	('act-s32-9', 'Act s.32(9)', 'County assembly staff', 8),
	('act-s32-10', 'Act s.32(10)', 'Registered teachers', 9),
	('act-s32-11', 'Act s.32(11)', 'Members of the Kenya Defence Forces', 10),
	('act-s32-12', 'Act s.32(12)', 'Members of the National Intelligence Service', 11),
	('act-s32-13', 'Act s.32(13)', 'Members of the National Police Service', 12),
	('act-s32-14', 'Act s.32(14)', 'Members of the Witness Protection Agency', 13),
	('regs-r5-a', 'Regs r.5(a)', 'EACC staff below the rank of Deputy Director', 14),
	('regs-r5-b', 'Regs r.5(b)', 'Staff and council members of public universities', 15),
	('regs-r5-c', 'Regs r.5(c)', 'Staff of the Central Bank of Kenya and of state-owned banks', 16),
	('regs-r5-d', 'Regs r.5(d)', 'Employees of the constitutional commissions (Constitution Art. 248(2))', 17),
	('regs-r5-e', 'Regs r.5(e)', 'Staff of the Office of the Director of Public Prosecutions, the Controller of Budget and the Auditor-General', 18),
	('regs-r5-f', 'Regs r.5(f)', 'Public officers for whom no other Commission is responsible', 19);
--> statement-breakpoint
-- Reporting officer assignments are tenant data (ADR-006). FORCE applies the policy to the
-- owning role the service connects as. `platform` is the context of platform-wide principals.
ALTER TABLE "reporting_officer_assignments" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "reporting_officer_assignments" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "reporting_officer_assignments_tenant_isolation" ON "reporting_officer_assignments"
	USING ("tenant" = current_setting('app.tenant', true) OR current_setting('app.tenant', true) = 'platform')
	WITH CHECK ("tenant" = current_setting('app.tenant', true) OR current_setting('app.tenant', true) = 'platform');
