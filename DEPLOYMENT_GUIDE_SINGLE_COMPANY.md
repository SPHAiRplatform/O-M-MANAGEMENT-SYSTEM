# SPHAiR Digital - Complete Deployment Guide (Single Company)

**Version:** 1.2
**Date:** March 2026
**Target:** Single company deployment on DigitalOcean (multi-tenant ready)
**Estimated Setup Time:** 4-6 hours  
**Estimated Monthly Cost:** $45-50/month (~$100-150 for 90 days)

---

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Overview](#overview)
3. [Step 1: DigitalOcean Setup](#step-1-digitalocean-setup)
4. [Step 2: Domain & Cloudflare Setup](#step-2-domain--cloudflare-setup)
5. [Step 3: Server Configuration](#step-3-server-configuration)
6. [Step 4: Database Setup](#step-4-database-setup)
7. [Step 5: Application Deployment](#step-5-application-deployment)
8. [Step 6: Email Service (SendGrid)](#step-6-email-service-sendgrid)
9. [Step 7: SSL Certificate Setup](#step-7-ssl-certificate-setup)
10. [Step 8: Monitoring Setup (Optional)](#step-8-monitoring-setup-optional)
11. [Step 9: Final Configuration](#step-9-final-configuration)
12. [Step 10: Testing & Verification](#step-10-testing--verification)
13. [Troubleshooting](#troubleshooting)
14. [Maintenance & Updates](#maintenance--updates)

---

## Prerequisites

Before starting, ensure you have:

- ✅ **DigitalOcean Account** (sign up at digitalocean.com)
- ✅ **Domain Name** (e.g., sphair.com or yourcompany.com)
- ✅ **GitHub Account** (for code repository)
- ✅ **SSH Key Pair** (for server access)
- ✅ **Basic Linux Command Line Knowledge**
- ✅ **Access to DNS Settings** (for domain configuration)

**Estimated Costs:**
- DigitalOcean Droplet: $24/month
- Managed PostgreSQL: $15/month
- Spaces (Storage): $5/month
- Domain: $12/year (~$1/month)
- **Total: ~$45/month** (plus optional services)

---

## Overview

This guide will deploy SPHAiR Digital for a single company using:

1. **DigitalOcean** - Infrastructure (server, database, storage)
2. **Cloudflare** - CDN, SSL, DDoS protection
3. **SendGrid** - Transactional emails

**Optional (can be added later):**
- UptimeRobot - Uptime monitoring
- Sentry - Error tracking
- Zendesk - Support ticketing

## Key Features

**SPHAiR Digital includes:**
- ✅ **Calendar System** - Automatically displays the current month on load
- ✅ **Task Management** - Preventive and corrective maintenance tasks
- ✅ **Multi-Tenant Support** - Organization-based data isolation
- ✅ **Inventory Management** - Track spare parts and materials
- ✅ **Report Generation** - Excel and PDF reports
- ✅ **User Management** - Role-based access control
- ✅ **File Uploads** - Secure file storage and management
- ✅ **Offline Mode** - PWA with service worker, IndexedDB caching, and sync queue
- ✅ **Plant Map / Sitemap Builder** - Visual sitemap with drag-and-drop builder
- ✅ **CM Letters & Fault Log** - Corrective maintenance letter tracking
- ✅ **Cycle Tracking** - Grass cutting and panel wash cycle management
- ✅ **SCADA Integration** - Inverter monitoring dashboard (feature-gated)
- ✅ **Audit Log** - Platform-level activity tracking
- ✅ **Organization Branding** - Custom colors, logos, and terminology per org
- ✅ **Feedback System** - In-app user feedback widget
- ✅ **Platform Dashboard** - System owner analytics and management

**Architecture:**
```
Internet
   │
   ▼
Cloudflare (CDN, SSL, DDoS Protection)
   │
   ▼
DigitalOcean Droplet (Application Server)
   │
   ├──► Managed PostgreSQL (Database)
   ├──► Spaces (File Storage)
   └──► SendGrid (Email Service)
```

---

## Step 1: DigitalOcean Setup

### 1.1 Create DigitalOcean Account

1. Go to https://www.digitalocean.com
2. Click "Sign Up"
3. Complete registration
4. Verify email address
5. Add payment method (credit card or PayPal)

### 1.2 Generate SSH Key (if you don't have one)

**On Windows (PowerShell):**
```powershell
ssh-keygen -t ed25519 -C "your_email@example.com"
# Press Enter to accept default location
# Enter passphrase (optional but recommended)
```

**On Mac/Linux:**
```bash
ssh-keygen -t ed25519 -C "your_email@example.com"
# Press Enter to accept default location
# Enter passphrase (optional but recommended)
```

**Copy your public key:**
```bash
# Windows
cat ~/.ssh/id_ed25519.pub

# Mac/Linux
cat ~/.ssh/id_ed25519.pub
```

### 1.3 Add SSH Key to DigitalOcean

1. Log into DigitalOcean
2. Go to **Settings** → **Security** → **SSH Keys**
3. Click **Add SSH Key**
4. Paste your public key
5. Give it a name (e.g., "My Laptop")
6. Click **Add SSH Key**

### 1.4 Create Droplet (Application Server)

1. Click **Create** → **Droplets**
2. **Choose an image:** Ubuntu 22.04 (LTS)
3. **Choose a plan:**
   - **Basic Plan**
   - **Regular Intel with SSD**
   - **2 vCPU, 4GB RAM, 80GB SSD** ($24/month)
4. **Choose a datacenter region:** Select closest to your users
5. **Authentication:** Select your SSH key
6. **Finalize:**
   - Hostname: `sphair-app` (or your preferred name)
   - Enable backups: Optional (adds $4.80/month)
7. Click **Create Droplet**

**Wait 1-2 minutes for droplet to be created.**

### 1.5 Create Managed PostgreSQL Database

1. In DigitalOcean, go to **Databases** → **Create Database Cluster**
2. **Choose a database engine:** PostgreSQL
3. **Choose a version:** PostgreSQL 15 (latest stable)
4. **Choose a datacenter region:** Same as your droplet
5. **Choose a configuration:**
   - **Basic Plan**
   - **Regular Intel with SSD**
   - **1GB RAM, 10GB Storage** ($15/month)
6. **Choose a database name:** `sphair_db` (or your preferred name)
7. **Finalize:**
   - Cluster name: `sphair-database`
   - Enable backups: Yes (included)
8. Click **Create Database Cluster**

**Wait 2-3 minutes for database to be created.**

**Important:** Note down the connection details:
- **Host:** (e.g., `db-postgresql-xxxxx-do-user-xxxxx.db.ondigitalocean.com`)
- **Port:** `25060`
- **Database:** `defaultdb`
- **Username:** `doadmin`
- **Password:** (click "Show" to reveal)

### 1.6 Create Spaces (Object Storage)

1. Go to **Spaces** → **Create a Space**
2. **Choose a datacenter region:** Same as your droplet
3. **Choose a datacenter:** Select one
4. **CDN:** Enable CDN (free, recommended)
5. **File listing:** Disable (for security)
6. **Choose a unique name:** `sphair-storage` (must be globally unique)
7. Click **Create a Space**

**After creation:**
1. Go to **Settings** → **Spaces Keys**
2. Click **Generate New Key**
3. Name: `sphair-app-key`
4. Note down:
   - **Access Key**
   - **Secret Key**

### 1.7 Configure Firewall (Security)

1. Go to **Networking** → **Firewalls** → **Create Firewall**
2. **Name:** `sphair-firewall`
3. **Inbound Rules:**
   - **SSH (22):** Allow from your IP only (or "All IPv4" for now)
   - **HTTP (80):** Allow from all IPv4
   - **HTTPS (443):** Allow from all IPv4
4. **Outbound Rules:** Allow all (default)
5. Click **Create Firewall**
6. **Apply to Droplet:**
   - Select your droplet
   - Click **Apply to Droplet**

### 1.8 Note Down Important Information

Create a file with all your credentials:

```
DIGITALOCEAN DROPLET:
- IP Address: xxx.xxx.xxx.xxx
- Hostname: sphair-app
- Username: root

DATABASE:
- Host: db-postgresql-xxxxx-do-user-xxxxx.db.ondigitalocean.com
- Port: 25060
- Database: defaultdb
- Username: doadmin
- Password: [your-password]

SPACES:
- Name: sphair-storage
- Region: nyc3
- Access Key: [your-access-key]
- Secret Key: [your-secret-key]
- Endpoint: https://sphair-storage.nyc3.digitaloceanspaces.com
```

---

## Step 2: Domain & Cloudflare Setup

### 2.1 Purchase Domain (if you don't have one)

**Recommended Registrars:**
- **Namecheap:** $10-15/year
- **Google Domains:** $12/year
- **Cloudflare Registrar:** $8-10/year (cheapest)

### 2.2 Create Cloudflare Account

1. Go to https://www.cloudflare.com
2. Click **Sign Up**
3. Complete registration
4. Verify email

### 2.3 Add Domain to Cloudflare

1. Click **Add a Site**
2. Enter your domain (e.g., `sphair.com`)
3. Click **Add site**
4. Select **Free plan** (sufficient for start)
5. Click **Continue**

### 2.4 Update Nameservers

Cloudflare will provide nameservers (e.g., `alice.ns.cloudflare.com`)

1. Go to your domain registrar
2. Find **Nameservers** or **DNS Settings**
3. Replace existing nameservers with Cloudflare's nameservers
4. Save changes

**Note:** DNS propagation can take 24-48 hours (usually 1-2 hours)

### 2.5 Configure DNS Records in Cloudflare

1. In Cloudflare, go to **DNS** → **Records**
2. Add the following records:

**A Record (Main Domain):**
- **Type:** A
- **Name:** @ (or your domain name)
- **IPv4 address:** [Your Droplet IP Address]
- **Proxy status:** Proxied (orange cloud) ✅
- **TTL:** Auto
- Click **Save**

**A Record (WWW Subdomain):**
- **Type:** A
- **Name:** www
- **IPv4 address:** [Your Droplet IP Address]
- **Proxy status:** Proxied (orange cloud) ✅
- **TTL:** Auto
- Click **Save**

**A Record (API Subdomain - Optional):**
- **Type:** A
- **Name:** api
- **IPv4 address:** [Your Droplet IP Address]
- **Proxy status:** Proxied (orange cloud) ✅
- **TTL:** Auto
- Click **Save**

### 2.6 Configure SSL/TLS in Cloudflare

1. Go to **SSL/TLS** → **Overview**
2. **Encryption mode:** Select **Full (strict)**
3. This ensures end-to-end encryption

### 2.7 Configure Security Settings

1. Go to **Security** → **Settings**
2. **Security Level:** Medium (or High for production)
3. **Challenge Passage:** 30 minutes
4. **Browser Integrity Check:** On

### 2.8 Configure Speed Settings (Optional but Recommended)

1. Go to **Speed** → **Optimization**
2. Enable:
   - **Auto Minify:** JavaScript, CSS, HTML
   - **Brotli:** On
   - **Rocket Loader:** On (optional)

---

## Step 3: Server Configuration

### 3.1 Connect to Your Droplet

**On Windows (PowerShell):**
```powershell
ssh root@[your-droplet-ip]
```

**On Mac/Linux:**
```bash
ssh root@[your-droplet-ip]
```

**First time connection:** Type `yes` to accept the fingerprint.

### 3.2 Update System

```bash
apt update && apt upgrade -y
```

### 3.3 Install Docker

```bash
# Install Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sh get-docker.sh

# Start Docker
systemctl start docker
systemctl enable docker

# Verify installation
docker --version
```

### 3.4 Install Docker Compose

```bash
# Install Docker Compose
apt install docker-compose -y

# Verify installation
docker-compose --version
```

### 3.5 Install Node.js (for running scripts)

```bash
# Install Node.js 18
curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
apt install -y nodejs

# Verify installation
node --version
npm --version
```

### 3.6 Install Git

```bash
apt install git -y
```

### 3.7 Install Certbot (for SSL certificates)

```bash
apt install certbot python3-certbot-nginx -y
```

### 3.8 Install Nginx (Reverse Proxy)

```bash
apt install nginx -y

# Start Nginx
systemctl start nginx
systemctl enable nginx
```

### 3.9 Configure Firewall

```bash
# Allow SSH, HTTP, HTTPS
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw enable

# Verify
ufw status
```

---

## Step 4: Database Setup

### 4.1 Connect to Database from Droplet

**Note:** Managed PostgreSQL uses SSL connections. You'll need to download the CA certificate.

1. In DigitalOcean, go to your database cluster
2. Click **Settings** → **Trusted Sources**
3. Add your Droplet IP address
4. Go to **Connection Details**
5. Download **CA Certificate** (save as `ca-certificate.crt`)

### 4.2 Upload CA Certificate to Server

**From your local machine:**
```bash
scp ca-certificate.crt root@[your-droplet-ip]:/root/
```

### 4.3 Install PostgreSQL Client (for testing)

```bash
apt install postgresql-client -y
```

### 4.4 Test Database Connection

```bash
psql "host=[database-host] port=25060 dbname=defaultdb user=doadmin sslmode=require sslrootcert=/root/ca-certificate.crt"
```

Enter your database password when prompted.

**If connection successful, type:** `\q` to exit.

### 4.5 Create Application Database

```bash
# Connect to database
psql "host=[database-host] port=25060 dbname=defaultdb user=doadmin sslmode=require sslrootcert=/root/ca-certificate.crt"

# Create database for application
CREATE DATABASE sphair_db;

# Create user (optional, or use doadmin)
CREATE USER sphair_user WITH PASSWORD 'your-secure-password';

# Grant privileges
GRANT ALL PRIVILEGES ON DATABASE sphair_db TO sphair_user;

# Exit
\q
```

**Note down:**
- Database name: `sphair_db`
- Database user: `sphair_user` (or `doadmin`)
- Database password: [your-password]

---

## Step 5: Application Deployment

### 5.1 Clone Repository

```bash
# Create application directory
mkdir -p /opt/sphair
cd /opt/sphair

# Clone your repository
git clone https://github.com/your-username/your-repo.git .

# Or if repository is private, use SSH:
# git clone git@github.com:your-username/your-repo.git .
```

### 5.2 Create Environment File

```bash
# Create .env file
nano .env
```

**Add the following configuration:**

```env
# Server Configuration
NODE_ENV=production
PORT=3001

# Database Configuration
DB_HOST=[your-database-host]
DB_PORT=25060
DB_NAME=sphair_db
DB_USER=sphair_user
DB_PASSWORD=[your-database-password]
DB_SSL=true
DB_SSL_CA=/root/ca-certificate.crt

# Redis Configuration (used by docker-compose for session management)
REDIS_ENABLED=true
REDIS_URL=redis://redis:6379

# Session & Auth Configuration
SESSION_SECRET=[generate-random-string-here]
JWT_SECRET=[generate-random-string-here]

# Platform Service Token (for system owner / internal API calls)
PLATFORM_SERVICE_TOKEN=[generate-random-string-here]

# Application URLs
FRONTEND_URL=https://yourdomain.com
API_URL=https://api.yourdomain.com

# Email Configuration (SendGrid - will configure in Step 6)
SENDGRID_API_KEY=[will-add-later]
SENDGRID_FROM_EMAIL=noreply@yourdomain.com

# File Upload Configuration
UPLOAD_MAX_SIZE=10485760
UPLOAD_DIR=/app/uploads

# Security
ALLOWED_ORIGINS=https://yourdomain.com,https://www.yourdomain.com
```

**Generate random strings for secrets:**
```bash
# Generate SESSION_SECRET
openssl rand -base64 32

# Generate JWT_SECRET
openssl rand -base64 32

# Generate PLATFORM_SERVICE_TOKEN
openssl rand -base64 32
```

**Save and exit:** `Ctrl+X`, then `Y`, then `Enter`

### 5.3 Build Docker Image

```bash
# Build the application
docker-compose build
```

### 5.4 Run Database Migrations

```bash
# Run migrations
docker-compose run --rm app npm run migrate

# Or if you have a setup script:
docker-compose run --rm app npm run setup-db
```

### 5.5 Start Application

```bash
# Start all services
docker-compose up -d

# Check logs
docker-compose logs -f
```

**Wait for application to start (30-60 seconds)**

### 5.6 Verify Application is Running

```bash
# Check if container is running
docker-compose ps

# Test API endpoint
curl http://localhost:3001/api/platform/health
```

**Expected response:**
```json
{"status":"ok","timestamp":"..."}
```

---

## Step 6: Email Service (SendGrid)

### 6.1 Create SendGrid Account

1. Go to https://sendgrid.com
2. Click **Start for Free**
3. Complete registration
4. Verify email address

### 6.2 Verify Sender Identity

1. In SendGrid dashboard, go to **Settings** → **Sender Authentication**
2. Click **Verify a Single Sender**
3. Fill in the form:
   - **From Email:** noreply@yourdomain.com
   - **From Name:** SPHAiR Digital
   - **Reply To:** support@yourdomain.com
   - **Company Address:** Your company address
4. Click **Create**
5. Check your email and click verification link

### 6.3 Create API Key

1. Go to **Settings** → **API Keys**
2. Click **Create API Key**
3. **API Key Name:** `sphair-production`
4. **API Key Permissions:** **Full Access** (or restrict to Mail Send)
5. Click **Create & View**
6. **IMPORTANT:** Copy the API key immediately (you won't see it again)

### 6.4 Update Environment File

```bash
# Edit .env file
nano /opt/sphair/.env

# Add SendGrid API key
SENDGRID_API_KEY=[paste-your-api-key-here]
SENDGRID_FROM_EMAIL=noreply@yourdomain.com

# Save and exit
```

### 6.5 Restart Application

```bash
cd /opt/sphair
docker-compose restart
```

### 6.6 Test Email (Optional)

You can test email functionality by triggering a password reset or using a test endpoint if available.

---

## Step 7: SSL Certificate Setup

### 7.1 Configure Nginx

```bash
# Create Nginx configuration
nano /etc/nginx/sites-available/sphair
```

**Add the following configuration:**

```nginx
server {
    listen 80;
    server_name yourdomain.com www.yourdomain.com;

    # Redirect HTTP to HTTPS
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name yourdomain.com www.yourdomain.com;

    # SSL Certificate (will be obtained via Certbot)
    ssl_certificate /etc/letsencrypt/live/yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/yourdomain.com/privkey.pem;

    # SSL Configuration
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;

    # Security Headers
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;

    # Proxy to Application
    location / {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }

    # Static files (if serving from Nginx)
    location /static/ {
        alias /opt/sphair/client/build/static/;
        expires 1y;
        add_header Cache-Control "public, immutable";
    }
}
```

**Save and exit**

### 7.2 Enable Site

```bash
# Create symbolic link
ln -s /etc/nginx/sites-available/sphair /etc/nginx/sites-enabled/

# Remove default site
rm /etc/nginx/sites-enabled/default

# Test Nginx configuration
nginx -t

# If test passes, reload Nginx
systemctl reload nginx
```

### 7.3 Obtain SSL Certificate

**Note:** Since you're using Cloudflare, you have two options:

**Option A: Use Cloudflare SSL (Recommended - Easier)**
- Cloudflare automatically provides SSL
- No need for Let's Encrypt on server
- Just ensure Cloudflare SSL mode is "Full (strict)"

**Option B: Use Let's Encrypt (More Control)**

```bash
# Obtain certificate
certbot --nginx -d yourdomain.com -d www.yourdomain.com

# Follow prompts:
# - Enter email address
# - Agree to terms
# - Choose whether to redirect HTTP to HTTPS (Yes)

# Test auto-renewal
certbot renew --dry-run
```

### 7.4 Configure Auto-Renewal

```bash
# Certbot automatically sets up renewal
# Verify cron job exists
systemctl status certbot.timer
```

---

## Step 8: Monitoring Setup (Optional)

### 8.1 UptimeRobot (Free Uptime Monitoring)

1. Go to https://uptimerobot.com
2. Sign up for free account
3. Click **Add New Monitor**
4. **Monitor Type:** HTTP(s)
5. **Friendly Name:** SPHAiR Digital
6. **URL:** https://yourdomain.com
7. **Monitoring Interval:** 5 minutes
8. Click **Create Monitor**

**Benefits:**
- Free 50 monitors
- Email alerts when site is down
- Uptime statistics

### 8.2 Sentry (Error Tracking - Optional)

1. Go to https://sentry.io
2. Sign up for free account
3. Create new project
4. Select **Node.js** as platform
5. Follow setup instructions to add Sentry SDK to your application

**Benefits:**
- Free 5,000 events/month
- Error tracking and alerts
- Performance monitoring

---

## Step 9: Final Configuration

### 9.1 Create Initial Admin User

```bash
# Connect to your application container
docker-compose exec app bash

# Run user creation script (if available)
# Or use database directly
psql "host=[database-host] port=25060 dbname=sphair_db user=sphair_user sslmode=require sslrootcert=/root/ca-certificate.crt"

# Create admin user (adjust based on your schema)
INSERT INTO users (username, email, full_name, role, password_hash, is_active, company_id)
VALUES ('admin', 'admin@yourdomain.com', 'System Administrator', 'system_owner', '[hashed-password]', true, '[company-id]');
```

### 9.2 Configure Company Settings

1. Log into your application
2. Go to admin panel
3. Configure:
   - Company name
   - Logo
   - Primary color
   - Contact information

### 9.3 Set Up Backups

```bash
# Create backup script
nano /opt/sphair/backup.sh
```

**Add backup script:**
```bash
#!/bin/bash
DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="/opt/sphair/backups"

# Create backup directory
mkdir -p $BACKUP_DIR

# Backup database
pg_dump "host=[db-host] port=25060 dbname=sphair_db user=sphair_user sslmode=require sslrootcert=/root/ca-certificate.crt" > $BACKUP_DIR/db_$DATE.sql

# Backup uploads
tar -czf $BACKUP_DIR/uploads_$DATE.tar.gz /opt/sphair/server/uploads

# Keep only last 7 days of backups
find $BACKUP_DIR -type f -mtime +7 -delete
```

**Make executable:**
```bash
chmod +x /opt/sphair/backup.sh
```

**Set up cron job:**
```bash
crontab -e

# Add daily backup at 2 AM
0 2 * * * /opt/sphair/backup.sh
```

### 9.4 Configure Log Rotation

```bash
# Configure Docker log rotation
nano /etc/docker/daemon.json
```

**Add:**
```json
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "10m",
    "max-file": "3"
  }
}
```

**Restart Docker:**
```bash
systemctl restart docker
```

---

## Step 10: Testing & Verification

### 10.1 Test Application Access

1. Open browser
2. Navigate to: `https://yourdomain.com`
3. Verify:
   - ✅ Site loads
   - ✅ SSL certificate is valid (green lock)
   - ✅ No mixed content warnings

### 10.2 Test API Endpoints

```bash
# Test health endpoint
curl https://yourdomain.com/api/platform/health

# Test authentication
curl -X POST https://yourdomain.com/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"your-password"}'
```

### 10.3 Test Email Functionality

1. Log into application
2. Trigger password reset
3. Check email inbox
4. Verify email is received

### 10.4 Test File Uploads

1. Log into application
2. Upload a test file (profile picture, document)
3. Verify file is saved
4. Verify file is accessible

### 10.5 Performance Testing

```bash
# Test response time
curl -o /dev/null -s -w "%{time_total}\n" https://yourdomain.com

# Should be < 1 second
```

### 10.6 Security Checklist

- ✅ HTTPS is working (SSL certificate valid)
- ✅ HTTP redirects to HTTPS
- ✅ Security headers are present
- ✅ Database uses SSL connection
- ✅ Environment variables are secure
- ✅ Firewall is configured
- ✅ SSH key authentication only (disable password auth)

---

## Troubleshooting

### Application Not Starting

**Check logs:**
```bash
docker-compose logs -f
```

**Common issues:**
- Database connection failed → Check database credentials
- Port already in use → Check if another service is using port 3001
- Missing environment variables → Check .env file

### Database Connection Issues

**Test connection:**
```bash
psql "host=[db-host] port=25060 dbname=sphair_db user=sphair_user sslmode=require sslrootcert=/root/ca-certificate.crt"
```

**Common issues:**
- Firewall blocking → Add Droplet IP to database trusted sources
- Wrong credentials → Verify username/password
- SSL certificate missing → Download CA certificate from DigitalOcean

### SSL Certificate Issues

**If using Cloudflare:**
- Ensure SSL mode is "Full (strict)"
- Check DNS records are proxied (orange cloud)

**If using Let's Encrypt:**
```bash
# Check certificate status
certbot certificates

# Renew certificate
certbot renew
```

### Email Not Sending

**Check SendGrid:**
1. Verify sender is verified
2. Check API key is correct
3. Check SendGrid activity log

**Test from command line:**
```bash
curl -X POST https://api.sendgrid.com/v3/mail/send \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"personalizations":[{"to":[{"email":"test@example.com"}]}],"from":{"email":"noreply@yourdomain.com"},"subject":"Test","content":[{"type":"text/plain","value":"Test email"}]}'
```

### High Server Load

**Check resource usage:**
```bash
# CPU and memory
htop

# Disk usage
df -h

# Docker resource usage
docker stats
```

**Solutions:**
- Upgrade droplet size
- Optimize database queries
- Enable caching
- Use CDN for static assets

---

## Maintenance & Updates

### Daily Tasks

- ✅ Monitor application logs
- ✅ Check disk space
- ✅ Verify backups are running

### Weekly Tasks

- ✅ Review error logs
- ✅ Check security updates
- ✅ Review system performance

### Monthly Tasks

- ✅ Update system packages
- ✅ Review and optimize database
- ✅ Review costs and usage

### Application Updates (Live Deployment)

Updates can be applied while the system is running. There will be a brief restart (~10-30 seconds) during the `up -d` step while the container swaps. Plan updates during off-hours if possible.

**Method 1: Manual Update (Recommended)**
```bash
cd /opt/sphair

# Pull latest code
git pull origin main

# Build the new image (this does NOT affect the running app)
docker-compose build app

# Swap to the new container (brief ~10-30s restart)
docker-compose up -d app

# Verify the app is healthy
docker-compose ps
docker-compose logs --tail=20 app
```

**Method 2: Automated Update (GitHub Actions)**

Set up CI/CD pipeline to automatically deploy on git push.

### Fresh Clone Deployment (Clean Slate)

Use this when the server has drifted from the repo (manual edits, different branch, or you want a clean state). This ensures the server runs exactly what is in the repository.

**Prerequisites:** You have your `.env` and (if needed) DB connection details and CA cert paths.

**Step 1: Back up what you need**
```bash
cd /opt/sphair
cp .env /root/sphair.env.backup
# If you use bind mounts and care about uploads/logs/backups:
# tar -czf /root/sphair-uploads-backup.tar.gz server/uploads server/logs server/backups 2>/dev/null || true
```

**Step 2: Stop and remove containers**
```bash
cd /opt/sphair
docker-compose down
```

**Step 3: Rename old app directory and clone fresh**
```bash
cd /opt
mv sphair sphair.old
git clone https://github.com/SPHAiRplatform/O-M-MANAGEMENT-SYSTEM.git sphair
cd sphair
```

**Step 4: Restore environment file**
```bash
cp /root/sphair.env.backup /opt/sphair/.env
# Edit if needed (e.g. paths, DB host)
nano .env
```

**Step 5: Start only postgres, redis, and app (skip nginx if host Nginx uses port 80)**
```bash
cd /opt/sphair
docker-compose up -d postgres redis app
```

If you use **host Nginx** (not the compose nginx service) because port 80 is already in use, do **not** run `docker-compose up -d` without arguments. Use the command above.

**Step 6: Run database setup (only if new DB or you need schema/seed)**
```bash
docker-compose run --rm app node scripts/setup-db.js
```

**Step 7: Rebuild app image and restart app (to use latest code)**
```bash
docker-compose build app
docker-compose stop app
docker rm sphairdigital-app
docker-compose up -d postgres redis app
```

**Step 8: Verify**
```bash
docker-compose ps
curl -s http://127.0.0.1:3001/api/platform/health
```

Expected: `{"status":"healthy",...}`. Then open `https://yourdomain.com` in a browser.

**If `docker-compose build app` fails on `npm ci` (server stage):** Edit the Dockerfile and change the server stage line from `RUN npm ci --only=production` to `RUN npm install --only=production`, then run the build again.

### Backup Restoration

**Restore database:**
```bash
psql "host=[db-host] port=25060 dbname=sphair_db user=sphair_user sslmode=require sslrootcert=/root/ca-certificate.crt" < /opt/sphair/backups/db_YYYYMMDD_HHMMSS.sql
```

**Restore uploads:**
```bash
tar -xzf /opt/sphair/backups/uploads_YYYYMMDD_HHMMSS.tar.gz -C /
```

---

## Quick Reference

### Important Commands

```bash
# View application logs
docker-compose logs -f

# Restart application
docker-compose restart

# Stop application
docker-compose down

# Start application
docker-compose up -d

# Access application container
docker-compose exec app bash

# Check application status
docker-compose ps

# View system resources
htop

# Check disk space
df -h

# Check Nginx status
systemctl status nginx

# Reload Nginx
systemctl reload nginx
```

### Important Files

- `/opt/sphair/.env` - Environment variables
- `/opt/sphair/docker-compose.yml` - Docker configuration
- `/etc/nginx/sites-available/sphair` - Nginx configuration
- `/opt/sphair/backups/` - Backup directory

### Important URLs

- Application: `https://yourdomain.com`
- API: `https://yourdomain.com/api`
- DigitalOcean Dashboard: https://cloud.digitalocean.com
- Cloudflare Dashboard: https://dash.cloudflare.com
- SendGrid Dashboard: https://app.sendgrid.com

---

## Cost Summary

**Monthly Costs:**
- DigitalOcean Droplet: $24
- Managed PostgreSQL: $15
- Spaces Storage: $5
- Domain: $1 (annual cost / 12)
- **Total: ~$45/month**

**Optional Services (Free Tiers Available):**
- Cloudflare: Free
- SendGrid: Free (100 emails/day)
- UptimeRobot: Free (50 monitors)
- Sentry: Free (5,000 events/month)

**Total Estimated Cost: $45-50/month**

---

## Next Steps

1. ✅ **Test all functionality** - Ensure everything works
2. ✅ **Set up monitoring** - Configure UptimeRobot and Sentry
3. ✅ **Create user documentation** - Guide for end users
4. ✅ **Set up support system** - Configure Zendesk (optional)
5. ✅ **Plan for scaling** - Prepare for growth

---

## Support Resources

- **DigitalOcean Documentation:** https://docs.digitalocean.com
- **Cloudflare Documentation:** https://developers.cloudflare.com
- **SendGrid Documentation:** https://docs.sendgrid.com
- **Docker Documentation:** https://docs.docker.com
- **Nginx Documentation:** https://nginx.org/en/docs/

---

## Recent Updates

**Version 1.1 (February 2026):**
- ✅ Calendar component now automatically displays the current month on load
- ✅ Updated cost estimates to reflect actual monthly pricing
- ✅ Consolidated all deployment information into this single comprehensive guide

**Document Version:** 1.1  
**Last Updated:** February 2026  
**Status:** Complete Deployment Guide for Single Company
