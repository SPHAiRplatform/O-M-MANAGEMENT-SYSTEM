# Moving From Droplet to App Platform

This guide walks you through migrating your SPHAiR Digital app from a DigitalOcean Droplet to **App Platform**, using your existing managed database and (optionally) Spaces. **Do not delete the Droplet until everything works on App Platform.**

---

## Before You Start – Important Notes

- **Redis**: This app uses Redis for sessions and JWT. On App Platform you must either add a **Redis** resource (Database → Redis) and set `REDIS_URL` and `REDIS_ENABLED=true`, or the app may run without Redis (sessions in memory; not recommended for production).
- **Uploads / files**: On the Droplet, files are stored in `server/uploads/` (company templates, images, reports, etc.). App Platform has an **ephemeral filesystem**—anything written to disk is lost on deploy/restart unless you use a **Volume** or **Spaces**.
  - **Option A – Volume**: Add a Volume in App Platform and mount it at `/app/uploads` so the app keeps using the same file paths. You must copy your existing `uploads` content into that volume (e.g. via a one-off job or by restoring from backup).
  - **Option B – Spaces**: The app would need code changes to read/write files to DigitalOcean Spaces instead of local disk. Until that is implemented, use a **Volume** for uploads.
- **DB SSL**: On the Droplet you may use `DB_SSL=true` and `DB_SSL_CA=/root/ca-certificate.crt`. On App Platform you cannot mount a CA file path the same way. Use `DB_SSL=true`; for managed PostgreSQL, App Platform typically connects with SSL without needing a custom CA path. If you see SSL errors, you may need to set `PGSSLMODE=require` or the equivalent in your connection config.

---

## Step 1 – Before You Delete Anything

Save everything important from your current Droplet. **Do not delete anything yet.**

1. Connect to your Droplet:
   ```bash
   ssh root@YOUR-DROPLET-IP
   ```
2. Copy your environment variables:
   ```bash
   cat /opt/sphair/.env
   ```
3. Copy **everything** you see and save it somewhere safe (e.g. a notepad file). You will need all these values for App Platform.

---

## Step 2 – Make Sure Your Code is on GitHub

App Platform pulls code directly from GitHub. Ensure your latest code is there:

```bash
cd /opt/sphair
git add .
git status
git commit -m "moving to app platform"
git push origin main
```

(Or run these from your local machine if you develop locally and deploy from there.)

---

## Step 3 – Create Your App on App Platform

1. Log into [DigitalOcean](https://cloud.digitalocean.com).
2. Click **App Platform** in the left menu.
3. Click **Create App**.
4. Select **GitHub**.
5. Authorize DigitalOcean if asked.
6. Select your repository.
7. Select branch **main**.
8. Click **Next**.

---

## Step 4 – Connect Your Existing Database

Use your existing managed database so no data is lost.

1. On the configuration page, click **Add Resource**.
2. Click **Database**.
3. Click **Previously Created DigitalOcean Database**.
4. Select your existing database from the list.
5. Click **Attach Database**.

This connects your existing database to the new app; data is unchanged.

---

## Step 5 – Add Redis (Required for Sessions)

The app uses Redis for session and JWT storage. Add Redis so sessions work correctly:

1. Click **Add Resource**.
2. Click **Database** (or **Datastore**).
3. Choose **Redis** (create a new Redis cluster or attach existing if you have one).
4. After it is created, App Platform will expose a connection URL (e.g. `REDIS_URL`). Ensure your app component has this variable (it may be auto-injected when you attach the resource).

In your app’s **Environment Variables**, set:

- `REDIS_ENABLED` = `true`
- `REDIS_URL` = (use the value provided by App Platform for the Redis resource)

---

## Step 6 – Add a Volume for Uploads (Recommended)

So that company files (templates, images, reports, etc.) persist across deploys:

1. In your app component, open **Settings** or **Edit**.
2. Find **Volumes** (or **Storage**).
3. Add a volume, e.g.:
   - **Mount Path**: `/app/uploads`
   - **Size**: e.g. 1 GB (adjust as needed).

After the first deploy, you will need to populate this volume with your existing uploads (e.g. from your Droplet backup or PC). Options:

- Use a one-off **Job** that copies from a backup (e.g. S3/Spaces or a URL).
- Or use `docker run` / a temporary container that mounts the volume and you copy files in (if App Platform supports it).

If you skip the volume, the app will start with an empty `uploads` folder and you will have to re-upload or restore files another way.

---

## Step 7 – Add Your Environment Variables

1. Click **Edit** on your app component.
2. Scroll to **Environment Variables**.
3. Add all the variables you copied from the Droplet in Step 1.

**Essential variables:**

| Variable | Example / notes |
|----------|------------------|
| `NODE_ENV` | `production` |
| `PORT` | `3001` (or the port App Platform assigns) |
| `DB_HOST` | (from attached DB) |
| `DB_PORT` | `25060` |
| `DB_NAME` | your database name |
| `DB_USER` | your database user |
| `DB_PASSWORD` | your database password |
| `DB_SSL` | `true` |
| `REDIS_ENABLED` | `true` |
| `REDIS_URL` | (from Redis resource) |
| `SESSION_SECRET` | (same as on Droplet) |
| `JWT_SECRET` | (same as on Droplet) |
| `TRUST_PROXY` | `true` |
| `DEFAULT_USER_PASSWORD` | (same as on Droplet) |
| `CORS_ORIGIN` | `https://yourdomain.com` or leave empty as needed |
| `FRONTEND_URL` | `https://yourdomain.com` |

**Optional (if you use them):**

- `PLATFORM_SERVICE_TOKEN`, `PLATFORM_UPDATE_IPS` (for update checks)
- `SENDGRID_API_KEY`, `SENDGRID_FROM_EMAIL` (email)
- `SPACES_ACCESS_KEY`, `SPACES_SECRET_KEY`, `SPACES_BUCKET`, `SPACES_REGION`, `SPACES_ENDPOINT` (only if the app is updated to use Spaces for uploads)

**Note:** On App Platform you typically **cannot** set `DB_SSL_CA` to a file path. Use `DB_SSL=true`; for DigitalOcean managed Postgres, SSL usually works without a custom CA. If you see SSL errors, check App Platform docs for database SSL options.

Click **Save**.

---

## Step 8 – Choose Your Plan

1. Select **Basic** plan.
2. Select **$12/month** (or the tier you prefer).
3. Click **Next**.

---

## Step 9 – Review and Deploy

1. Review that the database, Redis, and (if added) volume are attached and env vars are set.
2. Click **Create Resources**.
3. Wait 5–10 minutes for the build to finish.
4. Watch the build log until you see **Deploy Successful**.

---

## Step 10 – Test Before Touching Your Domain

Test the app on the temporary URL before changing DNS.

1. In App Platform, open your app.
2. Note the URL (e.g. `https://your-app-name.ondigitalocean.app`).
3. Open that URL in your browser and verify:
   - App loads.
   - You can log in.
   - Data from the database is correct.
   - If you added a volume and restored uploads, files (templates, images, etc.) are accessible.
4. **Do not move your domain** until everything works on this URL.

---

## Step 11 – Move Your Domain to App Platform

When everything works on the temporary URL:

1. In App Platform, open your app → **Settings** → **Domains**.
2. Click **Add Domain** and enter your domain (e.g. `sphairdigital.com`).
3. DigitalOcean will show a **CNAME** (or instructions). Use that value in DNS.

**In Cloudflare:**

1. Go to **DNS**.
2. Remove the existing **A** record that points to the Droplet IP.
3. Add a new record:
   - **Type**: CNAME  
   - **Name**: `@` (or the subdomain you use)  
   - **Target**: (value from DigitalOcean)  
   - **Proxy**: On (orange cloud) if you want Cloudflare in front.
4. Save.
5. Wait 10–30 minutes for DNS to propagate.

---

## Step 12 – Verify Domain and SSL

1. Open `https://yourdomain.com` in your browser.
2. Confirm the app loads and the padlock shows a valid SSL certificate.
3. Test login, data, and file access again on the real domain.

---

## Step 13 – Delete Your Droplet (Only When Ready)

**Only after** everything works on App Platform with your real domain:

1. In DigitalOcean, go to **Droplets**.
2. Select your Droplet.
3. Click **Destroy** and confirm.

This removes the Droplet cost (e.g. $24/month) while you keep the database and (if used) Redis and Spaces on App Platform.

---

## Quick Reference – Env Vars From Droplet

When copying from `cat /opt/sphair/.env`, ensure you transfer at least:

- `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `DB_SSL`
- `SESSION_SECRET`, `JWT_SECRET`
- `TRUST_PROXY`, `PORT`, `NODE_ENV`
- `DEFAULT_USER_PASSWORD`
- `CORS_ORIGIN` or `FRONTEND_URL`
- `REDIS_ENABLED`, `REDIS_URL` (from App Platform Redis resource)
- Any SendGrid or Spaces vars you use

Do **not** set `DB_SSL_CA` to a path on App Platform unless the product supports mounting a file; use `DB_SSL=true` and managed DB SSL defaults first.
