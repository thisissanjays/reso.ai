const { createClient } = require("@libsql/client");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

// Uses a hosted Turso (libSQL) database when TURSO_DATABASE_URL is set —
// required in production, since Render's free tier has no persistent disk
// and wipes local files on every restart/deploy. Falls back to a local
// SQLite file for local development so no Turso account is needed to run
// this app on your own machine.
let url = process.env.TURSO_DATABASE_URL;
let authToken = process.env.TURSO_AUTH_TOKEN;
if (!url) {
  const dataDir = path.join(__dirname, "../data");
  fs.mkdirSync(dataDir, { recursive: true });
  url = `file:${path.join(dataDir, "history.db")}`;
}

const client = createClient({ url, authToken });

const STATUS_VALUES = [
  "Draft",
  "Applied",
  "Shortlisted",
  "Interview",
  "Offer",
  "Rejected",
];

async function initDb() {
  await client.executeMultiple(`
    CREATE TABLE IF NOT EXISTS applications (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      dedupe_key         TEXT NOT NULL UNIQUE,
      company            TEXT NOT NULL DEFAULT '',
      job_title          TEXT NOT NULL DEFAULT '',
      job_id             TEXT NOT NULL DEFAULT '',
      status             TEXT NOT NULL DEFAULT 'Draft'
                           CHECK (status IN ('Draft','Applied','Shortlisted','Interview','Offer','Rejected')),
      notes              TEXT NOT NULL DEFAULT '',
      profile_snapshot   TEXT,
      jd_snapshot        TEXT,
      recruiter_name     TEXT,
      recruiter_title    TEXT,
      resume_json        TEXT,
      resume_ats_score   INTEGER,
      cover_letter_body  TEXT,
      created_at         TEXT NOT NULL,
      updated_at         TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_applications_updated_at ON applications(updated_at DESC);

    CREATE TABLE IF NOT EXISTS profile_settings (
      id               INTEGER PRIMARY KEY CHECK (id = 1),
      name             TEXT NOT NULL DEFAULT '',
      email            TEXT NOT NULL DEFAULT '',
      phone            TEXT NOT NULL DEFAULT '',
      linkedin         TEXT NOT NULL DEFAULT '',
      education_json   TEXT NOT NULL DEFAULT '[]',
      awards_json      TEXT NOT NULL DEFAULT '[]',
      master_profile   TEXT NOT NULL DEFAULT '',
      updated_at       TEXT NOT NULL
    );
  `);
}

function normalize(s) {
  return String(s || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function computeDedupeKey({ company, jobTitle, jobId }) {
  const c = normalize(company);
  const t = normalize(jobTitle);
  const j = normalize(jobId);
  if (!c && !t && !j) {
    return `blank:${Date.now()}:${crypto.randomBytes(4).toString("hex")}`;
  }
  return `${c}::${t}::${j}`;
}

async function upsertResume({ company, jobTitle, jobId, profile, jd, resumeData }) {
  const dedupeKey = computeDedupeKey({ company, jobTitle, jobId });
  const now = new Date().toISOString();
  await client.execute({
    sql: `
      INSERT INTO applications
        (dedupe_key, company, job_title, job_id, status, notes,
         profile_snapshot, jd_snapshot, resume_json, resume_ats_score, created_at, updated_at)
      VALUES
        (@dedupeKey, @company, @jobTitle, @jobId, 'Draft', '',
         @profileSnapshot, @jdSnapshot, @resumeJson, @atsScore, @now, @now)
      ON CONFLICT(dedupe_key) DO UPDATE SET
        company = excluded.company,
        job_title = excluded.job_title,
        job_id = excluded.job_id,
        profile_snapshot = excluded.profile_snapshot,
        jd_snapshot = excluded.jd_snapshot,
        resume_json = excluded.resume_json,
        resume_ats_score = excluded.resume_ats_score,
        updated_at = excluded.updated_at
    `,
    args: {
      dedupeKey,
      company: company || "",
      jobTitle: jobTitle || "",
      jobId: jobId || "",
      profileSnapshot: profile || "",
      jdSnapshot: jd || "",
      resumeJson: JSON.stringify(resumeData),
      atsScore: resumeData && typeof resumeData.ats_score === "number" ? resumeData.ats_score : null,
      now,
    },
  });
}

async function upsertCoverLetter({
  company,
  jobTitle,
  jobId,
  profile,
  jd,
  recruiterName,
  recruiterTitle,
  letterBody,
}) {
  const dedupeKey = computeDedupeKey({ company, jobTitle, jobId });
  const now = new Date().toISOString();
  await client.execute({
    sql: `
      INSERT INTO applications
        (dedupe_key, company, job_title, job_id, status, notes,
         profile_snapshot, jd_snapshot, recruiter_name, recruiter_title, cover_letter_body, created_at, updated_at)
      VALUES
        (@dedupeKey, @company, @jobTitle, @jobId, 'Draft', '',
         @profileSnapshot, @jdSnapshot, @recruiterName, @recruiterTitle, @letterBody, @now, @now)
      ON CONFLICT(dedupe_key) DO UPDATE SET
        company = excluded.company,
        job_title = excluded.job_title,
        job_id = excluded.job_id,
        profile_snapshot = excluded.profile_snapshot,
        jd_snapshot = excluded.jd_snapshot,
        recruiter_name = excluded.recruiter_name,
        recruiter_title = excluded.recruiter_title,
        cover_letter_body = excluded.cover_letter_body,
        updated_at = excluded.updated_at
    `,
    args: {
      dedupeKey,
      company: company || "",
      jobTitle: jobTitle || "",
      jobId: jobId || "",
      profileSnapshot: profile || "",
      jdSnapshot: jd || "",
      recruiterName: recruiterName || "",
      recruiterTitle: recruiterTitle || "",
      letterBody: letterBody || "",
      now,
    },
  });
}

async function listApplications() {
  const rs = await client.execute(`
    SELECT id, company, job_title, job_id, status, resume_ats_score,
           (resume_json IS NOT NULL) AS has_resume,
           (cover_letter_body IS NOT NULL) AS has_cover_letter,
           created_at, updated_at
    FROM applications
    ORDER BY updated_at DESC
  `);
  return rs.rows.map((row) => ({
    ...row,
    has_resume: !!row.has_resume,
    has_cover_letter: !!row.has_cover_letter,
  }));
}

async function getApplication(id) {
  const rs = await client.execute({
    sql: `SELECT * FROM applications WHERE id = @id`,
    args: { id },
  });
  const row = rs.rows[0];
  if (!row) return null;
  return {
    id: row.id,
    company: row.company,
    job_title: row.job_title,
    job_id: row.job_id,
    status: row.status,
    notes: row.notes,
    profile_snapshot: row.profile_snapshot,
    jd_snapshot: row.jd_snapshot,
    recruiter_name: row.recruiter_name,
    recruiter_title: row.recruiter_title,
    resume: row.resume_json ? JSON.parse(row.resume_json) : null,
    cover_letter_body: row.cover_letter_body,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

async function updateApplication(id, { status, notes }) {
  const existingRs = await client.execute({
    sql: `SELECT status, notes FROM applications WHERE id = @id`,
    args: { id },
  });
  const existing = existingRs.rows[0];
  if (!existing) return false;

  const nextStatus = status !== undefined ? status : existing.status;
  if (!STATUS_VALUES.includes(nextStatus)) {
    throw new Error("Invalid status");
  }
  const nextNotes = notes !== undefined ? notes : existing.notes;

  await client.execute({
    sql: `UPDATE applications SET status = @status, notes = @notes, updated_at = @now WHERE id = @id`,
    args: { id, status: nextStatus, notes: nextNotes, now: new Date().toISOString() },
  });
  return true;
}

async function getProfile() {
  const rs = await client.execute(`SELECT * FROM profile_settings WHERE id = 1`);
  const row = rs.rows[0];
  if (!row) {
    return {
      name: "",
      email: "",
      phone: "",
      linkedin: "",
      education: [],
      awards: [],
      master_profile: "",
    };
  }
  return {
    name: row.name,
    email: row.email,
    phone: row.phone,
    linkedin: row.linkedin,
    education: JSON.parse(row.education_json),
    awards: JSON.parse(row.awards_json),
    master_profile: row.master_profile,
  };
}

async function saveProfile({ name, email, phone, linkedin, education, awards, masterProfile }) {
  await client.execute({
    sql: `
      INSERT INTO profile_settings (id, name, email, phone, linkedin, education_json, awards_json, master_profile, updated_at)
      VALUES (1, @name, @email, @phone, @linkedin, @educationJson, @awardsJson, @masterProfile, @now)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        email = excluded.email,
        phone = excluded.phone,
        linkedin = excluded.linkedin,
        education_json = excluded.education_json,
        awards_json = excluded.awards_json,
        master_profile = excluded.master_profile,
        updated_at = excluded.updated_at
    `,
    args: {
      name: name || "",
      email: email || "",
      phone: phone || "",
      linkedin: linkedin || "",
      educationJson: JSON.stringify(education || []),
      awardsJson: JSON.stringify(awards || []),
      masterProfile: masterProfile || "",
      now: new Date().toISOString(),
    },
  });
}

module.exports = {
  STATUS_VALUES,
  initDb,
  computeDedupeKey,
  upsertResume,
  upsertCoverLetter,
  listApplications,
  getApplication,
  updateApplication,
  getProfile,
  saveProfile,
};
