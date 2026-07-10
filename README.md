# QuickBase Webhook Server
Generates Simplifile CSV and RevSprings Companion File automatically
when sub tax figures are updated in QuickBase, and emails both files
to servicing@certaincapital.com.

## Files
- server.js     — main webhook server
- package.json  — dependencies
- render.yaml   — Render deployment config

## Setup Steps (see full guide document for detailed walkthrough)

### 1. GitHub
- Create a free account at github.com
- Create a new repository called qb-webhook
- Upload all three files

### 2. Render
- Create a free account at render.com
- Connect your GitHub repository
- Set environment variables:
  - QB_USER_TOKEN  — your QuickBase user token
  - SENDGRID_KEY   — your SendGrid API key
  - FROM_EMAIL     — verified sender email in SendGrid

### 3. SendGrid
- Create a free account at sendgrid.com
- Verify your sender email address
- Generate an API key

### 4. QuickBase Pipeline
- Trigger: When any of fields 76, 77, 78, 132, 79 are updated
           AND field 8 = New Jersey
- Action:  HTTP POST to https://your-render-url.onrender.com/webhook

## Endpoints
- POST /webhook  — triggered by QuickBase Pipeline
- GET  /health   — confirms server is running
