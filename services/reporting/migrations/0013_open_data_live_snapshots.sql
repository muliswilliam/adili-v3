-- A mid-year snapshot of a year with no national consolidated report yet is built from the live
-- projections, so it has no NCR to point at; an annual release always has one.
ALTER TABLE "open_data_releases" ALTER COLUMN "national_report_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "open_data_releases" ADD CONSTRAINT "open_data_releases_annual_ncr" CHECK ("open_data_releases"."kind" <> 'annual' or "open_data_releases"."national_report_id" is not null);
