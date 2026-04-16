# EnhancedDrugFlashcardsApp Handoff

Last updated: 2026-04-16
Local path: `C:\Users\Owner\EnhancedDrugFlashcardsApp`
Related deployed repo: `https://github.com/jmccormick14/IVIGapp.git`

## Current State

This project is the drug-specific version of the rebuilt app.

It is a modern offline-first PWA built with `Vite + React + TypeScript` and supports:
- Study Mode for flashcards
- Work Mode for quick reference lookup
- legacy Google Sheet import
- automatic/local refresh of the original drug sheet
- parsing `type` so regular cards and summary/reference content are handled differently
- manual editing of flashcards
- manual editing of Work Mode details
- adding new drug entries from inside the UI
- automatic generation of matching study questions from Work Mode sections
- JSON backup/restore
- CSV export
- local IndexedDB persistence

## Important Product Rules

- This app is supposed to stay drug-focused.
- `type` in the legacy sheet determines whether content is a normal flashcard row or summary/reference content.
- Summary/reference content should feed Work Mode, not pollute the normal flashcard flow.
- Work Mode should stay optimized for fast lookup before/during work.

## Recent Fixes and Changes

- Added immediate UI refresh after `Refresh Original Drug Sheet` so users do not have to reload the page manually.
- Fixed legacy TSV parsing so stray quotes do not corrupt `Summary` rows.
- Added parsing of bolded legacy summary fields like `<strong>Pre Meds:</strong>` into structured Work Mode sections.
- Improved Work Mode search and selector behavior.
- Added local editing and backup/restore flow.
- Generalized naming was explored and then split off into `Flashy`; this app should remain drug-specific.

## Deployment / Repo Notes

The active drug-specific deployment path is the separate repo:
- `https://github.com/jmccormick14/IVIGapp.git`

If resuming deployment/debugging:
1. verify whether changes in this local folder have already been mirrored to `IVIGapp`
2. check the `IVIGapp` Actions/Pages workflow status
3. test first-load legacy import and Work Mode lookup on mobile

## Important Files

- [src/App.tsx](C:/Users/Owner/EnhancedDrugFlashcardsApp/src/App.tsx:1)
- [src/lib/importer.ts](C:/Users/Owner/EnhancedDrugFlashcardsApp/src/lib/importer.ts:1)
- [src/lib/storage.ts](C:/Users/Owner/EnhancedDrugFlashcardsApp/src/lib/storage.ts:1)
- [src/types.ts](C:/Users/Owner/EnhancedDrugFlashcardsApp/src/types.ts:1)
- [src/styles.css](C:/Users/Owner/EnhancedDrugFlashcardsApp/src/styles.css:1)
- [vite.config.ts](C:/Users/Owner/EnhancedDrugFlashcardsApp/vite.config.ts:1)

## Good Next Steps

- Confirm the live drug sheet import still matches the current source sheet format.
- Audit Study Mode to ensure summary/reference rows are not surfacing as normal cards.
- Tighten Work Mode layout around the highest-value nursing/clinical fields.
- Add export/import guidance for users editing data outside the app.
- Consider optional cloud sync later only if truly needed; current design is local-first.

## Resume Notes

If we pick this up later, start by:
1. validating a few real drugs end-to-end from legacy import -> Study Mode -> Work Mode
2. checking whether any recent sheet changes require importer tweaks
3. deciding whether the next priority is Work Mode polish, source sync reliability, or deployment cleanup
