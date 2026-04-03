# SPHAiRDigital Marketing Website

This is the marketing website for SPHAiRDigital, a professional centralized digital O&M system for solar power plant maintenance operations.

## Structure

- **sphairdigital.com** → Marketing website (this folder)
- **sphairdigital.com/app** → Actual software application

## Pages

- **index.html** - Main landing page with hero, about, features, services, and CTA sections
- **pricing.html** - Pricing and subscription plans page

## Preview Locally

### Option 1: Node.js Server (Recommended)

```bash
cd Sphair
node server.js
```

Then open http://localhost:8081 in your browser.

**Note:** The server uses port 8081 by default. If you need a different port, set the PORT environment variable:
```bash
PORT=8082 node server.js
```

### Option 2: Python HTTP Server

```bash
cd Sphair
python -m http.server 8081
```

Then open http://localhost:8081 in your browser.

### Option 3: VS Code Live Server

If you have the Live Server extension in VS Code:
1. Right-click on `index.html`
2. Select "Open with Live Server"

## Features

- **Simplified Design**: Clean, focused layout without unnecessary sections
- **Responsive**: Works on all devices (mobile, tablet, desktop)
- **Fast Loading**: Optimized images and assets
- **SEO Friendly**: Proper meta tags and semantic HTML

## Content

The website focuses on:
- SPHAiRDigital's value proposition
- Key features (Dynamic Checklists, Automated CM Generation, Audit Trails, etc.)
- Services (PM, CM, Plant Map, Inventory, etc.)
- Pricing plans (Starter, Professional, Enterprise)
- Clear CTAs to launch the app or view pricing

## Images

Images are loaded from Unsplash (via direct URLs) for:
- Solar power plant imagery
- Maintenance operations
- Professional visuals

## Notes

- No backend required - this is a static marketing site
- All links to `/app` will need to be configured in production to point to the actual application
- Contact form functionality can be added later if needed
