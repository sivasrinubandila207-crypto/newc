# Deployment Guide — Netlify & Render

This project is configured with dual-compatibility:
- **Netlify**: Serverless hosting for the static frontend and serverless backend functions (zero-cold-start backend, easy configuration).
- **Render**: Dedicated Node.js hosting (runs the entire app as a monolith using `server.js`).
- **Hybrid (Netlify + Render)**: Host frontend on Netlify's ultra-fast CDN, and backend on Render's persistent Express server.

---

## Option 1: Full Netlify Deployment (Recommended)
This hosts both the static files (from `frontend/`) and the APIs (from `backend/` as Netlify serverless functions) under a single domain.

### Steps
1. Connect your repository to **Netlify**.
2. Netlify will automatically detect the configuration in `netlify.toml`:
   - **Publish directory**: `frontend`
   - **Functions directory**: `backend`
3. Add the following environment variables in the Netlify site settings (**Site Configuration > Environment variables**):
   - `MONGO_URI`: Your direct MongoDB Atlas connection string.
   - `GROQ_API_KEY`: Your Groq Cloud API key.
   - `JWT_SECRET`: A secure random string for JWT token generation.
4. Click **Deploy site**. Both your frontend and backend functions will be live!

---

## Option 2: Full Render Deployment
This runs the entire app (frontend assets + backend routing) as a standard Express monolith service.

### Steps
1. Create a new **Web Service** on **Render**.
2. Connect your Git repository.
3. Configure the following settings:
   - **Runtime**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start` (This launches the Express server inside `server.js`)
 4. Add the following environment variables under **Environment**:
    - `PORT`: `8888` (or leave empty, Render overrides this automatically)
    - `MONGO_URI`: Your direct MongoDB Atlas connection string.
    - `GROQ_API_KEY`: Your Groq Cloud API key.
    - `JWT_SECRET`: A secure random string for JWT token generation.
    - `BREVO_API_KEY`: Your Brevo SMTP API Key.
    - `EMAIL_FROM`: Your authorized sender email address in Brevo.
    - *Note: Email delivery is performed via Brevo's HTTP API over standard HTTPS port 443, bypassing Render's default outbound SMTP port blocks (25, 465, 587) entirely and ensuring reliable delivery.*
 5. Click **Deploy**. Render will build and host the app under your Render domain name.

---

## Option 3: Hybrid Deployment (Netlify Frontend + Render Backend)
Best of both worlds: Netlify's CDN speeds up frontend assets, while Render hosts the Express backend.

### Step 1: Deploy Backend to Render
1. Deploy the backend to **Render** following **Option 2**.
2. Note your Render URL, e.g., `https://pdf-chat-api.onrender.com`.

### Step 2: Configure Netlify redirects
Modify your `netlify.toml` redirects section to proxy requests from Netlify to your Render backend to avoid CORS:

```toml
[build]
  publish = "frontend"

[[redirects]]
  from = "/api/*"
  to = "https://your-render-backend-url.onrender.com/api/:splat"
  status = 200
  force = true
```

### Step 3: Deploy Frontend to Netlify
1. Connect the repository to Netlify.
2. Netlify will deploy the static assets under `frontend/` and proxy `/api/*` requests directly to Render.
3. **No environment variables are needed on Netlify** in this case, only on Render!
