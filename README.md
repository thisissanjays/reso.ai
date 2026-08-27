# resume.ai — ATS Resume Builder

A local Node.js + Express app that tailors your resume to any job description using Google Gemini, with ATS (Applicant Tracking System) keyword analysis and scoring.

---

## Features

- **AI-powered resume tailoring** — rewrites your resume bullets using the exact terminology from the job description
- **ATS match score** — 0–100 score with a plain-English explanation
- **Keyword analysis** — shows matched and missing keywords at a glance
- **Actionable recommendations** — 3–5 specific suggestions to improve your ATS ranking
- **PDF export** — download the tailored resume as a PDF
- **Copy to clipboard** — one-click copy of the plain-text resume
- **API key stays server-side** — your Gemini key is never exposed to the browser

---

## Prerequisites

- [Node.js](https://nodejs.org/) v16 or higher
- npm (comes with Node.js)
- A [Gemini API key](https://aistudio.google.com/app/apikey) (free tier available)

---

## Quick Start

### 1. Install dependencies
```bash
npm install
```

### 2. Add your Gemini API key
Open `.env` and replace the placeholder:
```
GEMINI_API_KEY=AIzaSy...
```
Get your free key from: https://aistudio.google.com/app/apikey

### 3. Start the server
```bash
npm start
```
Expected output:
```
✅ resume.ai running at http://localhost:3000
   API key set: ✓
```

### 4. Open in your browser
Navigate to: http://localhost:3000

---

## Usage Guide

1. **Edit your profile** — your master candidate profile is pre-loaded in the left panel. Edit it to match your actual experience, skills, and background.
2. **Paste a job description** — copy any job posting into the bottom-left field.
3. **Click "Generate Tailored Resume"** — the app sends both to Gemini and waits for the analysis.
4. **View the Resume tab** — your tailored, ATS-safe resume appears on the right.
5. **View the ATS Analysis tab** — see your score, matched keywords (green), missing keywords (red), and recommendations.
6. **Export** — click **Download PDF** or **Copy to Clipboard**.

---

## Configuration

| Variable | Required | Default | Description |
|---|---|---|---|
| `GEMINI_API_KEY` | Yes | — | Your Gemini API key from aistudio.google.com |
| `PORT` | No | `3000` | Port the Express server listens on |
| `TURSO_DATABASE_URL` | No (production only) | — | Hosted libSQL/Turso database URL. If unset, falls back to a local SQLite file at `data/history.db` — fine for local dev, but **required on hosts with an ephemeral filesystem (e.g. Render's free tier)**, since local files don't survive a redeploy/restart there. |
| `TURSO_AUTH_TOKEN` | No (production only) | — | Auth token for the Turso database above. Required whenever `TURSO_DATABASE_URL` is set. |

---

## API Reference

### `GET /api/health`

Returns server status and whether the API key is configured.

**Response:**
```json
{
  "status": "ok",
  "apiKeySet": true
}
```

`apiKeySet` is `false` if the key is missing or still set to the placeholder value. The frontend displays a warning banner in this case.

---

### `POST /api/generate`

Generates a tailored resume and ATS analysis using Gemini 2.0 Flash.

**Request body:**
```json
{
  "profile": "Your master candidate profile text...",
  "jd": "The full job description text..."
}
```

**Success response (200):**
```json
{
  "ats_score": 82,
  "score_reason": "Your experience closely matches the core requirements. Two key technical skills from the JD are absent from your profile.",
  "matched_keywords": ["TypeScript", "CI/CD", "REST APIs", "Agile"],
  "missing_keywords": ["Kubernetes", "GraphQL"],
  "recommendations": "• Add Kubernetes experience or coursework to Skills section\n• Mention GraphQL in any relevant project descriptions\n• Quantify the impact of your CI/CD pipeline improvements",
  "resume": "JANE DOE\njane@email.com | linkedin.com/in/janedoe\n\nSUMMARY\n..."
}
```

**Error responses:**

| Status | Condition | Body |
|---|---|---|
| `400` | `profile` or `jd` missing from request | `{ "error": "Both profile and job description are required." }` |
| `500` | API key not set or still placeholder | `{ "error": "API key not configured. Please add it to your .env file." }` |
| `500` | Gemini API call failed | `{ "error": "Failed to generate resume. <message>" }` |

---

## Project Structure

```
resume-ai/
├── server/
│   ├── index.js        # Express server — API endpoints + Gemini integration
│   └── README.md       # Backend developer documentation
├── public/
│   └── index.html      # Full frontend (HTML + CSS + vanilla JS, single file)
├── .env                # API key and port — never commit this
├── .gitignore          # Excludes node_modules/ and .env
├── package.json        # Dependencies and npm scripts
└── README.md           # This file
```

---

## Tech Stack

| Layer | Technology | Version |
|---|---|---|
| Runtime | Node.js | 16+ |
| Web framework | Express | ^4.18.2 |
| AI model | Gemini 2.0 Flash (`gemini-2.0-flash`) | — |
| Gemini SDK | `@google/generative-ai` | ^0.21.0 |
| CORS | `cors` | ^2.8.5 |
| Environment config | `dotenv` | ^16.3.1 |
| PDF export | html2pdf.js (CDN) | 0.10.1 |
| Dev auto-restart | nodemon | ^3.0.1 |

---

## Development

Run with auto-restart on file changes:
```bash
npm run dev
```

**To change the pre-loaded candidate profile:**
Edit the `value` attribute of the `<textarea id="profile">` element in [public/index.html](public/index.html).

**To modify the prompt:**
Edit the `prompt` string inside the `app.post('/api/generate', ...)` handler in [server/index.js](server/index.js). The prompt instructs Gemini to return a specific JSON structure — if you change the response shape, update the frontend's `renderOutput()` function accordingly.

---

## Security Notes

- The `GEMINI_API_KEY` is loaded server-side only via `dotenv` and is **never sent to the browser**.
- `.env` is listed in `.gitignore` — do not remove this entry or commit the file.
- The `/api/generate` endpoint validates the API key on every request before calling Gemini.

---

## Troubleshooting

**"API key not configured" banner appears on load**
- Open `.env` and confirm `GEMINI_API_KEY` is set to your actual key (not `your_gemini_api_key_here`).
- Restart the server after editing `.env`.

**Port 3000 already in use**
- Add `PORT=3001` (or any free port) to your `.env` file and restart.

**"Failed to generate resume" error**
- Check the server terminal for the full error from Gemini.
- Verify your API key is valid at https://aistudio.google.com/app/apikey.

**Resume output is empty or malformed**
- Gemini occasionally returns malformed JSON. Retry — this is transient.
- If it happens consistently, check whether the response is being truncated.
