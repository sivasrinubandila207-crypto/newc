# InsightDocs AI — Netlify Deployment

RAG-Powered Multi-Document Knowledge Assistant. Upload PDFs and ask questions about them.

## Deploy to Netlify

### Step 1 — Install dependencies
```
npm install
```

### Step 2 — Deploy to Netlify
1. Go to https://netlify.com and create a free account
2. Drag and drop this entire folder onto the Netlify dashboard
   OR connect your GitHub repo

### Step 3 — Add your API key
1. In Netlify dashboard → Site settings → Environment variables
2. Add: `ANTHROPIC_API_KEY` = your key from https://console.anthropic.com

### Step 4 — Done!
Your site is live. Upload any PDF and start chatting.

## Local Development
```
npm install -g netlify-cli
netlify dev
```
Then open http://localhost:8888
