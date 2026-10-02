CREATE TABLE "feedback" (
	"id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"reviewer_subject" text NOT NULL,
	"rating" text NOT NULL,
	"reason" text,
	"note" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "feedback_job_id_reviewer_subject_pk" PRIMARY KEY("job_id","reviewer_subject"),
	CONSTRAINT "feedback_id_unique" UNIQUE("id"),
	CONSTRAINT "feedback_rating_check" CHECK ("feedback"."rating" in ('helpful', 'not-helpful')),
	CONSTRAINT "feedback_reason_check" CHECK ("feedback"."reason" is null or "feedback"."reason" in ('inaccurate', 'missed-something', 'unclear', 'too-long', 'other')),
	CONSTRAINT "feedback_note_length" CHECK (char_length("feedback"."note") <= 1000)
);
--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE no action ON UPDATE no action;