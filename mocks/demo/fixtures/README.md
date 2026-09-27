# Demo fixtures

`rosters/*.csv` are the demo Commission roster files (spec 02 / #44 template columns, plus IPRS and tax fields the importer can ignore). `seed_demo` builds IPRS persons and HR employments from these rows so onboarding lookups match the roster.

- `people-extra.csv` is IPRS + KRA only (spouse, not on a roster).
- `dependants.csv` is IPRS only (children under 18).

Phones are E.164 so the SMS inbox can show onboarding OTPs for the same numbers.

`python manage.py push_roster` (`pnpm roster:push`) posts `rosters/<DIRECTORY_COMMISSION>.csv` to the directory as an API roster batch, with the same emails and phones.
