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

The **Monday Meeting** page (`/meetings`, admin only) builds the agenda for a chosen Monday.
All rules live in `server/src/services/scheduling/rules.ts` (pure functions, unit-tested);
`repository.ts` and `actions.ts` apply them to the database.

### Frequencies

| Code | Meaning     | Next discussion after a discussion on day *D* |
| ---- | ----------- | --------------------------------------------- |
| M    | Weekly      | The Monday after *D* |
| F    | Fortnightly | *D* + 14 days (the Monday on or after, if *D* was not a Monday) |
| NM   | Next Month  | The chosen Monday (first by default; 2nd/3rd/4th/last selectable) of the month after *D* |

A task with no frequency is never on an agenda. Existing tasks start that way and are given a
frequency from the page's **Without frequency** tab; nothing is assigned automatically.

A new task (or a task given a frequency for the first time) goes to the upcoming Monday if it is
urgent or high priority, blocked, flagged, or due before the following Monday. Otherwise weekly
tasks go to the upcoming Monday, fortnightly ones within two weeks (bulk assignments are spread over
the next two Mondays) and NM ones to the designated Monday of next month. A deadline earlier than
that slot pulls the date to the Monday before the deadline.

### Agenda precedence

1. Completed, deleted or cancelled tasks are excluded.
2. Tasks brought forward to the meeting are included (section *Urgent*).
3. Tasks explicitly added to the meeting are included.
4. Otherwise a task is included only if its next discussion date is on or before the meeting date
   (a missed date carries over).
5. Frequency alone never puts a task on an agenda.
6. A task appears at most once per meeting (unique `meetingId + taskId`).

Only **Mark as discussed** moves a task's schedule, and it can be undone. Deferring keeps the
frequency and records the original date and reason; urgent, blocked, overdue and brought-forward
tasks need an explicit confirmation. Bringing a task forward does not change its frequency.
When the agenda exceeds the meeting time, the page suggests non-urgent tasks to defer to the next
Monday; nothing moves until confirmed. Every change is recorded in `TaskScheduleEvent`.

### Settings (server environment)

| Variable                         | Default        | Meaning |
| -------------------------------- | -------------- | ------- |
| `MEETING_TIME_ZONE`              | `Asia/Kolkata` | Time zone used for "today" and "upcoming Monday" |
| `MEETING_DURATION_LIMIT_MINUTES` | `90`           | Default meeting length (editable per meeting) |
| `DEFAULT_DISCUSSION_MINUTES`     | `3`            | Discussion time for a task with no estimate |

Deferral ranking weights are in `server/src/services/scheduling/config.ts`.

### API (admin only)

| Method | Endpoint | Description |
| ------ | -------- | ----------- |
| GET    | `/api/meetings/agenda?date=YYYY-MM-DD` | Agenda, load, deferral suggestions, unscheduled and flagged tasks |
| GET    | `/api/meetings` | Recent meetings |
| POST   | `/api/meetings/:date/save` | Save or refresh a draft agenda (idempotent) |
| PATCH  | `/api/meetings/:date` | Meeting time limit, notes, attached Monday PDF |
| POST   | `/api/meetings/:date/status` | `DRAFT` / `FINALIZED` / `CLOSED` |
| POST   | `/api/meetings/:date/items` | Add a task to this meeting once |
| DELETE | `/api/meetings/:date/items/:taskId` | Remove a manually added item |
| POST   | `/api/meetings/:date/items/:taskId/outcome` | Discussed / not discussed / pending, with notes and decisions |
| GET    | `/api/meetings/:date/export?format=xlsx` | Excel export (`format=csv` for CSV) |
| POST   | `/api/schedule/initialize` | Give unscheduled tasks a frequency in bulk |
| PATCH  | `/api/schedule/tasks/:id` | Frequency, priority, estimate, blocked/flag, review note, agreed date |
| POST   | `/api/schedule/tasks/:id/defer` | Defer to a later Monday |
| POST   | `/api/schedule/tasks/:id/bring-forward` | Bring forward to a meeting |
| POST   | `/api/schedule/tasks/:id/complete` | Mark completed |
| GET    | `/api/schedule/tasks/:id/history` | Meetings and scheduling changes |
| POST   | `/api/schedule/review/propose` | Proposals from Monday PDF review edits (no writes) |
| POST   | `/api/schedule/review/apply` | Apply confirmed review edits |

PDFs are not parsed. The Monday PDF can be attached to a meeting, and changes are recorded in the
**PDF review** tab; `proposeReview` in `rules.ts` is where automatic extraction can plug in later.

The production database was created without Prisma migration history, so the scheduling migration
(`server/prisma/migrations/20261024120000_add_meeting_scheduling`) was applied with
`prisma db execute`. Do not run `prisma migrate dev` against it; it would offer to reset the database.
