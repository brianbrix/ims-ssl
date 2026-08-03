# Sabbath School Reader

Upload and read Sabbath School PDF lessons with an IMS-branded web UI.

## Deploy On Wasmer (GitHub)

This repository now supports single-process production hosting on Wasmer:
the Node server serves both API routes and the built frontend.

### 1. Push latest code

Make sure these files are in your repo root:

1. `Anybuild`
2. `app.yaml`

### 2. Create app from GitHub

Open your link:

https://wasmer.io/apps/create?github=brianbrix/ims-ssl

Then continue through the wizard and pick the `main` branch.

### 3. Set required environment variables in Wasmer

In the Wasmer app dashboard, set:

1. `ADMIN_TOKEN` = a strong secret passcode
2. `STORAGE_ROOT` = `/persistent`
3. `CORS_ORIGIN` = your frontend origin(s) (or `*` while testing)

Optional:

1. `PUBLIC_API_BASE_URL` if you need fixed absolute API URLs in responses.

### 4. Persistent storage

`app.yaml` mounts volume `lesson-storage` at `/persistent`.
With `STORAGE_ROOT=/persistent`, uploads and SQLite data persist between deploys.

### 5. Deploy and test

After deploy is complete:

1. Open the Wasmer app URL.
2. Visit `/api/lessons` to confirm API health.
3. Upload a PDF and refresh to confirm persistence.

## Local Development

1. Install dependencies

```bash
npm install
cd server && npm install && cd ..
```

2. Start backend API

```bash
npm run server
```

3. Start frontend

```bash
npm run dev
```

4. Open the Vite URL (usually http://localhost:5173)

## Multi-User Access From Anywhere

To let multiple users access the same files from different devices/locations:

1. Deploy one shared backend service (not local on each user machine).
2. Deploy frontend to a public host.
3. Point frontend to backend with `VITE_API_BASE_URL`.
4. Set CORS allowed origins on backend.
5. Persist `server/uploads` and `server/data` on durable shared storage/volume.

Use `.env.example` as your configuration reference.

### Frontend Environment

Set in your frontend host/build environment:

```bash
VITE_API_BASE_URL=https://api.your-domain.com
```

### Backend Environment

Set in your backend runtime:

```bash
HOST=0.0.0.0
PORT=3001
ADMIN_TOKEN=replace-with-strong-token
CORS_ORIGIN=https://reader.your-domain.com
PUBLIC_API_BASE_URL=https://api.your-domain.com
```

`CORS_ORIGIN` also accepts comma-separated origins.

## Notes

1. Lesson metadata is stored in a SQLite database at `server/data/lessons.db`.
2. Uploaded PDFs are stored in `server/uploads`.
3. In production, mount both `server/data` and `server/uploads` to persistent storage (e.g. a durable volume), so data survives restarts/redeploys.
4. A legacy `server/data/lessons.json` (if present from an older version) is automatically migrated into SQLite on first startup and can be deleted afterward.
5. Change `ADMIN_TOKEN`; do not use the default in production.
