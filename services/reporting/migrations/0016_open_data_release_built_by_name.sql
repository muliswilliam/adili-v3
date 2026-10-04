-- Who built a release by name too, as their token gave it (spec 09b S6: the EACC preview shows
-- who built it). Releases built before have none: their subject stands in.
ALTER TABLE "open_data_releases" ADD COLUMN "built_by_name" text;
