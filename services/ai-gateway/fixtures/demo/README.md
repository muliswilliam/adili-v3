# Demo AI fixtures

Recorded Anthropic answers for the scripted AI beats of the demo (docs/demo/README.md), so the demo runs with no provider: `pnpm demo:ai replay`.

- Recorded with `pnpm demo:ai record`, which calls Anthropic and writes one `<sha256>.json` per request here. Run each scripted beat once from its checkpoint, review the diff like code and commit it.
- The ai-gateway matches them with `AI_REPLAY_MATCH=normalised`: ids and timestamps a fresh run mints anew (a new flag's UUID, a submission time) do not change the key, and the current run's values are put back into the recorded answer. Anything else that differs (another file, another question, another prompt version) needs a new recording.
- Synthetic data only: a fixture holds the whole request, prompts and minimised input included.
- Fixtures recorded on the hosted VM stay there across deploys (the rsync protects `*.json` here); copy them back to commit them.
