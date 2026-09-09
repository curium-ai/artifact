# Comment navigation through tabs

Validated September 9, 2026 using the in-app browser and a local copy of the reported multi-tab HTML. Production was inspected read-only; no comments, artifacts, or database records were changed. The private report and screenshots remain outside the repository.

## Manual regression checks

- Reproduced the exact failure with the previous bridge: select a whole insight card in the second tab, save its old-format anchor locally, switch to the first tab, then locate the comment. Result: “Needs reattachment”.
- Loaded the fixed bridge with that same saved anchor: locating automatically activated the second tab and found the original card, with no reattachment.
- Selected a heading in the second tab's nested Final Draft view, switched back to See Changes and then the first outer tab. Locating restored both the second outer tab and Final Draft, then scrolled to the heading.
- Switched outer and nested tabs with comment mode enabled, saved the local QA comment, and navigated back to it. Comment mode remained enabled.

The local harness used the actual injected bridge in a sandboxed iframe and persisted anchors in browser-local storage. This verifies document navigation; it does not repeat server-side comment persistence tests.

## Automated checks

18 frontend tests pass; production TypeScript/Vite build passes. New regression tests cover hidden legacy text, nested tab navigation, ARIA controls, navigation during comment mode, ambiguous controls, changed content after reveal, and duplicated IDs across views. Existing bridge and FileViewer tests also pass.

## Supported markup and limits

Navigation uses a uniquely associated local control: `aria-controls`, tab-panel `aria-labelledby`, fragment `href`, `data-artifact-target`, `data-target`, `data-bs-target`, `data-tab`, generated `data-select`/panel-ID suffixes, or scoped `data-mode`/`data-view` pairs. Containing native details elements are opened. Existing HTML is not rewritten, and author click handlers maintain active tab state.

Custom controls without an identifiable relationship need a `data-artifact-target="#panel-id"` attribute or standard ARIA association. Hidden unsupported content gets an instruction to open its tab, rather than an incorrect reattachment error. Content unmounted from the DOM cannot currently be discovered. Hidden legacy anchors in the same immutable revision are provisional until revealed and text-verified; changed or ambiguous visible targets remain rejected. No database migration is required.
