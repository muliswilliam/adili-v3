# Legal corpus

The passages the help search and the declarant assistant cite (spec 11, #324). Loaded and imported by `src/help/corpus.ts`; stored and searched by the help module (#325).

| File | Instrument | In force from | Passages |
|---|---|---|---|
| `act-2025.json` | Conflict of Interest Act, 2025 (Act No. 11 of 2025) | 19 Aug 2025 | Part IV (ss. 30-40), the s. 2 definitions (one per term), the First Schedule (introduction, guidelines, notes 1-14, form paragraphs 1-9, solemn declaration) and the Second Schedule (items 1-15) |
| `regs-2026.json` | Conflict of Interest Regulations, 2026 (Legal Notice 53 of 2026) | 26 Mar 2026 | Regulations 1-34 |

## Provenance

Text is taken from the official PDFs in [`docs/reference/legal`](../../../docs/reference/legal) (Kenya Law and Laws.Africa; no copyright on the legislative content). It was extracted with `pdftotext`, then page headers, footers and page numbers were removed, ligatures normalised (NFKC) and whitespace collapsed. Nothing else is changed: subsection markers stay inline, and errors in the published text are kept and noted in the passage's `notes` (r. 15's "if#"). Every passage that crosses a page was checked against the PDF.

Citations read `Act s.31`, `Act s.2 "family"`, `Act First Schedule, note 13`, `Act Second Schedule, item 15` and `Regs r.21`. Tags come from `CORPUS_TAGS` in `src/help/corpus.ts`.

## Not yet included

- **Swahili text** (`textSw`): no official Swahili version is in hand; passages are English only until one is. Machine translation is not a substitute for the law's text.
- **Administrative Mechanisms** (EACC, Kenya Gazette 17-18 Aug 2026, source `am`): the official text has not been received (architecture open question 8).

## Changing the corpus

Edit the JSON. A correction keeps the passage's effective date and is updated in place on the next import. An amendment adds a passage with the same citation and a later `effectiveFrom`; the import ends the earlier wording on that date. The corpus version is a hash of the files, so an unchanged corpus imports as a no-op.
