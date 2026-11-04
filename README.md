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

Statuses: **Pending**, **Running**, **Completed**, and **Overdue**. Overdue is derived, not stored:
a task is *Overdue* when its status is `Pending` and `dueDate` is before today. A **Running**
task (work in progress) is never shown as Overdue, whatever its execution date.

## Access for Branch Officers

| Access | Who | What |
| ------ | --- | ---- |
| View | Every BO | All departments, designations, tasks, and other BOs' updates (no department isolation) |
| Edit | BOs assigned to the task | Submit updates (Action Plan, Action Plan Date, BO Remark, attachments), edit their own, change the task's status |
| Administrative | DRM only | Task details, DRM remarks, review frequency, Allocated Monday, deleting tasks or BO entries |

BO logins are created by the DRM on the **Logins** page (`/logins`), one per designation, grouped by
department; public registration is closed. A login is set on the account that already holds the
designation's tasks. Duplicate accounts for the same designation are merged into it at that point.
BOs change their password under Settings.

The server enforces these rules. A task's department comes from its concerned officers'
designations (`lib/departments.ts`); BOs get a **Departments** page and a department filter on Tasks.

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

The **Monday Meeting** page (`/meetings`, admin only) has cards for **W** (Weekly), **FT**
(Fortnightly) and **M** (Monthly) tasks and a Monday Agenda card. Each card opens a register of
**every** task with that review frequency, in any status, with search, a status filter, sorting,
and per-row Review Frequency and Allocated Monday selectors. The Tasks page shows the same
review code, allocated Monday and next date next to each task.

The schedule is a fixed calendar (`server/src/services/scheduling/rules.ts`, unit-tested), shared
by the website and every PDF:

| Code | Frequency   | Due on |
| ---- | ----------- | ------ |
| W    | Weekly      | Every Monday |
| F1   | Fortnightly | The 1st and 3rd Monday of every month |
| F2   | Fortnightly | The 2nd and 4th Monday of every month |
| M    | Monthly     | Its allocated Monday of every month, 1st–5th (`monthlyMondayOrdinal`); a 5th Monday falls back to the last Monday in four-Monday months |

F1 / F2 Mondays are allocated automatically (no Monday to pick). A month's 5th Monday has no F1 / F2
tasks. The group is stored in `monthlyMondayOrdinal` (1 = F1, 2 = F2); older fortnightly tasks
without one take F1 or F2 from their start Monday (`fortnightAnchor`), so no data migration was needed.

One-time frequencies: the task is discussed once, on its **Allocated Monday**
(`Task.allocatedMonday`). This is a meeting date, not the Execution Date (TDC).

| Frequency     | Allocated Monday |
| ------------- | ---------------- |
| Next Monday   | The coming Monday |
| Next Month    | A Monday of next month, picked by the DRM |
| Flexible Date | Any Monday from the coming one on |

The DRM can change the Allocated Monday (Reschedule / "Change Monday"). **Mark important** highlights
a task and puts it on the coming Monday's agenda (a task without a frequency becomes Next Monday).

- Selecting a Monday shows exactly the tasks due that day; nothing carries over and nothing is
  allocated by hand. Ticking **Discussed** only records it.
- Each task appears at most once per Monday (agenda built per task; `meetingId + taskId` is unique).
  Viewing the agenda or generating PDFs stores nothing.
- **Reschedule** moves one review date to another Monday; the frequency and other dates stay.
- Changing the frequency or allocated Monday updates future dates at once; past meetings are kept.
- Tasks without a review frequency are never on an agenda.
- New tasks are W (weekly) by default and are first on the Monday they are created on, or the next one.
- **Finalize agenda** freezes a Monday's list; tasks created afterwards go to the following Monday.
  **Reopen** makes it follow the calendar again. Viewing and PDF downloads never change anything.
- Word limits: Action Plan and BO Remarks 300 words each, DRM Remarks 150 words (live counter in
  the forms, checked by the server; text is never shortened). Older longer text only needs
  shortening when it is edited. In PDFs, long text wraps inside its column, rows grow to fit, and
  a long row continues on the next page ("contd.") under a repeated header.
- `MEETING_TIME_ZONE` (default `Asia/Kolkata`) decides what "today" is.

**Monday Discussion Agenda** (website and PDF): only the tasks allocated to the selected Monday, in
12 columns (S.N., Date, Review Frequency, Allocated Monday, Task, Coordinator Officer, Other
Officers, Action Plan, Execution Date (TDC), Status, DRM Remark / File, Latest BO Remark / File),
sorted by date, newest first, with S.N. numbered in that order. The PDF is landscape with the
meeting date in the heading and repeated column headings. The **W / F1-F2 / M register PDFs** use the
Task Report layout with the review frequency and allocated Monday next to the task. The Tasks
page PDF and its status filters are unchanged.

### API (admin only)

| Method | Endpoint | Description |
| ------ | -------- | ----------- |
| GET    | `/api/meetings/register` | All tasks with cycle, status, dates, latest remarks; counts per cycle |
| GET    | `/api/meetings/register/pdf?cycle=WEEKLY&status=all` | Cycle register PDF (`status`: all, pending, overdue, completed) |
| GET    | `/api/meetings/agenda?date=YYYY-MM-DD` | Tasks due on a Monday |
| POST   | `/api/meetings/:date/finalize` / `reopen` | Freeze / unfreeze a Monday's agenda |
| POST   | `/api/meetings/:date/items/:taskId/outcome` | `{ outcome: "DISCUSSED" | "PENDING" }` |
| GET    | `/api/meetings/:date/export?format=pdf|xlsx|csv` | Agenda download |
| PATCH  | `/api/schedule/tasks/:id/cycle` | `{ cycle (WEEKLY, F1, F2, MONTHLY, NEXT_MONDAY, NEXT_MONTH, FLEXIBLE), monthlyMondayOrdinal? (1-5, M), allocatedMonday? (Monday, Next Month / Flexible) }` |
| POST   | `/api/schedule/tasks/:id/important` | `{ important: boolean }` |
| POST   | `/api/schedule/cycle` | Same, for many tasks: `{ taskIds, cycle }` |
| POST   | `/api/schedule/tasks/:id/reschedule` | `{ toDate, fromDate?, reason? }` |
| GET    | `/api/schedule/tasks/:id/history` | Scheduling history |

The production database was created without Prisma migration history, so the scheduling
migrations in `server/prisma/migrations` were applied with `prisma db execute`. Do not run
`prisma migrate dev` against it; it would offer to reset the database.
