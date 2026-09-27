# Demo fixtures

`rosters/*.csv` (one per demo Commission: `psc`, `tsc`) are the HR mock's officers, with the IPRS and tax fields `seed_demo` needs. `seed_demo` builds IPRS persons and HR employments from these rows so onboarding lookups match the roster.

The files to upload in the console are generated from them: `python manage.py generate_rosters` (`pnpm --filter @adili/mocks roster:files`) writes `demo/rosters/<commission>-roster.csv` in the roster template's snake_case columns, with the planted bad rows listed in `demo/rosters.py`. A test fails when the committed files are out of date.

- `people-extra.csv` is IPRS + KRA only (spouse, not on a roster).
- `dependants.csv` is IPRS only (children under 18).

Phones are E.164 so the SMS inbox can show onboarding OTPs for the same numbers.

`python manage.py push_roster` (`pnpm roster:push`) posts `rosters/<DIRECTORY_COMMISSION>.csv` to the directory as an API roster batch, with the same emails and phones.
