# RailWork — Railway Workforce Management System

Full-stack task monitoring app for railway work assignments.

- **Frontend**: Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS v4
- **Backend**: Node.js + Express 5 + TypeScript + Prisma ORM (`server/`)
- **Database**: PostgreSQL 16 (Docker container, host port `5433`)
- **Auth**: JWT (Bearer token stored in `localStorage`)

## Architecture

```
Browser ──> Next.js (localhost:3000) ──rewrite /api──> Express (localhost:4000) ──> PostgreSQL 16 (Docker)
```

The Next.js frontend proxies every `/api/*` request to the Express backend via
`next.config.ts`, so the UI only ever talks to relative `/api` paths.

## Prerequisites

- Node.js 18+ (tested on 22)
- Docker Desktop (for the PostgreSQL container)

## Getting Started

### 1. Start PostgreSQL

```bash
docker compose up -d
```

Creates the `railwork-db` container (PostgreSQL 16) on host port `5433` with:

- Database: `railwork`
- User / password: `railwork` / `railwork`

> The host port is `5433` (not `5432`) so it won't clash with any local
> PostgreSQL install. Change it in `docker-compose.yml` if needed.

### 2. Backend (`server/`)

```bash
cd server
npm install
cp .env.example .env      # set DATABASE_URL / JWT_SECRET if needed
npx prisma migrate dev    # apply schema
npx prisma db seed        # seed admin, officers and sample tasks
npm run dev               # API on http://localhost:4000
```

### 3. Frontend (root)

```bash
npm install
npm run dev               # app on http://localhost:3000
```

Open http://localhost:3000 and sign in.

## Demo credentials (seeded)

| Role    | Email              | Password    |
| ------- | ------------------ | ----------- |
| Admin   | `admin@railwork.com` | `admin123` |
| Officer | `rahul@railwork.com` | `password123` |
| Officer | `neha@railwork.com`  | `password123` |
| Officer | `arjun@railwork.com` | `password123` |

## API overview

| Method | Endpoint                          | Description                                |
| ------ | --------------------------------- | ------------------------------------------ |
| POST   | `/api/auth/login`                 | Email + password → JWT token               |
| GET    | `/api/auth/me`                    | Current user (auth)                        |
| GET/POST | `/api/users`                    | List / create users (admin)                |
| GET/PUT/DELETE | `/api/users/:id`        | Get / update / delete user (admin)         |
| GET    | `/api/tasks`                      | List tasks (search, status, officer, paging) |
| POST   | `/api/tasks`                      | Create a task                              |
| GET/PUT | `/api/tasks/:id`                | Get / update a task                        |
| PATCH  | `/api/tasks/:id/status`           | Change task status                         |
| DELETE | `/api/tasks/:id`                  | Soft delete (moves to recycle bin)         |
| GET    | `/api/tasks/recycle-bin`          | List deleted tasks                         |
| POST   | `/api/tasks/:id/restore`          | Restore a deleted task                     |
| DELETE | `/api/tasks/:id/hard`             | Permanently delete a task                  |
| GET    | `/api/dashboard/stats`            | Total / pending / overdue / completed + recent + due today |
| GET    | `/api/dashboard/task-status`      | Pie chart counts                           |
| GET    | `/api/dashboard/weekly`           | Weekly created-task counts                 |

**Overdue** is derived, not stored: a task is *Overdue* when its status is
`Pending` and `dueDate` is before today.

## Useful scripts

Frontend (root):

```bash
npm run dev     # dev server
npm run build   # production build
npm run lint    # eslint
```

Backend (`server/`):

```bash
npm run dev          # tsx watch
npm run build        # tsc
npm run typecheck    # tsc --noEmit
npm test             # scheduling unit tests + API integration tests (throwaway Postgres)
npm run test:unit    # scheduling rules only
npm run db:migrate   # prisma migrate dev
npm run db:seed      # prisma db seed
npm run db:studio    # prisma studio
```

## Monday meeting scheduling

The **Monday Meeting** page (`/meetings`, admin only) has three cycle cards (Weekly, Fortnightly,
Monthly) and a Monday Agenda card. Each cycle card opens a register of **every** task in that
cycle, in any status, with search, a status filter, sorting, a per-row cycle selector and a
**Download PDF** button. Task status (Pending / Overdue / Completed) is shown, never used for scheduling.

Rules live in `server/src/services/scheduling/rules.ts` (pure functions, unit-tested).

| Cycle       | First discussion (never discussed) | After a discussion on day *D* |
| ----------- | ---------------------------------- | ----------------------------- |
| WEEKLY      | The upcoming Monday | The Monday after *D* |
| FORTNIGHTLY | The upcoming Monday | *D* + 14 days (the Monday on or after) |
| MONTHLY     | Chosen Monday of next month (first by default) | Chosen Monday of the month after *D* |

- A task is on a Monday's agenda only if its next discussion date is on or before that Monday,
  so a task appears at most once per meeting (also enforced by a unique `meetingId + taskId` key).
- Only ticking **Discussed** moves a task's schedule; it can be unticked to restore the previous date.
- **Reschedule** moves one task's next discussion to another Monday without changing its cycle.
- Changing a cycle recalculates only the future date; past discussions are kept.
- Tasks without a cycle are never on an agenda and are listed under "Assign cycles".
- `MEETING_TIME_ZONE` (default `Asia/Kolkata`) decides what "today" is.

### API (admin only)

| Method | Endpoint | Description |
| ------ | -------- | ----------- |
| GET    | `/api/meetings/register` | All tasks with cycle, status, dates, latest remarks; counts per cycle |
| GET    | `/api/meetings/register/pdf?cycle=WEEKLY&status=all` | Cycle register PDF (`status`: all, pending, overdue, completed) |
| GET    | `/api/meetings/agenda?date=YYYY-MM-DD` | Tasks due on a Monday |
| POST   | `/api/meetings/:date/items/:taskId/outcome` | `{ outcome: "DISCUSSED" | "PENDING" }` |
| GET    | `/api/meetings/:date/export?format=pdf|xlsx|csv` | Agenda download |
| PATCH  | `/api/schedule/tasks/:id/cycle` | `{ cycle, monthlyMondayOrdinal? }` |
| POST   | `/api/schedule/cycle` | Same, for many tasks: `{ taskIds, cycle }` |
| POST   | `/api/schedule/tasks/:id/reschedule` | `{ toDate, reason? }` |
| GET    | `/api/schedule/tasks/:id/history` | Scheduling history |

The production database was created without Prisma migration history, so the scheduling
migrations in `server/prisma/migrations` were applied with `prisma db execute`. Do not run
`prisma migrate dev` against it; it would offer to reset the database.
