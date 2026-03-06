# Fresh Clone Deployment — Step-by-Step

Use this when the server has drifted from the repo or you want a clean deploy. Assumes app was previously at `/opt/sphair` and you use **host Nginx** (so we do **not** start the compose `nginx` service).

---

## 1. Back up

```bash
cd /opt/sphair
cp .env /root/sphair.env.backup
```

(Optional: back up `server/uploads`, `server/logs`, `server/backups` if you need them.)

---

## 2. Stop containers

```bash
cd /opt/sphair
docker-compose down
```

---

## 3. Remove old app and clone fresh

This deletes the old app directory and frees space. Back up `server/uploads`, `server/logs`, or `server/backups` in step 1 if you need them.

```bash
cd /opt
rm -rf sphair
git clone https://github.com/SPHAiRplatform/O-M-MANAGEMENT-SYSTEM.git sphair
cd sphair
```

---

## 4. Restore `.env`

```bash
cp /root/sphair.env.backup /opt/sphair/.env
```

Edit if needed (DB host, secrets, paths):

```bash
nano /opt/sphair/.env
```

---

## 5. Start postgres, redis, and app only

```bash
cd /opt/sphair
docker-compose up -d postgres redis app
```

Do **not** run `docker-compose up -d` without arguments if host Nginx is using port 80.

---

## 6. Database setup (if new DB or need schema/seed)

```bash
cd /opt/sphair
docker-compose run --rm app node scripts/setup-db.js
```

---

## 7. Rebuild app and restart

```bash
cd /opt/sphair
docker-compose build app
docker-compose stop app
docker rm sphairdigital-app
docker-compose up -d postgres redis app
```

If the build fails at `RUN npm ci --only=production` in the Dockerfile, change that line to `RUN npm install --only=production` and run the build again.

---

## 8. Verify

```bash
docker-compose ps
curl -s http://127.0.0.1:3001/api/platform/health
```

You should see something like: `{"status":"healthy","database":"connected",...}`.

Then open `https://yourdomain.com` in a browser and log in.

---

## Cloudflare

If login or API calls return 403 “Just a moment…”:

- In Cloudflare: **Security** → **WAF** → add a rule to **Skip** security for URI path starting with `/api`.
- Or temporarily set **Security Level** to **Essentially Off** to confirm.

---

## One-liner (after backup and restore of `.env`)

```bash
cd /opt/sphair && docker-compose down && cd /opt && rm -rf sphair && git clone https://github.com/SPHAiRplatform/O-M-MANAGEMENT-SYSTEM.git sphair && cp /root/sphair.env.backup sphair/.env && cd sphair && docker-compose up -d postgres redis app && docker-compose run --rm app node scripts/setup-db.js && docker-compose build app && docker-compose stop app && docker rm sphairdigital-app 2>/dev/null; docker-compose up -d postgres redis app
```

Run steps individually if you prefer to verify each stage.
