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
npm run db:migrate   # prisma migrate dev
npm run db:seed      # prisma db seed
npm run db:studio    # prisma studio
```
