# POS System (ระบบขายหน้าร้าน)

Thai-language, offline-first POS web app (PWA). All UI text is Thai. MVP scope: single branch. Future phases: Electron wrap, multi-branch sync, ERP.

## Commands
- `npm run dev` — dev server on port 5173 (or use `.claude/launch.json` → `pos-dev`)
- `npm run build` — typecheck (`tsc -b`) + production build
- `node scripts/gen-icons.mjs` — regenerate PWA PNGs from `public/icon.svg`

## Stack
Vite + React 19 + TypeScript strict (`verbatimModuleSyntax` — always `import type`) + Tailwind v4 (emerald primary, cards `bg-white rounded-2xl`) + Dexie (IndexedDB `pos-db`) + Zustand + Recharts. Font: Noto Sans Thai (bundled).

## Architecture
- **All data lives in IndexedDB** via `src/db/db.ts` (tables: products, categories, members, promotions, sales, stockMoves, heldBills, settings, expenses — v2 added `expenses` for the accounting module; bump schema with additive `this.version(n)` calls). `settings` is a single row `id=1`; read it with `useSettings()` from `src/db/hooks.ts`. Reactive reads via `useLiveQuery` (dexie-react-hooks).
- **Money/promo engine** in `src/lib/`: `promotions.ts` (auto-promo engine; bill-level promos pick the single best), `totals.ts` (`computeTotals` — discount order: line manual → line promo → bill promo → bill manual → points), `checkout.ts` (`finalizeSale`/`voidSale` — Dexie transactions that also move stock & member points).
- **Receipts** print via `#print-area` div in `index.html` (`src/lib/receipt.ts` builds HTML string, `@media print` CSS in `src/index.css` hides `#root`). Widths 58/80mm from settings.
- **Cart** is Zustand (`src/stores/cartStore.ts`), keyed by product+options+note+price for line merging. `productId 0` = ad-hoc custom item (skips stock/promos).
- Shared UI kit: `src/components/ui.tsx` (Button, Modal, Icon, toast, …) — use it, don't hand-roll.
- Business mode `retail` | `cafe` (settings) tweaks POS grid density; product options work in both.

## Conventions
- Round money with `r2()` at aggregation points; format with `baht()`/`money()` from `src/lib/format.ts`. Dates via Intl `th-TH` (Buddhist era is expected).
- Seed/sample data in `src/db/seed.ts` (fixed ids 1–15; `initDb()` runs on app start, idempotent).
