require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const path = require("path");
const db = require("./db");

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "../public")));

// Gemini client — API key stays server-side only
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Gemini occasionally returns transient 503 ("high demand") / 429 (rate limit)
// errors, or — since 2.5 Flash spends part of maxOutputTokens on internal
// "thinking" before the actual answer — gets cut off mid-JSON on longer
// thinking passes, which surfaces as a JSON.parse SyntaxError. Retry the
// whole call+parse unit a couple of times with backoff on either failure
// mode, so the user isn't the one manually retrying on a blip.
async function generateWithRetry(fn, maxRetries = 2) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const transient =
        err instanceof SyntaxError || /\b(429|500|503)\b/.test(err.message || "");
      if (!transient || attempt === maxRetries) throw err;
      const delay = 1000 * Math.pow(2, attempt);
      console.warn(
        `Gemini call failed (attempt ${attempt + 1}/${maxRetries + 1}), retrying in ${delay}ms: ${err.message}`,
      );
      await new Promise((r) => setTimeout(r, delay));
    }
  }
}

// Health check
app.get("/api/health", (req, res) => {
  const keySet =
    !!process.env.GEMINI_API_KEY &&
    process.env.GEMINI_API_KEY !== "your_gemini_api_key_here";
  res.json({ status: "ok", apiKeySet: keySet });
});

// Main resume generation endpoint
app.post("/api/generate", async (req, res) => {
  const { jd, company, jobTitle, jobId } = req.body;
  const { master_profile: profile } = await db.getProfile();

  if (!profile) {
    return res
      .status(400)
      .json({ error: "Please save your profile in the Profile tab before generating." });
  }

  if (!jd) {
    return res.status(400).json({ error: "A job description is required." });
  }

  if (
    !process.env.GEMINI_API_KEY ||
    process.env.GEMINI_API_KEY === "your_gemini_api_key_here"
  ) {
    return res.status(500).json({
      error: "API key not configured. Please add it to your .env file.",
    });
  }

  try {
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

    const prompt = `You are an expert ATS resume coach. Tailor the candidate's experience and projects for the job description, and reorder their skills by relevance.

CANDIDATE PROFILE:
${profile}

JOB DESCRIPTION:
${jd}

RULES:
- Do NOT use any markdown formatting (no **, no *, no #) in any text field. Plain text only.
- Do NOT mention awards, certifications, or recognition in Experience bullets. Those are in a separate section. Focus only on technical work, tools used, and measurable impact.
- For skills: Include ALL skills from the candidate profile PLUS any additional exact-keyword skills from the JD not already listed. Put JD-relevant skills first, then the rest.
- EXPERIENCE BULLETS: Add 1-2 new bullets at the TOP of the experience list that highlight JD-relevant skills the candidate genuinely has — infer these from their skills list and projects (e.g. if they have LangChain/LangGraph/RAG in skills and built an RAG project, a bullet about building LLM/agent systems is valid and honest). Then include ALL existing profile bullets below, with their original meaning, tools, and metrics kept intact. Do NOT modify existing bullets just to inject JD keywords.
- PROJECTS: ALWAYS include every project from the candidate profile. Never drop any project. Tailor each description to emphasize JD-relevant aspects where possible, but all projects must appear.

Respond with ONLY a valid JSON object (no markdown, no backticks) with this exact structure:
{
  "ats_score": <number 0-100>,
  "score_reason": "<2 sentence explanation>",
  "matched_keywords": ["keyword1", "keyword2"],
  "missing_keywords": ["keyword1", "keyword2"],
  "recommendations": "<3-5 bullet recommendations each starting with •, separated by newlines>",
  "experience": [
    {
      "org": "<company name>",
      "location": "<city, state>",
      "role": "<job title>",
      "dates": "<start – end>",
      "bullets": [
        { "title": "<bold keyword from JD>", "desc": "<description using JD terminology, strong action verb, metric>" }
      ]
    }
  ],
  "projects": [
    { "title": "<project name>", "desc": "<tailored description highlighting JD-relevant aspects>" }
  ],
  "skills": [
    { "label": "Languages", "value": "<JD-relevant languages first, then all candidate languages, plus any JD-specific language keywords not already listed>" },
    { "label": "Technologies", "value": "<JD-relevant technologies first, then all candidate technologies, plus any JD-specific technology keywords not already listed>" }
  ]
}`;

    const parsed = await generateWithRetry(async () => {
      const result = await model.generateContent({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          maxOutputTokens: 8192,
          responseMimeType: "application/json",
        },
      });
      return JSON.parse(result.response.text());
    });

    try {
      await db.upsertResume({ company, jobTitle, jobId, profile, jd, resumeData: parsed });
    } catch (dbErr) {
      console.error("History write error (resume):", dbErr.message);
    }

    res.json(parsed);
  } catch (err) {
    console.error("Gemini API error:", err.message);
    res
      .status(500)
      .json({ error: "Failed to generate resume. " + err.message });
  }
});

// Cover letter generation endpoint
app.post("/api/generate-cover-letter", async (req, res) => {
  const { jd, company, jobTitle, jobId, recruiterName, recruiterTitle } = req.body;
  const { master_profile: profile } = await db.getProfile();

  if (!profile) {
    return res
      .status(400)
      .json({ error: "Please save your profile in the Profile tab before generating." });
  }

  if (!jd) {
    return res.status(400).json({ error: "A job description is required." });
  }

  if (
    !process.env.GEMINI_API_KEY ||
    process.env.GEMINI_API_KEY === "your_gemini_api_key_here"
  ) {
    return res.status(500).json({
      error: "API key not configured. Please add it to your .env file.",
    });
  }

  try {
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

    const prompt = `You are an expert career coach writing a tailored, ATS-friendly cover letter body.

CANDIDATE PROFILE:
${profile}

JOB DESCRIPTION:
${jd}

RECIPIENT:
- Recruiter name: ${recruiterName || "Hiring Manager"}
- Recruiter title: ${recruiterTitle || "(not provided)"}
- Company: ${company || "(not provided)"}
- Role: ${jobTitle || "(not provided)"}

RULES:
- Do NOT use any markdown formatting (no **, no *, no #, no bullet points). Plain prose paragraphs only.
- Do NOT include a salutation ("Dear ...") or a sign-off ("Sincerely, ..."). Those are added separately — respond with ONLY the body paragraphs.
- Write 3-4 short paragraphs, ~250-400 words total, sized to fit one page.
- Do NOT quote, paraphrase, or reuse the job description's own marketing language, mission statements, taglines, or buzzwords back at the company (e.g. if the JD talks about "inflection points," "frontier models," or "quantifiable outcomes," do not repeat those phrases). This includes generic-sounding phrases lifted straight from the JD, like "complex business challenges" — if a 3+ word phrase appears in the JD, do not reuse it verbatim even if it sounds like ordinary English. Write in the candidate's own voice about their own work, not the company's about itself.
- NEVER use any of these exact words/phrases anywhere in the letter, in any form: "Furthermore", "In addition", "Additionally", "Moreover", "align" / "aligns" / "alignment", "leverage" / "leveraging", "demonstrates" / "highlights my" / "reflects" / "showcases", "eager" / "excited", "passionate", "confident that", "perfect fit", "proven track record", "significant impact", "drive success", "mission" (when referring to the company's mission). If a sentence needs one of these to make sense, rewrite the sentence around a concrete detail instead — do not substitute a synonym that means the same thing.
- Do NOT explicitly state that an accomplishment is relevant, e.g. "this shows I can..." or "this experience prepares me to...". Describe the work concretely and stop the sentence there — do not add a trailing clause explaining why it matters. Trust the reader to connect it themselves.
- Ground every claim in one concrete detail already in the candidate profile — a real tool, a real number, a real project name. No paragraph should end on a vague, generic claim with no specific detail in it.
- Vary sentence openings and structure across paragraphs — do not repeat the same "During my time at X, I did Y, resulting in Z" shape more than once.
- Paragraph 1: open with something specific and concrete from the candidate's background — not a restatement of the job title or the company's mission.
- Paragraph 2-3: cite 2-3 concrete, truthful qualifications/achievements pulled from the candidate profile, using JD terminology only where it fits naturally. Do not invent employers, titles, or metrics not present in the profile.
- Final paragraph: 2-3 sentences. State one specific, genuine reason the role itself is interesting (not the company's mission/vision/focus — the reader already knows what their own company does), and stop. No generic enthusiasm language, no restating the company's self-description.
- Separate paragraphs with a blank line (\\n\\n).

Respond with ONLY a valid JSON object (no markdown, no backticks) with this exact structure:
{ "letter_body": "<paragraph text with \\n\\n between paragraphs>" }`;

    const parsed = await generateWithRetry(async () => {
      const result = await model.generateContent({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          maxOutputTokens: 4096,
          responseMimeType: "application/json",
        },
      });
      return JSON.parse(result.response.text());
    });

    try {
      await db.upsertCoverLetter({
        company,
        jobTitle,
        jobId,
        profile,
        jd,
        recruiterName,
        recruiterTitle,
        letterBody: parsed.letter_body,
      });
    } catch (dbErr) {
      console.error("History write error (cover letter):", dbErr.message);
    }

    res.json(parsed);
  } catch (err) {
    console.error("Gemini API error (cover letter):", err.message);
    res
      .status(500)
      .json({ error: "Failed to generate cover letter. " + err.message });
  }
});

// Application history endpoints
app.get("/api/history", async (req, res) => {
  res.json({ applications: await db.listApplications() });
});

app.get("/api/history/:id", async (req, res) => {
  const app_ = await db.getApplication(req.params.id);
  if (!app_) return res.status(404).json({ error: "Not found" });
  res.json(app_);
});

app.patch("/api/history/:id", async (req, res) => {
  const { status, notes } = req.body;
  try {
    const updated = await db.updateApplication(req.params.id, { status, notes });
    if (!updated) return res.status(404).json({ error: "Not found" });
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Profile settings endpoints
app.get("/api/profile", async (req, res) => {
  res.json(await db.getProfile());
});

app.put("/api/profile", async (req, res) => {
  const { name, email, phone, linkedin, education, awards, master_profile } = req.body;
  await db.saveProfile({
    name,
    email,
    phone,
    linkedin,
    education,
    awards,
    masterProfile: master_profile,
  });
  res.json({ ok: true });
});

// Catch-all: serve frontend
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "../public/index.html"));
});

db.initDb()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`\n✅ resume.ai running at http://localhost:${PORT}`);
      console.log(
        `   API key set: ${!!process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== "your_gemini_api_key_here" ? "✓" : "✗ — add it to .env"}\n`,
      );
    });
  })
  .catch((err) => {
    console.error("Failed to initialize database:", err.message);
    process.exit(1);
  });
