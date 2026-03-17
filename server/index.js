require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "../public")));

// Gemini client — API key stays server-side only
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Health check
app.get("/api/health", (req, res) => {
  const keySet =
    !!process.env.GEMINI_API_KEY &&
    process.env.GEMINI_API_KEY !== "your_gemini_api_key_here";
  res.json({ status: "ok", apiKeySet: keySet });
});

// Main resume generation endpoint
app.post("/api/generate", async (req, res) => {
  const { profile, jd } = req.body;

  if (!profile || !jd) {
    return res
      .status(400)
      .json({ error: "Both profile and job description are required." });
  }

  if (
    !process.env.GEMINI_API_KEY ||
    process.env.GEMINI_API_KEY === "your_gemini_api_key_here"
  ) {
    return res
      .status(500)
      .json({
        error: "API key not configured. Please add it to your .env file.",
      });
  }

  try {
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

    const CANDIDATE_SKILLS = {
      languages: "Python, JavaScript, Typescript, C++, Terraform, Bash, SQL, CSS, HTML, Kubectl",
      technologies: "AWS, React.js, Node.js, Langchain and Langraph, crew-ai, flowise, N8N, End-to-End SDLC, troubleshooting, LLD, HLD, Data structure and Algorithm, Docker, Kubernetes, MongoDB, Jenkins CICD, Harness CICD, Linux, AWS Lambda, S3, SNS, SQS, DocumentDB, Aurora, Elasticache-Redis, EKS, Cloudwatch, Terraform, Ansible, Dynatrace, Splunk, Serverless functions, Disaster recovery architecture"
    };

    const prompt = `You are an expert ATS resume coach. Tailor the candidate's experience and projects for the job description, and reorder their skills by relevance.

CANDIDATE PROFILE:
${profile}

JOB DESCRIPTION:
${jd}

CANDIDATE'S EXISTING SKILLS:
Languages: ${CANDIDATE_SKILLS.languages}
Technologies: ${CANDIDATE_SKILLS.technologies}

RULES:
- Do NOT use any markdown formatting (no **, no *, no #) in any text field. Plain text only.
- Do NOT mention awards, certifications, or recognition in Experience bullets. Those are in a separate section. Focus only on technical work, tools used, and measurable impact.
- For skills: include ALL of the candidate's existing skills PLUS any additional exact-keyword skills from the JD that are not already in the list. Put JD-relevant skills first, then the rest.
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

    const result = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        maxOutputTokens: 8192,
        responseMimeType: 'application/json'
      }
    });
    const raw = result.response.text();
    const parsed = JSON.parse(raw);

    res.json(parsed);
  } catch (err) {
    console.error("Gemini API error:", err.message);
    res
      .status(500)
      .json({ error: "Failed to generate resume. " + err.message });
  }
});

// Catch-all: serve frontend
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "../public/index.html"));
});

app.listen(PORT, () => {
  console.log(`\n✅ resume.ai running at http://localhost:${PORT}`);
  console.log(
    `   API key set: ${!!process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== "your_gemini_api_key_here" ? "✓" : "✗ — add it to .env"}\n`,
  );
});
