-- Tags as text for the generated search vectors: array_to_string is only stable (element output
-- functions may depend on settings), but for text[] it is not, and a generated column needs an
-- immutable expression.
CREATE FUNCTION help_tags_text(tags text[]) RETURNS text
	LANGUAGE sql IMMUTABLE PARALLEL SAFE
	RETURN array_to_string(tags, ' ');
--> statement-breakpoint
CREATE TABLE "corpus_imports" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "corpus_imports_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"version" text NOT NULL,
	"inserted" integer NOT NULL,
	"updated" integer NOT NULL,
	"removed" integer NOT NULL,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "corpus_passages" (
	"id" uuid PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"citation" text NOT NULL,
	"title" text NOT NULL,
	"text_en" text NOT NULL,
	"text_sw" text,
	"tags" text[] NOT NULL,
	"effective_from" date NOT NULL,
	"effective_to" date,
	"version" text NOT NULL,
	"search_en" "tsvector" GENERATED ALWAYS AS (setweight(to_tsvector('english'::regconfig, "corpus_passages"."title"), 'A') || setweight(to_tsvector('english'::regconfig, help_tags_text("corpus_passages"."tags")), 'B') || setweight(to_tsvector('english'::regconfig, "corpus_passages"."text_en"), 'C')) STORED,
	"search_sw" "tsvector" GENERATED ALWAYS AS (setweight(to_tsvector('simple'::regconfig, "corpus_passages"."title"), 'A') || setweight(to_tsvector('simple'::regconfig, help_tags_text("corpus_passages"."tags")), 'B') || setweight(to_tsvector('simple'::regconfig, coalesce("corpus_passages"."text_sw", '')), 'C')) STORED,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "corpus_passages_wording_key" UNIQUE("source","citation","effective_from"),
	CONSTRAINT "corpus_passages_effective_check" CHECK ("corpus_passages"."effective_to" is null or "corpus_passages"."effective_to" > "corpus_passages"."effective_from")
);
--> statement-breakpoint
CREATE TABLE "help_articles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant" text,
	"title" text NOT NULL,
	"body_en" text NOT NULL,
	"body_sw" text,
	"tags" text[] NOT NULL,
	"effective_from" date NOT NULL,
	"effective_to" date,
	"published" boolean DEFAULT false NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by" text NOT NULL,
	"search_en" "tsvector" GENERATED ALWAYS AS (setweight(to_tsvector('english'::regconfig, "help_articles"."title"), 'A') || setweight(to_tsvector('english'::regconfig, help_tags_text("help_articles"."tags")), 'B') || setweight(to_tsvector('english'::regconfig, "help_articles"."body_en"), 'C')) STORED,
	"search_sw" "tsvector" GENERATED ALWAYS AS (setweight(to_tsvector('simple'::regconfig, "help_articles"."title"), 'A') || setweight(to_tsvector('simple'::regconfig, help_tags_text("help_articles"."tags")), 'B') || setweight(to_tsvector('simple'::regconfig, coalesce("help_articles"."body_sw", '')), 'C')) STORED,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "help_articles_effective_check" CHECK ("help_articles"."effective_to" is null or "help_articles"."effective_to" > "help_articles"."effective_from")
);
--> statement-breakpoint
CREATE INDEX "corpus_passages_search_en_idx" ON "corpus_passages" USING gin ("search_en");--> statement-breakpoint
CREATE INDEX "corpus_passages_search_sw_idx" ON "corpus_passages" USING gin ("search_sw");--> statement-breakpoint
CREATE INDEX "help_articles_tenant_idx" ON "help_articles" USING btree ("tenant");--> statement-breakpoint
CREATE INDEX "help_articles_search_en_idx" ON "help_articles" USING gin ("search_en");--> statement-breakpoint
CREATE INDEX "help_articles_search_sw_idx" ON "help_articles" USING gin ("search_sw");