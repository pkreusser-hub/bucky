# portfolio.html — REI portfolio model

Standalone financial model for Laws Family REI LLC. One self-contained file, no external
requests, works over http and straight from disk (`file://`) — it gets emailed around, so
keep it that way. Suite: `node tools/_verify-portfolio.cjs` (add `--shots` for plates).

Entries oldest → newest; when two disagree, the lower one wins.

- **Source of truth is the quarterly "Valuation and Mgmt Fee" workbooks**, consolidated.
  The 4/13/25 workbook itemizes per-tranche rows (nine Bow River RE III rows, five SGE II,
  two Berkeley); they are summed here under the consolidated names the later workbooks use.
  Every embedded snapshot total must tie to its workbook's own Total cell — the suite
  asserts all four to the cent.
- **The management fee rate cell (0.005) is ANNUAL, billed quarterly.** Every workbook's
  fee cell equals `total × 0.005 / 4` (e.g. 17,032,658 → $21,290.8225). First read of the
  sheet assumed 0.5% per quarter; the fee cells refute it. Don't reintroduce that.
- **The "as of 7.10.26" workbook's header cell still reads 4.11.26.** It contains the
  6/12/26 HVG buy, so the header is stale and the filename is right. The snapshot is dated
  2026-07-10.
- **External capital must be recorded in `DATA.flows`**, not just in the values (BSSS +$50k
  4/1/26, HVG +$100k 6/12/26). Every growth number on the page is flow-adjusted; a missed
  flow silently inflates implied returns.
- **Cash and Schwab get no implied-growth rate.** Their moves include deposits/withdrawals
  the workbooks don't record; a computed "84%/yr" for Schwab would be a lie. The table
  shows n/a and the note says why.
- **Quarterly update path**: regenerate the file from the new workbook in a Claude session
  (canonical), or use the in-page "Add a quarterly snapshot" form — that stores to
  localStorage on that device only, and Export merges builtin + added snapshots so a
  regeneration can pick them up.
- **The hero AUM figure needs two grid tracks on desktop** or it clips ("$17,032,65" on
  the first plate). The suite measures the rendered ink with a Range against the tile box,
  both viewports — the element's own box said everything was fine while the text clipped.
