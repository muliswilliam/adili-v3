# Legal corpus

The passages the help search and the declarant assistant cite (spec 11, #324). Loaded and imported by `src/help/corpus.ts`; stored and searched by the help module (#325).

| File | Instrument | In force from | Passages |
|---|---|---|---|
| `act-2025.json` | Conflict of Interest Act, 2025 (Act No. 11 of 2025) | 19 Aug 2025 | Part IV (ss. 30-40), the s. 2 definitions (one per term), the First Schedule (introduction, guidelines, notes 1-14, form paragraphs 1-9, solemn declaration) and the Second Schedule (items 1-15) |
| `regs-2026.json` | Conflict of Interest Regulations, 2026 (Legal Notice 53 of 2026) | 26 Mar 2026 | Regulations 1-34, with r. 2 one passage per defined term |

## Provenance

Text is taken from the official PDFs in [`docs/reference/legal`](../../../docs/reference/legal) (Kenya Law and Laws.Africa; no copyright on the legislative content). It was extracted with `pdftotext`, then page headers, footers and page numbers were removed, ligatures normalised (NFKC) and whitespace collapsed. Nothing else is changed: subsection markers stay inline, and errors in the published text are kept and noted in the passage's `notes` (r. 15's "if#"). Every passage that crosses a page was checked against the PDF.

The statutory text keeps the law's em dashes ("means—"). That is a deliberate exception to how-we-work.md's plain-dash rule, which covers our own code and docs, not quoted legislation.

Citations read `Act s.31`, `Act s.2 "family"`, `Act First Schedule, note 13`, `Act Second Schedule, item 15`, `Regs r.2 "gift"` and `Regs r.21`; the loader refuses any other form. Tags come from `CORPUS_TAGS` in `src/help/corpus.ts`: section kinds, statement item types (`vehicle`, `land`...) and topics; help search boosts passages tagged with the section and item a declarant is on.

## Not yet included

- **Swahili text** (`textSw`): no official Swahili version is in hand; passages are English only until one is. Machine translation is not a substitute for the law's text. Swahili questions reach the English text through the reviewed glossary in `src/help/glossary.ts`.
- **The Regulations' Schedule of Forms A-N**: blank forms with no guidance notes (disclosure, gifts, recusal, Form K access requests, Forms L and M compliance reports, Form N complaints). The form a declarant fills, with its notes, is the Act's First Schedule, which is included; Forms K and M are also the `form-k.v1` and `form-m.v1` JSON Schemas.
- **Administrative Mechanisms** (EACC, Kenya Gazette 17-18 Aug 2026, source `am`): the official text has not been received (architecture open question 8). Tracked in #426.

## Changing the corpus

The service imports the files on boot and after migrations (`db:migrate`), under a lock and once per version; a platform administrator can re-import with `POST /v1/help/corpus/import`. Edit the JSON; the files are the whole statutory corpus. A correction keeps the passage's effective date and is updated in place on the next import. An amendment adds a passage with the same citation and a later `effectiveFrom`; the import ends the earlier wording on that date. A wording removed from the files (say, an amendment entered with the wrong date) is removed on import and the wording it had ended is current again. The corpus version is a hash of the files, including titles and notes, so an unchanged corpus imports as a no-op and each passage records the version that last wrote it.
