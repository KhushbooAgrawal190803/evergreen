# Evergreen v2

A rebuild of the bag-factory system: orders → fabric → printing → cutting → packing → dispatch.

## Run it

```bash
cd v2
npm install
npm run dev          # http://localhost:5173 (loads demo data on first run)
npm run reset-demo   # wipe and reload the demo data
npm test             # scenario tests (needs `npm run dev` running; changes demo data, so reset after)
```

Requires Node 22+ (uses the built-in `node:sqlite`). No PHP, Docker, Redis or Postgres needed.

## Signing in

Demo mode (the default) creates four accounts, all with password `evergreen-demo`:
`owner@`, `manager@`, `floor@` and `dispatch@evergreen.test`. The sign-in page lists them.

For a real deployment run with `DEMO=0 NODE_ENV=production ADMIN_EMAIL=you@company.com npm start` (after `npm run build`).
No demo data or demo accounts are created; a single owner account is made with a one-time password printed to the
console, which must be changed at first sign-in. Serve it over HTTPS (the session cookie is `Secure` in production).

| Role | Can do |
|---|---|
| Owner | Everything, including users |
| Manager | Orders, stock, production, dispatch, settings; sees prices and the activity log |
| Floor operator | Mark rolls printed / cut, pack bags |
| Dispatch | Move sacks, create challans |

Everyone signed in can view; every write is permission-checked on the server (`server/auth.js`).
Security: scrypt password hashes, HttpOnly SameSite session cookie (12 h), 5-attempt lockout, same-origin check on writes,
forced change of admin-set passwords, sessions revoked on password/role change or deactivation.

## Layout

| Path | What |
|---|---|
| `server/formulas.js` | The client's production formulas (bags per roll, roll width, bag weight, cylinder) as plain functions — no `eval` |
| `server/db.js` | SQLite schema — the single source of truth for the data model |
| `server/api.js` | JSON API; derives each order's stage, the pipeline, fabric shortages |
| `server/auth.js` | Sign-in, sessions, roles & permissions, user management |
| `server/seed.js` | Invented demo data |
| `src/pages/` | Today (dashboard), Orders, Order detail, New order, Production, Stock, Dispatch, Settings |

## Notes

- Fabric "short" means free stock is below the minimum **or** below what open orders still need (computed from the formulas).
- The spec's weight-based yield formula omits the kg→g conversion; `bagsFromRoll` applies it.
- Not yet built: self-service password reset by email, two-factor sign-in, printing-colour masters, brokers/commission, garbage verification, roll split/swap/sale, PDF challans.

## Where every number comes from, and how to undo it

Nothing on screen is typed in as a free-standing total; each figure is derived from a recorded event.

| Shown as | Recorded by | Undo / correct |
|---|---|---|
| Incoming fabric | **Fabric ordered** (Stock) | Edit roll · Remove incoming |
| Fabric in stock | **Mark received** (Stock) | Mark not received · Edit roll (actual weight) |
| Rolls booked to an order | **Book / Auto-book** (Order) | Release |
| Printed | **Printed** (Production) | Undo print |
| Bags cut, waste | **Cut** (Production) | Undo cut (refused while those bags are packed) |
| Handle stock | **Delivery received** (Stock) adds · cutting loop/box bags subtracts 3.4 g/bag automatically · **Correct after count** overwrites | Undo cut returns handles |
| Sacks at factory | **Pack bags** (Order) — sacks are only ever created at the factory | Unpack (factory only) |
| Sacks in godown / sent | **Move to godown · Move back to factory · Send to client** (Dispatch), each creates a challan | Cancel challan (latest move only; reopens an auto-closed order) |
| Delivered | Automatic when every bag is sent, or **Close as delivered** with a reason | Reopen |
| Cancelled | **Cancel order** (before printing) | Reopen |
| Clients, suppliers, machines | Settings | Edit · Deactivate / reactivate (never deleted, so history stays intact) |

Every action and undo is written to the activity log with the person's name.

## Production suggestions

`server/planner.js` suggests a machine for every roll waiting to print or cut, and forecasts each order's ready date:

- **Printing**: only machines with enough colours for the job, and (if the machine's cylinder sizes are listed) the right cylinder (W+G, or L for U-cut).
- **Cutting**: only machines set up for that bag type.
- Earliest delivery date first; each roll goes to the capable machine that's free soonest, using each machine's rolls-per-day.
- Cutting is planned the working day after printing; Sundays are off.
- Orders that will finish after their due date are flagged on Today and Production. The server refuses to record a job on a machine that can't do it.

Machine capabilities (colours, cylinders, bag types, rolls/day) are in Settings → Reference data → Machines. **The demo values are invented; get the real ones from the client.**

## Delivery challans

Every move of sacks (factory → godown, godown → factory, to client) creates a numbered challan. Dispatch → **Print** opens a printable
A4 delivery challan (consignor, consignee with address/GSTIN, vehicle, goods, sacks, bags, weight, signature lines); use the browser's
**Save as PDF**. Company name, address, GSTIN and HSN code are set by the owner in Settings → Users & roles → Company details.
Cancelled challans stay on record, marked CANCELLED.
