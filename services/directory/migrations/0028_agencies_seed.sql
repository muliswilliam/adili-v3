-- Law-enforcement agencies EACC issues officer accounts to (spec 10). Reference data: a new
-- agency is a migration. The legal basis cites the statute that gives the agency its mandate.
INSERT INTO "agencies" ("code", "name", "legal_basis", "sort_order") VALUES
	('DCI', 'Directorate of Criminal Investigations', 'National Police Service Act, 2011, s.35', 1),
	('ODPP', 'Office of the Director of Public Prosecutions', 'Constitution of Kenya, Art. 157; Office of the Director of Public Prosecutions Act, 2013', 2),
	('ARA', 'Asset Recovery Agency', 'Proceeds of Crime and Anti-Money Laundering Act, 2009, s.53', 3),
	('FRC', 'Financial Reporting Centre', 'Proceeds of Crime and Anti-Money Laundering Act, 2009, s.21', 4);
