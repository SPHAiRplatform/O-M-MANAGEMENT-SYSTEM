# SPHAiR marketing site on the droplet — full step-by-step guide

Serve the static marketing site from the repo folder **`Sphair/`** on the **same domain** as the O&M app, at path **`/home/`**. The **API stays at `/api/*`**. The **React app stays at `/`** (login and application).

---

## Table of contents

1. [What you will have](#what-you-will-have-when-finished)
2. [Before you start (prerequisites)](#before-you-start-prerequisites)
3. [Part A — Files on the server](#part-a--put-marketing-files-on-the-server)
4. [Part B — Nginx configuration](#part-b--nginx-configuration)
5. [Part C — Reload and test](#part-c--reload-nginx-and-test)
6. [Part D — Cloudflare and DNS](#part-d--cloudflare-and-dns-checklist)
7. [Part E — Every time you update (deploy workflow)](#part-e--every-time-you-update-deploy-workflow)
8. [Optional helper script](#optional-helper-script)
9. [Rollback](#rollback)
10. [Troubleshooting](#troubleshooting)
11. [Quick reference](#quick-reference)

---

## What you will have when finished

| URL (example) | Purpose |
|---------------|---------|
| `https://yourdomain.com/home/` | Marketing homepage (`Sphair/index.html`) |
| `https://yourdomain.com/home/pricing.html` | Marketing pages (same folder) |
| `https://yourdomain.com/api/...` | API (unchanged) |
| `https://yourdomain.com/` | React O&M app (unchanged) |

- **`/home`** (no trailing slash) redirects to **`/home/`**.

---

## Before you start (prerequisites)

Work through these mentally; if something is missing, fix it before adding `/home`.

1. **SSH access** to the droplet as a user with `sudo`.
2. **Repo already on the server** at a known path (this guide uses **`/opt/sphair`**). If yours differs, replace `/opt/sphair` everywhere.
3. **Docker app running** on **`127.0.0.1:3001`** (e.g. `docker compose ps` shows `app` healthy).
4. **Host Nginx** (not only Docker Nginx) terminates HTTPS and proxies to port **3001**.
5. **Folder name in the repo** is **`Sphair`** (capital **S**). Commands use `./Sphair/` — if your clone uses different casing, adjust the path.
6. **`rsync`** installed (`rsync --version`). If not: `sudo apt-get update && sudo apt-get install -y rsync`.

You need **no change** to the Dockerfile or the Node app for marketing-only updates.

---

## Part A — Put marketing files on the server

### Step A.1 — Open SSH and go to the project root

```bash
ssh your-user@YOUR_DROPLET_IP
cd /opt/sphair
```

If the project lives elsewhere, `cd` there instead.

### Step A.2 — Get the latest code

```bash
git status
git pull origin main
```

Resolve any git conflicts before continuing.

### Step A.3 — Create the marketing directory

```bash
sudo mkdir -p /opt/sphair/marketing
sudo chown -R "$USER":"$USER" /opt/sphair/marketing
```

### Step A.4 — Copy `Sphair/` into `marketing/` (first time and refreshes)

```bash
cd /opt/sphair
rsync -av --delete ./Sphair/ /opt/sphair/marketing/
```

- **`--delete`** removes files under `marketing/` that you removed from `Sphair/` in git (keeps mirrors in sync).

### Step A.5 — Confirm files exist

```bash
test -f /opt/sphair/marketing/index.html && echo "OK: index.html exists"
ls -la /opt/sphair/marketing/assets/css/main.css
```

If `index.html` is missing, check that `./Sphair/index.html` exists in the repo (`ls Sphair/index.html` from `/opt/sphair`).

---

## Part B — Nginx configuration

**Rule:** The **`/home/`** `location` block must appear **before** the catch-all **`location /`** that proxies to Node, so Nginx serves static files for `/home/...` and does not send those requests to the app.

### Step B.1 — Open your site config

Common paths (use the one you already use):

```bash
sudo nano /etc/nginx/sites-available/sphair
```

or

```bash
sudo nano /etc/nginx/sites-available/sphairdigital
```

### Step B.2 — Insert the `/home` blocks (copy-paste)

Inside the **`server { ... }`** block that has **`listen 443 ssl`** (HTTPS), **above** `location / {`, paste:

```nginx
    # --- Marketing site (static files from repo Sphair/) — MUST be before location / ---
    location = /home {
        return 301 https://$host/home/;
    }

    location /home/ {
        alias /opt/sphair/marketing/;
        index index.html;
    }
    # --- end marketing ---
```

**Important details:**

- **`location /home/`** must end with **`/`**.
- **`alias /opt/sphair/marketing/;`** must end with **`/`** (trailing slash).
- Do **not** put these blocks only in the port **80** server; they belong in the **443** server (or in both only if you also serve static on HTTP — normally you only need them on **443**).

### Step B.3 — Full example (simple layout: one `location /` proxy)

If your HTTPS server looks like this today, your file should look **like this after** editing (Certbot lines may differ on your machine):

```nginx
server {
    server_name sphairdigital.com www.sphairdigital.com;

    # --- Marketing site (static) — before location / ---
    location = /home {
        return 301 https://$host/home/;
    }

    location /home/ {
        alias /opt/sphair/marketing/;
        index index.html;
    }

    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }

    listen 443 ssl; # managed by Certbot
    ssl_certificate /etc/letsencrypt/live/sphairdigital.com/fullchain.pem; # managed by Certbot
    ssl_certificate_key /etc/letsencrypt/live/sphairdigital.com/privkey.pem; # managed by Certbot
    include /etc/letsencrypt/options-ssl-nginx.conf; # managed by Certbot
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem; # managed by Certbot
}

server {
    listen 80;
    server_name sphairdigital.com www.sphairdigital.com;
    return 301 https://$host$request_uri;
}
```

Replace **`server_name`** and **Certbot paths** if your domain or certificate name differs.

### Step B.4 — If you use separate `location /api` and `location /uploads`

Some configs proxy `/api` and `/uploads` explicitly, then **`location /`**. Put the **`/home/`** block **above all of them** (or at least **above** `location /`). Example order:

1. `location = /home` → redirect  
2. `location /home/` → `alias`  
3. `location /api` → `proxy_pass`  
4. `location /uploads` → `proxy_pass`  
5. `location /` → `proxy_pass`

### Step B.5 — Upload size (optional)

If you only serve static HTML/CSS from `/home/`, you do not need extra `client_max_body_size` there. Keep **`client_max_body_size`** on the **`location /`** (or global) that hits Node for large uploads.

Save the file (`Ctrl+O`, Enter, `Ctrl+X` in nano).

---

## Part C — Reload Nginx and test

### Step C.1 — Test configuration

```bash
sudo nginx -t
```

You must see: **`syntax is ok`** and **`test is successful`**.  
If you see an error, **do not** run `reload` yet — fix the typo, often a missing `;` or brace.

### Step C.2 — Reload Nginx

```bash
sudo systemctl reload nginx
```

### Step C.3 — Tests from the droplet

Replace **`sphairdigital.com`** with your real domain if different.

```bash
# 1) Redirect /home → /home/
curl -sI https://sphairdigital.com/home | head -5

# 2) Marketing homepage (expect 200)
curl -sI https://sphairdigital.com/home/ | head -8

# 3) CSS (expect 200)
curl -sI https://sphairdigital.com/home/assets/css/main.css | head -5

# 4) API still works (expect 200 from health)
curl -sI https://sphairdigital.com/api/health | head -5

# 5) App shell at root (expect 200)
curl -sI https://sphairdigital.com/ | head -5
```

### Step C.4 — Browser checks

1. Open **`https://your-domain.com/home/`** (use **https**).
2. Open DevTools → **Network**; reload. Confirm **`main.css`**, **`logo.png`**, etc. load with **status 200** and paths under **`/home/...`**.
3. Click **Pricing**, **Book a Pilot** — URLs should stay under **`/home/`**.
4. Open **`/`** and confirm the O&M app still loads and login/API work.

---

## Part D — Cloudflare and DNS checklist

1. **DNS**  
   - **`@` (apex)** and **`www`** both point to your droplet (A or CNAME with flattening).  
   - If only `www` works, fix apex **A** record.

2. **SSL/TLS**  
   - Use **Full** or **Full (strict)** with a valid certificate on the origin (Let’s Encrypt is fine for Full strict).  
   - Avoid **Flexible** — it can cause redirect loops with origin HTTPS.

3. **No conflicting redirect rules**  
   - In **Rules → Redirect Rules**, ensure nothing rewrites **`/home*`** into a loop (e.g. repeated 301 to the same URL).

4. **WAF (optional)**  
   - If API calls are challenged, add a skip rule for paths starting with **`/api`** (see your main deployment doc).

---

## Part E — Every time you update (deploy workflow)

### When you change **only** marketing (`Sphair/` HTML, CSS, images)

```bash
cd /opt/sphair
git pull origin main
rsync -av --delete ./Sphair/ /opt/sphair/marketing/
```

No Docker rebuild. Optional: `sudo systemctl reload nginx` only if you changed Nginx config.

### When you change the **app** (client/server)

```bash
cd /opt/sphair
git pull origin main
docker compose up -d --build app
rsync -av --delete ./Sphair/ /opt/sphair/marketing/
```

### Order suggestion

1. `git pull`  
2. Rebuild/restart **app** if needed  
3. **`rsync` marketing**  
4. **`nginx -t` && reload** only if you edited Nginx  

---

## Optional helper script

Create a small script so you do not forget `rsync`:

```bash
nano /opt/sphair/sync-marketing.sh
```

Paste:

```bash
#!/usr/bin/env bash
set -euo pipefail
REPO_ROOT="/opt/sphair"
DEST="/opt/sphair/marketing"
cd "$REPO_ROOT"
git pull origin main
rsync -av --delete "$REPO_ROOT/Sphair/" "$DEST/"
echo "Marketing synced from Sphair/ to $DEST"
```

Make it executable:

```bash
chmod +x /opt/sphair/sync-marketing.sh
```

Run:

```bash
/opt/sphair/sync-marketing.sh
```

---

## Rollback

**Remove marketing only:**

1. Comment out or delete the **`location = /home`** and **`location /home/`** blocks in your Nginx config.
2. `sudo nginx -t && sudo systemctl reload nginx`  
3. Optionally `rm -rf /opt/sphair/marketing` (only if you no longer need a local copy).

The app and API are unchanged.

---

## Troubleshooting

| Symptom | What to do |
|---------|------------|
| **404** on `/home/` | Run `ls /opt/sphair/marketing/index.html`. Re-run **Part A** `rsync`. Check **`alias`** path ends with `/` and matches **`location /home/`**. |
| **404** on `/home/assets/...` | Confirm `rsync` copied `assets`: `ls /opt/sphair/marketing/assets`. |
| **Download** offers file instead of page | Usually wrong **`Content-Type`** — if you see this, confirm you did not point `alias` at the wrong directory. |
| **403 Forbidden** | Check permissions: `chmod -R u+rX /opt/sphair/marketing` and ownership. |
| **Works on `www`, not apex** (or reverse) | Fix DNS **A** / **CNAME** for both hostnames (see Part D). |
| **React app broken, API 429** | Separate from marketing: rate limiting / real IP behind Cloudflare — see main deployment guide. |
| **`nginx -t` fails** | Check every `{` has `}`; every directive ends with `;`. Compare with **Part B.3**. |

**Nginx error log:**

```bash
sudo tail -50 /var/log/nginx/error.log
```

---

## Quick reference

| Item | Value |
|------|--------|
| Source in repo | `./Sphair/` |
| On-server copy | `/opt/sphair/marketing/` |
| Public URL | `https://yourdomain.com/home/` |
| Nginx | `/home/` **before** `location /` in **443** server |
| Update marketing | `git pull` + `rsync -av --delete ./Sphair/ /opt/sphair/marketing/` |

---

## Linking marketing ↔ app (optional UX)

In `Sphair/index.html` (or shared header), add a button for operators, for example:

- **Sign in to app:** `href="/"` or your real login path (e.g. `/login` if that is your route).

Use **root-relative** paths (`/`, `/login`) so they work on both `www` and apex.

---

*This guide is self-contained. Your main application deployment (Docker, database, SSL, Cloudflare) may be documented in `DEPLOYMENT_GUIDE_SINGLE_COMPANY.md` or `FRESH_CLONE_DEPLOY.md` — follow those for the stack; use this file only for serving **`Sphair/`** at **`/home/`**.*
