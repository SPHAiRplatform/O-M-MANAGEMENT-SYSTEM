# Fresh Deployment Guide — SPHAiR O&M System

Complete step-by-step guide for deploying from scratch on a DigitalOcean Droplet with Docker, host-level Nginx, and Cloudflare SSL.

**Infrastructure:** Droplet (Ubuntu) + Docker (Postgres, Redis, App) + Host Nginx + Cloudflare

---

## Prerequisites

- DigitalOcean Droplet (Ubuntu 22.04+, 2GB+ RAM)
- Domain pointed to Cloudflare (e.g., `sphairdigital.com`)
- Cloudflare DNS A record → Droplet IP
- SSH access: `ssh root@YOUR_DROPLET_IP`

---

## Phase 1: Clean the Droplet

If you have an existing deployment, clean it first. **Skip to Phase 2 if this is a brand-new droplet.**

```bash
# SSH into droplet
ssh root@YOUR_DROPLET_IP

# Stop and remove everything
cd /opt/sphair 2>/dev/null
docker compose down -v 2>/dev/null    # -v removes database volumes too (fresh start)
cd /opt
rm -rf sphair

# Prune Docker to free space
docker system prune -af --volumes
```

---

## Phase 2: Install Dependencies (first-time only)

```bash
# Update system
apt update && apt upgrade -y

# Install Docker (if not installed)
curl -fsSL https://get.docker.com | sh
systemctl enable docker && systemctl start docker

# Install Docker Compose plugin (if not installed)
apt install docker-compose-plugin -y

# Verify
docker --version
docker compose version

# Install Nginx (host-level reverse proxy)
apt install nginx -y
systemctl enable nginx
```

---

## Phase 3: Clone and Configure

### 3.1 Clone the repository

```bash
cd /opt
git clone https://github.com/SPHAiRplatform/O-M-MANAGEMENT-SYSTEM.git sphair
cd /opt/sphair
```

### 3.2 Create the .env file

```bash
nano /opt/sphair/.env
```

Paste this template — **replace all placeholder values**:

```env
# ============================================
# SPHAiR O&M System — Production Environment
# ============================================

# Database (Docker internal)
DB_HOST=postgres
DB_PORT=5432
DB_NAME=solar_om_db
DB_USER=postgres
DB_PASSWORD=CHANGE_ME_STRONG_DB_PASSWORD

# Server
PORT=3001
NODE_ENV=production

# Security — generate with: openssl rand -hex 32
SESSION_SECRET=CHANGE_ME_RUN_openssl_rand_hex_32
JWT_SECRET=CHANGE_ME_RUN_openssl_rand_hex_32
PLATFORM_SERVICE_TOKEN=CHANGE_ME_RUN_openssl_rand_hex_32

# Redis (Docker internal)
REDIS_ENABLED=true
REDIS_URL=redis://redis:6379

# Trust proxy (required behind Nginx/Cloudflare)
TRUST_PROXY=true

# CORS — your production domain(s)
CORS_ORIGIN=https://sphairdigital.com,https://www.sphairdigital.com

# Default password for seeded users (change on first login)
DEFAULT_USER_PASSWORD=CHANGE_ME_initial_password

# Super admin credentials (for create-superadmin.js script)
SUPERADMIN_USERNAME=Super
SUPERADMIN_EMAIL=super@sphairdigital.com
SUPERADMIN_PASSWORD=CHANGE_ME_super_admin_password
```

### 3.3 Generate secrets

Run these on the droplet and paste values into .env:

```bash
echo "SESSION_SECRET: $(openssl rand -hex 32)"
echo "JWT_SECRET: $(openssl rand -hex 32)"
echo "PLATFORM_SERVICE_TOKEN: $(openssl rand -hex 32)"
echo "DB_PASSWORD: $(openssl rand -hex 16)"
```

---

## Phase 4: Create Upload Directories

```bash
cd /opt/sphair
mkdir -p server/uploads/companies server/uploads/profiles server/logs server/backups
chmod -R 755 server/uploads server/logs server/backups
```

---

## Phase 5: Build and Start Docker Services

### 5.1 Build the app image (includes frontend build)

```bash
cd /opt/sphair
docker compose build --no-cache app
```

This takes 3-5 minutes. It builds the React frontend and packages it with the Node.js server.

### 5.2 Start PostgreSQL and Redis first

```bash
docker compose up -d postgres redis
```

Wait for them to be healthy:

```bash
docker compose ps
# Both should show "healthy" status. If not, wait 15 seconds and check again.
```

### 5.3 Run database setup (schema + migrations + seed data)

```bash
docker compose run --rm app node scripts/setup-db.js
```

Expected output:
```
Setting up database...
Database 'solar_om_db' already exists
Schema created successfully
Running Multi-Tenant migrations...
Multi-Tenant Migration multi_tenant_001_create_organizations.sql applied successfully
...
Migration optimize_rls_policies.sql applied successfully
Default users created:
  Admin: username=admin, password=***
  Technician: username=tech1, password=***
Weather Station checklist template created
Energy Meter checklist template created
Database setup completed!
```

If you see errors about "already exists" or "duplicate", that's fine — the migrations are idempotent.

### 5.4 Create the platform super admin

```bash
docker compose run --rm app node scripts/create-superadmin.js
```

This creates a `super_admin` user (username from SUPERADMIN_USERNAME in .env) that can manage all organizations from the platform dashboard.

### 5.5 Start the app

```bash
docker compose up -d app
```

### 5.6 Verify the app is running

```bash
# Check container status
docker compose ps

# Test health endpoint
curl -s http://127.0.0.1:3001/api/health | head -c 200

# Check logs for errors
docker compose logs app --tail 50
```

You should see `{"status":"healthy","database":"connected",...}` from the health check.

---

## Phase 6: Configure Host Nginx

**Important:** We use the host Nginx (not Docker Compose's nginx service) because it handles SSL with Cloudflare directly.

### 6.1 Create Nginx config

```bash
nano /etc/nginx/sites-available/sphairdigital
```

Paste:

```nginx
server {
    listen 80;
    server_name sphairdigital.com www.sphairdigital.com;

    # Security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;

    # Max upload size (for logos, templates, images)
    client_max_body_size 50M;

    # API routes → Node.js app
    location /api {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;

        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }

    # Uploaded files (logos, images, templates, etc.)
    location /uploads {
        proxy_pass http://127.0.0.1:3001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        expires 7d;
    }

    # Frontend (served by Node.js from /public)
    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Health check (for monitoring)
    location /health {
        access_log off;
        proxy_pass http://127.0.0.1:3001/api/health;
    }
}
```

### 6.2 Enable the site

```bash
# Remove default site
rm -f /etc/nginx/sites-enabled/default

# Enable our site
ln -sf /etc/nginx/sites-available/sphairdigital /etc/nginx/sites-enabled/

# Test config
nginx -t

# Reload
systemctl reload nginx
```

---

## Phase 7: Configure Cloudflare

### 7.1 DNS

- **A record:** `sphairdigital.com` → `YOUR_DROPLET_IP` (Proxied / orange cloud)
- **CNAME:** `www` → `sphairdigital.com` (Proxied)

### 7.2 SSL/TLS

- Go to **SSL/TLS** → **Overview** → Set to **Full** (not Full Strict)
  - This means: Cloudflare → HTTPS → Your server (HTTP). Cloudflare handles the certificate.
- **Edge Certificates** → Enable **Always Use HTTPS**

### 7.3 WAF Rules (prevent Cloudflare from blocking API calls)

Go to **Security** → **WAF** → **Create Rule**:

- **Rule name:** Skip security for API
- **When:** URI Path starts with `/api`
- **Then:** Skip all remaining rules
- **Also skip:** Browser Integrity Check, Challenge Passage, WAF Managed Rules

This prevents Cloudflare from showing "Just a moment..." challenges on API requests.

### 7.4 Page Rules (optional)

- `sphairdigital.com/api/*` → Cache Level: Bypass, Security Level: Essentially Off

---

## Phase 8: Verify Everything Works

### 8.1 Health check

```bash
curl -s https://sphairdigital.com/api/health
```

### 8.2 Login test

Open `https://sphairdigital.com` in your browser.

**Login as platform super admin:**
- Username: value of `SUPERADMIN_USERNAME` from .env (default: `superadmin`)
- Password: value of `SUPERADMIN_PASSWORD` from .env

After login, you should see the Platform Dashboard with the "Smart Innovations Energy" organization.

### 8.3 Enter a company

Click "Enter" next to the organization. You should be able to:
- See the tenant dashboard
- View registered users
- Upload logos (Branding page)
- Create/upload checklist templates
- View tasks, inventory, etc.

---

## Troubleshooting

### Container won't start

```bash
docker compose logs app --tail 100
docker compose logs postgres --tail 50
```

### 401/403 errors on API calls

- Check that `CORS_ORIGIN` in `.env` matches your domain exactly (including https://)
- Check that `TRUST_PROXY=true` is set
- Check browser console for the specific error message
- JWT auth is the primary auth method in production (session cookies may not persist through Cloudflare)

### "Just a moment..." Cloudflare challenge on API

- Add the WAF skip rule from Phase 7.3 above
- Or temporarily set Security Level to "Essentially Off" in Cloudflare dashboard

### Database setup errors

```bash
# Connect to database directly
docker compose exec postgres psql -U postgres -d solar_om_db

# Check if tables exist
\dt

# Check if organizations exist
SELECT id, name, slug FROM organizations;

# Check if users exist
SELECT username, role, roles, organization_id FROM users;
```

### Uploaded files not showing (logo 404)

```bash
# Check if file exists in container
docker compose exec app ls -la uploads/companies/

# Check directory permissions
docker compose exec app ls -la uploads/
```

### Need to re-run migrations only (without wiping data)

```bash
docker compose run --rm app node scripts/setup-db.js
```

All migrations use `IF NOT EXISTS` / `ON CONFLICT` so they're safe to re-run.

### View app logs

```bash
# Real-time logs
docker compose logs -f app

# Last 200 lines
docker compose logs app --tail 200
```

---

## Maintenance

### Update to latest code

```bash
cd /opt/sphair
git pull origin main
docker compose build --no-cache app
docker compose up -d app
```

If there are new migrations, also run:
```bash
docker compose run --rm app node scripts/setup-db.js
```

### Restart services

```bash
docker compose restart app        # Just the app
docker compose restart             # All services
```

### Database backup

```bash
docker compose exec postgres pg_dump -U postgres solar_om_db > /root/backup_$(date +%Y%m%d).sql
```

### Database restore

```bash
cat /root/backup_YYYYMMDD.sql | docker compose exec -T postgres psql -U postgres solar_om_db
```

---

## Quick Reference — Full Clean Deploy (one section at a time)

```bash
# 1. SSH in
ssh root@YOUR_DROPLET_IP

# 2. Clean old deployment
cd /opt/sphair 2>/dev/null && docker compose down -v; cd /opt && rm -rf sphair

# 3. Clone fresh
git clone https://github.com/SPHAiRplatform/O-M-MANAGEMENT-SYSTEM.git sphair && cd sphair

# 4. Create .env (use template from Phase 3.2 above)
nano .env

# 5. Create directories
mkdir -p server/uploads/companies server/uploads/profiles server/logs server/backups

# 6. Build and start
docker compose build --no-cache app
docker compose up -d postgres redis
sleep 10
docker compose run --rm app node scripts/setup-db.js
docker compose run --rm app node scripts/create-superadmin.js
docker compose up -d app

# 7. Verify
docker compose ps
curl -s http://127.0.0.1:3001/api/health
```
