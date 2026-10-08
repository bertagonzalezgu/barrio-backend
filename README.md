# barrio. — backend

> 🚧 **Provisional documentation.** This project is under active development (IT Academy Barcelona Activa bootcamp). This README will be filled in as the weeks in `ROADMAP.md` progress.

## What barrio. is

A neighborhood time bank: people exchange help (classes, repairs, moving, pet and plant care) paying in **hours**, not money. Final bootcamp project, merging Project 4 (dashboards and data visualization) and the Final Project.

This repository is the **own API** that gives the app real persistence. The frontend lives in a separate repository: [`barrio-frontend`](#) *(add the link here once it's public)*.

## Stack

- Node.js + Express
- **PostgreSQL (Neon) via Prisma** — adjustment after the bootcamp mentor's feedback: the domain (exchange proposals with a state cycle, an hour balance derived from a history) has clear relations between tables and needs transactions that touch several rows at once, which is exactly where a relational database is the stronger fit
- Firebase Admin SDK (verifying authentication tokens)
- Anthropic API (Claude) — AI-generated tickets and double content moderation
- Stripe Identity (test mode) — identity verification
- Vitest (testing, with acceptance criteria in Gherkin)

## Data model

Defined in `prisma/schema.prisma`. Main entities:

- **User** — user profile (the hour balance isn't a direct field, it's derived from `TimeTransaction`)
- **Ticket** — a need or an offer of help (looking for/offering)
- **Exchange** — an exchange proposal, with its own state cycle: `proposed → pending → accepted → completed → confirmed → rated` (or `cancelled`/`rejected`). Hours are **reserved** on acceptance and only **actually transferred** once both parties confirm.
- **TimeTransaction** — history of hour movements (`reservation` / `transfer` / `release`), from which each user's available and reserved balance is calculated
- **Report** — reports on tickets or users
- **Message** — internal chat messages for each exchange

See `docs/BRIEFING.md` section 7 for the full detail of fields and relations.

## Project structure

```
prisma/
  schema.prisma  ← definition of all models and their relations
  migrations/    ← auto-generated, not edited by hand
src/
  routes/
  controllers/
  middleware/    ← auth, validation, error handling
  services/      ← logic for calling Claude (generation + moderation), data access via Prisma Client
docs/
  BRIEFING.md
  ROADMAP.md
  KANBAN.md
```

## Running it locally

1. Clone the repository and install dependencies:
   ```bash
   npm install
   ```
2. Create a `.env` file at the root with:
   ```
   DATABASE_URL=postgresql://user:password@host/database?sslmode=require
   PORT=3000
   ANTHROPIC_API_KEY=...
   FIREBASE_PROJECT_ID=...
   STRIPE_SECRET_KEY=...
   ```
   *(ask me for the keys if you need them — they're not committed, for security)*
3. Generate the Prisma client and apply migrations:
   ```bash
   npx prisma generate
   npx prisma migrate dev
   ```
4. Start the server:
   ```bash
   npm run dev
   ```
5. To inspect the data with a visual interface:
   ```bash
   npx prisma studio
   ```

## Tests

```bash
npm run test
```
Tests cover the acceptance criteria written in Gherkin (`docs/gherkin/*.feature`, the backend ones).

## Project status

In development — follow week-by-week progress in `docs/ROADMAP.md`.

## Deployment

*(pending — will be deployed to Render/Railway in Week 4 of the roadmap)*

---

Individual project by Berta González — IT Academy Barcelona Activa.