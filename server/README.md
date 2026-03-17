# server/index.js — Backend Reference

Express server that proxies requests to the Google Gemini API and serves the frontend.

---

## Overview

The server has three responsibilities:

1. **Serve the frontend** — serves `public/index.html` as a static file for all non-API routes
2. **Proxy Gemini API calls** — keeps the API key server-side and handles prompt construction
3. **Validate requests** — checks inputs and API key configuration before calling Gemini

---

## Endpoints

### `GET /api/health`

Lightweight check used by the frontend on page load to determine whether the API key is configured.

**Response:**
```json
{ "status": "ok", "apiKeySet": true }
```

`apiKeySet` is `false` if `GEMINI_API_KEY` is unset or still equals `"your_gemini_api_key_here"`.

---

### `POST /api/generate`

Main endpoint. Accepts a candidate profile and job description, calls Gemini 2.0 Flash, and returns a tailored resume plus ATS analysis.

**Request body:**
```json
{
  "profile": "Candidate's master resume/profile as plain text",
  "jd": "Full job description text"
}
```

Both fields are required.

**Success response (200):**
```json
{
  "ats_score": 82,
  "score_reason": "Two-sentence explanation of why this score was given.",
  "matched_keywords": ["keyword1", "keyword2"],
  "missing_keywords": ["keyword1", "keyword2"],
  "recommendations": "• Bullet 1\n• Bullet 2\n• Bullet 3",
  "resume": "Full tailored resume as plain text..."
}
```

**Error responses:**

| HTTP Status | Trigger | Error message |
|---|---|---|
| `400` | `profile` or `jd` missing | `"Both profile and job description are required."` |
| `500` | API key missing or placeholder | `"API key not configured. Please add it to your .env file."` |
| `500` | Gemini SDK throws | `"Failed to generate resume. <original error message>"` |

---

### `GET *` (catch-all)

Serves `public/index.html` for all other GET requests.

---

## Gemini Integration

**Model:** `gemini-2.0-flash`

The prompt is a single string combining the candidate profile and job description. The model is instructed to return **only a raw JSON object** (no markdown fences) matching the response shape above.

After receiving the response, the server:
1. Reads the content: `result.response.text()`
2. Strips any accidental markdown fences: `.replace(/```json|```/g, '').trim()`
3. Parses with `JSON.parse()` — if this throws, the 500 error handler catches it

The parsed object is sent directly to the client.

---

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `GEMINI_API_KEY` | Yes | — | Gemini API key from aistudio.google.com; must not be the placeholder string |
| `PORT` | No | `3000` | Port the server binds to |

Variables are loaded from `.env` via `dotenv` at startup.

---

## Error Handling

- **Missing inputs (400):** Checked before the Gemini call to avoid unnecessary API usage.
- **Unconfigured API key (500):** Checked on every `/api/generate` request so the server can run and serve the frontend even without a key.
- **Gemini errors (500):** Caught by `try/catch`; original error message is forwarded to the client and logged to `stderr`.
- **JSON parse failure:** Falls into the same `catch` block as Gemini errors.

---

## Extending the Server

**Add a new endpoint:**
Add an `app.get()` or `app.post()` route before the catch-all `app.get('*', ...)` at the bottom of `index.js`.

**Change the model:**
Edit the `model` field in `genAI.getGenerativeModel({ model: '...' })`. Available models: `gemini-2.0-flash`, `gemini-1.5-pro`, `gemini-1.5-flash`.

**Change the response shape:**
Modify the JSON structure described in the prompt string, then update the frontend's `renderOutput()` function in `public/index.html` to match.

**Add streaming:**
Replace `model.generateContent(prompt)` with `model.generateContentStream(prompt)` and pipe chunks to the client using `res.write()` with `Transfer-Encoding: chunked`.
