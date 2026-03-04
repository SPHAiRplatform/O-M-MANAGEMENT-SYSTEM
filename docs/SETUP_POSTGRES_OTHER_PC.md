# PostgreSQL Setup — Running the App on Another PC

Use this guide when moving the ChecksheetsApp (SPHAiRDigital) to a new machine. It covers database configuration and how to run the app against a local PostgreSQL instance.

---

## 1. Current Database Configuration

The app expects these **environment variables** (set in `server/.env`):

| Variable       | Current value (this PC) | Description                |
|----------------|-------------------------|----------------------------|
| `DB_HOST`      | `localhost`             | PostgreSQL server host     |
| `DB_PORT`      | `5432`                  | PostgreSQL port            |
| `DB_NAME`      | `solar_om_db`           | Database name              |
| `DB_USER`      | `postgres`              | PostgreSQL user            |
| `DB_PASSWORD`  | *(your password)*       | PostgreSQL user password   |

Optional (have defaults in code):

- `DB_MAX_CONNECTIONS` (default: 20)
- `DB_MIN_CONNECTIONS` (default: 2)
- `DB_IDLE_TIMEOUT` (default: 30000 ms)
- `DB_CONNECTION_TIMEOUT` (default: 2000 ms)

The application code (e.g. `server/index.js`) defaults to:

- **Database name:** `solar_om_db`
- **User:** `postgres`
- **Host:** `localhost`
- **Port:** `5432`

So on the other PC you can use the same DB name and user, and only need to set the password (and override host/port if PostgreSQL is not on localhost).

---

## 2. Install PostgreSQL on the Other PC

1. **Download PostgreSQL**
   - https://www.postgresql.org/download/windows/ (Windows)
   - Or use the installer from the official site for your OS.

2. **Run the installer**
   - Install PostgreSQL (v12 or higher).
   - Note the **port** (default `5432`).
   - Set and remember the **postgres user password**; you will use it as `DB_PASSWORD` in `server/.env`.

3. **Ensure the service is running**
   - Windows: Services → find "PostgreSQL" → ensure it’s running.
   - macOS/Linux: e.g. `sudo service postgresql status` or `brew services list` (if installed via Homebrew).

---

## 3. Get the Code on the Other PC

From the machine where you have the repo (or from GitHub after you push):

- **Option A — Clone from GitHub**
  ```bash
  git clone https://github.com/YOUR_USERNAME/ChecksheetsApp.git
  cd ChecksheetsApp
  ```
- **Option B — Copy the project folder** (e.g. USB, network share), then open it in your editor/terminal.

---

## 4. Create `server/.env` on the Other PC

The repo does **not** include `server/.env` (it’s in `.gitignore`). Create it from the example and set the DB password:

1. Copy the example file:
   ```bash
   cd server
   copy .env.example .env
   ```
   (On macOS/Linux: `cp .env.example .env`.)

2. Edit `server/.env` and set at least:

   ```env
   # Database (required)
   DB_HOST=localhost
   DB_PORT=5432
   DB_NAME=solar_om_db
   DB_USER=postgres
   DB_PASSWORD=YOUR_POSTGRES_PASSWORD

   # Server
   NODE_ENV=development
   PORT=3001
   ```

   Replace `YOUR_POSTGRES_PASSWORD` with the password you set for the `postgres` user during PostgreSQL installation.

3. Optional: add `JWT_SECRET` and `SESSION_SECRET` if you use auth (you can copy from this PC’s `server/.env` or generate new ones).

---

## 5. Install Dependencies and Create the Database

From the **project root** (e.g. `d:\PJs\ChecksheetsApp` or `~/ChecksheetsApp`):

```bash
# Install all dependencies (root, server, client)
npm run install-all
```

Then create the database and run schema + migrations:

```bash
npm run setup-db
```

This will:

- Connect to PostgreSQL as `DB_USER` (e.g. `postgres`) using `DB_PASSWORD`.
- Create the database `solar_om_db` if it doesn’t exist.
- Apply `server/db/schema.sql` and the migrations in `server/db/migrations/`.
- Seed initial data (default org, users, templates, etc.).

If you see “Database setup completed!” you’re good. If you see errors, check that:

- PostgreSQL is running.
- `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD` in `server/.env` are correct.
- The user has permission to create databases (default `postgres` user does).

---

## 6. Run the Application

From the project root:

```bash
npm run dev
```

This starts:

- **Backend:** http://localhost:3001  
- **Frontend:** http://localhost:3000  

Or run separately:

```bash
# Terminal 1 — backend
npm run server

# Terminal 2 — frontend
npm run client
```

---

## 7. Quick Reference — Commands on the Other PC

```bash
# 1. Clone or copy project, then:
cd ChecksheetsApp

# 2. Environment
cd server && copy .env.example .env
# Edit .env: set DB_PASSWORD (and DB_NAME if you use a different one)

# 3. Install and DB setup
cd ..
npm run install-all
npm run setup-db

# 4. Run
npm run dev
```

---

## 8. Moving Data from This PC to the Other PC

### Option A: Move All Data (Recommended)

**On THIS PC (current machine):**

1. **Create a database dump:**

   **Option 1 — Using PowerShell script:**
   ```powershell
   powershell -ExecutionPolicy Bypass -File scripts\dump-database.ps1
   ```
   
   **Option 2 — Using Node.js script (if pg_dump is in PATH):**
   ```bash
   node scripts/dump-database.js
   ```
   
   **Option 2 — Manual command (if script doesn't work):**
   
   Open PowerShell or Command Prompt and run:
   ```powershell
   # Set password (replace 0000 with your actual postgres password)
   $env:PGPASSWORD="0000"
   
   # Create dump (adjust path/date format as needed)
   pg_dump -h localhost -p 5432 -U postgres -d solar_om_db -F c -f "scripts\database-dump\solar_om_db_backup.backup"
   ```
   
   Or if `pg_dump` is not in PATH, use full path:
   ```powershell
   & "C:\Program Files\PostgreSQL\16\bin\pg_dump.exe" -h localhost -p 5432 -U postgres -d solar_om_db -F c -f "scripts\database-dump\solar_om_db_backup.backup"
   ```
   (Replace `16` with your PostgreSQL version number)
   
   This creates a compressed backup file in `scripts/database-dump/`, e.g.:
   ```
   scripts/database-dump/solar_om_db_backup.backup
   ```

2. **Copy the dump file to the other PC:**
   - Copy the `.backup` file via USB drive, network share, cloud storage, etc.
   - Note the full path where you'll save it on the other PC.

**On the OTHER PC:**

1. **Install PostgreSQL and set up the project** (follow steps 2-4 above).

2. **Place the dump file** in the project (e.g., `scripts/database-dump/` folder).

3. **Restore the database:**

   **Option 1 — Using the script:**
   ```bash
   node scripts/restore-database.js scripts/database-dump/solar_om_db_backup.backup
   ```
   
   **Option 2 — Manual commands (if script doesn't work):**
   
   Open PowerShell or Command Prompt:
   ```powershell
   # Set password
   $env:PGPASSWORD="YOUR_POSTGRES_PASSWORD"
   
   # Drop and recreate the database
   psql -U postgres -c "DROP DATABASE IF EXISTS solar_om_db;"
   psql -U postgres -c "CREATE DATABASE solar_om_db;"
   
   # Restore the dump
   pg_restore -U postgres -d solar_om_db scripts/database-dump/solar_om_db_backup.backup
   ```
   
   Or use full paths if tools aren't in PATH:
   ```powershell
   & "C:\Program Files\PostgreSQL\16\bin\psql.exe" -U postgres -c "DROP DATABASE IF EXISTS solar_om_db;"
   & "C:\Program Files\PostgreSQL\16\bin\psql.exe" -U postgres -c "CREATE DATABASE solar_om_db;"
   & "C:\Program Files\PostgreSQL\16\bin\pg_restore.exe" -U postgres -d solar_om_db scripts/database-dump/solar_om_db_backup.backup
   ```

4. **Start the application:**
   ```bash
   npm run dev
   ```

✅ **Result:** All your organizations, users, tasks, inventory, calendar events, and other data will be available on the other PC.

---

### Option B: Fresh Setup (No Data Migration)

If you don't need to move existing data:

**On the OTHER PC:**

1. Follow steps 2-4 above (install PostgreSQL, clone code, create `.env`).
2. Run `npm run setup-db` — this creates a fresh database with seed data only.
3. Run `npm run dev`.

✅ **Result:** Clean database with default seed data (default org, admin user, templates). No data from this PC.

---

### Manual Dump/Restore (Alternative)

If the scripts don't work, you can use PostgreSQL commands directly:

**On THIS PC:**
```bash
pg_dump -U postgres -d solar_om_db -F c -f solar_om_db.backup
```

**On the OTHER PC:**
```bash
# Drop and recreate
psql -U postgres -c "DROP DATABASE IF EXISTS solar_om_db;"
psql -U postgres -c "CREATE DATABASE solar_om_db;"

# Restore
pg_restore -U postgres -d solar_om_db solar_om_db.backup
```

Make sure `pg_dump` and `pg_restore` are in your PATH (they come with PostgreSQL installation).
