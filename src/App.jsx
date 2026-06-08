import { useState, useEffect, useRef, useCallback } from "react";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_DEFAULT_KEY
);

// ─── PLANS ────────────────────────────────────────────────────────────────────
const PLANS = {
  free: {
    name: "Starter",
    inr: 0,
    resumeLimit: 2,
    coverLetterLimit: 1,
    emailLimit: 1,
    features: [
      "2 AI-tailored resumes",
      "1 cover letter",
      "1 outreach email",
      "All 6 templates",
      "PDF export",
      "ATS keyword matching",
    ],
    cta: "Current Plan",
    color: "#9ca3af",
  },
  pay_per: {
    name: "Pay Per Use",
    inr: 49,
    resumeLimit: 9999,
    coverLetterLimit: 9999,
    emailLimit: 9999,
    features: [
      "₹49 per resume or letter",
      "No subscription",
      "All 6 templates",
      "Full AI tailoring",
      "Cover letters",
      "Outreach emails",
      "PDF + edit",
    ],
    cta: "Pay as you go",
    popular: true,
    color: "#6366f1",
  },
  lifetime: {
    name: "Lifetime",
    inr: 1499,
    resumeLimit: 9999,
    coverLetterLimit: 9999,
    emailLimit: 9999,
    features: [
      "Unlimited resumes",
      "Unlimited cover letters",
      "Unlimited outreach emails",
      "All templates forever",
      "Priority AI",
      "One-time payment",
    ],
    cta: "Get Lifetime Access",
    badge: "Best Value",
    color: "#f59e0b",
  },
};

const RZP_KEY_ID = import.meta.env.VITE_RZP_KEY;

function openRazorpay({ amount, label, user, onSuccess, onError }) {
  const script = document.createElement("script");
  script.src = "https://checkout.razorpay.com/v1/checkout.js";
  script.onload = () => {
    const rzp = new window.Razorpay({
      key: RZP_KEY_ID,
      amount: amount * 100,
      currency: "INR",
      name: "ResumeAI",
      description: label,
      prefill: { name: user?.user_metadata?.full_name || "", email: user?.email || "" },
      theme: { color: "#6366f1" },
      handler: (res) => onSuccess(res.razorpay_payment_id),
      modal: { ondismiss: () => onError("Payment cancelled") },
    });
    rzp.on("payment.failed", (r) => onError(r.error.description));
    rzp.open();
  };
  script.onerror = () => onError("Failed to load payment gateway");
  document.head.appendChild(script);
}

// ─── AI PROVIDERS ─────────────────────────────────────────────────────────────
const KEYS = {
  gemini: import.meta.env.VITE_GEMINI_API,
  groq: import.meta.env.VITE_GROQ_API,
  cohere: import.meta.env.VITE_COHERE_API,
  mistral: import.meta.env.VITE_MISTRAL_API,
  openrouter: import.meta.env.VITE_OPENROUTER_API,
};

class RateLimit extends Error { constructor(p) { super(p); this.name = "RateLimit"; } }
const cooldown = {};

const PROVIDERS = [
  {
    id: "groq", label: "Groq · Llama 3.3 70B", ok: () => !!KEYS.groq,
    run: async (p) => {
      const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${KEYS.groq}` },
        body: JSON.stringify({ model: "llama-3.3-70b-versatile", messages: [{ role: "user", content: p }], max_tokens: 4096, temperature: 0.25 })
      });
      if (r.status === 429 || r.status === 413) throw new RateLimit("groq");
      if (!r.ok) throw new Error(`Groq ${r.status}`);
      return (await r.json()).choices?.[0]?.message?.content || "";
    }
  },
  {
    id: "gemini", label: "Gemini 2.0 Flash", ok: () => !!KEYS.gemini,
    run: async (p) => {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${KEYS.gemini}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: p }] }], generationConfig: { temperature: 0.25, maxOutputTokens: 4096 } })
      });
      if (r.status === 429 || r.status === 503) throw new RateLimit("gemini");
      if (!r.ok) throw new Error(`Gemini ${r.status}`);
      const d = await r.json();
      if (d.error) throw new RateLimit("gemini");
      return d.candidates?.[0]?.content?.parts?.[0]?.text || "";
    }
  },
  {
    id: "mistral", label: "Mistral Small", ok: () => !!KEYS.mistral,
    run: async (p) => {
      const r = await fetch("https://api.mistral.ai/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${KEYS.mistral}` },
        body: JSON.stringify({ model: "mistral-small-latest", messages: [{ role: "user", content: p }], max_tokens: 4096, temperature: 0.25 })
      });
      if (r.status === 429) throw new RateLimit("mistral");
      if (!r.ok) throw new Error(`Mistral ${r.status}`);
      return (await r.json()).choices?.[0]?.message?.content || "";
    }
  },
  {
    id: "cohere", label: "Cohere Command-R", ok: () => !!KEYS.cohere,
    run: async (p) => {
      const r = await fetch("https://api.cohere.com/v1/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${KEYS.cohere}` },
        body: JSON.stringify({ model: "command-r", message: p, max_tokens: 4000, temperature: 0.25 })
      });
      if (r.status === 429) throw new RateLimit("cohere");
      if (!r.ok) throw new Error(`Cohere ${r.status}`);
      return (await r.json()).text || "";
    }
  },
  {
    id: "openrouter", label: "OpenRouter", ok: () => !!KEYS.openrouter,
    run: async (p) => {
      const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${KEYS.openrouter}`, "HTTP-Referer": window.location.origin },
        body: JSON.stringify({ model: "mistralai/mistral-7b-instruct:free", messages: [{ role: "user", content: p }], max_tokens: 4000 })
      });
      if (r.status === 429 || r.status === 402) throw new RateLimit("openrouter");
      if (!r.ok) throw new Error(`OpenRouter ${r.status}`);
      return (await r.json()).choices?.[0]?.message?.content || "";
    }
  },
];

async function callAI(prompt) {
  const now = Date.now();
  const pool = PROVIDERS.filter(p => p.ok() && !(cooldown[p.id] > now));
  if (!pool.length) throw new Error("NO_PROVIDERS");
  const errors = [];
  for (const p of pool) {
    try {
      const t = await p.run(prompt);
      if (!t || typeof t !== "string" || t.trim().length === 0) { errors.push({ provider: p.id, reason: "empty" }); continue; }
      const trimmed = t.trim();
      if (!trimmed.includes("{") || !trimmed.includes("}")) { errors.push({ provider: p.id, reason: "no_json" }); continue; }
      return { text: t, provider: p.label };
    } catch (e) {
      if (e instanceof RateLimit) { cooldown[e.message] = now + 3600000; errors.push({ provider: p.id, reason: "rate_limit" }); continue; }
      errors.push({ provider: p.id, reason: e.message });
    }
  }
  throw new Error(`ALL_FAILED: ${JSON.stringify(errors)}`);
}

async function callAIText(prompt) {
  const now = Date.now();
  const pool = PROVIDERS.filter(p => p.ok() && !(cooldown[p.id] > now));
  if (!pool.length) throw new Error("NO_PROVIDERS");
  for (const p of pool) {
    try {
      const t = await p.run(prompt);
      if (t && t.trim().length > 50) return { text: t.trim(), provider: p.label };
    } catch (e) {
      if (e instanceof RateLimit) { cooldown[e.message] = now + 3600000; continue; }
    }
  }
  throw new Error("ALL_FAILED");
}

// ─── PROMPTS ──────────────────────────────────────────────────────────────────
function buildResumePrompt(company, jd, candidateText) {
  return `You are a world-class technical resume writer. Produce a complete, ATS-optimized, 100% factual resume JSON for a candidate applying to ${company}.

COMPANY: ${company}

JOB DESCRIPTION:
"""
${jd}
"""

CANDIDATE BACKGROUND:
"""
${candidateText.slice(0, 8000)}
"""

YOUR MISSION: Rewrite the candidate's resume so it speaks ${company}'s exact language using ONLY the candidate's real experience. Never fabricate.

ABSOLUTE RULES:
1. NEVER invent metrics, percentages, user counts, or achievements the candidate didn't write.
2. NEVER add technologies the candidate didn't mention.
3. Output EXACTLY the same number of bullets per role as the candidate provided.
4. PROJECTS: Count every project the candidate listed. Output all of them. Non-negotiable.
5. Summary: 2-3 sentences. Mention ${company}. Use ONLY facts from candidate background.
6. Forbidden bullet starters: "Responsible for", "Helped", "Assisted", "Worked on".

OUTPUT: Return ONLY valid JSON starting with { and ending with }. No markdown. No explanation.

{
  "name": "candidate full name",
  "currentTitle": "title that best matches the JD",
  "email": "from candidate",
  "phone": "from candidate or empty string",
  "location": "from candidate or empty string",
  "linkedin": "full URL from candidate or empty string",
  "github": "full URL from candidate or empty string",
  "portfolio": "full URL from candidate or empty string",
  "summary": "2-3 sentences mentioning ${company}",
  "experience": [{"title":"","company":"","period":"","location":"","bullets":[]}],
  "projects": [{"name":"","tech":"","link":"","description":"","bullets":[]}],
  "skills": {"technical":[],"soft":[],"tools":[]},
  "education": [{"degree":"","school":"","year":"","gpa":""}],
  "certifications": []
}`;
}

function buildCoverLetterPrompt(company, jd, candidateText, role) {
  return `You are an expert cover letter writer. Write a compelling, personalized cover letter for this candidate applying to ${company} for the ${role || "role"}.

COMPANY: ${company}
ROLE: ${role || "the advertised position"}

JOB DESCRIPTION:
"""
${jd}
"""

CANDIDATE BACKGROUND:
"""
${candidateText.slice(0, 6000)}
"""

RULES:
1. 3-4 paragraphs, ~300 words total.
2. Open with a strong hook — NOT "I am writing to apply for...".
3. Weave in specific JD keywords naturally.
4. Reference a specific achievement or project from their background.
5. Close with confident CTA.
6. Sound human, not AI-generated.
7. NEVER invent facts or achievements not in the candidate background.

Return ONLY valid JSON:
{
  "subject": "Re: [Role] at ${company}",
  "salutation": "Dear Hiring Manager,",
  "paragraphs": ["paragraph 1", "paragraph 2", "paragraph 3", "paragraph 4"],
  "closing": "Best regards,",
  "candidateName": "name from background",
  "role": "${role || "the role"}",
  "company": "${company}"
}`;
}

function buildOutreachEmailPrompt(company, jd, candidateText, recipientName, recipientRole, emailType) {
  return `You are an expert at writing professional outreach emails. Write a ${emailType || "job application"} email.

RECIPIENT: ${recipientName || "Hiring Manager"} (${recipientRole || "Recruiter"}) at ${company}

JOB DESCRIPTION:
"""
${jd}
"""

CANDIDATE BACKGROUND:
"""
${candidateText.slice(0, 5000)}
"""

EMAIL TYPE: ${emailType || "job application email with resume attached"}

RULES:
1. Subject line must be specific and attention-grabbing.
2. Opening line: immediately establish why you're reaching out.
3. 2-3 short paragraphs max.
4. Highlight ONE specific achievement or skill relevant to the role.
5. Clear CTA at end.
6. Professional but warm tone.
7. NEVER invent facts.

Return ONLY valid JSON:
{
  "subject": "compelling subject line",
  "greeting": "Hi ${recipientName || "there"},",
  "paragraphs": ["paragraph 1", "paragraph 2", "paragraph 3"],
  "closing": "Best,",
  "candidateName": "name from background",
  "recipientName": "${recipientName || "Hiring Manager"}",
  "company": "${company}"
}`;
}

// ─── UTILITIES ────────────────────────────────────────────────────────────────
function extractJSON(raw, fallback) {
  if (!raw || typeof raw !== "string") return fallback;
  const strategies = [
    (s) => JSON.parse(s.trim()),
    (s) => JSON.parse(s.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim()),
    (s) => { const start = s.indexOf("{"); const end = s.lastIndexOf("}"); if (start === -1 || end === -1 || end <= start) throw new Error("no_braces"); return JSON.parse(s.slice(start, end + 1)); },
    (s) => { const m = s.match(/\{[\s\S]*\}/); if (!m) throw new Error("no_match"); return JSON.parse(m[0]); },
    (s) => JSON.parse(s.replace(/^[^{]*/s, "").replace(/[^}]*$/s, "").replace(/,\s*([}\]])/g, "$1").trim()),
  ];
  for (let i = 0; i < strategies.length; i++) {
    try { const r = strategies[i](raw); if (r && typeof r === "object" && !Array.isArray(r)) return r; } catch { }
  }
  return fallback;
}

function extractProjectsFallback(text) {
  const lower = text.toLowerCase();
  const idx = lower.indexOf("project");
  if (idx === -1) return [];
  const lines = text.slice(idx).split("\n").filter(l => l.trim());
  const projects = [];
  let current = null;
  for (const line of lines.slice(0, 40)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith("•") || trimmed.startsWith("-") || trimmed.startsWith("*")) { if (current) current.bullets.push(trimmed.replace(/^[•\-\*]\s*/, "").trim()); }
    else if (trimmed.toLowerCase().startsWith("tech:") || trimmed.toLowerCase().startsWith("stack:")) { if (current) current.tech = trimmed.replace(/^(tech|stack):\s*/i, "").trim(); }
    else if (trimmed.toLowerCase().startsWith("link:") || trimmed.startsWith("http")) { if (current) current.link = trimmed.replace(/^(link|github):\s*/i, "").trim(); }
    else if (trimmed.length > 3) { if (current) projects.push(current); current = { name: trimmed, tech: "", link: "", description: "", bullets: [] }; }
  }
  if (current) projects.push(current);
  return projects.slice(0, 5);
}

function buildOffline(candidateText, jd, company) {
  const lines = candidateText.split("\n").filter(l => l.trim().length > 2);
  const emailMatch = candidateText.match(/[\w.+-]+@[\w-]+\.[a-z]{2,}/i);
  const phoneMatch = candidateText.match(/[\+]?[\d\s\-\(\)]{10,}/);
  return {
    name: lines[0]?.trim() || "Your Name",
    currentTitle: "Full Stack Engineer",
    email: emailMatch?.[0] || "",
    phone: phoneMatch?.[0]?.trim() || "",
    location: "",
    linkedin: "",
    github: "",
    portfolio: "",
    summary: `Experienced engineer applying to ${company}. Strong full-stack background focused on shipping production-quality software.`,
    experience: [{ title: "Software Engineer", company: "Previous Role", period: "2022 – Present", location: "Remote", bullets: ["Built and shipped production web applications with React and Node.js", "Designed and maintained RESTful APIs serving thousands of users"] }],
    projects: extractProjectsFallback(candidateText),
    skills: { technical: ["React", "JavaScript", "Node.js", "SQL"], soft: [], tools: ["Git", "Docker"] },
    education: [{ degree: "Bachelor's Degree", school: "", year: "", gpa: "" }],
    certifications: [],
  };
}

// ─── SUPABASE HELPERS ──────────────────────────────────────────────────────────
async function upsertProfile(user) {
  try {
    const { data } = await supabase.from("profiles").select("id").eq("id", user.id).single();
    if (!data) {
      await supabase.from("profiles").insert({
        id: user.id, email: user.email,
        full_name: user.user_metadata?.full_name || "",
        avatar_url: user.user_metadata?.avatar_url || "",
        plan: "free", resume_count: 0, cover_letter_count: 0, email_count: 0,
      });
    }
  } catch (e) { console.warn("upsertProfile:", e.message); }
}

async function fetchProfile(userId) {
  const { data } = await supabase.from("profiles").select("*").eq("id", userId).single();
  return data;
}

async function fetchResumes(userId) {
  const { data } = await supabase.from("resumes").select("*").eq("user_id", userId).order("updated_at", { ascending: false });
  return data || [];
}

async function fetchCoverLetters(userId) {
  const { data } = await supabase.from("cover_letters").select("*").eq("user_id", userId).order("updated_at", { ascending: false });
  return data || [];
}

async function fetchOutreachEmails(userId) {
  const { data } = await supabase.from("outreach_emails").select("*").eq("user_id", userId).order("updated_at", { ascending: false });
  return data || [];
}

async function saveResume(userId, resumeData, jobData, template, font, existingId) {
  const payload = {
    user_id: userId,
    title: `${resumeData.name || "Resume"} → ${jobData?.co || "Untitled"}`,
    company_name: jobData?.co || "",
    job_description: jobData?.jd || "",
    content: resumeData,
    template: template || "ats_pro",
    font: font || "DM Sans",
    updated_at: new Date().toISOString(),
  };
  if (existingId) {
    const { data } = await supabase.from("resumes").update(payload).eq("id", existingId).select().single();
    return data;
  }
  const { data } = await supabase.from("resumes").insert({ ...payload, created_at: new Date().toISOString() }).select().single();
  if (data) {
    const { data: prof } = await supabase.from("profiles").select("resume_count").eq("id", userId).single();
    await supabase.from("profiles").update({ resume_count: (prof?.resume_count || 0) + 1 }).eq("id", userId);
  }
  return data;
}

async function saveCoverLetter(userId, clData, jobData, existingId) {
  const payload = {
    user_id: userId,
    title: `Cover Letter → ${jobData?.co || "Untitled"}`,
    company_name: jobData?.co || "",
    job_description: jobData?.jd || "",
    content: clData,
    updated_at: new Date().toISOString(),
  };
  if (existingId) {
    const { data } = await supabase.from("cover_letters").update(payload).eq("id", existingId).select().single();
    return data;
  }
  const { data } = await supabase.from("cover_letters").insert({ ...payload, created_at: new Date().toISOString() }).select().single();
  if (data) {
    const { data: prof } = await supabase.from("profiles").select("cover_letter_count").eq("id", userId).single();
    await supabase.from("profiles").update({ cover_letter_count: (prof?.cover_letter_count || 0) + 1 }).eq("id", userId);
  }
  return data;
}

async function saveOutreachEmail(userId, emailData, jobData, existingId) {
  const payload = {
    user_id: userId,
    title: `Email → ${jobData?.co || "Untitled"} (${emailData.recipientName || "Hiring Manager"})`,
    company_name: jobData?.co || "",
    subject: emailData.subject || "",
    content: emailData,
    updated_at: new Date().toISOString(),
  };
  if (existingId) {
    const { data } = await supabase.from("outreach_emails").update(payload).eq("id", existingId).select().single();
    return data;
  }
  const { data } = await supabase.from("outreach_emails").insert({ ...payload, created_at: new Date().toISOString() }).select().single();
  if (data) {
    const { data: prof } = await supabase.from("profiles").select("email_count").eq("id", userId).single();
    await supabase.from("profiles").update({ email_count: (prof?.email_count || 0) + 1 }).eq("id", userId);
  }
  return data;
}

async function deleteItem(table, id) {
  return supabase.from(table).delete().eq("id", id);
}

// ─── TEMPLATES ────────────────────────────────────────────────────────────────
const TEMPLATES = [
  { id: "ats_pro", n: "ATS Pro", desc: "Clean single-col, max parsability", ac: "#1a1a2e", bg: "#fff", hBg: "#fff", hTx: "#1a1a2e", preview: "#1a1a2e" },
  { id: "stanford", n: "Stanford", desc: "Bold serif, academic prestige", ac: "#8c1515", bg: "#fff", hBg: "#fff", hTx: "#1a1a1a", preview: "#8c1515" },
  { id: "notion", n: "Notion", desc: "Minimal blocks, tech-forward", ac: "#37352f", bg: "#fff", hBg: "#f7f6f3", hTx: "#37352f", preview: "#37352f" },
  { id: "stripe", n: "Stripe", desc: "Indigo accent, modern SaaS", ac: "#635bff", bg: "#fff", hBg: "#0a2540", hTx: "#fff", preview: "#635bff" },
  { id: "linear", n: "Linear", desc: "Dark mode, neon indigo, dev-first", ac: "#5e6ad2", bg: "#0f0f17", hBg: "#0f0f17", hTx: "#e8e8f0", dark: true, preview: "#5e6ad2" },
  { id: "vercel", n: "Vercel", desc: "Stark B&W, bold typography", ac: "#000", bg: "#fff", hBg: "#000", hTx: "#fff", preview: "#000000" },
];

const FONTS = [
  { n: "DM Sans", v: "'DM Sans',sans-serif" },
  { n: "Lora", v: "'Lora',serif" },
  { n: "Fraunces", v: "'Fraunces',serif" },
  { n: "Inter", v: "'Inter',sans-serif" },
  { n: "Syne", v: "'Syne',sans-serif" },
  { n: "Crimson", v: "'Crimson Text',serif" },
];

// ─── COLOR TOKENS ─────────────────────────────────────────────────────────────
const C = {
  bg: "#0c0c14",
  bgAlt: "#13131f",
  surface: "#1a1a2e",
  surfaceAlt: "#1f1f35",
  border: "#2a2a45",
  borderLight: "#22223a",
  text: "#e8e8f5",
  textMuted: "#8888aa",
  textLight: "#5a5a78",
  accent: "#6366f1",
  accentDark: "#4f46e5",
  accentLight: "#818cf8",
  accentBg: "rgba(99,102,241,0.08)",
  accentBorder: "rgba(99,102,241,0.25)",
  violet: "#8b5cf6",
  emerald: "#10b981",
  amber: "#f59e0b",
  rose: "#f43f5e",
};

// ─── GLOBAL STYLES ─────────────────────────────────────────────────────────────
const GS = () => (
  <style>{`
    @import url('https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700&family=Lora:ital,wght@0,400;0,600;1,400&family=Fraunces:ital,opsz,wght@0,9..144,700;0,9..144,900;1,9..144,400&family=Inter:wght@300;400;500;600;700&family=Syne:wght@600;700;800&display=swap');
    *{box-sizing:border-box;margin:0;padding:0}
    html{scroll-behavior:smooth}
    body{font-family:'DM Sans',sans-serif;-webkit-font-smoothing:antialiased;background:${C.bg};color:${C.text}}

    @keyframes spin{to{transform:rotate(360deg)}}
    @keyframes fadeIn{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:none}}
    @keyframes fadeUp{from{opacity:0;transform:translateY(28px)}to{opacity:1;transform:none}}
    @keyframes float{0%,100%{transform:translateY(0)}50%{transform:translateY(-8px)}}
    @keyframes blink{0%,100%{opacity:1}50%{opacity:.2}}
    @keyframes shimmer{0%{background-position:-400px 0}100%{background-position:400px 0}}
    @keyframes scaleIn{from{opacity:0;transform:scale(.96)}to{opacity:1;transform:scale(1)}}
    @keyframes marquee{0%{transform:translateX(0)}100%{transform:translateX(-50%)}}
    @keyframes gradShift{0%,100%{background-position:0% 50%}50%{background-position:100% 50%}}
    @keyframes pulseRing{0%{box-shadow:0 0 0 0 rgba(99,102,241,.4)}70%{box-shadow:0 0 0 12px rgba(99,102,241,0)}100%{box-shadow:0 0 0 0 rgba(99,102,241,0)}}
    @keyframes slideUp{from{opacity:0;transform:translateY(40px)}to{opacity:1;transform:none}}

    .fade-in{animation:fadeIn .5s cubic-bezier(.22,1,.36,1) both}
    .fade-in-1{animation:fadeIn .5s .1s cubic-bezier(.22,1,.36,1) both}
    .fade-in-2{animation:fadeIn .5s .2s cubic-bezier(.22,1,.36,1) both}
    .fade-in-3{animation:fadeIn .5s .32s cubic-bezier(.22,1,.36,1) both}
    .fade-in-4{animation:fadeIn .5s .46s cubic-bezier(.22,1,.36,1) both}
    .scale-in{animation:scaleIn .28s ease both}
    .slide-up{animation:slideUp .7s cubic-bezier(.22,1,.36,1) both}
    .ske{background:linear-gradient(90deg,${C.border} 0%,${C.surfaceAlt} 50%,${C.border} 100%);background-size:400px 100%;animation:shimmer 1.5s infinite linear;border-radius:4px}

    .btn-primary{display:inline-flex;align-items:center;gap:8px;padding:11px 22px;background:${C.accent};color:#fff;border:none;border-radius:9px;font-size:13px;font-weight:600;cursor:pointer;transition:all .18s;font-family:'DM Sans',sans-serif;white-space:nowrap;letter-spacing:.1px}
    .btn-primary:hover:not(:disabled){background:${C.accentDark};transform:translateY(-2px);box-shadow:0 12px 28px rgba(99,102,241,.4)}
    .btn-primary:active:not(:disabled){transform:translateY(0)}
    .btn-primary:disabled{opacity:.38;cursor:not-allowed}

    .btn-secondary{display:inline-flex;align-items:center;gap:8px;padding:10px 20px;background:${C.surface};color:${C.text};border:1.5px solid ${C.border};border-radius:9px;font-size:13px;font-weight:500;cursor:pointer;transition:all .18s;font-family:'DM Sans',sans-serif;white-space:nowrap}
    .btn-secondary:hover{background:${C.surfaceAlt};border-color:${C.accent}60;transform:translateY(-1px)}

    .btn-ghost{display:inline-flex;align-items:center;gap:6px;padding:9px 16px;background:none;color:${C.textMuted};border:1.5px solid ${C.border};border-radius:9px;font-size:13px;font-weight:500;cursor:pointer;transition:all .18s;font-family:'DM Sans',sans-serif;white-space:nowrap}
    .btn-ghost:hover{color:${C.text};background:${C.surfaceAlt};border-color:${C.borderLight}}

    .btn-danger{display:inline-flex;align-items:center;gap:6px;padding:8px 14px;background:rgba(244,63,94,.06);color:#f43f5e;border:1px solid rgba(244,63,94,.15);border-radius:8px;font-size:13px;font-weight:500;cursor:pointer;transition:all .18s;font-family:'DM Sans',sans-serif}
    .btn-danger:hover{background:rgba(244,63,94,.14);border-color:rgba(244,63,94,.35)}

    .input-dark{width:100%;padding:11px 14px;background:${C.surface};border:1.5px solid ${C.border};border-radius:9px;color:${C.text};font-size:14px;font-family:'DM Sans',sans-serif;transition:all .18s;resize:vertical;outline:none;line-height:1.65}
    .input-dark::placeholder{color:${C.textLight}}
    .input-dark:focus{border-color:${C.accent};background:${C.surfaceAlt};box-shadow:0 0 0 3px rgba(99,102,241,.12)}

    .card{background:${C.surface};border:1.5px solid ${C.border};border-radius:14px;transition:all .2s}
    .card:hover{border-color:${C.accent}50;transform:translateY(-1px);box-shadow:0 8px 32px rgba(0,0,0,.25)}

    .glass{background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.06);backdrop-filter:blur(20px)}

    ::-webkit-scrollbar{width:3px;height:3px}
    ::-webkit-scrollbar-track{background:transparent}
    ::-webkit-scrollbar-thumb{background:${C.border};border-radius:2px}

    @media(max-width:768px){.desktop-only{display:none!important}}
    @media print{
      body{background:white!important;margin:0!important;-webkit-print-color-adjust:exact;print-color-adjust:exact}
      #resume-canvas{box-shadow:none!important;border:none!important;margin:0!important;border-radius:0!important;width:794px!important;}
      .no-print{display:none!important}
      @page{margin:0;size:A4 portrait}
    }
  `}</style>
);

// ─── ICONS ────────────────────────────────────────────────────────────────────
const Icon = ({ n, s = 18, c = "currentColor" }) => {
  const paths = {
    spark: "M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z M18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456z",
    arr: "M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3",
    chk: "M4.5 12.75l6 6 9-13.5",
    chkCircle: "M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z",
    up: "M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5",
    dl: "M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3",
    doc: "M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z",
    tr: "M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0",
    pls: "M12 4.5v15m7.5-7.5h-15",
    x: "M6 18L18 6M6 6l12 12",
    out: "M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3 0l3-3m0 0l-3-3m3 3H9",
    crown: "M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.563.563 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z",
    bolt: "M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z",
    home: "M2.25 12l8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25",
    user: "M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z",
    edit: "M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125",
    sv: "M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0111.186 0z",
    back: "M19 12H5M12 5l-7 7 7 7",
    mail: "M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75",
    pen: "M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L6.832 19.82a4.5 4.5 0 01-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 011.13-1.897L16.863 4.487zm0 0L19.5 7.125",
    copy: "M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 01-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H6.75a9.06 9.06 0 011.5.124m7.5 10.376h3.375c.621 0 1.125-.504 1.125-1.125V11.25c0-4.46-3.243-8.161-7.5-8.876a9.06 9.06 0 00-1.5-.124H9.375c-.621 0-1.125.504-1.125 1.125v3.5m7.5 10.375H9.375a1.125 1.125 0 01-1.125-1.125v-9.25m12 6.625v-1.875a3.375 3.375 0 00-3.375-3.375h-1.5a1.125 1.125 0 01-1.125-1.125v-1.5a3.375 3.375 0 00-3.375-3.375H9.75",
    google: "GOOGLE",
  };

  if (n === "google") return (
    <svg width={s} height={s} viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
    </svg>
  );

  return (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d={paths[n] || paths.spark} />
    </svg>
  );
};

const Spinner = ({ s = 18, c = C.accent }) => (
  <div style={{ width: s, height: s, borderRadius: "50%", border: `2px solid ${c}20`, borderTop: `2px solid ${c}`, animation: "spin .65s linear infinite", flexShrink: 0 }} />
);

const Logo = ({ size = "md" }) => {
  const sz = size === "sm" ? { icon: 28, font: 13, iconSz: 14 } : { icon: 36, font: 15, iconSz: 17 };
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <div style={{ width: sz.icon, height: sz.icon, background: `linear-gradient(135deg, ${C.accent}, ${C.violet})`, borderRadius: 9, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
        <Icon n="spark" s={sz.iconSz} c="#fff" />
      </div>
      <span style={{ fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: sz.font, color: C.text, letterSpacing: "-0.5px" }}>resume<span style={{ color: C.accent }}>ai</span></span>
    </div>
  );
};

// ─── LANDING ──────────────────────────────────────────────────────────────────
// ─── LANDING ──────────────────────────────────────────────────────────────────
const Landing = ({ onSignIn }) => {
  const IS = "'Instrument Serif', serif";
  const IF = "'DM Sans', sans-serif";
  const CR = "#f5f0eb";
  const BL = "#1a1612";
  const MU = "#8c7b6e";
  const AC = "#6366f1";

  const [introOver, setIntroOver] = useState(false);
  const [introPhase, setIntroPhase] = useState(0); // 0=logo, 1=expand, 2=done
  const [videoPlaying, setVideoPlaying] = useState(false);
  const videoRef = useRef(null);

  // ── cinematic intro sequence ──
  useEffect(() => {
    const t1 = setTimeout(() => setIntroPhase(1), 900);   // logo shown → start expand
    const t2 = setTimeout(() => setIntroPhase(2), 1800);  // expand → fade out overlay
    const t3 = setTimeout(() => setIntroOver(true), 2600); // overlay gone
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, []);

  const handlePlayToggle = () => {
    const v = videoRef.current;
    if (!v) return;
    if (videoPlaying) { v.pause(); setVideoPlaying(false); }
    else { v.play(); setVideoPlaying(true); }
  };

  // ── SVG cloud band ──
  const CloudBand = ({ id = "a", flip = false, fromColor = CR, toColor = CR }) => (
    <div style={{ position: "relative", height: 220, overflow: "hidden", pointerEvents: "none", marginTop: -1, marginBottom: -1 }}>
      <svg viewBox="0 0 1440 220" preserveAspectRatio="none" style={{ width: "100%", height: "100%", display: "block" }} xmlns="http://www.w3.org/2000/svg">
        <defs>
          <radialGradient id={`cga${id}`} cx="25%" cy="65%"><stop offset="0%" stopColor="#d8cfe8" stopOpacity=".95" /><stop offset="100%" stopColor="transparent" stopOpacity="0" /></radialGradient>
          <radialGradient id={`cgb${id}`} cx="72%" cy="52%"><stop offset="0%" stopColor="#f0d0e8" stopOpacity=".9" /><stop offset="100%" stopColor="transparent" stopOpacity="0" /></radialGradient>
          <radialGradient id={`cgc${id}`} cx="50%" cy="75%"><stop offset="0%" stopColor="#c8d8f4" stopOpacity=".75" /><stop offset="100%" stopColor="transparent" stopOpacity="0" /></radialGradient>
          <filter id={`bf1${id}`}><feGaussianBlur stdDeviation="7" /></filter>
          <filter id={`bf2${id}`}><feGaussianBlur stdDeviation="13" /></filter>
        </defs>

        {/* sky fill */}
        <rect width="1440" height="220" fill={`url(#cgc${id})`} opacity=".55" />

        {/* far back clouds — large, blurry */}
        <ellipse cx="200" cy="160" rx="280" ry="75" fill={`url(#cga${id})`} filter={`url(#bf2${id})`} opacity=".6" />
        <ellipse cx="750" cy="140" rx="350" ry="90" fill={`url(#cgb${id})`} filter={`url(#bf2${id})`} opacity=".5" />
        <ellipse cx="1250" cy="155" rx="270" ry="72" fill={`url(#cga${id})`} filter={`url(#bf2${id})`} opacity=".55" />

        {/* mid clouds */}
        <ellipse cx="130" cy="150" rx="160" ry="52" fill="white" filter={`url(#bf1${id})`} opacity=".5" />
        <ellipse cx="410" cy="130" rx="130" ry="44" fill="white" filter={`url(#bf1${id})`} opacity=".45" />
        <ellipse cx="680" cy="145" rx="200" ry="58" fill="white" filter={`url(#bf1${id})`} opacity=".52" />
        <ellipse cx="980" cy="125" rx="170" ry="50" fill="white" filter={`url(#bf1${id})`} opacity=".42" />
        <ellipse cx="1310" cy="140" rx="150" ry="48" fill="white" filter={`url(#bf1${id})`} opacity=".5" />

        {/* near-crisp top puffs */}
        <ellipse cx="160" cy="115" rx="90" ry="35" fill="white" opacity=".65" filter={`url(#bf1${id})`} />
        <ellipse cx="510" cy="100" rx="75" ry="30" fill="white" opacity=".55" filter={`url(#bf1${id})`} />
        <ellipse cx="880" cy="108" rx="100" ry="38" fill="white" opacity=".6" filter={`url(#bf1${id})`} />
        <ellipse cx="1200" cy="98" rx="80" ry="32" fill="white" opacity=".5" filter={`url(#bf1${id})`} />

        {/* horizon fill matching destination color */}
        <rect x="0" y="190" width="1440" height="30" fill={flip ? fromColor : toColor} opacity="1" />
      </svg>
    </div>
  );

  // ── wavy SVG divider — organic edge between sections ──
  const WaveDivider = ({ fromBg, toBg, flip = false }) => (
    <div style={{ position: "relative", height: 90, overflow: "hidden", marginTop: -1, marginBottom: -1 }}>
      <svg viewBox="0 0 1440 90" preserveAspectRatio="none" style={{ width: "100%", height: "100%", display: "block" }} xmlns="http://www.w3.org/2000/svg">
        <rect width="1440" height="90" fill={fromBg} />
        <path d={flip
          ? "M0,0 C360,90 1080,0 1440,60 L1440,90 L0,90 Z"
          : "M0,60 C360,0 1080,90 1440,30 L1440,90 L0,90 Z"}
          fill={toBg} />
      </svg>
    </div>
  );

  // ── resume card ──
  const ResumeCard = ({ tilt = 0, delay = "0s" }) => (
    <div style={{ animation: `floatA 7s ${delay} ease-in-out infinite`, display: "inline-block" }}>
      <div style={{ width: 164, background: "#fff", borderRadius: 16, boxShadow: "0 24px 64px rgba(100,80,60,.2), 0 2px 8px rgba(0,0,0,.06)", padding: "16px 14px", transform: `rotate(${tilt}deg)` }}>
        <div style={{ height: 9, width: "62%", background: BL, borderRadius: 4, marginBottom: 5 }} />
        <div style={{ height: 5, width: "40%", background: AC, borderRadius: 3, marginBottom: 13, opacity: .55 }} />
        {[78, 60, 88, 52, 70].map((w, i) => <div key={i} style={{ height: 4, width: `${w}%`, background: "#e8e4df", borderRadius: 2, marginBottom: 4 }} />)}
        <div style={{ marginTop: 11, padding: "7px 9px", background: "#f0eefb", borderRadius: 8, border: "1px solid #d8d4f8" }}>
          <div style={{ fontSize: 7, fontWeight: 700, color: AC, letterSpacing: "1.2px" }}>ATS SCORE</div>
          <div style={{ fontSize: 20, fontWeight: 900, color: BL, letterSpacing: "-1.5px", marginTop: 2 }}>94<span style={{ fontSize: 9, opacity: .35 }}>/100</span></div>
        </div>
      </div>
    </div>
  );

  // ── plane ──
  const Plane = () => (
    <svg width="180" height="110" viewBox="0 0 220 130" xmlns="http://www.w3.org/2000/svg" style={{ animation: "floatB 9s ease-in-out infinite", display: "block" }}>
      <defs>
        <radialGradient id="pg" cx="50%" cy="30%"><stop offset="0%" stopColor="#eac8a0" /><stop offset="100%" stopColor="#c8906a" /></radialGradient>
        <radialGradient id="wg" cx="50%" cy="40%"><stop offset="0%" stopColor="#c09060" /><stop offset="100%" stopColor="#a07040" /></radialGradient>
      </defs>
      <ellipse cx="110" cy="70" rx="80" ry="24" fill="url(#pg)" />
      <ellipse cx="145" cy="62" rx="30" ry="17" fill="#d8a882" />
      <ellipse cx="184" cy="70" rx="20" ry="13" fill="#c08060" />
      <ellipse cx="36" cy="65" rx="15" ry="11" fill="#b07050" />
      <ellipse cx="105" cy="56" rx="60" ry="11" fill="url(#wg)" transform="rotate(-7 105 56)" />
      <ellipse cx="110" cy="83" rx="55" ry="9" fill="#986040" transform="rotate(5 110 83)" />
      <ellipse cx="163" cy="59" rx="15" ry="10" fill="#a8d0e4" opacity=".88" />
      <ellipse cx="200" cy="70" rx="4" ry="24" fill="#8a5030" opacity=".75" />
      <circle cx="95" cy="94" r="9" fill="#6a3828" />
      <circle cx="125" cy="94" r="9" fill="#6a3828" />
      <ellipse cx="110" cy="112" rx="70" ry="9" fill="rgba(90,50,20,.1)" />
    </svg>
  );

  // ── app icons ──
  const AppIcons = () => (
    <div style={{ display: "flex", gap: 18, justifyContent: "center" }}>
      {[
        { bg: "#f5d06a", emoji: "📄", label: "Resume" },
        { bg: BL, emoji: "🌙", label: "Dark" },
        { bg: "#7c88e8", emoji: "✉️", label: "Letter" },
        { bg: "#e87c6a", emoji: "📧", label: "Email" },
      ].map((ic, i) => (
        <div key={i} style={{ animation: `floatC 6s ${i * 0.45}s ease-in-out infinite` }}>
          <div style={{ width: 72, height: 72, background: ic.bg, borderRadius: 20, display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 10px 28px rgba(0,0,0,.14), 0 2px 6px rgba(0,0,0,.08)", fontSize: 28 }}>{ic.emoji}</div>
          <div style={{ textAlign: "center", fontSize: 10, color: MU, marginTop: 7, fontFamily: IF, fontWeight: 500 }}>{ic.label}</div>
        </div>
      ))}
    </div>
  );

  // ── mock chat ──
  const MockChat = () => (
    <div style={{ background: "#fff", borderRadius: 18, boxShadow: "0 20px 56px rgba(100,80,60,.15)", padding: "18px 20px", maxWidth: 340, width: "100%", fontFamily: IF }}>
      <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 14, paddingBottom: 13, borderBottom: "1px solid #f0ece8" }}>
        <div style={{ width: 30, height: 30, background: "linear-gradient(135deg,#6366f1,#8b5cf6)", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <span style={{ fontSize: 11, color: "#fff", fontWeight: 700 }}>AI</span>
        </div>
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: BL }}>resumeai</div>
          <div style={{ fontSize: 9, color: "#10b981", fontWeight: 600 }}>● Analyzing your JD</div>
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
        <div style={{ alignSelf: "flex-end", background: "#f0eefb", border: "1px solid #d8d4f8", borderRadius: "13px 13px 3px 13px", padding: "9px 13px", fontSize: 12, color: BL, maxWidth: "82%" }}>
          Senior React Engineer at Stripe
        </div>
        <div style={{ alignSelf: "flex-start", background: "#f8f5f0", borderRadius: "13px 13px 13px 3px", padding: "9px 13px", fontSize: 12, color: BL, maxWidth: "86%" }}>
          Found 23 ATS keywords. Rewriting your 4 roles now...
        </div>
        <div style={{ alignSelf: "flex-start", background: "#f8f5f0", borderRadius: "13px 13px 13px 3px", padding: "9px 13px", fontSize: 12, color: BL, maxWidth: "86%", display: "flex", alignItems: "center", gap: 7 }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#10b981", flexShrink: 0 }} />
          Resume ready · 94 ATS score
        </div>
      </div>
    </div>
  );

  const FeatureRow = ({ emoji, title, desc, color }) => (
    <div style={{ display: "flex", gap: 18, alignItems: "flex-start", padding: "22px 0", borderBottom: `1px solid rgba(26,22,18,.07)` }}>
      <div style={{ width: 48, height: 48, borderRadius: 13, background: color, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, fontSize: 22 }}>{emoji}</div>
      <div>
        <div style={{ fontFamily: IS, fontSize: 18, color: BL, marginBottom: 5, lineHeight: 1.2 }}>{title}</div>
        <div style={{ fontSize: 13, color: MU, lineHeight: 1.78, maxWidth: 360 }}>{desc}</div>
      </div>
    </div>
  );

  return (
    <div style={{ fontFamily: IF, background: CR, color: BL, minHeight: "100vh", overflowX: "hidden" }}>

      {/* ── STYLES ── */}
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=DM+Sans:opsz,wght@9..40,300;9..40,400;9..40,500;9..40,600;9..40,700&display=swap');

        @keyframes floatA{0%,100%{transform:translateY(0px)}50%{transform:translateY(-14px)}}
        @keyframes floatB{0%,100%{transform:translateY(0px)}50%{transform:translateY(-9px)}}
        @keyframes floatC{0%,100%{transform:translateY(0px)}33%{transform:translateY(-8px)}66%{transform:translateY(-3px)}}
        @keyframes riseIn{from{opacity:0;transform:translateY(26px)}to{opacity:1;transform:none}}
        @keyframes marquee{0%{transform:translateX(0)}100%{transform:translateX(-50%)}}

        /* intro animations */
        @keyframes introLogoIn{from{opacity:0;transform:scale(.7)}to{opacity:1;transform:scale(1)}}
        @keyframes introExpand{from{transform:scale(1)}to{transform:scale(42)}}
        @keyframes introFade{from{opacity:1}to{opacity:0}}
        @keyframes introTextIn{0%{opacity:0;letter-spacing:2em}60%{opacity:1}100%{opacity:1;letter-spacing:-.02em}}

        /* play button */
        @keyframes playPulse{0%,100%{box-shadow:0 0 0 0 rgba(245,240,235,.35),0 0 0 0 rgba(245,240,235,.18)}50%{box-shadow:0 0 0 18px rgba(245,240,235,.12),0 0 0 36px rgba(245,240,235,.04)}}
        @keyframes playRing1{0%{transform:scale(1);opacity:.5}100%{transform:scale(2.4);opacity:0}}
        @keyframes playRing2{0%{transform:scale(1);opacity:.4}100%{transform:scale(2.8);opacity:0}}
        @keyframes playRotate{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}
        @keyframes playTriangleIn{from{opacity:0;transform:translate(-50%,-50%) scale(.6)}to{opacity:1;transform:translate(-50%,-50%) scale(1)}}

        .riseIn{animation:riseIn .9s cubic-bezier(.22,1,.36,1) both}
        .riseIn-1{animation:riseIn .9s .14s cubic-bezier(.22,1,.36,1) both}
        .riseIn-2{animation:riseIn .9s .28s cubic-bezier(.22,1,.36,1) both}
        .riseIn-3{animation:riseIn .9s .44s cubic-bezier(.22,1,.36,1) both}
        .riseIn-4{animation:riseIn .9s .62s cubic-bezier(.22,1,.36,1) both}

        .land-btn{display:inline-flex;align-items:center;gap:9px;padding:13px 28px;background:#1a1612;color:#f5f0eb;border:none;border-radius:100px;font-size:14px;font-weight:500;cursor:pointer;font-family:'DM Sans',sans-serif;transition:all .22s}
        .land-btn:hover{background:#2d2720;transform:translateY(-2px);box-shadow:0 14px 36px rgba(26,22,18,.28)}
        .land-btn-ghost{display:inline-flex;align-items:center;gap:8px;padding:13px 24px;background:transparent;color:#8c7b6e;border:1.5px solid rgba(26,22,18,.2);border-radius:100px;font-size:13px;font-weight:500;cursor:pointer;font-family:'DM Sans',sans-serif;transition:all .22s;text-decoration:none}
        .land-btn-ghost:hover{border-color:rgba(26,22,18,.5);color:#1a1612;background:rgba(26,22,18,.04)}
        .plan-card{background:#fff;border-radius:22px;padding:34px 28px;border:1.5px solid rgba(26,22,18,.09);transition:all .22s;position:relative;cursor:default}
        .plan-card:hover{transform:translateY(-5px);box-shadow:0 28px 70px rgba(100,80,60,.15)}
        .plan-card.featured{border-color:rgba(26,22,18,.75)}
      `}</style>

      {/* ══════════════════════════════════════════════════════
          CINEMATIC INTRO OVERLAY
      ══════════════════════════════════════════════════════ */}
      {!introOver && (
        <div style={{
          position: "fixed", inset: 0, zIndex: 9999,
          display: "flex", alignItems: "center", justifyContent: "center",
          background: CR,
          animation: introPhase >= 2 ? "introFade .7s .1s cubic-bezier(.4,0,.2,1) both" : "none",
          pointerEvents: introPhase >= 2 ? "none" : "all",
        }}>
          {/* expanding circle */}
          <div style={{
            position: "absolute",
            width: 80, height: 80,
            borderRadius: "50%",
            background: BL,
            transformOrigin: "center center",
            animation: introPhase >= 1
              ? "introExpand .9s cubic-bezier(.4,0,.2,1) both"
              : "none",
          }} />
          {/* logo text — shown before expand */}
          {introPhase === 0 && (
            <div style={{
              position: "relative", zIndex: 2,
              fontFamily: IS, fontSize: 28, color: BL, letterSpacing: "-.5px",
              animation: "introLogoIn .5s cubic-bezier(.22,1,.36,1) both",
            }}>
              resumeai<sup style={{ fontSize: 12, opacity: .4, verticalAlign: "super" }}>®</sup>
            </div>
          )}
          {/* cream text over dark circle during expand */}
          {introPhase >= 1 && (
            <div style={{
              position: "relative", zIndex: 3,
              fontFamily: IS, fontSize: 28, color: CR, letterSpacing: "-.5px",
              animation: "introTextIn .6s cubic-bezier(.22,1,.36,1) both",
            }}>
              resumeai<sup style={{ fontSize: 12, opacity: .5, verticalAlign: "super" }}>®</sup>
            </div>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════
          NAV
      ══════════════════════════════════════════════════════ */}
      <header style={{ position: "fixed", top: 0, left: 0, right: 0, zIndex: 200, background: "rgba(245,240,235,.92)", backdropFilter: "blur(20px)", borderBottom: "1px solid rgba(26,22,18,.08)" }}>
        <div style={{ maxWidth: 1200, margin: "0 auto", padding: "0 36px", height: 60, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontFamily: IS, fontSize: 22, color: BL, letterSpacing: "-.3px" }}>
            resumeai<sup style={{ fontSize: 10, opacity: .45, verticalAlign: "super" }}>®</sup>
          </span>
          <nav style={{ display: "flex", alignItems: "center", gap: 4 }}>
            {[["How it works", "#how"], ["Pricing", "#pricing"]].map(([l, h]) => (
              <a key={l} href={h} style={{ fontSize: 13, color: MU, textDecoration: "none", padding: "6px 14px", borderRadius: 8, transition: "color .15s", fontFamily: IF, fontWeight: 500 }}
                onMouseEnter={e => e.currentTarget.style.color = BL}
                onMouseLeave={e => e.currentTarget.style.color = MU}>{l}</a>
            ))}
            <button className="land-btn" onClick={onSignIn} style={{ padding: "9px 20px", marginLeft: 8 }}>
              <Icon n="google" s={13} /> Sign in
            </button>
          </nav>
        </div>
      </header>

      {/* ══════════════════════════════════════════════════════
          HERO
      ══════════════════════════════════════════════════════ */}
      <section style={{ position: "relative", minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", padding: "140px 24px 80px", overflow: "hidden" }}>
        {/* ambient blobs */}
        <div style={{ position: "absolute", top: "5%", left: "-8%", width: 600, height: 500, borderRadius: "50%", background: "radial-gradient(circle, rgba(196,176,230,.38) 0%, transparent 65%)", pointerEvents: "none" }} />
        <div style={{ position: "absolute", top: "20%", right: "-6%", width: 480, height: 400, borderRadius: "50%", background: "radial-gradient(circle, rgba(230,196,210,.32) 0%, transparent 65%)", pointerEvents: "none" }} />
        <div style={{ position: "absolute", bottom: "12%", left: "28%", width: 400, height: 280, borderRadius: "50%", background: "radial-gradient(circle, rgba(200,210,240,.28) 0%, transparent 65%)", pointerEvents: "none" }} />

        {/* floating resume cards */}
        <div style={{ position: "absolute", left: "3%", top: "22%", opacity: .85 }}>
          <ResumeCard tilt={-9} delay="0s" />
        </div>
        <div style={{ position: "absolute", right: "2%", top: "28%", opacity: .78 }}>
          <ResumeCard tilt={8} delay="1.4s" />
        </div>

        {/* pill */}
        <div className="riseIn" style={{ display: "inline-flex", alignItems: "center", gap: 7, marginBottom: 30, padding: "5px 16px 5px 10px", background: "rgba(99,102,241,.08)", border: "1px solid rgba(99,102,241,.2)", borderRadius: 100 }}>
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#10b981", display: "inline-block", boxShadow: "0 0 7px rgba(16,185,129,.7)" }} />
          <span style={{ fontSize: 12, color: AC, fontWeight: 600, letterSpacing: ".2px" }}>Resume · Cover Letter · Outreach Email</span>
        </div>

        <h1 className="riseIn-1" style={{ fontFamily: IS, fontWeight: 400, fontSize: "clamp(54px,8.5vw,112px)", lineHeight: .9, letterSpacing: "-3.5px", maxWidth: 1000, color: BL, marginBottom: 28 }}>
          It's not a resume.<br />
          <em style={{ fontStyle: "italic", color: AC }}>It's your career.</em>
        </h1>

        <p className="riseIn-2" style={{ fontSize: "clamp(15px,1.6vw,18px)", color: MU, lineHeight: 1.82, maxWidth: 510, marginBottom: 44, fontWeight: 300 }}>
          Paste any job description. AI tailors your resume, cover letter, and outreach email — in 60 seconds — using only your real experience.
        </p>

        <div className="riseIn-3" style={{ display: "flex", gap: 12, flexWrap: "wrap", justifyContent: "center", marginBottom: 72 }}>
          <button className="land-btn" onClick={onSignIn}><Icon n="google" s={15} /> Start free — no card</button>
          <a className="land-btn-ghost" href="#how">See how it works →</a>
        </div>

        <div className="riseIn-4"><AppIcons /></div>
      </section>

      {/* ══════════════════════════════════════════════════════
          CLOUD DIVIDER → lavender
      ══════════════════════════════════════════════════════ */}
      <CloudBand id="1" fromColor={CR} toColor="#ddd0ee" />

      {/* ══════════════════════════════════════════════════════
          "IT'S NOT AN APP" — lavender world
      ══════════════════════════════════════════════════════ */}
      <section style={{ background: "linear-gradient(180deg,#ddd0ee 0%,#e8e2f5 100%)", padding: "80px 32px 60px", textAlign: "center" }}>
        <div style={{ maxWidth: 700, margin: "0 auto" }}>
          <p style={{ fontFamily: IS, fontStyle: "italic", fontSize: 13, color: "#9070b0", marginBottom: 18, letterSpacing: "1px" }}>Beta Space</p>
          <h2 style={{ fontFamily: IS, fontWeight: 400, fontSize: "clamp(30px,5vw,58px)", letterSpacing: "-2px", color: BL, lineHeight: 1.08, marginBottom: 20 }}>
            It's not an app.<br />It's not a website.<br />
            <em style={{ fontStyle: "italic" }}>It's your career on the internet.</em>
          </h2>
          <p style={{ fontSize: 15, color: MU, lineHeight: 1.85, maxWidth: 460, margin: "0 auto" }}>
            resumeai lives in your browser, gives your work a real voice, and puts a new opportunity in front of you every time.
          </p>
        </div>
        <div style={{ margin: "56px auto 0", display: "flex", justifyContent: "center" }}>
          <Plane />
        </div>
        <p style={{ fontFamily: IS, fontStyle: "italic", fontSize: 13, color: "#9070b0", marginTop: 14 }}>You're the Captain</p>
        <h3 style={{ fontFamily: IS, fontWeight: 400, fontSize: "clamp(22px,3.5vw,42px)", letterSpacing: "-1.5px", color: BL, marginTop: 6 }}>
          Fly a world of jobs<br />in your own direction
        </h3>
      </section>

      {/* ══════════════════════════════════════════════════════
          WAVE DIVIDER → cream
      ══════════════════════════════════════════════════════ */}
      <WaveDivider fromBg="#e8e2f5" toBg={CR} />

      {/* ══════════════════════════════════════════════════════
          VIDEO SECTION — play only, animated button
      ══════════════════════════════════════════════════════ */}
      <section style={{ background: CR, padding: "80px 32px 100px", textAlign: "center" }}>
        <div style={{ maxWidth: 900, margin: "0 auto" }}>
          <p style={{ fontFamily: IS, fontStyle: "italic", fontSize: 13, color: "#9070b0", marginBottom: 16 }}>See It In Action</p>
          <h2 style={{ fontFamily: IS, fontWeight: 400, fontSize: "clamp(28px,4vw,52px)", letterSpacing: "-2px", color: BL, marginBottom: 14 }}>
            From job post to<br />interview-ready in 60 seconds.
          </h2>
          <p style={{ fontSize: 14, color: MU, marginBottom: 52, lineHeight: 1.8, maxWidth: 440, margin: "0 auto 52px" }}>
            Watch how resumeai reads a job description and builds a fully tailored resume, cover letter, and email — live.
          </p>

          {/* video container */}
          <div style={{ position: "relative", borderRadius: 24, overflow: "hidden", boxShadow: "0 40px 100px rgba(100,80,60,.18), 0 8px 24px rgba(0,0,0,.08)", background: "#1a1612", aspectRatio: "16/9", maxWidth: 860, margin: "0 auto" }}>

            {/* actual video — swap src with your recording */}
            <video
              ref={videoRef}
              muted
              playsInline
              preload="metadata"
              onEnded={() => setVideoPlaying(false)}
              style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
              src="" /* ← paste your video URL here */
            />

            {/* poster overlay (cream-toned placeholder) */}
            {!videoPlaying && (
              <div style={{ position: "absolute", inset: 0, background: "linear-gradient(135deg,#2a2016 0%,#1a1612 50%,#221820 100%)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                {/* subtle grid lines */}
                <div style={{ position: "absolute", inset: 0, backgroundImage: "linear-gradient(rgba(245,240,235,.03) 1px,transparent 1px),linear-gradient(90deg,rgba(245,240,235,.03) 1px,transparent 1px)", backgroundSize: "40px 40px" }} />
                {/* soft glow */}
                <div style={{ position: "absolute", width: 400, height: 400, borderRadius: "50%", background: "radial-gradient(circle,rgba(196,160,220,.12) 0%,transparent 65%)" }} />
                {/* mock screen content hint */}
                <div style={{ position: "absolute", inset: "15%", background: "rgba(245,240,235,.03)", borderRadius: 12, border: "1px solid rgba(245,240,235,.06)" }} />
              </div>
            )}

            {/* ANIMATED PLAY BUTTON */}
            <button
              onClick={handlePlayToggle}
              style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)", background: "none", border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 10 }}>

              {videoPlaying ? (
                /* pause icon */
                <div style={{ width: 64, height: 64, borderRadius: "50%", background: "rgba(245,240,235,.18)", border: "2px solid rgba(245,240,235,.45)", backdropFilter: "blur(8px)", display: "flex", alignItems: "center", justifyContent: "center", transition: "all .2s" }}
                  onMouseEnter={e => { e.currentTarget.style.background = "rgba(245,240,235,.28)"; e.currentTarget.style.transform = "scale(1.08)"; }}
                  onMouseLeave={e => { e.currentTarget.style.background = "rgba(245,240,235,.18)"; e.currentTarget.style.transform = "none"; }}>
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <rect x="6" y="4" width="4" height="16" rx="2" fill="#f5f0eb" />
                    <rect x="14" y="4" width="4" height="16" rx="2" fill="#f5f0eb" />
                  </svg>
                </div>
              ) : (
                /* animated play button */
                <div style={{ position: "relative", width: 90, height: 90 }}>
                  {/* outer pulse ring 1 */}
                  <div style={{ position: "absolute", inset: -8, borderRadius: "50%", border: "1.5px solid rgba(245,240,235,.22)", animation: "playRing1 2.2s cubic-bezier(.4,0,.6,1) infinite" }} />
                  {/* outer pulse ring 2 */}
                  <div style={{ position: "absolute", inset: -8, borderRadius: "50%", border: "1.5px solid rgba(245,240,235,.14)", animation: "playRing2 2.2s .55s cubic-bezier(.4,0,.6,1) infinite" }} />
                  {/* spinning dashed ring */}
                  <svg style={{ position: "absolute", inset: 0, animation: "playRotate 8s linear infinite" }} viewBox="0 0 90 90" xmlns="http://www.w3.org/2000/svg">
                    <circle cx="45" cy="45" r="43" fill="none" stroke="rgba(245,240,235,.2)" strokeWidth="1" strokeDasharray="6 5" />
                  </svg>
                  {/* main circle */}
                  <div style={{ position: "absolute", inset: 0, borderRadius: "50%", background: "rgba(245,240,235,.14)", border: "2px solid rgba(245,240,235,.5)", backdropFilter: "blur(10px)", animation: "playPulse 2.8s ease-in-out infinite", transition: "all .22s" }}
                    onMouseEnter={e => { e.currentTarget.style.background = "rgba(245,240,235,.24)"; e.currentTarget.style.borderColor = "rgba(245,240,235,.8)"; e.currentTarget.style.transform = "scale(1.08)"; }}
                    onMouseLeave={e => { e.currentTarget.style.background = "rgba(245,240,235,.14)"; e.currentTarget.style.borderColor = "rgba(245,240,235,.5)"; e.currentTarget.style.transform = "none"; }}>
                  </div>
                  {/* triangle */}
                  <svg style={{ position: "absolute", top: "50%", left: "52%", transform: "translate(-50%,-50%)", animation: "playTriangleIn .4s cubic-bezier(.22,1,.36,1) both" }} width="28" height="28" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M6.5 5.5l12 6.5-12 6.5V5.5z" fill="#f5f0eb" stroke="#f5f0eb" strokeWidth=".5" strokeLinejoin="round" />
                  </svg>
                </div>
              )}
            </button>

            {/* bottom label */}
            {!videoPlaying && (
              <div style={{ position: "absolute", bottom: 20, left: "50%", transform: "translateX(-50%)", fontSize: 11, color: "rgba(245,240,235,.45)", letterSpacing: "1.5px", textTransform: "uppercase", fontFamily: IF, whiteSpace: "nowrap" }}>
                Watch the demo · 60 sec
              </div>
            )}
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════
          ORNAMENTAL DIVIDER — thin ruled line with diamond
      ══════════════════════════════════════════════════════ */}
      <div style={{ display: "flex", alignItems: "center", gap: 0, padding: "0 40px", background: CR }}>
        <div style={{ flex: 1, height: 1, background: "rgba(26,22,18,.1)" }} />
        <div style={{ padding: "0 20px" }}>
          <svg width="16" height="16" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">
            <rect x="7" y="0" width="2" height="16" fill="rgba(26,22,18,.18)" />
            <rect x="0" y="7" width="16" height="2" fill="rgba(26,22,18,.18)" />
            <rect x="5" y="5" width="6" height="6" fill={CR} transform="rotate(45 8 8)" />
            <rect x="5" y="5" width="6" height="6" stroke="rgba(26,22,18,.22)" strokeWidth="1" fill="none" transform="rotate(45 8 8)" />
          </svg>
        </div>
        <div style={{ flex: 1, height: 1, background: "rgba(26,22,18,.1)" }} />
      </div>

      {/* ══════════════════════════════════════════════════════
          OWN YOUR DATA — two column
      ══════════════════════════════════════════════════════ */}
      <section style={{ background: CR, padding: "80px 32px 100px" }}>
        <div style={{ maxWidth: 1100, margin: "0 auto", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 80, alignItems: "center" }}>
          <div>
            <p style={{ fontFamily: IS, fontStyle: "italic", fontSize: 13, color: "#9070b0", marginBottom: 16 }}>Own Your Future</p>
            <h2 style={{ fontFamily: IS, fontWeight: 400, fontSize: "clamp(26px,4vw,52px)", letterSpacing: "-2px", color: BL, lineHeight: 1.05, marginBottom: 20 }}>
              The resume is yours,<br />the data is yours.
            </h2>
            <p style={{ fontSize: 14, color: MU, lineHeight: 1.85, marginBottom: 32 }}>
              resumeai runs on your content. You own every word it writes. Export, edit, delete — anything you want, anytime.
            </p>
            <div style={{ display: "flex", flexDirection: "column" }}>
              <FeatureRow emoji="📄" title="AI-Tailored Resume" desc="ATS-optimized. Every bullet in the JD's exact language." color="#f0f0fb" />
              <FeatureRow emoji="✉️" title="Cover Letter" desc="Strong hook, real story, confident CTA. 300 words. Human." color="#f0faf5" />
              <FeatureRow emoji="📧" title="Outreach Email" desc="Cold email or follow-up. Specific subject, one key win, clear ask." color="#fff5f0" />
            </div>
          </div>
          <div style={{ display: "flex", justifyContent: "center" }}>
            <MockChat />
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════
          WAVE DIVIDER → dark
      ══════════════════════════════════════════════════════ */}
      <WaveDivider fromBg={CR} toBg="#1a1612" />

      {/* ══════════════════════════════════════════════════════
          DARK INTERLUDE
      ══════════════════════════════════════════════════════ */}
      <section style={{ background: "#1a1612", padding: "80px 32px 100px", textAlign: "center" }}>
        <p style={{ fontFamily: IS, fontStyle: "italic", fontSize: 13, color: "rgba(196,176,230,.6)", marginBottom: 18 }}>For Dreamers</p>
        <h2 style={{ fontFamily: IS, fontWeight: 400, fontSize: "clamp(28px,4.5vw,60px)", letterSpacing: "-2px", color: "#f5f0eb", lineHeight: 1.05, marginBottom: 18 }}>
          Build it for yourself,<br />see it run everywhere.
        </h2>
        <p style={{ fontSize: 14, color: "rgba(245,240,235,.42)", lineHeight: 1.85, maxWidth: 460, margin: "0 auto 44px" }}>
          Dream up the resume the role deserves — tailored in seconds, for the future.
        </p>
        <button className="land-btn" onClick={onSignIn} style={{ background: "#f5f0eb", color: "#1a1612" }}
          onMouseEnter={e => { e.currentTarget.style.background = "#fff"; e.currentTarget.style.transform = "translateY(-2px)"; }}
          onMouseLeave={e => { e.currentTarget.style.background = "#f5f0eb"; e.currentTarget.style.transform = "none"; }}>
          <Icon n="google" s={15} /> Get Started Free
        </button>
      </section>

      {/* ══════════════════════════════════════════════════════
          WAVE DIVIDER → cream
      ══════════════════════════════════════════════════════ */}
      <WaveDivider fromBg="#1a1612" toBg={CR} flip />

      {/* ══════════════════════════════════════════════════════
          HOW IT WORKS
      ══════════════════════════════════════════════════════ */}
      <section id="how" style={{ background: CR, padding: "60px 32px 100px" }}>
        <div style={{ maxWidth: 920, margin: "0 auto", textAlign: "center" }}>
          <p style={{ fontFamily: IS, fontStyle: "italic", fontSize: 13, color: "#9070b0", marginBottom: 16 }}>Think Outside The App</p>
          <h2 style={{ fontFamily: IS, fontWeight: 400, fontSize: "clamp(28px,4vw,52px)", letterSpacing: "-2px", color: BL, lineHeight: 1.05, marginBottom: 14 }}>
            Software teamwork to<br />help your dream work.
          </h2>
          <p style={{ fontSize: 14, color: MU, marginBottom: 60, lineHeight: 1.8 }}>Connected to your goals. Everything collaborates.</p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 14 }}>
            {[
              { emoji: "💼", title: "Paste the job", desc: "Drop any JD. Every keyword, requirement, culture signal extracted.", n: "01", bg: "#f0f0fb" },
              { emoji: "👤", title: "Add your background", desc: "Upload your resume or answer quick guided questions.", n: "02", bg: "#f0faf5" },
              { emoji: "✨", title: "AI tailors everything", desc: "Resume, cover letter, email — written for this exact role.", n: "03", bg: "#fff5f0" },
              { emoji: "⬇️", title: "Download & apply", desc: "ATS-clean PDF. Live editor. Switch templates. No watermarks.", n: "04", bg: "#f5f0fb" },
            ].map((s, i) => (
              <div key={i} style={{ background: s.bg, borderRadius: 20, padding: "28px 22px", textAlign: "left", border: "1.5px solid rgba(26,22,18,.06)", transition: "transform .2s, box-shadow .2s" }}
                onMouseEnter={e => { e.currentTarget.style.transform = "translateY(-4px)"; e.currentTarget.style.boxShadow = "0 18px 44px rgba(100,80,60,.11)"; }}
                onMouseLeave={e => { e.currentTarget.style.transform = "none"; e.currentTarget.style.boxShadow = "none"; }}>
                <div style={{ fontSize: 28, marginBottom: 14 }}>{s.emoji}</div>
                <div style={{ fontSize: 10, fontWeight: 700, color: MU, letterSpacing: "1.5px", marginBottom: 10 }}>{s.n}</div>
                <div style={{ fontFamily: IS, fontSize: 18, color: BL, marginBottom: 8, lineHeight: 1.2 }}>{s.title}</div>
                <div style={{ fontSize: 13, color: MU, lineHeight: 1.78 }}>{s.desc}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════
          MARQUEE — dark band
      ══════════════════════════════════════════════════════ */}
      <div style={{ background: "#1a1612", padding: "18px 0", overflow: "hidden" }}>
        <div style={{ display: "flex", animation: "marquee 34s linear infinite", width: "max-content" }}>
          {[...Array(2)].flatMap(() =>
            ["ATS Optimized", "AI Resume", "Cover Letter", "Cold Email", "6 Templates", "Culture Analysis", "PDF Export", "Live Editor", "Zero Fabrication"].map((item, i) => (
              <span key={`${i}-m`} style={{ padding: "0 32px", fontSize: 10, fontWeight: 500, color: "rgba(245,240,235,.28)", whiteSpace: "nowrap", letterSpacing: "2.5px", textTransform: "uppercase", fontFamily: IF }}>
                {item} <span style={{ marginLeft: 32, color: "rgba(196,176,230,.25)" }}>◆</span>
              </span>
            ))
          )}
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════
          PRICING
      ══════════════════════════════════════════════════════ */}
      <section id="pricing" style={{ background: CR, padding: "100px 32px" }}>
        <div style={{ maxWidth: 1000, margin: "0 auto" }}>
          <div style={{ textAlign: "center", marginBottom: 64 }}>
            <p style={{ fontFamily: IS, fontStyle: "italic", fontSize: 13, color: "#9070b0", marginBottom: 16 }}>Building a new platform</p>
            <h2 style={{ fontFamily: IS, fontWeight: 400, fontSize: "clamp(28px,4vw,52px)", letterSpacing: "-2px", color: BL, marginBottom: 10 }}>
              We're building a career tool<br />that inspires us.
            </h2>
            <p style={{ fontSize: 13, color: MU, marginTop: 12 }}>First 2 resumes free · ₹49 per doc · ₹1,499 lifetime</p>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(260px,1fr))", gap: 14, maxWidth: 960, margin: "0 auto" }}>
            {Object.entries(PLANS).map(([key, plan]) => (
              <div key={key} className={`plan-card${plan.popular ? " featured" : ""}`}>
                {plan.popular && <div style={{ position: "absolute", top: -12, left: "50%", transform: "translateX(-50%)", background: BL, color: CR, fontSize: 9, fontWeight: 700, padding: "4px 16px", borderRadius: 100, whiteSpace: "nowrap", letterSpacing: "1px", fontFamily: IF }}>MOST POPULAR</div>}
                {plan.badge && <div style={{ position: "absolute", top: -12, left: "50%", transform: "translateX(-50%)", background: "#f59e0b", color: "#000", fontSize: 9, fontWeight: 700, padding: "4px 16px", borderRadius: 100, whiteSpace: "nowrap" }}>{plan.badge}</div>}
                <div style={{ fontSize: 10, fontWeight: 700, color: MU, letterSpacing: "1px", textTransform: "uppercase", marginBottom: 12, fontFamily: IF }}>{plan.name}</div>
                <div style={{ fontFamily: IS, fontSize: 48, fontWeight: 400, letterSpacing: "-2px", color: BL, marginBottom: 4, lineHeight: 1 }}>
                  {plan.inr === 0 ? "Free" : `₹${plan.inr}`}
                </div>
                <div style={{ fontSize: 12, color: MU, marginBottom: 26, fontFamily: IF }}>
                  {plan.inr === 0 ? "forever" : plan.inr === 49 ? "per document" : "one-time"}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 28 }}>
                  {plan.features.map((f, i) => (
                    <div key={i} style={{ display: "flex", gap: 9, alignItems: "flex-start" }}>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={BL} strokeWidth="2.5" strokeLinecap="round" style={{ marginTop: 2, flexShrink: 0, opacity: .45 }}><path d="M4.5 12.75l6 6 9-13.5" /></svg>
                      <span style={{ fontSize: 13, color: MU, lineHeight: 1.45, fontFamily: IF }}>{f}</span>
                    </div>
                  ))}
                </div>
                <button onClick={onSignIn} style={{ width: "100%", padding: "12px 0", borderRadius: 100, border: plan.popular ? "none" : "1.5px solid rgba(26,22,18,.18)", background: plan.popular ? BL : "transparent", color: plan.popular ? CR : BL, fontSize: 13, fontWeight: 500, cursor: "pointer", fontFamily: IF, transition: "all .18s" }}
                  onMouseEnter={e => { if (plan.popular) e.currentTarget.style.background = "#2d2720"; else { e.currentTarget.style.background = "rgba(26,22,18,.04)"; e.currentTarget.style.borderColor = "rgba(26,22,18,.5)"; } }}
                  onMouseLeave={e => { if (plan.popular) e.currentTarget.style.background = BL; else { e.currentTarget.style.background = "transparent"; e.currentTarget.style.borderColor = "rgba(26,22,18,.18)"; } }}
                >{plan.cta}</button>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════
          CLOUD DIVIDER into final CTA
      ══════════════════════════════════════════════════════ */}
      <CloudBand id="2" fromColor={CR} toColor="#e8dff5" />

      {/* ══════════════════════════════════════════════════════
          FINAL CTA
      ══════════════════════════════════════════════════════ */}
      <section style={{ background: "linear-gradient(180deg,#e8dff5 0%,#ddd4f0 100%)", padding: "80px 32px 100px", textAlign: "center" }}>
        <div style={{ maxWidth: 560, margin: "0 auto" }}>
          <p style={{ fontFamily: IS, fontStyle: "italic", fontSize: 13, color: "#9070b0", marginBottom: 18 }}>Beginning a new position</p>
          <h2 style={{ fontFamily: IS, fontWeight: 400, fontSize: "clamp(36px,5.5vw,68px)", letterSpacing: "-2.5px", lineHeight: .94, marginBottom: 22, color: BL }}>
            We're building a resume<br />that <em style={{ fontStyle: "italic", color: AC }}>inspires us.</em>
          </h2>
          <p style={{ fontSize: 15, color: MU, lineHeight: 1.8, marginBottom: 40, maxWidth: 400, margin: "0 auto 40px" }}>
            A cloud resume designed around the person. AI-powered, honest, and yours.
          </p>
          <button className="land-btn" onClick={onSignIn}><Icon n="google" s={15} /> Get Started Free</button>
          <div style={{ marginTop: 14, fontSize: 12, color: MU, opacity: .65, fontFamily: IF }}>No card · 2 free resumes · Instant PDF</div>
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════
          FOOTER
      ══════════════════════════════════════════════════════ */}
      <footer style={{ background: "#1a1612", padding: "52px 40px 36px" }}>
        <div style={{ maxWidth: 1200, margin: "0 auto" }}>
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr 1fr", gap: 40, marginBottom: 52, paddingBottom: 40, borderBottom: "1px solid rgba(245,240,235,.07)" }}>
            <div>
              <div style={{ fontFamily: IS, fontSize: 22, color: "#f5f0eb", marginBottom: 14, letterSpacing: "-.3px" }}>
                resumeai<sup style={{ fontSize: 10, opacity: .4, verticalAlign: "super" }}>®</sup>
              </div>
              <div style={{ fontSize: 13, color: "rgba(245,240,235,.36)", lineHeight: 1.78, maxWidth: 210, fontFamily: IF }}>
                The cloud resume designed around the person, not the recruiter.
              </div>
            </div>
            {[
              { h: "Product", links: ["Resume Builder", "Cover Letters", "Outreach Emails", "Templates", "Pricing"] },
              { h: "Company", links: ["About", "Blog", "Careers", "Press"] },
              { h: "Legal", links: ["Privacy", "Terms", "Cookies"] },
              { h: "Support", links: ["Docs", "GitHub", "Discord", "Contact"] },
            ].map((col, i) => (
              <div key={i}>
                <div style={{ fontSize: 10, fontWeight: 700, color: "rgba(245,240,235,.28)", letterSpacing: "1.8px", textTransform: "uppercase", marginBottom: 18, fontFamily: IF }}>{col.h}</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
                  {col.links.map(l => (
                    <a key={l} href="#" style={{ fontSize: 13, color: "rgba(245,240,235,.42)", textDecoration: "none", fontFamily: IF, transition: "color .15s" }}
                      onMouseEnter={e => e.currentTarget.style.color = "#f5f0eb"}
                      onMouseLeave={e => e.currentTarget.style.color = "rgba(245,240,235,.42)"}>{l}</a>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
            <span style={{ fontSize: 12, color: "rgba(245,240,235,.2)", fontFamily: IF }}>Beta · The Studio & Dreamers</span>
            <span style={{ fontSize: 12, color: "rgba(245,240,235,.2)", fontFamily: IF }}>© 2025 resumeai</span>
          </div>
        </div>
      </footer>
    </div>
  );
};



// ─── AUTH MODAL ───────────────────────────────────────────────────────────────
const AuthModal = ({ onClose }) => {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const signIn = async () => {
    setBusy(true); setErr(null);
    const { error } = await supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo: window.location.origin } });
    if (error) { setErr(error.message); setBusy(false); }
  };
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }} onClick={onClose}>
      <div style={{ position: "absolute", inset: 0, background: "rgba(4,4,12,.88)", backdropFilter: "blur(24px)" }} />
      <div className="scale-in" style={{ position: "relative", background: "#0f0f1f", borderRadius: 22, padding: "48px 44px", maxWidth: 380, width: "100%", textAlign: "center", boxShadow: "0 40px 100px rgba(0,0,0,.7), 0 0 0 1px rgba(255,255,255,.07)", border: "1px solid rgba(255,255,255,.07)" }} onClick={e => e.stopPropagation()}>
        <button onClick={onClose} style={{ position: "absolute", top: 16, right: 16, background: "rgba(255,255,255,.05)", border: "1px solid rgba(255,255,255,.08)", cursor: "pointer", borderRadius: 8, padding: "6px 7px", transition: "all .15s" }}
          onMouseEnter={e => e.currentTarget.style.background = "rgba(255,255,255,.1)"}
          onMouseLeave={e => e.currentTarget.style.background = "rgba(255,255,255,.05)"}>
          <Icon n="x" s={13} c="rgba(255,255,255,.5)" />
        </button>
        <div style={{ width: 56, height: 56, background: "linear-gradient(135deg, #6366f1, #8b5cf6)", borderRadius: 16, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 26px", boxShadow: "0 0 40px rgba(99,102,241,.4)", animation: "float 3s ease-in-out infinite" }}>
          <Icon n="spark" s={26} c="#fff" />
        </div>
        <h2 style={{ fontFamily: "'Instrument Serif',serif", fontSize: 28, fontWeight: 400, color: "#f5f5ff", marginBottom: 10, letterSpacing: "-.5px" }}>Welcome to resumeai</h2>
        <p style={{ fontSize: 14, color: "rgba(240,240,248,.4)", lineHeight: 1.65, marginBottom: 30 }}>Sign in to build AI-tailored resumes, cover letters, and outreach emails.</p>
        {err && <div style={{ background: "rgba(244,63,94,.08)", border: "1px solid rgba(244,63,94,.2)", borderRadius: 8, padding: "10px 14px", fontSize: 13, color: "#f43f5e", marginBottom: 16 }}>{err}</div>}
        <button onClick={signIn} disabled={busy} style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 10, padding: "14px 20px", background: "rgba(255,255,255,.06)", border: "1px solid rgba(255,255,255,.12)", borderRadius: 11, cursor: busy ? "wait" : "pointer", fontSize: 14, fontWeight: 500, color: "#f0f0f8", transition: "all .18s", fontFamily: "'DM Sans',sans-serif" }}
          onMouseEnter={e => { if (!busy) { e.currentTarget.style.background = "rgba(255,255,255,.1)"; e.currentTarget.style.borderColor = "rgba(99,102,241,.5)"; } }}
          onMouseLeave={e => { e.currentTarget.style.background = "rgba(255,255,255,.06)"; e.currentTarget.style.borderColor = "rgba(255,255,255,.12)"; }}>
          {busy ? <Spinner s={16} c="#f0f0f8" /> : <Icon n="google" s={17} />}
          {busy ? "Connecting..." : "Continue with Google"}
        </button>
        <p style={{ fontSize: 11, color: "rgba(255,255,255,.2)", marginTop: 18 }}>First 2 resumes free · No credit card ever</p>
      </div>
    </div>
  );
};

const Sidebar = ({ page, onNav, user, profile, onSignOut, collapsed, onToggle }) => {
  const planKey = profile?.plan || "free";
  const name = user?.user_metadata?.full_name || user?.email?.split("@")[0] || "You";
  const avatar = user?.user_metadata?.avatar_url;
  const navItems = [
    { id: "overview", label: "Dashboard", icon: "home" },
    { id: "resumes", label: "My Resumes", icon: "doc" },
    { id: "cover_letters", label: "Cover Letters", icon: "pen" },
    { id: "emails", label: "Outreach Emails", icon: "mail" },
    { id: "build", label: "New Application", icon: "spark", accent: true },
    { id: "plan", label: "Upgrade Plan", icon: "crown" },
  ];
  return (
    <div style={{ width: collapsed ? 62 : 248, background: "#0c0c18", height: "100vh", position: "fixed", left: 0, top: 0, zIndex: 100, display: "flex", flexDirection: "column", transition: "width .22s cubic-bezier(.4,0,.2,1)", borderRight: "1px solid rgba(255,255,255,.06)", overflow: "hidden" }}>
      {/* header */}
      <div style={{ padding: "0 14px", display: "flex", alignItems: "center", justifyContent: "space-between", height: 62, borderBottom: "1px solid rgba(255,255,255,.05)", flexShrink: 0 }}>
        {collapsed
          ? <div style={{ width: 34, height: 34, background: "linear-gradient(135deg, #6366f1, #8b5cf6)", borderRadius: 9, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto", cursor: "pointer", boxShadow: "0 0 20px rgba(99,102,241,.3)" }} onClick={onToggle}><Icon n="spark" s={15} c="#fff" /></div>
          : <>
            <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
              <div style={{ width: 30, height: 30, borderRadius: 8, background: "linear-gradient(135deg, #6366f1, #8b5cf6)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <Icon n="spark" s={13} c="#fff" />
              </div>
              <span style={{ fontFamily: "'Instrument Serif',serif", fontSize: 17, color: "#f0f0f8", letterSpacing: "-.2px" }}>resumeai</span>
            </div>
            <button onClick={onToggle} style={{ background: "none", border: "none", cursor: "pointer", color: "rgba(255,255,255,.3)", padding: 4, borderRadius: 5, transition: "color .15s" }}
              onMouseEnter={e => e.currentTarget.style.color = "rgba(255,255,255,.7)"}
              onMouseLeave={e => e.currentTarget.style.color = "rgba(255,255,255,.3)"}>
              <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M15 6l-6 6 6 6" /></svg>
            </button>
          </>
        }
      </div>

      {/* nav */}
      <nav style={{ padding: "12px 8px", flex: 1, overflowY: "auto" }}>
        {navItems.map(item => {
          const active = page === item.id;
          return (
            <button key={item.id} onClick={() => onNav(item.id)}
              style={{ width: "100%", display: "flex", alignItems: "center", gap: 9, padding: collapsed ? "11px 0" : "10px 12px", background: item.accent && !active ? "rgba(99,102,241,.1)" : active ? "rgba(99,102,241,.14)" : "none", border: active ? "1px solid rgba(99,102,241,.3)" : item.accent && !active ? "1px solid rgba(99,102,241,.15)" : "1px solid transparent", borderRadius: 9, color: active ? "#a5b4fc" : item.accent ? "#818cf8" : "rgba(255,255,255,.45)", cursor: "pointer", fontSize: 13, fontWeight: active ? 600 : 400, fontFamily: "'DM Sans',sans-serif", transition: "all .15s", marginBottom: 4, justifyContent: collapsed ? "center" : "flex-start", position: "relative" }}
              onMouseEnter={e => { if (!active) { e.currentTarget.style.background = item.accent ? "rgba(99,102,241,.14)" : "rgba(255,255,255,.05)"; e.currentTarget.style.color = "#fff"; } }}
              onMouseLeave={e => { if (!active) { e.currentTarget.style.background = item.accent ? "rgba(99,102,241,.1)" : "none"; e.currentTarget.style.color = active ? "#a5b4fc" : item.accent ? "#818cf8" : "rgba(255,255,255,.45)"; } }}>
              {active && !collapsed && <div style={{ position: "absolute", left: 0, top: "50%", transform: "translateY(-50%)", width: 3, height: 16, background: "#6366f1", borderRadius: "0 3px 3px 0", boxShadow: "0 0 8px rgba(99,102,241,.6)" }} />}
              <Icon n={item.icon} s={15} c={active ? "#818cf8" : item.accent ? "#818cf8" : "currentColor"} />
              {!collapsed && <span>{item.label}</span>}
            </button>
          );
        })}
      </nav>

      {/* upgrade nudge */}
      {!collapsed && planKey === "free" && (
        <div style={{ margin: "0 8px 8px", padding: "13px 14px", background: "rgba(99,102,241,.08)", border: "1px solid rgba(99,102,241,.2)", borderRadius: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: "#a5b4fc", marginBottom: 4 }}>Free plan · 2 resumes left</div>
          <button onClick={() => onNav("plan")} style={{ fontSize: 11, color: "#818cf8", background: "none", border: "none", cursor: "pointer", fontWeight: 600, padding: 0, fontFamily: "'DM Sans',sans-serif" }}>Upgrade for ₹49/doc →</button>
        </div>
      )}

      {/* user */}
      <div style={{ padding: "10px 8px", borderTop: "1px solid rgba(255,255,255,.05)", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9, padding: collapsed ? "10px 0" : "10px 10px", borderRadius: 9, justifyContent: collapsed ? "center" : "flex-start" }}>
          {avatar
            ? <img src={avatar} style={{ width: 30, height: 30, borderRadius: "50%", flexShrink: 0, border: "2px solid rgba(99,102,241,.3)" }} alt="" />
            : <div style={{ width: 30, height: 30, background: "linear-gradient(135deg, #6366f1, #8b5cf6)", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, fontSize: 12, fontWeight: 700, color: "#fff" }}>{name[0]?.toUpperCase()}</div>
          }
          {!collapsed && (
            <>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 500, color: "rgba(255,255,255,.75)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</div>
                <div style={{ fontSize: 10, color: "rgba(255,255,255,.3)", textTransform: "capitalize" }}>{planKey} plan</div>
              </div>
              <button onClick={onSignOut} style={{ background: "none", border: "none", cursor: "pointer", color: "rgba(255,255,255,.25)", padding: 5, borderRadius: 6, transition: "color .15s", flexShrink: 0 }}
                onMouseEnter={e => e.currentTarget.style.color = "#f43f5e"}
                onMouseLeave={e => e.currentTarget.style.color = "rgba(255,255,255,.25)"}>
                <Icon n="out" s={13} c="currentColor" />
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

const DashboardLayout = ({ user, profile, onSignOut, children, page, onNav }) => {
  const [collapsed, setCollapsed] = useState(window.innerWidth < 900);
  return (
    <div style={{ display: "flex", minHeight: "100vh", background: C.bg }}>
      <Sidebar page={page} onNav={onNav} user={user} profile={profile} onSignOut={onSignOut} collapsed={collapsed} onToggle={() => setCollapsed(c => !c)} />
      <div style={{ flex: 1, marginLeft: collapsed ? 60 : 240, transition: "margin-left .22s cubic-bezier(.4,0,.2,1)", minWidth: 0, overflowX: "hidden" }}>
        {children}
      </div>
    </div>
  );
};

// ─── OVERVIEW ─────────────────────────────────────────────────────────────────
const OverviewPage = ({ user, profile, resumes, coverLetters, outreachEmails, onBuild, onOpenResume, onNav }) => {
  const name = user?.user_metadata?.full_name?.split(" ")[0] || "there";
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  return (
    <div style={{ padding: "40px 40px 80px", maxWidth: 1000, color: C.text }} className="fade-in">
      {/* header */}
      <div style={{ marginBottom: 36 }}>
        <h1 style={{ fontFamily: "'Instrument Serif',serif", fontSize: 34, fontWeight: 400, letterSpacing: "-1px", color: "#f5f5ff", marginBottom: 6 }}>{greeting}, {name}</h1>
        <p style={{ fontSize: 14, color: "rgba(240,240,248,.4)" }}>Your job application dashboard</p>
      </div>

      {/* build CTA */}
      <div style={{ background: "linear-gradient(135deg, rgba(99,102,241,.12), rgba(139,92,246,.08))", border: "1px solid rgba(99,102,241,.25)", borderRadius: 18, padding: "32px 36px", marginBottom: 28, display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 20, boxShadow: "0 0 60px rgba(99,102,241,.08)" }}>
        <div>
          <h2 style={{ fontFamily: "'Instrument Serif',serif", fontSize: 22, fontWeight: 400, color: "#f5f5ff", marginBottom: 8 }}>Build a complete application kit</h2>
          <p style={{ fontSize: 13, color: "rgba(240,240,248,.45)", maxWidth: 480, lineHeight: 1.7 }}>Resume + cover letter + outreach email — all AI-tailored to the specific role, using only your real experience. Zero hallucination.</p>
        </div>
        <button className="btn-primary" onClick={onBuild} style={{ padding: "13px 26px", fontSize: 14, flexShrink: 0, boxShadow: "0 0 30px rgba(99,102,241,.35)" }}>
          <Icon n="spark" s={14} c="#fff" /> New Application <Icon n="arr" s={13} c="#fff" />
        </button>
      </div>

      {/* stats */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(145px,1fr))", gap: 12, marginBottom: 36 }}>
        {[
          { label: "Resumes Built", value: resumes.length, icon: "doc", color: "#6366f1", glow: "rgba(99,102,241,.2)" },
          { label: "Cover Letters", value: coverLetters.length, icon: "pen", color: "#8b5cf6", glow: "rgba(139,92,246,.2)" },
          { label: "Outreach Emails", value: outreachEmails.length, icon: "mail", color: "#10b981", glow: "rgba(16,185,129,.15)" },
          { label: "Companies Targeted", value: [...new Set([...resumes, ...coverLetters].map(r => r.company_name).filter(Boolean))].length, icon: "bolt", color: "#f59e0b", glow: "rgba(245,158,11,.15)" },
        ].map((s, i) => (
          <div key={i} style={{ background: "rgba(255,255,255,.03)", border: "1px solid rgba(255,255,255,.07)", borderRadius: 14, padding: "22px 20px", transition: "all .2s", cursor: "default" }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = `${s.color}40`; e.currentTarget.style.boxShadow = `0 0 30px ${s.glow}`; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = "rgba(255,255,255,.07)"; e.currentTarget.style.boxShadow = "none"; }}>
            <div style={{ width: 36, height: 36, background: `${s.color}18`, borderRadius: 9, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 14, border: `1px solid ${s.color}30` }}>
              <Icon n={s.icon} s={16} c={s.color} />
            </div>
            <div style={{ fontFamily: "'Instrument Serif',serif", fontSize: 32, fontWeight: 400, letterSpacing: "-1px", color: "#f5f5ff", marginBottom: 3, lineHeight: 1 }}>{s.value}</div>
            <div style={{ fontSize: 12, color: "rgba(240,240,248,.35)" }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* recent */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
        {[
          { title: "Recent Resumes", items: resumes.slice(0, 4), icon: "doc", color: "#6366f1", clickable: true, nav: "resumes" },
          { title: "Recent Cover Letters", items: coverLetters.slice(0, 4), icon: "pen", color: "#8b5cf6", clickable: false, nav: "cover_letters" },
        ].map((section, si) => (
          <div key={si}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
              <h3 style={{ fontSize: 13, fontWeight: 600, color: "rgba(255,255,255,.6)", letterSpacing: ".2px" }}>{section.title}</h3>
              <button onClick={() => onNav(section.nav)} style={{ fontSize: 12, color: "rgba(99,102,241,.7)", background: "none", border: "none", cursor: "pointer", fontFamily: "'DM Sans',sans-serif", transition: "color .15s" }}
                onMouseEnter={e => e.currentTarget.style.color = "#a5b4fc"}
                onMouseLeave={e => e.currentTarget.style.color = "rgba(99,102,241,.7)"}>View all →</button>
            </div>
            {section.items.length === 0
              ? <div style={{ textAlign: "center", padding: "36px 16px", border: "1px dashed rgba(255,255,255,.08)", borderRadius: 14 }}>
                <Icon n={section.icon} s={22} c="rgba(255,255,255,.15)" />
                <p style={{ fontSize: 13, color: "rgba(255,255,255,.2)", marginTop: 12 }}>None yet</p>
              </div>
              : <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {section.items.map(r => (
                  <div key={r.id} onClick={() => section.clickable && onOpenResume(r)}
                    style={{ display: "flex", alignItems: "center", gap: 12, padding: "13px 16px", background: "rgba(255,255,255,.03)", border: "1px solid rgba(255,255,255,.06)", borderRadius: 12, cursor: section.clickable ? "pointer" : "default", transition: "all .18s" }}
                    onMouseEnter={e => { if (section.clickable) { e.currentTarget.style.background = "rgba(255,255,255,.06)"; e.currentTarget.style.borderColor = `${section.color}35`; } }}
                    onMouseLeave={e => { e.currentTarget.style.background = "rgba(255,255,255,.03)"; e.currentTarget.style.borderColor = "rgba(255,255,255,.06)"; }}>
                    <div style={{ width: 34, height: 34, background: `${section.color}15`, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, border: `1px solid ${section.color}25` }}>
                      <Icon n={section.icon} s={14} c={section.color} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 500, fontSize: 12, color: "rgba(255,255,255,.75)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.title}</div>
                      <div style={{ fontSize: 11, color: "rgba(255,255,255,.25)", marginTop: 1 }}>{r.company_name || "—"}</div>
                    </div>
                    {section.clickable && <Icon n="arr" s={12} c="rgba(255,255,255,.2)" />}
                  </div>
                ))}
              </div>
            }
          </div>
        ))}
      </div>
    </div>
  );
};

// ─── RESUMES PAGE ─────────────────────────────────────────────────────────────
const ResumesPage = ({ resumes, setResumes, onBuild, onOpen }) => {
  const [search, setSearch] = useState("");
  const filtered = resumes.filter(r => !search || r.title?.toLowerCase().includes(search.toLowerCase()) || r.company_name?.toLowerCase().includes(search.toLowerCase()));
  const del = async (id, e) => {
    e.stopPropagation();
    if (!confirm("Delete this resume?")) return;
    await deleteItem("resumes", id);
    setResumes(r => r.filter(x => x.id !== id));
  };
  return (
    <div style={{ padding: "36px 36px 60px", color: C.text }} className="fade-in">
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 28, flexWrap: "wrap", gap: 14 }}>
        <div>
          <h1 style={{ fontFamily: "'Fraunces',serif", fontSize: 28, fontWeight: 900, letterSpacing: "-1px", color: C.text, marginBottom: 4 }}>My Resumes</h1>
          <p style={{ fontSize: 13, color: C.textMuted }}>{resumes.length} resume{resumes.length !== 1 ? "s" : ""} created</p>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          {resumes.length > 3 && <input className="input-dark" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search..." style={{ width: 190, padding: "9px 13px", fontSize: 13 }} />}
          <button onClick={onBuild} className="btn-primary"><Icon n="pls" s={13} c="#fff" /> New Resume</button>
        </div>
      </div>
      {filtered.length === 0
        ? <div style={{ textAlign: "center", padding: "76px 24px", border: `1.5px dashed ${C.border}`, borderRadius: 14 }}>
          <Icon n="doc" s={30} c={C.textLight} />
          <p style={{ fontSize: 15, color: C.textMuted, marginTop: 14, marginBottom: 4, fontWeight: 600 }}>{resumes.length === 0 ? "No resumes yet" : "Nothing matches"}</p>
          {resumes.length === 0 && <button className="btn-primary" onClick={onBuild} style={{ marginTop: 16 }}>Build your first resume</button>}
        </div>
        : <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(280px,1fr))", gap: 10 }}>
          {filtered.map(r => {
            const tpl = TEMPLATES.find(t => t.id === r.template) || TEMPLATES[0];
            const date = new Date(r.updated_at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
            return (
              <div key={r.id} onClick={() => onOpen(r)} className="card" style={{ padding: "20px", cursor: "pointer" }}
                onMouseEnter={e => { e.currentTarget.style.background = C.surfaceAlt; e.currentTarget.style.borderColor = C.accent + "40"; }}
                onMouseLeave={e => { e.currentTarget.style.background = C.surface; e.currentTarget.style.borderColor = C.border; }}>
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 14 }}>
                  <div style={{ width: 42, height: 42, background: tpl.preview + "18", borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <Icon n="doc" s={18} c={tpl.preview} />
                  </div>
                  <button onClick={e => del(r.id, e)} style={{ background: "none", border: "none", cursor: "pointer", padding: 5, borderRadius: 6, color: C.textLight, transition: "all .15s" }}
                    onMouseEnter={e => { e.currentTarget.style.background = "rgba(244,63,94,.08)"; e.currentTarget.style.color = C.rose; }}
                    onMouseLeave={e => { e.currentTarget.style.background = "none"; e.currentTarget.style.color = C.textLight; }}>
                    <Icon n="tr" s={13} c="currentColor" />
                  </button>
                </div>
                <div style={{ fontFamily: "'Syne',sans-serif", fontWeight: 700, fontSize: 13, color: C.text, marginBottom: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.title}</div>
                <div style={{ fontSize: 12, color: C.textMuted, marginBottom: 14 }}>{r.company_name || "No company"} · {date}</div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <span style={{ fontSize: 10, fontWeight: 700, color: tpl.preview, background: tpl.preview + "15", padding: "3px 10px", borderRadius: 100, border: `1px solid ${tpl.preview}25` }}>{tpl.n}</span>
                  <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: C.textMuted }}><Icon n="edit" s={10} c={C.textMuted} />Edit</div>
                </div>
              </div>
            );
          })}
        </div>
      }
    </div>
  );
};

// ─── COVER LETTERS PAGE ────────────────────────────────────────────────────────
const CoverLettersPage = ({ coverLetters, setCoverLetters, onBuild }) => {
  const [viewing, setViewing] = useState(null);
  const [copied, setCopied] = useState(false);

  const del = async (id, e) => {
    e?.stopPropagation();
    if (!confirm("Delete this cover letter?")) return;
    await deleteItem("cover_letters", id);
    setCoverLetters(r => r.filter(x => x.id !== id));
    if (viewing?.id === id) setViewing(null);
  };

  const copyText = (cl) => {
    const text = [`Subject: ${cl.content?.subject || ""}`, "", cl.content?.salutation || "Dear Hiring Manager,", "", ...(cl.content?.paragraphs || []), "", cl.content?.closing || "Best regards,", cl.content?.candidateName || ""].join("\n\n");
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (viewing) {
    const cl = viewing;
    return (
      <div style={{ padding: "36px 36px 60px", color: C.text, maxWidth: 780 }} className="fade-in">
        <button className="btn-ghost" onClick={() => setViewing(null)} style={{ marginBottom: 24 }}>← Back</button>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 24, flexWrap: "wrap", gap: 12 }}>
          <div>
            <h1 style={{ fontFamily: "'Fraunces',serif", fontSize: 24, fontWeight: 900, color: C.text, marginBottom: 4 }}>{cl.title}</h1>
            <p style={{ fontSize: 13, color: C.textMuted }}>{cl.company_name} · {new Date(cl.updated_at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}</p>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn-secondary" onClick={() => copyText(cl)}><Icon n="copy" s={13} c={C.textMuted} />{copied ? "Copied!" : "Copy Text"}</button>
            <button className="btn-danger" onClick={e => del(cl.id, e)}><Icon n="tr" s={13} c={C.rose} />Delete</button>
          </div>
        </div>
        <div style={{ background: C.surface, border: `1.5px solid ${C.border}`, borderRadius: 16, padding: "36px 40px", fontFamily: "'Lora',serif", lineHeight: 1.85 }}>
          {cl.content?.subject && <div style={{ fontSize: 13, fontWeight: 700, color: C.textMuted, marginBottom: 24, fontFamily: "'DM Sans',sans-serif", borderBottom: `1px solid ${C.border}`, paddingBottom: 16 }}>Subject: {cl.content.subject}</div>}
          <p style={{ marginBottom: 20, color: C.textMuted, fontSize: 14 }}>{cl.content?.salutation || "Dear Hiring Manager,"}</p>
          {(cl.content?.paragraphs || []).map((p, i) => <p key={i} style={{ marginBottom: 18, fontSize: 14.5, color: C.text, lineHeight: 1.9 }}>{p}</p>)}
          <p style={{ marginTop: 24, color: C.textMuted, fontSize: 14 }}>{cl.content?.closing || "Best regards,"}</p>
          <p style={{ fontWeight: 700, fontSize: 14, color: C.text, marginTop: 6 }}>{cl.content?.candidateName || ""}</p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: "36px 36px 60px", color: C.text }} className="fade-in">
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 28, flexWrap: "wrap", gap: 14 }}>
        <div>
          <h1 style={{ fontFamily: "'Fraunces',serif", fontSize: 28, fontWeight: 900, letterSpacing: "-1px", color: C.text, marginBottom: 4 }}>Cover Letters</h1>
          <p style={{ fontSize: 13, color: C.textMuted }}>{coverLetters.length} created</p>
        </div>
        <button onClick={onBuild} className="btn-primary"><Icon n="pls" s={13} c="#fff" /> New Cover Letter</button>
      </div>
      {coverLetters.length === 0
        ? <div style={{ textAlign: "center", padding: "76px 24px", border: `1.5px dashed ${C.border}`, borderRadius: 14 }}>
          <Icon n="pen" s={30} c={C.textLight} />
          <p style={{ fontSize: 15, color: C.textMuted, marginTop: 14, marginBottom: 4, fontWeight: 600 }}>No cover letters yet</p>
          <button className="btn-primary" onClick={onBuild} style={{ marginTop: 16 }}>Generate your first cover letter</button>
        </div>
        : <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(280px,1fr))", gap: 10 }}>
          {coverLetters.map(cl => (
            <div key={cl.id} onClick={() => setViewing(cl)} className="card" style={{ padding: "20px", cursor: "pointer" }}
              onMouseEnter={e => { e.currentTarget.style.background = C.surfaceAlt; e.currentTarget.style.borderColor = C.violet + "40"; }}
              onMouseLeave={e => { e.currentTarget.style.background = C.surface; e.currentTarget.style.borderColor = C.border; }}>
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 12 }}>
                <div style={{ width: 40, height: 40, background: C.violet + "15", borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <Icon n="pen" s={17} c={C.violet} />
                </div>
                <button onClick={e => del(cl.id, e)} style={{ background: "none", border: "none", cursor: "pointer", padding: 5, borderRadius: 6, color: C.textLight }}
                  onMouseEnter={e => { e.currentTarget.style.background = "rgba(244,63,94,.08)"; e.currentTarget.style.color = C.rose; }}
                  onMouseLeave={e => { e.currentTarget.style.background = "none"; e.currentTarget.style.color = C.textLight; }}>
                  <Icon n="tr" s={13} c="currentColor" />
                </button>
              </div>
              <div style={{ fontFamily: "'Syne',sans-serif", fontWeight: 700, fontSize: 13, color: C.text, marginBottom: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{cl.title}</div>
              <div style={{ fontSize: 12, color: C.textMuted, marginBottom: 10 }}>{cl.company_name || "No company"} · {new Date(cl.updated_at).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</div>
              {cl.content?.paragraphs?.[0] && <p style={{ fontSize: 11, color: C.textLight, lineHeight: 1.5, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>{cl.content.paragraphs[0]}</p>}
            </div>
          ))}
        </div>
      }
    </div>
  );
};

// ─── EMAILS PAGE ──────────────────────────────────────────────────────────────
const EmailsPage = ({ outreachEmails, setOutreachEmails, onBuild }) => {
  const [viewing, setViewing] = useState(null);
  const [copied, setCopied] = useState(false);

  const del = async (id, e) => {
    e?.stopPropagation();
    if (!confirm("Delete this email?")) return;
    await deleteItem("outreach_emails", id);
    setOutreachEmails(r => r.filter(x => x.id !== id));
    if (viewing?.id === id) setViewing(null);
  };

  const copyText = (em) => {
    const text = [`Subject: ${em.content?.subject || ""}`, "", em.content?.greeting || "", "", ...(em.content?.paragraphs || []), "", em.content?.closing || "Best,", em.content?.candidateName || ""].join("\n\n");
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const openMailClient = (em) => {
    const body = [em.content?.greeting || "", "", ...(em.content?.paragraphs || []), "", em.content?.closing || "Best,", em.content?.candidateName || ""].join("\n\n");
    window.open(`mailto:?subject=${encodeURIComponent(em.content?.subject || "")}&body=${encodeURIComponent(body)}`);
  };

  if (viewing) {
    const em = viewing;
    return (
      <div style={{ padding: "36px 36px 60px", color: C.text, maxWidth: 780 }} className="fade-in">
        <button className="btn-ghost" onClick={() => setViewing(null)} style={{ marginBottom: 24 }}>← Back</button>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 24, flexWrap: "wrap", gap: 12 }}>
          <div>
            <h1 style={{ fontFamily: "'Fraunces',serif", fontSize: 24, fontWeight: 900, color: C.text, marginBottom: 4 }}>{em.title}</h1>
            <p style={{ fontSize: 13, color: C.textMuted }}>{em.company_name} · {new Date(em.updated_at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}</p>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button className="btn-secondary" onClick={() => copyText(em)}><Icon n="copy" s={13} c={C.textMuted} />{copied ? "Copied!" : "Copy"}</button>
            <button className="btn-primary" onClick={() => openMailClient(em)}><Icon n="mail" s={13} c="#fff" />Open in Mail</button>
            <button className="btn-danger" onClick={e => del(em.id, e)}><Icon n="tr" s={13} c={C.rose} />Delete</button>
          </div>
        </div>
        <div style={{ background: C.surface, border: `1.5px solid ${C.border}`, borderRadius: 16, overflow: "hidden" }}>
          <div style={{ padding: "16px 24px", background: C.surfaceAlt, borderBottom: `1px solid ${C.border}` }}>
            <div style={{ fontSize: 11, color: C.textLight, marginBottom: 3, fontWeight: 600, textTransform: "uppercase", letterSpacing: "1px" }}>Subject</div>
            <div style={{ fontSize: 14, fontWeight: 600, color: C.text }}>{em.content?.subject || "—"}</div>
          </div>
          <div style={{ padding: "28px 32px", fontFamily: "'Lora',serif", lineHeight: 1.85 }}>
            <p style={{ marginBottom: 20, color: C.textMuted, fontSize: 14 }}>{em.content?.greeting || "Hi there,"}</p>
            {(em.content?.paragraphs || []).map((p, i) => <p key={i} style={{ marginBottom: 18, fontSize: 14.5, color: C.text, lineHeight: 1.85 }}>{p}</p>)}
            <p style={{ marginTop: 24, color: C.textMuted, fontSize: 14 }}>{em.content?.closing || "Best,"}</p>
            <p style={{ fontWeight: 700, fontSize: 14, color: C.text, marginTop: 6 }}>{em.content?.candidateName || ""}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: "36px 36px 60px", color: C.text }} className="fade-in">
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 28, flexWrap: "wrap", gap: 14 }}>
        <div>
          <h1 style={{ fontFamily: "'Fraunces',serif", fontSize: 28, fontWeight: 900, letterSpacing: "-1px", color: C.text, marginBottom: 4 }}>Outreach Emails</h1>
          <p style={{ fontSize: 13, color: C.textMuted }}>{outreachEmails.length} email{outreachEmails.length !== 1 ? "s" : ""} created</p>
        </div>
        <button onClick={onBuild} className="btn-primary"><Icon n="pls" s={13} c="#fff" /> New Email</button>
      </div>
      {outreachEmails.length === 0
        ? <div style={{ textAlign: "center", padding: "76px 24px", border: `1.5px dashed ${C.border}`, borderRadius: 14 }}>
          <Icon n="mail" s={30} c={C.textLight} />
          <p style={{ fontSize: 15, color: C.textMuted, marginTop: 14, marginBottom: 4, fontWeight: 600 }}>No outreach emails yet</p>
          <button className="btn-primary" onClick={onBuild} style={{ marginTop: 16 }}>Generate your first outreach email</button>
        </div>
        : <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(280px,1fr))", gap: 10 }}>
          {outreachEmails.map(em => (
            <div key={em.id} onClick={() => setViewing(em)} className="card" style={{ padding: "20px", cursor: "pointer" }}
              onMouseEnter={e => { e.currentTarget.style.background = C.surfaceAlt; e.currentTarget.style.borderColor = C.emerald + "40"; }}
              onMouseLeave={e => { e.currentTarget.style.background = C.surface; e.currentTarget.style.borderColor = C.border; }}>
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 12 }}>
                <div style={{ width: 40, height: 40, background: C.emerald + "15", borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <Icon n="mail" s={17} c={C.emerald} />
                </div>
                <button onClick={e => del(em.id, e)} style={{ background: "none", border: "none", cursor: "pointer", padding: 5, borderRadius: 6, color: C.textLight }}
                  onMouseEnter={e => { e.currentTarget.style.background = "rgba(244,63,94,.08)"; e.currentTarget.style.color = C.rose; }}
                  onMouseLeave={e => { e.currentTarget.style.background = "none"; e.currentTarget.style.color = C.textLight; }}>
                  <Icon n="tr" s={13} c="currentColor" />
                </button>
              </div>
              <div style={{ fontFamily: "'Syne',sans-serif", fontWeight: 700, fontSize: 13, color: C.text, marginBottom: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{em.title}</div>
              <div style={{ fontSize: 12, color: C.textMuted, marginBottom: 8 }}>{em.company_name} · {new Date(em.updated_at).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</div>
              {em.content?.subject && <div style={{ fontSize: 11, color: C.textLight, fontStyle: "italic", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>Subj: {em.content.subject}</div>}
            </div>
          ))}
        </div>
      }
    </div>
  );
};

// ─── PLAN PAGE ────────────────────────────────────────────────────────────────
const PlanPage = ({ user, profile, onPlanSuccess }) => {
  const [paying, setPaying] = useState(null);
  const [msg, setMsg] = useState(null);
  const planKey = profile?.plan || "free";
  const handlePay = (key, amount) => {
    if (key === "free" || key === planKey) return;
    setPaying(key); setMsg(null);
    openRazorpay({
      amount, label: `ResumeAI ${PLANS[key].name}`, user,
      onSuccess: async (paymentId) => {
        await supabase.from("profiles").update({ plan: key, payment_id: paymentId, plan_updated_at: new Date().toISOString() }).eq("id", user.id);
        onPlanSuccess(key);
        setMsg({ t: "ok", m: `You're now on the ${PLANS[key].name} plan! 🎉` });
        setPaying(null);
      },
      onError: (e) => { setMsg({ t: "err", m: e }); setPaying(null); },
    });
  };
  return (
    <div style={{ padding: "36px 36px 60px", color: C.text }} className="fade-in">
      <h1 style={{ fontFamily: "'Fraunces',serif", fontSize: 28, fontWeight: 900, letterSpacing: "-1px", color: C.text, marginBottom: 4 }}>Plans & Pricing</h1>
      <p style={{ fontSize: 13, color: C.textMuted, marginBottom: 30 }}>Resumes · Cover Letters · Outreach Emails · One-time payments · Secure via Razorpay</p>
      {msg && (
        <div style={{ background: msg.t === "ok" ? "rgba(16,185,129,.06)" : "rgba(244,63,94,.06)", border: `1px solid ${msg.t === "ok" ? "rgba(16,185,129,.2)" : "rgba(244,63,94,.2)"}`, borderRadius: 9, padding: "11px 16px", fontSize: 13, color: msg.t === "ok" ? C.emerald : C.rose, marginBottom: 22, display: "flex", alignItems: "center", gap: 8 }}>
          <Icon n={msg.t === "ok" ? "chkCircle" : "x"} s={15} c={msg.t === "ok" ? C.emerald : C.rose} />{msg.m}
        </div>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))", gap: 12, maxWidth: 880 }}>
        {Object.entries(PLANS).map(([key, plan]) => {
          const isCurrent = planKey === key;
          return (
            <div key={key} className="card" style={{ padding: "28px 22px", position: "relative", border: isCurrent ? `1.5px solid ${C.accent}50` : plan.popular ? `1.5px solid ${C.accent}40` : `1.5px solid ${C.border}`, background: plan.popular ? C.surfaceAlt : C.surface, boxShadow: plan.popular ? "0 0 30px rgba(99,102,241,.15)" : "none" }}>
              {plan.badge && !isCurrent && <div style={{ position: "absolute", top: -10, left: "50%", transform: "translateX(-50%)", background: C.amber, color: "#000", fontSize: 9, fontWeight: 800, padding: "3px 12px", borderRadius: 100, whiteSpace: "nowrap" }}>{plan.badge}</div>}
              {isCurrent && <div style={{ position: "absolute", top: -10, right: 12, background: C.emerald, color: "#fff", fontSize: 9, fontWeight: 800, padding: "3px 10px", borderRadius: 100 }}>✓ Current</div>}
              <div style={{ fontWeight: 700, fontSize: 11, color: plan.color, marginBottom: 8, letterSpacing: ".5px", textTransform: "uppercase" }}>{plan.name}</div>
              <div style={{ fontFamily: "'Fraunces',serif", fontSize: 40, fontWeight: 900, letterSpacing: "-1.5px", color: C.text, marginBottom: 3 }}>{plan.inr === 0 ? "Free" : `₹${plan.inr}`}</div>
              <div style={{ fontSize: 11, color: C.textLight, marginBottom: 22 }}>{plan.inr === 0 ? "forever" : plan.inr === 49 ? "per document" : "one-time"}</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 9, marginBottom: 24 }}>
                {plan.features.map((f, i) => <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 7 }}><Icon n="chk" s={11} c={C.accent} /><span style={{ fontSize: 12, color: C.textMuted, lineHeight: 1.4 }}>{f}</span></div>)}
              </div>
              <button onClick={() => !isCurrent && handlePay(key, plan.inr)} disabled={isCurrent || paying === key}
                style={{ width: "100%", padding: "11px 0", borderRadius: 8, border: `1.5px solid ${isCurrent ? C.border : plan.popular ? C.accent : C.border}`, background: isCurrent ? "none" : plan.popular ? `linear-gradient(135deg, ${C.accent}, ${C.violet})` : "none", color: isCurrent ? C.textMuted : plan.popular ? "#fff" : C.text, fontSize: 13, fontWeight: 700, cursor: isCurrent ? "default" : "pointer", fontFamily: "inherit", transition: "all .18s", opacity: isCurrent ? 0.5 : 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
                {paying === key ? <><Spinner s={12} c="#fff" /> Processing...</> : isCurrent ? "Current plan" : plan.cta}
              </button>
            </div>
          );
        })}
      </div>
      <div style={{ marginTop: 20, padding: "12px 16px", background: C.surface, borderRadius: 9, border: `1.5px solid ${C.border}`, fontSize: 12, color: C.textMuted, maxWidth: 880 }}>
        🔒 Secure payments via Razorpay · UPI, cards, net banking · No auto-renewal ever
      </div>
    </div>
  );
};

// ─── BUILD LAUNCHER ───────────────────────────────────────────────────────────
const BuildLauncher = ({ onSelect, onBack }) => (
  <div style={{ minHeight: "100vh", background: "#080810", fontFamily: "'DM Sans',sans-serif", display: "flex", flexDirection: "column" }}>
    <header style={{ background: "rgba(12,12,24,.9)", backdropFilter: "blur(20px)", borderBottom: "1px solid rgba(255,255,255,.06)", padding: "0 28px", height: 62, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
      <button onClick={onBack} style={{ background: "none", border: "none", cursor: "pointer", display: "flex", alignItems: "center", gap: 7, color: "rgba(255,255,255,.4)", fontSize: 13, fontFamily: "'DM Sans',sans-serif", transition: "color .15s" }}
        onMouseEnter={e => e.currentTarget.style.color = "#fff"}
        onMouseLeave={e => e.currentTarget.style.color = "rgba(255,255,255,.4)"}>
        <Icon n="back" s={14} c="currentColor" /> Back
      </button>
      <span style={{ fontFamily: "'Instrument Serif',serif", fontSize: 18, color: "rgba(255,255,255,.6)" }}>resumeai</span>
      <div style={{ width: 60 }} />
    </header>
    <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: "48px 24px" }}>
      <div style={{ width: "100%", maxWidth: 560 }} className="fade-in">
        <div style={{ textAlign: "center", marginBottom: 48 }}>
          <h1 style={{ fontFamily: "'Instrument Serif',serif", fontSize: 38, fontWeight: 400, letterSpacing: "-1.5px", color: "#f5f5ff", marginBottom: 10 }}>What are you building?</h1>
          <p style={{ fontSize: 14, color: "rgba(240,240,248,.35)" }}>Choose a document type to get started</p>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {[
            { id: "resume", icon: "doc", title: "AI-Tailored Resume", desc: "ATS-optimized with company culture signals and targeted bullets", color: "#6366f1", badge: "Most Popular" },
            { id: "cover_letter", icon: "pen", title: "Cover Letter", desc: "Compelling letter with a strong hook and personalized story", color: "#8b5cf6" },
            { id: "email", icon: "mail", title: "Outreach Email", desc: "Professional cold email or follow-up with a clear CTA", color: "#10b981" },
          ].map(opt => (
            <div key={opt.id} onClick={() => onSelect(opt.id)}
              style={{ padding: "24px 26px", borderRadius: 16, border: "1px solid rgba(255,255,255,.08)", background: "rgba(255,255,255,.025)", cursor: "pointer", transition: "all .2s", display: "flex", alignItems: "center", gap: 18, position: "relative" }}
              onMouseEnter={e => { e.currentTarget.style.background = "rgba(255,255,255,.05)"; e.currentTarget.style.borderColor = `${opt.color}50`; e.currentTarget.style.transform = "translateX(5px)"; e.currentTarget.style.boxShadow = `0 0 40px ${opt.color}18`; }}
              onMouseLeave={e => { e.currentTarget.style.background = "rgba(255,255,255,.025)"; e.currentTarget.style.borderColor = "rgba(255,255,255,.08)"; e.currentTarget.style.transform = "none"; e.currentTarget.style.boxShadow = "none"; }}>
              {opt.badge && <div style={{ position: "absolute", top: -11, right: 18, background: "linear-gradient(135deg, #6366f1, #8b5cf6)", color: "#fff", fontSize: 9, fontWeight: 700, padding: "3px 12px", borderRadius: 100 }}>{opt.badge}</div>}
              <div style={{ width: 54, height: 54, background: `${opt.color}15`, borderRadius: 14, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, border: `1px solid ${opt.color}30` }}>
                <Icon n={opt.icon} s={22} c={opt.color} />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontFamily: "'Instrument Serif',serif", fontSize: 19, color: "#f5f5ff", marginBottom: 5 }}>{opt.title}</div>
                <div style={{ fontSize: 13, color: "rgba(240,240,248,.4)", lineHeight: 1.55 }}>{opt.desc}</div>
              </div>
              <Icon n="arr" s={16} c="rgba(255,255,255,.2)" />
            </div>
          ))}
        </div>
      </div>
    </div>
  </div>
);

// ─── JOB INPUT PAGE ───────────────────────────────────────────────────────────
const JobInputPage = ({ onNext, onBack, buildType = "resume" }) => {
  const [co, setCo] = useState("");
  const [jd, setJd] = useState("");
  const [mode, setMode] = useState(null);
  const [file, setFile] = useState(null);
  const [fileText, setFileText] = useState("");
  const [drag, setDrag] = useState(false);
  const [step, setStep] = useState(1);
  const [recipientName, setRecipientName] = useState("");
  const [recipientRole, setRecipientRole] = useState("");
  const [emailType, setEmailType] = useState("job application email with resume attached");

  const typeLabels = { resume: "Resume", cover_letter: "Cover Letter", email: "Outreach Email" };
  const typeIcons = { resume: "doc", cover_letter: "pen", email: "mail" };

  const onFile = async (f) => {
    if (!f) return;
    setFile(f);
    const isPDF = f.type === "application/pdf" || f.name.endsWith(".pdf");
    if (!isPDF) { const reader = new FileReader(); reader.onload = e => setFileText(e.target.result); reader.readAsText(f); return; }
    try {
      if (!window.pdfjsLib) {
        await new Promise((resolve, reject) => {
          const script = document.createElement("script");
          script.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
          script.onload = resolve; script.onerror = reject;
          document.head.appendChild(script);
        });
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
      }
      const arrayBuffer = await f.arrayBuffer();
      const pdf = await window.pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      let fullText = "";
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        fullText += content.items.map(item => item.str).join(" ") + "\n";
      }
      if (fullText.trim().length < 50) { alert("This PDF appears to be a scanned image. Please use 'Fill in details' instead."); setFile(null); setFileText(""); return; }
      setFileText(fullText);
    } catch { alert("Could not read this PDF. Try uploading as .txt or use 'Fill in details' instead."); setFile(null); setFileText(""); }
  };

  const proceed = () => {
    const extra = buildType === "email" ? { recipientName, recipientRole, emailType } : {};
    if (mode === "upload") onNext({ co, jd, mode, fileText, ...extra });
    else if (mode === "questionnaire") onNext({ co, jd, mode, ...extra });
  };

  return (
    <div style={{ minHeight: "100vh", background: C.bg, fontFamily: "'DM Sans',sans-serif", display: "flex", flexDirection: "column" }}>
      <header style={{ background: C.surface, borderBottom: `1.5px solid ${C.border}`, padding: "0 28px", height: 58, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <button onClick={onBack} style={{ background: "none", border: "none", cursor: "pointer", display: "flex", alignItems: "center", gap: 6, color: C.textMuted, fontSize: 13, fontFamily: "'DM Sans',sans-serif" }}>
          <Icon n="back" s={14} c={C.textMuted} /> Back
        </button>
        <Logo size="sm" />
        <div style={{ width: 60 }} />
      </header>
      <div style={{ flex: 1, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "48px 24px" }}>
        <div style={{ width: "100%", maxWidth: 620 }} className="fade-in">
          <div style={{ display: "flex", gap: 6, marginBottom: 32 }}>
            {[1, 2].map((_, idx) => (
              <div key={idx} style={{ flex: 1, height: 3, borderRadius: 2, background: idx < step ? C.accent : C.border, transition: "background .3s" }} />
            ))}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 20, padding: "8px 14px", background: C.accentBg, border: `1px solid ${C.accentBorder}`, borderRadius: 8, width: "fit-content" }}>
            <Icon n={typeIcons[buildType]} s={14} c={C.accent} />
            <span style={{ fontSize: 12, fontWeight: 700, color: C.accent }}>Building: {typeLabels[buildType]}</span>
          </div>

          {step === 1 && (
            <div>
              <h1 style={{ fontFamily: "'Fraunces',serif", fontSize: 28, fontWeight: 900, letterSpacing: "-1px", color: C.text, marginBottom: 6 }}>Target role</h1>
              <p style={{ fontSize: 14, color: C.textMuted, marginBottom: 28 }}>The more detail you give, the better the AI tailoring</p>
              <div style={{ marginBottom: 16 }}>
                <label style={{ fontSize: 11, fontWeight: 700, color: C.textMuted, letterSpacing: ".5px", textTransform: "uppercase", display: "block", marginBottom: 7 }}>Company Name *</label>
                <input className="input-dark" value={co} onChange={e => setCo(e.target.value)} placeholder="e.g. Google, Stripe, Swiggy..." autoFocus />
              </div>
              <div style={{ marginBottom: 16 }}>
                <label style={{ fontSize: 11, fontWeight: 700, color: C.textMuted, letterSpacing: ".5px", textTransform: "uppercase", display: "block", marginBottom: 7 }}>Job Description *</label>
                <textarea className="input-dark" value={jd} onChange={e => setJd(e.target.value)} placeholder="Paste the full job description here..." rows={9} style={{ minHeight: 200 }} />
                {jd.length > 0 && <div style={{ fontSize: 11, color: C.textLight, marginTop: 5 }}>{jd.split(/\s+/).filter(Boolean).length} words</div>}
              </div>
              {buildType === "email" && (
                <>
                  <div style={{ marginBottom: 14 }}>
                    <label style={{ fontSize: 11, fontWeight: 700, color: C.textMuted, letterSpacing: ".5px", textTransform: "uppercase", display: "block", marginBottom: 7 }}>Recipient Name <span style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>(optional)</span></label>
                    <input className="input-dark" value={recipientName} onChange={e => setRecipientName(e.target.value)} placeholder="e.g. Sarah Chen" />
                  </div>
                  <div style={{ marginBottom: 14 }}>
                    <label style={{ fontSize: 11, fontWeight: 700, color: C.textMuted, letterSpacing: ".5px", textTransform: "uppercase", display: "block", marginBottom: 7 }}>Recipient Role <span style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>(optional)</span></label>
                    <input className="input-dark" value={recipientRole} onChange={e => setRecipientRole(e.target.value)} placeholder="e.g. Engineering Manager, Recruiter" />
                  </div>
                  <div style={{ marginBottom: 16 }}>
                    <label style={{ fontSize: 11, fontWeight: 700, color: C.textMuted, letterSpacing: ".5px", textTransform: "uppercase", display: "block", marginBottom: 7 }}>Email Type</label>
                    <select className="input-dark" value={emailType} onChange={e => setEmailType(e.target.value)} style={{ cursor: "pointer" }}>
                      <option>job application email with resume attached</option>
                      <option>cold outreach to hiring manager</option>
                      <option>recruiter follow-up email</option>
                      <option>referral request email</option>
                      <option>post-interview thank you email</option>
                    </select>
                  </div>
                </>
              )}
              <button className="btn-primary" onClick={() => { if (co.trim() && jd.trim()) setStep(2); }} disabled={!co.trim() || !jd.trim()} style={{ padding: "12px 28px", fontSize: 14 }}>
                Continue <Icon n="arr" s={14} c="#fff" />
              </button>
            </div>
          )}

          {step === 2 && (
            <div>
              <h1 style={{ fontFamily: "'Fraunces',serif", fontSize: 28, fontWeight: 900, letterSpacing: "-1px", color: C.text, marginBottom: 6 }}>Your background</h1>
              <p style={{ fontSize: 14, color: C.textMuted, marginBottom: 26 }}>How do you want to share your experience?</p>
              <div style={{ display: "grid", gap: 10, marginBottom: 24 }}>
                {[
                  { id: "upload", icon: "up", title: "Upload existing resume", desc: "Upload PDF or text — AI extracts your background and tailors it" },
                  { id: "questionnaire", icon: "user", title: "Fill in details", desc: "Answer guided questions and AI builds everything from scratch" },
                ].map(opt => (
                  <div key={opt.id} onClick={() => setMode(opt.id)} style={{ padding: "20px 22px", borderRadius: 12, border: mode === opt.id ? `2px solid ${C.accent}` : `1.5px solid ${C.border}`, background: mode === opt.id ? C.accentBg : C.surface, cursor: "pointer", transition: "all .18s", display: "flex", alignItems: "flex-start", gap: 14 }}>
                    <div style={{ width: 44, height: 44, background: mode === opt.id ? C.accentBg : C.surfaceAlt, borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                      <Icon n={opt.icon} s={19} c={mode === opt.id ? C.accent : C.textMuted} />
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 700, fontSize: 14, color: C.text, marginBottom: 4 }}>{opt.title}</div>
                      <div style={{ fontSize: 13, color: C.textMuted, lineHeight: 1.6 }}>{opt.desc}</div>
                    </div>
                    {mode === opt.id && <div style={{ width: 18, height: 18, borderRadius: "50%", background: C.accent, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, marginTop: 3 }}><Icon n="chk" s={9} c="#fff" /></div>}
                  </div>
                ))}
              </div>
              {mode === "upload" && (
                <div
                  onDragOver={e => { e.preventDefault(); setDrag(true); }}
                  onDragLeave={() => setDrag(false)}
                  onDrop={e => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files[0]; if (f) onFile(f); }}
                  onClick={() => document.getElementById("rf-input")?.click()}
                  style={{ border: `2px dashed ${drag ? C.accent : file ? C.emerald : C.border}`, borderRadius: 10, padding: "28px", textAlign: "center", cursor: "pointer", background: drag ? C.accentBg : file ? "rgba(16,185,129,.04)" : C.surface, transition: "all .18s", marginBottom: 20 }}>
                  <input id="rf-input" type="file" accept=".txt,.pdf,.doc,.docx" style={{ display: "none" }} onChange={e => onFile(e.target.files?.[0])} />
                  <div style={{ marginBottom: 8 }}>{file ? <Icon n="chkCircle" s={28} c={C.emerald} /> : <Icon n="up" s={28} c={C.textLight} />}</div>
                  {file
                    ? <div><div style={{ fontSize: 14, color: C.emerald, fontWeight: 600 }}>✓ {file.name}</div>{fileText ? <div style={{ fontSize: 11, color: C.textMuted, marginTop: 4 }}>{fileText.length} characters extracted ✓</div> : <div style={{ fontSize: 11, color: C.amber, marginTop: 4 }}>Extracting text...</div>}</div>
                    : <><div style={{ fontSize: 14, color: C.textMuted, fontWeight: 500, marginBottom: 4 }}>Drop resume here or click to browse</div><div style={{ fontSize: 12, color: C.textLight }}>PDF, TXT — must be a text-based PDF</div></>
                  }
                </div>
              )}
              <div style={{ display: "flex", gap: 10 }}>
                <button className="btn-ghost" onClick={() => setStep(1)}>← Back</button>
                <button className="btn-primary" onClick={proceed} disabled={!mode || (mode === "upload" && !fileText)}>
                  {mode === "questionnaire" ? <>Fill in details <Icon n="arr" s={14} c="#fff" /></> : <><Icon n="spark" s={14} c="#fff" /> Generate {typeLabels[buildType]}</>}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// ─── QUESTIONNAIRE ────────────────────────────────────────────────────────────
const QuestionnairePage = ({ onDone, onBack, company }) => {
  const [step, setStep] = useState(0);
  const [ans, setAns] = useState({});
  const fields = [
    { key: "name", label: "Your Full Name", placeholder: "e.g. Rahul Sharma", type: "input", required: true },
    { key: "email", label: "Email Address", placeholder: "your@email.com", type: "input", required: true },
    { key: "phone", label: "Phone Number", placeholder: "+91 98765 43210", type: "input" },
    { key: "location", label: "Location", placeholder: "Mumbai, India / Remote", type: "input" },
    { key: "linkedin", label: "LinkedIn URL", placeholder: "linkedin.com/in/yourname", type: "input" },
    { key: "github", label: "GitHub URL", placeholder: "github.com/yourhandle", type: "input" },
    { key: "currentTitle", label: "Current / Last Job Title", placeholder: "e.g. Full Stack Engineer", type: "input", required: true },
    { key: "yearsExp", label: "Years of Experience", placeholder: "e.g. 3+ years", type: "input", required: true },
    { key: "expText", label: "Work Experience", placeholder: "Job Title at Company (Start – End)\n• What you built\n• Key achievements\n\nInclude ALL work experience.", type: "textarea", rows: 13, required: true },
    { key: "projectsText", label: "Projects", placeholder: "Project Name — What it does\nTech: React, Node.js\nLink: github.com/...\n• Key feature", type: "textarea", rows: 9 },
    { key: "skillsText", label: "Technical Skills & Tools", placeholder: "e.g. React, TypeScript, Node.js, PostgreSQL, Docker...", type: "textarea", rows: 3, required: true },
    { key: "educationText", label: "Education", placeholder: "BSc Computer Science\nMVM College, Mumbai\n2021 – 2024", type: "textarea", rows: 4, required: true },
    { key: "achievementsText", label: "Certifications / Achievements", placeholder: "e.g. AWS Certified, Hackathon winner...", type: "textarea", rows: 3 },
  ];
  const required = fields.filter(f => f.required);
  const allDone = required.every(f => (ans[f.key] || "").trim().length > 0);
  const f = fields[step];
  const buildCandidateText = (a) => `Name: ${a.name || ""}
Email: ${a.email || ""}
Phone: ${a.phone || ""}
Location: ${a.location || ""}
LinkedIn: ${a.linkedin || ""}
GitHub: ${a.github || ""}
Current/Last Title: ${a.currentTitle || ""}
Years of Experience: ${a.yearsExp || ""}

WORK EXPERIENCE:
${a.expText || ""}

PROJECTS:
${a.projectsText || "None"}

TECHNICAL SKILLS:
${a.skillsText || ""}

EDUCATION:
${a.educationText || ""}

CERTIFICATIONS/ACHIEVEMENTS:
${a.achievementsText || "None"}`;

  return (
    <div style={{ minHeight: "100vh", background: C.bg, fontFamily: "'DM Sans',sans-serif", display: "flex", flexDirection: "column" }}>
      <header style={{ background: C.surface, borderBottom: `1.5px solid ${C.border}`, padding: "0 28px", height: 58, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <button onClick={onBack} style={{ background: "none", border: "none", cursor: "pointer", display: "flex", alignItems: "center", gap: 6, color: C.textMuted, fontSize: 13, fontFamily: "'DM Sans',sans-serif" }}>
          <Icon n="back" s={14} c={C.textMuted} /> Back
        </button>
        <div style={{ fontSize: 12, color: C.textMuted, fontWeight: 500 }}>{step + 1} / {fields.length}{company && <span style={{ color: C.accent }}> → {company}</span>}</div>
        <div style={{ width: 60 }} />
      </header>
      <div style={{ height: 3, background: C.border }}>
        <div style={{ height: "100%", background: `linear-gradient(90deg, ${C.accent}, ${C.violet})`, transition: "width .35s ease", width: `${((step + 1) / fields.length) * 100}%` }} />
      </div>
      <div style={{ flex: 1, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "44px 24px" }}>
        <div style={{ width: "100%", maxWidth: 580 }} key={step} className="fade-in">
          <div style={{ fontSize: 10, fontWeight: 700, color: C.textLight, letterSpacing: "1.5px", marginBottom: 8 }}>STEP {step + 1} / {fields.length}</div>
          <h2 style={{ fontFamily: "'Fraunces',serif", fontSize: 26, fontWeight: 900, color: C.text, letterSpacing: "-0.5px", marginBottom: 5 }}>
            {f.label}{f.required && <span style={{ color: C.accent }}> *</span>}
          </h2>
          <p style={{ fontSize: 13, color: C.textMuted, marginBottom: 20 }}>{f.required ? "Required for best quality" : "Optional — skip if not applicable"}</p>
          {f.type === "input"
            ? <input className="input-dark" value={ans[f.key] || ""} onChange={e => setAns(a => ({ ...a, [f.key]: e.target.value }))} placeholder={f.placeholder} style={{ marginBottom: 26 }} onKeyDown={e => { if (e.key === "Enter" && step < fields.length - 1) setStep(s => s + 1); }} autoFocus />
            : <textarea className="input-dark" value={ans[f.key] || ""} onChange={e => setAns(a => ({ ...a, [f.key]: e.target.value }))} placeholder={f.placeholder} rows={f.rows || 6} style={{ marginBottom: 26 }} autoFocus />
          }
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {step > 0 && <button className="btn-ghost" onClick={() => setStep(s => s - 1)}>← Back</button>}
            {step < fields.length - 1
              ? <button className="btn-primary" onClick={() => setStep(s => s + 1)} disabled={f.required && !ans[f.key]?.trim()}>Next <Icon n="arr" s={13} c="#fff" /></button>
              : <button className="btn-primary" onClick={() => onDone(buildCandidateText(ans))} disabled={!allDone}><Icon n="spark" s={14} c="#fff" /> Generate Now</button>
            }
            {!f.required && step < fields.length - 1 && <button className="btn-ghost" onClick={() => setStep(s => s + 1)} style={{ fontSize: 12 }}>Skip →</button>}
          </div>
          <div style={{ marginTop: 28, display: "flex", flexWrap: "wrap", gap: 5 }}>
            {fields.map((fi, i) => (
              <button key={i} onClick={() => setStep(i)} style={{ width: 24, height: 24, borderRadius: 6, border: "none", cursor: "pointer", fontSize: 9, fontWeight: 700, fontFamily: "'DM Sans',sans-serif", background: i === step ? C.accent : ans[fi.key]?.trim() ? "rgba(16,185,129,.15)" : C.border, color: i === step ? "#fff" : ans[fi.key]?.trim() ? C.emerald : C.textLight, transition: "all .15s" }}>
                {i + 1}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

// ─── GENERATING SCREEN ────────────────────────────────────────────────────────
const GeneratingScreen = ({ stage, provider, company, buildType = "resume" }) => {
  const msgs = {
    resume: ["Reading the job description...", "Extracting ATS keywords...", "Analyzing company culture...", "Mapping your experience...", "Crafting your summary...", "Rewriting bullet points...", "Optimizing skills...", "Final polish..."],
    cover_letter: ["Analyzing the job description...", "Understanding company culture...", "Crafting your opening hook...", "Personalizing your story...", "Matching achievements to the role...", "Polishing the closing...", "Final review..."],
    email: ["Analyzing the role and company...", "Crafting your subject line...", "Writing your opening line...", "Highlighting key achievements...", "Personalizing the message...", "Perfecting the CTA...", "Final review..."],
  };
  const msgList = msgs[buildType] || msgs.resume;
  const labels = { resume: "Tailoring your resume", cover_letter: "Writing your cover letter", email: "Crafting your outreach email" };
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh", background: C.bg, fontFamily: "'DM Sans',sans-serif" }}>
      <div style={{ maxWidth: 440, textAlign: "center", padding: "48px 24px" }}>
        <div style={{ width: 70, height: 70, borderRadius: "50%", background: C.accentBg, border: `1.5px solid ${C.accentBorder}`, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 28px", animation: "float 3s ease-in-out infinite", boxShadow: "0 0 40px rgba(99,102,241,.2)" }}>
          <Icon n="spark" s={30} c={C.accent} />
        </div>
        <h2 style={{ fontFamily: "'Fraunces',serif", fontSize: 24, fontWeight: 900, letterSpacing: "-0.5px", marginBottom: 10, color: C.text }}>{labels[buildType] || labels.resume}</h2>
        {provider && (
          <div style={{ fontSize: 11, fontWeight: 700, color: C.accent, background: C.accentBg, border: `1px solid ${C.accentBorder}`, padding: "4px 14px", borderRadius: 100, display: "inline-flex", alignItems: "center", gap: 6, marginBottom: 16 }}>
            <div style={{ width: 5, height: 5, borderRadius: "50%", background: C.accent, animation: "blink 1.2s infinite" }} />{provider}
          </div>
        )}
        <p key={stage} style={{ color: C.textMuted, fontSize: 14, marginBottom: 40, animation: "fadeIn .5s ease", lineHeight: 1.6 }}>{msgList[stage % msgList.length]}</p>
        <div style={{ height: 4, background: C.border, borderRadius: 2 }}>
          <div style={{ height: "100%", background: `linear-gradient(90deg, ${C.accent}, ${C.violet})`, borderRadius: 2, width: `${Math.min(95, (stage + 1) * 12)}%`, transition: "width 2s ease" }} />
        </div>
        <div style={{ marginTop: 10, fontSize: 11, color: C.textLight }}>This takes 10–25 seconds...</div>
      </div>
    </div>
  );
};

// ─── RESUME VIEW (all 6 templates) ───────────────────────────────────────────
const ResumeView = ({ resume: r, tpl, font }) => {
  if (!r) return null;
  const t = TEMPLATES.find(x => x.id === tpl) || TEMPLATES[0];
  const ff = FONTS.find(f => f.n === font)?.v || "'DM Sans',sans-serif";
  const validProjects = Array.isArray(r.projects) ? r.projects.filter(p => p && (p.name || p.description || (Array.isArray(p.bullets) && p.bullets.length > 0))) : [];
  const hasProjects = validProjects.length > 0;
  const hasCerts = r.certifications?.filter(c => c)?.length > 0;
  const allSkills = [...(r.skills?.technical || []), ...(r.skills?.soft || []), ...(r.skills?.tools || [])].filter(Boolean);

  // ── ATS PRO ──
  if (tpl === "ats_pro") {
    return (
      <div id="resume-canvas" style={{ fontFamily: ff, fontSize: 10.5, background: "#fff", color: "#111827", minHeight: 1056, padding: "40px 52px" }}>
        <div style={{ textAlign: "center", marginBottom: 14, paddingBottom: 14, borderBottom: "2px solid #1a1a2e" }}>
          <div style={{ fontSize: 26, fontWeight: 800, letterSpacing: "-0.5px", color: "#1a1a2e", marginBottom: 4 }}>{r.name}</div>
          {r.currentTitle && <div style={{ fontSize: 11, color: "#6b7280", fontWeight: 600, marginBottom: 8, letterSpacing: "1px", textTransform: "uppercase" }}>{r.currentTitle}</div>}
          <div style={{ display: "flex", justifyContent: "center", flexWrap: "wrap", gap: "0 12px", fontSize: 9.5, color: "#6b7280" }}>
            {[r.email, r.phone, r.location, r.linkedin, r.github, r.portfolio].filter(Boolean).map((v, i) => <span key={i}>{i > 0 && <span style={{ marginRight: 12, color: "#d1d5db" }}>|</span>}{v}</span>)}
          </div>
        </div>
        {r.summary && <div style={{ marginBottom: 14 }}><div style={{ fontSize: 9, fontWeight: 800, color: "#1a1a2e", letterSpacing: "2px", textTransform: "uppercase", marginBottom: 5 }}>PROFESSIONAL SUMMARY</div><p style={{ fontSize: 10.5, lineHeight: 1.75, color: "#374151" }}>{r.summary}</p></div>}
        {r.experience?.filter(e => e.title || e.company)?.length > 0 && (
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 9, fontWeight: 800, color: "#1a1a2e", letterSpacing: "2px", textTransform: "uppercase", marginBottom: 8, borderBottom: "1.5px solid #e5e7eb", paddingBottom: 3 }}>EXPERIENCE</div>
            {r.experience.filter(e => e.title || e.company).map((e, i) => (
              <div key={i} style={{ marginBottom: 11 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}><span style={{ fontWeight: 700, fontSize: 11 }}>{e.company}</span><span style={{ fontSize: 9.5, color: "#9ca3af" }}>{e.period}</span></div>
                <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ fontStyle: "italic", fontSize: 10, color: "#374151" }}>{e.title}</span><span style={{ fontSize: 9.5, color: "#9ca3af" }}>{e.location}</span></div>
                <ul style={{ margin: "4px 0 0 16px", padding: 0 }}>{(e.bullets || []).filter(b => b?.trim()).map((b, j) => <li key={j} style={{ fontSize: 10.5, lineHeight: 1.65, color: "#1f2937", marginBottom: 2 }}>{b}</li>)}</ul>
              </div>
            ))}
          </div>
        )}
        {hasProjects && (
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 9, fontWeight: 800, color: "#1a1a2e", letterSpacing: "2px", textTransform: "uppercase", marginBottom: 8, borderBottom: "1.5px solid #e5e7eb", paddingBottom: 3 }}>PROJECTS</div>
            {validProjects.map((p, i) => (
              <div key={i} style={{ marginBottom: 8 }}>
                <div style={{ display: "flex", justifyContent: "space-between" }}><span><strong>{p.name}</strong>{p.tech && <span style={{ fontStyle: "italic", color: "#6b7280" }}> | {p.tech}</span>}</span>{p.link && <span style={{ fontSize: 9.5, color: "#6b7280" }}>{p.link}</span>}</div>
                {p.description && <div style={{ fontSize: 10.5, color: "#374151", marginBottom: 2 }}>{p.description}</div>}
                <ul style={{ margin: "2px 0 0 16px", padding: 0 }}>{(p.bullets || []).filter(b => b?.trim()).map((b, j) => <li key={j} style={{ fontSize: 10.5, lineHeight: 1.6, color: "#1f2937" }}>{b}</li>)}</ul>
              </div>
            ))}
          </div>
        )}
        {allSkills.length > 0 && (
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 9, fontWeight: 800, color: "#1a1a2e", letterSpacing: "2px", textTransform: "uppercase", marginBottom: 6, borderBottom: "1.5px solid #e5e7eb", paddingBottom: 3 }}>TECHNICAL SKILLS</div>
            {r.skills?.technical?.length > 0 && <div style={{ fontSize: 10.5, marginBottom: 3 }}><strong>Languages/Frameworks: </strong>{r.skills.technical.join(", ")}</div>}
            {r.skills?.tools?.length > 0 && <div style={{ fontSize: 10.5, marginBottom: 3 }}><strong>Tools: </strong>{r.skills.tools.join(", ")}</div>}
            {r.skills?.soft?.length > 0 && <div style={{ fontSize: 10.5 }}><strong>Other: </strong>{r.skills.soft.join(", ")}</div>}
          </div>
        )}
        {r.education?.filter(e => e.degree || e.school)?.length > 0 && (
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 9, fontWeight: 800, color: "#1a1a2e", letterSpacing: "2px", textTransform: "uppercase", marginBottom: 6, borderBottom: "1.5px solid #e5e7eb", paddingBottom: 3 }}>EDUCATION</div>
            {r.education.filter(e => e.degree || e.school).map((e, i) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}><div><span style={{ fontWeight: 700 }}>{e.school}</span>{e.degree && <span style={{ fontStyle: "italic", color: "#374151" }}> — {e.degree}</span>}</div><span style={{ fontSize: 9.5, color: "#9ca3af" }}>{e.year}</span></div>
            ))}
          </div>
        )}
        {hasCerts && <div><div style={{ fontSize: 9, fontWeight: 800, color: "#1a1a2e", letterSpacing: "2px", textTransform: "uppercase", marginBottom: 6, borderBottom: "1.5px solid #e5e7eb", paddingBottom: 3 }}>CERTIFICATIONS</div>{r.certifications.filter(c => c).map((c, i) => <div key={i} style={{ fontSize: 10.5, marginBottom: 2 }}>• {c}</div>)}</div>}
      </div>
    );
  }

  // ── STANFORD ──
  if (tpl === "stanford") {
    const AC = "#8c1515";
    const Sec = ({ label }) => <div style={{ fontSize: 9, fontWeight: 800, color: AC, letterSpacing: "2px", textTransform: "uppercase", borderBottom: `1.5px solid ${AC}`, paddingBottom: 3, marginBottom: 8 }}>{label}</div>;
    return (
      <div id="resume-canvas" style={{ fontFamily: ff, fontSize: 10.5, background: "#fff", minHeight: 1056, padding: "36px 48px" }}>
        <div style={{ borderBottom: `3px solid ${AC}`, paddingBottom: 14, marginBottom: 14 }}>
          <div style={{ fontFamily: "'Fraunces',serif", fontSize: 32, fontWeight: 900, color: "#1a1a1a", letterSpacing: "-1px" }}>{r.name}</div>
          {r.currentTitle && <div style={{ fontSize: 12, color: AC, fontWeight: 700, marginTop: 3, letterSpacing: "1px" }}>{r.currentTitle}</div>}
          <div style={{ display: "flex", flexWrap: "wrap", gap: "2px 16px", marginTop: 8, fontSize: 9.5, color: "#6b7280" }}>{[r.email, r.phone, r.location, r.linkedin, r.github].filter(Boolean).map((v, i) => <span key={i}>{v}</span>)}</div>
        </div>
        {r.summary && <div style={{ marginBottom: 14 }}><Sec label="SUMMARY" /><p style={{ fontSize: 10.5, lineHeight: 1.8, color: "#374151", fontStyle: "italic" }}>{r.summary}</p></div>}
        {r.experience?.filter(e => e.title || e.company)?.length > 0 && (
          <div style={{ marginBottom: 14 }}><Sec label="EXPERIENCE" />
            {r.experience.filter(e => e.title || e.company).map((e, i) => (
              <div key={i} style={{ marginBottom: 12, paddingLeft: 12, borderLeft: `2px solid ${AC}30` }}>
                <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ fontFamily: "'Fraunces',serif", fontWeight: 700, fontSize: 11.5 }}>{e.title}</span><span style={{ fontSize: 9.5, color: "#9ca3af" }}>{e.period}</span></div>
                <div style={{ fontSize: 10, color: AC, fontWeight: 700, marginBottom: 4 }}>{e.company}</div>
                <ul style={{ margin: 0, paddingLeft: 14 }}>{(e.bullets || []).filter(b => b?.trim()).map((b, j) => <li key={j} style={{ fontSize: 10.5, lineHeight: 1.65, color: "#374151", marginBottom: 2 }}>{b}</li>)}</ul>
              </div>
            ))}
          </div>
        )}
        {hasProjects && (
          <div style={{ marginBottom: 14 }}><Sec label="PROJECTS" />
            {validProjects.map((p, i) => (
              <div key={i} style={{ marginBottom: 9, paddingLeft: 12, borderLeft: `2px solid ${AC}30` }}>
                <div style={{ display: "flex", justifyContent: "space-between" }}><strong style={{ fontSize: 11, fontFamily: "'Fraunces',serif" }}>{p.name}</strong>{p.link && <span style={{ fontSize: 9, color: AC }}>{p.link}</span>}</div>
                {p.tech && <div style={{ fontSize: 9, color: "#6b7280", fontStyle: "italic" }}>{p.tech}</div>}
                {p.description && <div style={{ fontSize: 10.5, color: "#374151", marginBottom: 2 }}>{p.description}</div>}
                <ul style={{ margin: "2px 0 0", paddingLeft: 14 }}>{(p.bullets || []).filter(b => b?.trim()).map((b, j) => <li key={j} style={{ fontSize: 10.5, color: "#374151", lineHeight: 1.6 }}>{b}</li>)}</ul>
              </div>
            ))}
          </div>
        )}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 180px", gap: 16 }}>
          <div>{allSkills.length > 0 && <div><Sec label="SKILLS" />{r.skills?.technical?.length > 0 && <div style={{ fontSize: 10.5, marginBottom: 3 }}><strong>Technical: </strong>{r.skills.technical.join(", ")}</div>}{r.skills?.tools?.length > 0 && <div style={{ fontSize: 10.5 }}><strong>Tools: </strong>{r.skills.tools.join(", ")}</div>}</div>}</div>
          <div>
            {r.education?.filter(e => e.degree || e.school)?.length > 0 && <div><Sec label="EDUCATION" />{r.education.filter(e => e.degree || e.school).map((e, i) => <div key={i} style={{ marginBottom: 8 }}><div style={{ fontWeight: 700, fontSize: 10 }}>{e.degree}</div><div style={{ fontSize: 9.5, color: AC }}>{e.school}</div>{e.year && <div style={{ fontSize: 9, color: "#9ca3af" }}>{e.year}</div>}</div>)}</div>}
            {hasCerts && <div style={{ marginTop: 12 }}><Sec label="CERTS" />{r.certifications.filter(c => c).map((c, i) => <div key={i} style={{ fontSize: 9.5, color: "#374151", marginBottom: 3 }}>{c}</div>)}</div>}
          </div>
        </div>
      </div>
    );
  }

  // ── NOTION ──
  if (tpl === "notion") {
    const Block = ({ label }) => <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 9 }}><div style={{ width: 12, height: 12, background: "#37352f", borderRadius: 2 }} /><span style={{ fontSize: 9, fontWeight: 800, color: "#37352f", letterSpacing: "2px", textTransform: "uppercase" }}>{label}</span></div>;
    return (
      <div id="resume-canvas" style={{ fontFamily: ff, fontSize: 10.5, background: "#fff", minHeight: 1056, padding: "40px 48px", color: "#37352f" }}>
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 28, fontWeight: 800, color: "#37352f", letterSpacing: "-0.5px", marginBottom: 4 }}>{r.name}</div>
          {r.currentTitle && <div style={{ fontSize: 11, color: "#6b7280", fontWeight: 600, marginBottom: 10 }}>{r.currentTitle}</div>}
          <div style={{ display: "flex", flexWrap: "wrap", gap: "2px 14px", fontSize: 9.5, color: "#9ca3af" }}>{[r.email, r.phone, r.location, r.linkedin, r.github, r.portfolio].filter(Boolean).map((v, i) => <span key={i}>{v}</span>)}</div>
        </div>
        {r.summary && <div style={{ marginBottom: 16, padding: "12px 14px", background: "#f7f6f3", borderRadius: 6, fontSize: 10.5, lineHeight: 1.8 }}>{r.summary}</div>}
        {r.experience?.filter(e => e.title || e.company)?.length > 0 && (
          <div style={{ marginBottom: 16 }}><Block label="Experience" />
            {r.experience.filter(e => e.title || e.company).map((e, i) => (
              <div key={i} style={{ marginBottom: 12, paddingLeft: 18, borderLeft: "2px solid #e5e7eb" }}>
                <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ fontWeight: 700, fontSize: 11 }}>{e.title}</span><span style={{ fontSize: 9.5, color: "#9ca3af" }}>{e.period}</span></div>
                <div style={{ fontSize: 10, color: "#6b7280", marginBottom: 5 }}>{e.company}{e.location ? ` · ${e.location}` : ""}</div>
                <ul style={{ margin: 0, paddingLeft: 14 }}>{(e.bullets || []).filter(b => b?.trim()).map((b, j) => <li key={j} style={{ fontSize: 10.5, lineHeight: 1.65, color: "#37352f", marginBottom: 2 }}>{b}</li>)}</ul>
              </div>
            ))}
          </div>
        )}
        {hasProjects && (
          <div style={{ marginBottom: 16 }}><Block label="Projects" />
            {validProjects.map((p, i) => (
              <div key={i} style={{ marginBottom: 8, padding: "8px 12px", background: "#f7f6f3", borderRadius: 6 }}>
                <div style={{ display: "flex", justifyContent: "space-between" }}><strong style={{ fontSize: 11 }}>{p.name}</strong>{p.link && <span style={{ fontSize: 9, color: "#6b7280" }}>{p.link}</span>}</div>
                {p.tech && <div style={{ fontSize: 9, color: "#9ca3af", marginBottom: 3 }}>{p.tech}</div>}
                {p.description && <div style={{ fontSize: 10.5, color: "#37352f", marginBottom: 3 }}>{p.description}</div>}
                {(p.bullets || []).filter(b => b?.trim()).map((b, j) => <div key={j} style={{ fontSize: 10, color: "#6b7280", lineHeight: 1.55 }}>→ {b}</div>)}
              </div>
            ))}
          </div>
        )}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          {allSkills.length > 0 && <div><Block label="Skills" />{r.skills?.technical?.length > 0 && <div style={{ fontSize: 10.5, marginBottom: 3 }}><strong>Technical:</strong> {r.skills.technical.join(", ")}</div>}{r.skills?.tools?.length > 0 && <div style={{ fontSize: 10.5 }}><strong>Tools:</strong> {r.skills.tools.join(", ")}</div>}</div>}
          {r.education?.filter(e => e.degree || e.school)?.length > 0 && <div><Block label="Education" />{r.education.filter(e => e.degree || e.school).map((e, i) => <div key={i} style={{ marginBottom: 7 }}><div style={{ fontWeight: 700, fontSize: 10.5 }}>{e.degree}</div><div style={{ fontSize: 10, color: "#6b7280" }}>{e.school}</div>{e.year && <div style={{ fontSize: 9, color: "#9ca3af" }}>{e.year}</div>}</div>)}</div>}
        </div>
      </div>
    );
  }

  // ── STRIPE ──
  if (tpl === "stripe") {
    const AC = "#635bff";
    const Sec = ({ label }) => <div style={{ fontSize: 8, fontWeight: 800, color: AC, letterSpacing: "2.5px", textTransform: "uppercase", marginBottom: 10, paddingBottom: 3, borderBottom: `2px solid ${AC}` }}>{label}</div>;
    return (
      <div id="resume-canvas" style={{ fontFamily: ff, fontSize: 10.5, background: "#fff", minHeight: 1056 }}>
        <div style={{ background: "#0a2540", padding: "28px 36px 22px" }}>
          <div style={{ fontSize: 26, fontWeight: 800, color: "#fff", letterSpacing: "-0.5px", marginBottom: 4 }}>{r.name}</div>
          {r.currentTitle && <div style={{ fontSize: 11, color: "rgba(255,255,255,0.6)", fontWeight: 600, letterSpacing: "1px", textTransform: "uppercase", marginBottom: 10 }}>{r.currentTitle}</div>}
          <div style={{ display: "flex", flexWrap: "wrap", gap: "3px 18px", fontSize: 9.5, color: "rgba(255,255,255,0.5)" }}>{[r.email, r.phone, r.location, r.linkedin, r.github, r.portfolio].filter(Boolean).map((v, i) => <span key={i}>{v}</span>)}</div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 175px" }}>
          <div style={{ padding: "20px 24px 20px 36px", borderRight: "1px solid #e5e7eb" }}>
            {r.summary && <div style={{ marginBottom: 16, paddingBottom: 16, borderBottom: "1px solid #f3f4f6" }}><p style={{ fontSize: 10.5, lineHeight: 1.8, color: "#374151" }}>{r.summary}</p></div>}
            {r.experience?.filter(e => e.title || e.company)?.length > 0 && (
              <div style={{ marginBottom: 16 }}><Sec label="Experience" />
                {r.experience.filter(e => e.title || e.company).map((e, i) => (
                  <div key={i} style={{ marginBottom: 14 }}>
                    <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ fontWeight: 700, fontSize: 11 }}>{e.title}</span><span style={{ fontSize: 9, color: "#9ca3af" }}>{e.period}</span></div>
                    <div style={{ fontSize: 10, color: AC, fontWeight: 600, marginBottom: 5 }}>{e.company}</div>
                    <ul style={{ margin: 0, paddingLeft: 14 }}>{(e.bullets || []).filter(b => b?.trim()).map((b, j) => <li key={j} style={{ fontSize: 10.5, color: "#374151", lineHeight: 1.65, marginBottom: 2 }}>{b}</li>)}</ul>
                  </div>
                ))}
              </div>
            )}
            {hasProjects && (<div><Sec label="Projects" />{validProjects.map((p, i) => (<div key={i} style={{ marginBottom: 9 }}><div style={{ display: "flex", justifyContent: "space-between" }}><strong style={{ fontSize: 11 }}>{p.name}</strong>{p.link && <span style={{ fontSize: 9, color: AC }}>{p.link}</span>}</div>{p.tech && <div style={{ fontSize: 9, color: "#9ca3af", fontStyle: "italic" }}>{p.tech}</div>}{p.description && <div style={{ fontSize: 10.5, color: "#374151" }}>{p.description}</div>}<ul style={{ margin: "2px 0 0", paddingLeft: 14 }}>{(p.bullets || []).filter(b => b?.trim()).map((b, j) => <li key={j} style={{ fontSize: 10, color: "#374151", lineHeight: 1.55 }}>{b}</li>)}</ul></div>))}</div>)}
          </div>
          <div style={{ padding: "20px 20px", background: "#fafafa" }}>
            {allSkills.length > 0 && <div style={{ marginBottom: 16 }}><Sec label="Skills" />{r.skills?.technical?.map((s, i) => <div key={i} style={{ fontSize: 9.5, marginBottom: 3, padding: "2px 7px", background: AC + "10", borderRadius: 3, color: "#0a2540", fontWeight: 600 }}>{s}</div>)}{r.skills?.tools?.length > 0 && <><div style={{ fontSize: 8, color: "#9ca3af", fontWeight: 700, margin: "8px 0 4px", letterSpacing: "1px" }}>TOOLS</div>{r.skills.tools.map((s, i) => <div key={i} style={{ fontSize: 9.5, color: "#374151", marginBottom: 2 }}>{s}</div>)}</>}</div>}
            {r.education?.filter(e => e.degree || e.school)?.length > 0 && <div style={{ marginBottom: 16 }}><Sec label="Education" />{r.education.filter(e => e.degree || e.school).map((e, i) => <div key={i} style={{ marginBottom: 8 }}><div style={{ fontWeight: 700, fontSize: 10 }}>{e.degree}</div><div style={{ fontSize: 9.5, color: AC }}>{e.school}</div>{e.year && <div style={{ fontSize: 9, color: "#9ca3af" }}>{e.year}</div>}</div>)}</div>}
            {hasCerts && <div><Sec label="Certs" />{r.certifications.filter(c => c).map((c, i) => <div key={i} style={{ fontSize: 9.5, color: "#374151", marginBottom: 3 }}>{c}</div>)}</div>}
          </div>
        </div>
      </div>
    );
  }

  // ── LINEAR ──
  if (tpl === "linear") {
    const AC = "#5e6ad2";
    const DB = "rgba(94,106,210,0.15)";
    const Sec = ({ label }) => <div style={{ fontSize: 8, fontWeight: 800, color: AC, letterSpacing: "2.5px", textTransform: "uppercase", marginBottom: 10, paddingBottom: 3, borderBottom: `1px solid ${DB}` }}>{label}</div>;
    return (
      <div id="resume-canvas" style={{ fontFamily: ff, fontSize: 10.5, background: "#0f0f17", color: "#e8e8f0", minHeight: 1056 }}>
        <div style={{ padding: "28px 36px 20px", borderBottom: `1px solid ${DB}` }}>
          <div style={{ fontSize: 24, fontWeight: 800, color: "#f0f0f8", letterSpacing: "-0.5px", marginBottom: 4 }}>{r.name}</div>
          {r.currentTitle && <div style={{ fontSize: 11, color: AC, fontWeight: 700, letterSpacing: "1px", marginBottom: 10 }}>{r.currentTitle}</div>}
          <div style={{ display: "flex", flexWrap: "wrap", gap: "3px 16px", fontSize: 9.5, color: "rgba(232,232,240,0.4)" }}>{[r.email, r.phone, r.location, r.linkedin, r.github, r.portfolio].filter(Boolean).map((v, i) => <span key={i}>{v}</span>)}</div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 175px" }}>
          <div style={{ padding: "20px 24px 20px 36px", borderRight: `1px solid ${DB}` }}>
            {r.summary && <div style={{ marginBottom: 16, padding: "12px 14px", background: `${AC}08`, borderLeft: `2px solid ${AC}`, borderRadius: "0 6px 6px 0" }}><p style={{ fontSize: 10.5, lineHeight: 1.8, color: "rgba(232,232,240,0.75)" }}>{r.summary}</p></div>}
            {r.experience?.filter(e => e.title || e.company)?.length > 0 && (
              <div style={{ marginBottom: 16 }}><Sec label="Experience" />
                {r.experience.filter(e => e.title || e.company).map((e, i) => (
                  <div key={i} style={{ marginBottom: 14, paddingLeft: 10, borderLeft: `2px solid ${AC}40` }}>
                    <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ fontWeight: 700, fontSize: 11, color: "#f0f0f8" }}>{e.title}</span><span style={{ fontSize: 9, color: "rgba(232,232,240,0.35)", marginLeft: 8, whiteSpace: "nowrap" }}>{e.period}</span></div>
                    <div style={{ fontSize: 10, color: AC, fontWeight: 600, marginBottom: 5 }}>{e.company}</div>
                    {(e.bullets || []).filter(b => b?.trim()).map((b, j) => <div key={j} style={{ fontSize: 10.5, color: "rgba(232,232,240,0.7)", lineHeight: 1.7, display: "flex", gap: 6, marginBottom: 3 }}><span style={{ color: AC, fontSize: 7, marginTop: 5, flexShrink: 0 }}>▸</span><span>{b}</span></div>)}
                  </div>
                ))}
              </div>
            )}
            {hasProjects && (<div><Sec label="Projects" />{validProjects.map((p, i) => (<div key={i} style={{ marginBottom: 10, padding: "8px 12px", background: `${AC}06`, border: `1px solid ${DB}`, borderRadius: 6 }}><div style={{ display: "flex", justifyContent: "space-between" }}><strong style={{ fontSize: 11, color: "#f0f0f8" }}>{p.name}</strong>{p.link && <span style={{ fontSize: 9, color: AC }}>{p.link}</span>}</div>{p.tech && <div style={{ fontSize: 9, color: `${AC}cc`, fontStyle: "italic", marginBottom: 3 }}>{p.tech}</div>}{p.description && <div style={{ fontSize: 10, color: "rgba(232,232,240,0.6)", marginBottom: 3 }}>{p.description}</div>}{(p.bullets || []).filter(b => b?.trim()).map((b, j) => <div key={j} style={{ fontSize: 10, color: "rgba(232,232,240,0.6)", display: "flex", gap: 5, lineHeight: 1.55 }}><span style={{ color: AC, fontSize: 7.5, marginTop: 3.5 }}>▸</span><span>{b}</span></div>)}</div>))}</div>)}
          </div>
          <div style={{ padding: "20px 18px", background: "rgba(2,2,12,0.4)" }}>
            {allSkills.length > 0 && <div style={{ marginBottom: 16 }}><Sec label="Skills" />{r.skills?.technical?.length > 0 && <div style={{ display: "flex", flexWrap: "wrap", gap: 3, marginBottom: 9 }}>{r.skills.technical.map((s, i) => <span key={i} style={{ fontSize: 8.5, color: AC, background: `${AC}15`, padding: "2px 7px", borderRadius: 3, fontWeight: 600 }}>{s}</span>)}</div>}{r.skills?.tools?.length > 0 && <div style={{ display: "flex", flexWrap: "wrap", gap: 3 }}>{r.skills.tools.map((s, i) => <span key={i} style={{ fontSize: 8.5, color: "rgba(232,232,240,0.55)", background: "rgba(255,255,255,0.05)", padding: "2px 7px", borderRadius: 3, border: "1px solid rgba(255,255,255,0.07)" }}>{s}</span>)}</div>}</div>}
            {r.education?.filter(e => e.degree || e.school)?.length > 0 && <div style={{ marginBottom: 16 }}><Sec label="Education" />{r.education.filter(e => e.degree || e.school).map((e, i) => <div key={i} style={{ marginBottom: 8 }}><div style={{ fontWeight: 700, fontSize: 10, color: "#f0f0f8" }}>{e.degree}</div><div style={{ fontSize: 9.5, color: AC }}>{e.school}</div>{e.year && <div style={{ fontSize: 8.5, color: "rgba(232,232,240,0.3)" }}>{e.year}</div>}</div>)}</div>}
            {hasCerts && <div><Sec label="Certs" />{r.certifications.filter(c => c).map((c, i) => <div key={i} style={{ fontSize: 9.5, color: "rgba(232,232,240,0.55)", marginBottom: 4, display: "flex", gap: 5 }}><span style={{ color: AC }}>◆</span><span>{c}</span></div>)}</div>}
          </div>
        </div>
      </div>
    );
  }

  // ── VERCEL ──
  if (tpl === "vercel") {
    const Sec = ({ label }) => <div style={{ fontSize: 8, fontWeight: 900, color: "#000", letterSpacing: "2px", textTransform: "uppercase", marginBottom: 10, borderBottom: "3px solid #000", paddingBottom: 4 }}>{label}</div>;
    return (
      <div id="resume-canvas" style={{ fontFamily: ff, fontSize: 10.5, background: "#fff", minHeight: 1056 }}>
        <div style={{ background: "#000", padding: "28px 40px 22px" }}>
          <div style={{ fontSize: 28, fontWeight: 900, color: "#fff", letterSpacing: "-1px", marginBottom: 4 }}>{r.name}</div>
          {r.currentTitle && <div style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", fontWeight: 600, letterSpacing: "2px", textTransform: "uppercase", marginBottom: 10 }}>{r.currentTitle}</div>}
          <div style={{ display: "flex", flexWrap: "wrap", gap: "2px 16px", fontSize: 9.5, color: "rgba(255,255,255,0.4)" }}>{[r.email, r.phone, r.location, r.linkedin, r.github, r.portfolio].filter(Boolean).map((v, i) => <span key={i}>{v}</span>)}</div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 175px" }}>
          <div style={{ padding: "22px 24px 22px 40px", borderRight: "1px solid #000" }}>
            {r.summary && <div style={{ marginBottom: 18, paddingBottom: 16, borderBottom: "2px solid #000" }}><p style={{ fontSize: 10.5, lineHeight: 1.8, color: "#111827" }}>{r.summary}</p></div>}
            {r.experience?.filter(e => e.title || e.company)?.length > 0 && (
              <div style={{ marginBottom: 18 }}><Sec label="Experience" />
                {r.experience.filter(e => e.title || e.company).map((e, i) => (
                  <div key={i} style={{ marginBottom: 14 }}>
                    <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ fontWeight: 800, fontSize: 11, color: "#000" }}>{e.title}</span><span style={{ fontSize: 9, color: "#9ca3af" }}>{e.period}</span></div>
                    <div style={{ fontSize: 10, color: "#6b7280", fontWeight: 700, marginBottom: 5, textTransform: "uppercase", letterSpacing: "0.5px" }}>{e.company}</div>
                    <ul style={{ margin: 0, paddingLeft: 14 }}>{(e.bullets || []).filter(b => b?.trim()).map((b, j) => <li key={j} style={{ fontSize: 10.5, color: "#374151", lineHeight: 1.65, marginBottom: 2 }}>{b}</li>)}</ul>
                  </div>
                ))}
              </div>
            )}
            {hasProjects && (<div><Sec label="Projects" />{validProjects.map((p, i) => (<div key={i} style={{ marginBottom: 10, borderLeft: "3px solid #000", paddingLeft: 10 }}><div style={{ display: "flex", justifyContent: "space-between" }}><strong style={{ fontSize: 11, color: "#000" }}>{p.name}</strong>{p.link && <span style={{ fontSize: 9, color: "#6b7280" }}>{p.link}</span>}</div>{p.tech && <div style={{ fontSize: 9, color: "#9ca3af", fontStyle: "italic" }}>{p.tech}</div>}{p.description && <div style={{ fontSize: 10.5, color: "#374151", marginBottom: 2 }}>{p.description}</div>}<ul style={{ margin: "2px 0 0", paddingLeft: 14 }}>{(p.bullets || []).filter(b => b?.trim()).map((b, j) => <li key={j} style={{ fontSize: 10, color: "#374151", lineHeight: 1.55 }}>{b}</li>)}</ul></div>))}</div>)}
          </div>
          <div style={{ padding: "22px 22px", background: "#f9fafb", borderLeft: "1px solid #e5e7eb" }}>
            {allSkills.length > 0 && <div style={{ marginBottom: 18 }}><Sec label="Skills" /><div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>{r.skills?.technical?.map((s, i) => <div key={i} style={{ fontSize: 9.5, marginBottom: 3, padding: "3px 7px", background: "#000", borderRadius: 3, color: "#fff", fontWeight: 600 }}>{s}</div>)}</div>{r.skills?.tools?.length > 0 && <div style={{ marginTop: 8 }}>{r.skills.tools.map((s, i) => <div key={i} style={{ fontSize: 9.5, color: "#6b7280", marginBottom: 2 }}>{s}</div>)}</div>}</div>}
            {r.education?.filter(e => e.degree || e.school)?.length > 0 && <div style={{ marginBottom: 18 }}><Sec label="Education" />{r.education.filter(e => e.degree || e.school).map((e, i) => <div key={i} style={{ marginBottom: 9 }}><div style={{ fontWeight: 800, fontSize: 10, color: "#000" }}>{e.degree}</div><div style={{ fontSize: 9.5, color: "#6b7280" }}>{e.school}</div>{e.year && <div style={{ fontSize: 9, color: "#9ca3af" }}>{e.year}</div>}</div>)}</div>}
            {hasCerts && <div><Sec label="Certs" />{r.certifications.filter(c => c).map((c, i) => <div key={i} style={{ fontSize: 9.5, color: "#374151", marginBottom: 4 }}>{c}</div>)}</div>}
          </div>
        </div>
      </div>
    );
  }

  return <div id="resume-canvas" style={{ fontFamily: ff, fontSize: 10.5, background: "#fff", padding: "36px 48px", minHeight: 1056, color: "#111" }}><div style={{ fontSize: 24, fontWeight: 800 }}>{r.name}</div></div>;
};

// ─── BUILDER PAGE ──────────────────────────────────────────────────────────────
const BuilderPage = ({ resume: initialResume, jobData, user, savedId: initSavedId, onBack }) => {
  const [resume, setResume] = useState(initialResume);
  const [tpl, setTpl] = useState(initialResume?._tpl || "ats_pro");
  const [font, setFont] = useState(initialResume?._font || "DM Sans");
  const [tab, setTab] = useState("preview");
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState(null);
  const [savedId, setSavedId] = useState(initSavedId);

  const updateField = (path, value) => {
    setResume(r => {
      const clone = JSON.parse(JSON.stringify(r));
      const keys = path.split(".");
      let obj = clone;
      for (let i = 0; i < keys.length - 1; i++) obj = obj[keys[i]];
      obj[keys[keys.length - 1]] = value;
      return clone;
    });
  };

  useEffect(() => {
    const bp = () => {
      const c = document.getElementById("resume-canvas");
      if (!c) return;
      const scale = Math.min(1, 1123 / c.scrollHeight);
      if (scale < 1) { c.style.transform = `scale(${scale})`; c.style.transformOrigin = "top left"; c.style.width = `${100 / scale}%`; }
    };
    const ap = () => { const c = document.getElementById("resume-canvas"); if (c) { c.style.transform = ""; c.style.width = ""; } };
    window.addEventListener("beforeprint", bp);
    window.addEventListener("afterprint", ap);
    return () => { window.removeEventListener("beforeprint", bp); window.removeEventListener("afterprint", ap); };
  }, []);

  const saveToDB = async () => {
    if (!user) return;
    setSaving(true);
    try {
      const data = await saveResume(user.id, resume, jobData, tpl, font, savedId);
      if (data && !savedId) setSavedId(data.id);
      setSaveMsg("Saved ✓");
    } catch { setSaveMsg("Save failed"); }
    setSaving(false);
    setTimeout(() => setSaveMsg(null), 2500);
  };

  const downloadPDF = () => {
    const canvas = document.getElementById("resume-canvas");
    if (!canvas) return;
    const A4_W = 794; const A4_H = 1123;
    const scale = Math.min(A4_W / canvas.scrollWidth, A4_H / canvas.scrollHeight, 1);
    const styles = Array.from(document.styleSheets).map(ss => { try { return Array.from(ss.cssRules).map(r => r.cssText).join("\n"); } catch { return ""; } }).join("\n");
    const printDoc = `<!DOCTYPE html><html><head><meta charset="utf-8"/><style>@import url('https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,400;9..40,600;9..40,700&family=Lora:ital,wght@0,400;0,600;1,400&family=Fraunces:opsz,wght@9..144,700;9..144,900&family=Inter:wght@400;600;700&family=Syne:wght@700;800&display=swap');*{box-sizing:border-box;margin:0;padding:0}${styles}html,body{width:${A4_W}px;height:${A4_H}px;overflow:hidden;background:white}#resume-canvas{width:${A4_W}px!important;transform:scale(${scale});transform-origin:top left}@page{margin:0;size:A4 portrait}</style></head><body>${canvas.outerHTML}</body></html>`;
    const iframe = document.createElement("iframe");
    iframe.style.cssText = "position:fixed;top:-9999px;left:-9999px;width:794px;height:1123px;border:none;";
    document.body.appendChild(iframe);
    iframe.contentDocument.open(); iframe.contentDocument.write(printDoc); iframe.contentDocument.close();
    iframe.onload = () => { setTimeout(() => { iframe.contentWindow.focus(); iframe.contentWindow.print(); setTimeout(() => document.body.removeChild(iframe), 1000); }, 800); };
  };

  return (
    <div style={{ minHeight: "100vh", background: C.bg, fontFamily: "'DM Sans',sans-serif", display: "flex", flexDirection: "column" }}>
      <header className="no-print" style={{ background: C.surface, borderBottom: `1.5px solid ${C.border}`, padding: "0 18px", height: 58, display: "flex", alignItems: "center", gap: 10, position: "sticky", top: 0, zIndex: 50 }}>
        <button className="btn-ghost" onClick={onBack} style={{ padding: "7px 12px", fontSize: 12 }}>← Back</button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: "'Syne',sans-serif", fontSize: 13, fontWeight: 700, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {resume?.name || "Resume"}{jobData?.co ? ` → ${jobData.co}` : ""}
          </div>
        </div>
        <div style={{ display: "flex", gap: 2, background: C.bg, borderRadius: 8, padding: "3px", border: `1px solid ${C.border}` }}>
          {["preview", "edit"].map(t => <button key={t} onClick={() => setTab(t)} style={{ padding: "6px 16px", borderRadius: 6, border: "none", cursor: "pointer", fontSize: 12, fontWeight: 600, fontFamily: "'DM Sans',sans-serif", transition: "all .15s", background: tab === t ? C.surface : "none", color: tab === t ? C.text : C.textMuted }}>{t === "preview" ? "Preview" : "Edit"}</button>)}
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {saveMsg && <span style={{ fontSize: 12, color: saveMsg.includes("✓") ? C.emerald : C.rose, fontWeight: 600 }}>{saveMsg}</span>}
          {user && <button className="btn-secondary" onClick={saveToDB} disabled={saving} style={{ fontSize: 12, padding: "7px 13px", gap: 5 }}>{saving ? <Spinner s={12} c={C.textMuted} /> : <Icon n="sv" s={12} c={C.textMuted} />}{saving ? "Saving..." : "Save"}</button>}
          <button className="btn-primary" onClick={downloadPDF} style={{ fontSize: 12, padding: "7px 15px", gap: 5 }}><Icon n="dl" s={12} c="#fff" /> Download PDF</button>
        </div>
      </header>

      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        <div className="no-print desktop-only" style={{ width: 210, borderRight: `1.5px solid ${C.border}`, padding: "18px 12px", overflowY: "auto", background: C.surface, flexShrink: 0 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: C.textLight, letterSpacing: "1.5px", marginBottom: 10 }}>TEMPLATE</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 5, marginBottom: 24 }}>
            {TEMPLATES.map(tm => (
              <button key={tm.id} onClick={() => setTpl(tm.id)} style={{ padding: "9px 6px", borderRadius: 7, border: tpl === tm.id ? `2px solid ${tm.preview}` : `1.5px solid ${C.border}`, background: tpl === tm.id ? tm.preview + "15" : C.surfaceAlt, cursor: "pointer", fontSize: 9, fontWeight: 600, fontFamily: "'DM Sans',sans-serif", color: tpl === tm.id ? tm.preview : C.textMuted, transition: "all .15s", textAlign: "center" }}>
                <div style={{ width: "100%", height: 20, background: tm.dark ? "#1a1a2e" : tm.hBg, borderRadius: 3, marginBottom: 5, border: `1px solid ${tm.preview}30` }} />
                {tm.n}
              </button>
            ))}
          </div>
          <div style={{ fontSize: 10, fontWeight: 700, color: C.textLight, letterSpacing: "1.5px", marginBottom: 8 }}>FONT</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {FONTS.map(f => (
              <button key={f.n} onClick={() => setFont(f.n)} style={{ padding: "8px 11px", borderRadius: 7, border: font === f.n ? `1.5px solid ${C.accent}` : `1.5px solid ${C.border}`, background: font === f.n ? C.accentBg : "none", cursor: "pointer", fontSize: 12, fontFamily: f.v, fontWeight: 600, color: font === f.n ? C.accent : C.textMuted, textAlign: "left", transition: "all .15s" }}>
                {f.n}
              </button>
            ))}
          </div>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "26px 22px", background: C.bgAlt }}>
          {tab === "preview"
            ? <div style={{ maxWidth: 794, margin: "0 auto", boxShadow: "0 8px 60px rgba(0,0,0,.4)", borderRadius: 4, overflow: "hidden" }}><ResumeView resume={resume} tpl={tpl} font={font} /></div>
            : (
              <div style={{ maxWidth: 740, margin: "0 auto", display: "flex", flexDirection: "column", gap: 14 }}>
                <div className="card" style={{ padding: "22px" }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: C.textMuted, letterSpacing: ".5px", marginBottom: 14, textTransform: "uppercase" }}>Contact Info</div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                    {[["name", "Full Name"], ["currentTitle", "Title"], ["email", "Email"], ["phone", "Phone"], ["location", "Location"], ["linkedin", "LinkedIn"], ["github", "GitHub"], ["portfolio", "Portfolio"]].map(([k, l]) => (
                      <div key={k}><label style={{ fontSize: 11, color: C.textMuted, display: "block", marginBottom: 4, fontWeight: 500 }}>{l}</label><input className="input-dark" value={resume?.[k] || ""} onChange={e => updateField(k, e.target.value)} style={{ fontSize: 13 }} /></div>
                    ))}
                  </div>
                </div>
                <div className="card" style={{ padding: "22px" }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: C.textMuted, letterSpacing: ".5px", marginBottom: 10, textTransform: "uppercase" }}>Professional Summary</div>
                  <textarea className="input-dark" value={resume?.summary || ""} onChange={e => updateField("summary", e.target.value)} rows={4} style={{ fontSize: 13 }} />
                </div>
                <div className="card" style={{ padding: "22px" }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: C.textMuted, letterSpacing: ".5px", marginBottom: 16, textTransform: "uppercase" }}>Experience</div>
                  {(resume?.experience || []).map((exp, i) => (
                    <div key={i} style={{ marginBottom: 20, paddingBottom: 20, borderBottom: i < (resume.experience.length - 1) ? `1px solid ${C.border}` : "none" }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: C.accent, marginBottom: 9 }}>Role {i + 1}</div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 9, marginBottom: 10 }}>
                        {[["title", "Job Title"], ["company", "Company"], ["period", "Period"], ["location", "Location"]].map(([k, l]) => (
                          <div key={k}><label style={{ fontSize: 11, color: C.textMuted, display: "block", marginBottom: 4, fontWeight: 500 }}>{l}</label><input className="input-dark" value={exp[k] || ""} onChange={e => { const exps = JSON.parse(JSON.stringify(resume.experience)); exps[i][k] = e.target.value; updateField("experience", exps); }} style={{ fontSize: 13 }} /></div>
                        ))}
                      </div>
                      <div><label style={{ fontSize: 11, color: C.textMuted, display: "block", marginBottom: 4, fontWeight: 500 }}>Bullet Points (one per line)</label><textarea className="input-dark" value={(exp.bullets || []).join("\n")} onChange={e => { const exps = JSON.parse(JSON.stringify(resume.experience)); exps[i].bullets = e.target.value.split("\n"); updateField("experience", exps); }} rows={5} style={{ fontSize: 13 }} /></div>
                    </div>
                  ))}
                </div>
                <div className="card" style={{ padding: "22px" }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: C.textMuted, letterSpacing: ".5px", marginBottom: 14, textTransform: "uppercase" }}>Projects</div>
                  {(resume?.projects || []).map((proj, i) => (
                    <div key={i} style={{ marginBottom: 18, paddingBottom: 18, borderBottom: i < (resume.projects.length - 1) ? `1px solid ${C.border}` : "none" }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: C.accent, marginBottom: 9 }}>Project {i + 1}</div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 9, marginBottom: 10 }}>
                        {[["name", "Project Name"], ["tech", "Tech Stack"], ["link", "Link"], ["description", "Description"]].map(([k, l]) => (
                          <div key={k}><label style={{ fontSize: 11, color: C.textMuted, display: "block", marginBottom: 4, fontWeight: 500 }}>{l}</label><input className="input-dark" value={proj[k] || ""} onChange={e => { const ps = JSON.parse(JSON.stringify(resume.projects)); ps[i][k] = e.target.value; updateField("projects", ps); }} style={{ fontSize: 13 }} /></div>
                        ))}
                      </div>
                      <div><label style={{ fontSize: 11, color: C.textMuted, display: "block", marginBottom: 4, fontWeight: 500 }}>Bullet Points (one per line)</label><textarea className="input-dark" value={(proj.bullets || []).join("\n")} onChange={e => { const ps = JSON.parse(JSON.stringify(resume.projects)); ps[i].bullets = e.target.value.split("\n"); updateField("projects", ps); }} rows={3} style={{ fontSize: 13 }} /></div>
                    </div>
                  ))}
                </div>
                <div className="card" style={{ padding: "22px" }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: C.textMuted, letterSpacing: ".5px", marginBottom: 12, textTransform: "uppercase" }}>Skills</div>
                  {[["technical", "Technical Skills (comma separated)"], ["soft", "Soft Skills (comma separated)"], ["tools", "Tools & Technologies (comma separated)"]].map(([k, l]) => (
                    <div key={k} style={{ marginBottom: 11 }}><label style={{ fontSize: 11, color: C.textMuted, display: "block", marginBottom: 4, fontWeight: 500 }}>{l}</label><input className="input-dark" value={(resume?.skills?.[k] || []).join(", ")} onChange={e => { const skills = JSON.parse(JSON.stringify(resume.skills || {})); skills[k] = e.target.value.split(",").map(s => s.trim()).filter(Boolean); updateField("skills", skills); }} style={{ fontSize: 13 }} /></div>
                  ))}
                </div>
                <div className="card" style={{ padding: "22px" }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: C.textMuted, letterSpacing: ".5px", marginBottom: 12, textTransform: "uppercase" }}>Education</div>
                  {(resume?.education || []).map((edu, i) => (
                    <div key={i} style={{ marginBottom: 14 }}>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 9 }}>
                        {[["degree", "Degree"], ["school", "School"], ["year", "Year"], ["gpa", "GPA"]].map(([k, l]) => (
                          <div key={k}><label style={{ fontSize: 11, color: C.textMuted, display: "block", marginBottom: 4, fontWeight: 500 }}>{l}</label><input className="input-dark" value={edu[k] || ""} onChange={e => { const edus = JSON.parse(JSON.stringify(resume.education)); edus[i][k] = e.target.value; updateField("education", edus); }} style={{ fontSize: 13 }} /></div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
                <div className="card" style={{ padding: "22px" }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: C.textMuted, letterSpacing: ".5px", marginBottom: 10, textTransform: "uppercase" }}>Certifications</div>
                  <textarea className="input-dark" value={(resume?.certifications || []).filter(c => c).join("\n")} onChange={e => updateField("certifications", e.target.value.split("\n").map(s => s.trim()).filter(Boolean))} rows={3} style={{ fontSize: 13 }} placeholder="One certification per line" />
                </div>
              </div>
            )
          }
        </div>
      </div>
    </div>
  );
};

// ─── MAIN APP ─────────────────────────────────────────────────────────────────
export default function App() {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [screen, setScreen] = useState("landing");
  const [page, setPage] = useState("overview");
  const [showAuth, setShowAuth] = useState(false);
  const [resumes, setResumes] = useState([]);
  const [coverLetters, setCoverLetters] = useState([]);
  const [outreachEmails, setOutreachEmails] = useState([]);
  const [dataLoaded, setDataLoaded] = useState(false);

  const [jobData, setJobData] = useState(null);
  const [buildType, setBuildType] = useState("resume");
  const [activeResume, setActiveResume] = useState(null);
  const [savedResumeId, setSavedResumeId] = useState(null);
  const [genStage, setGenStage] = useState(0);
  const [aiProvider, setAiProvider] = useState(null);
  const timer = useRef(null);

  const setRoute = useCallback((path) => { window.history.pushState({}, "", `/${path}`); }, []);

  useEffect(() => {
    const bootTimer = setTimeout(() => { if (screen === "boot") setScreen("landing"); }, 3000);
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      clearTimeout(bootTimer);
      const u = session?.user ?? null;
      setUser(u);
      if (u) { await upsertProfile(u); const p = await fetchProfile(u.id); setProfile(p); setScreen("dashboard"); setRoute("dashboard"); }
      else { setScreen("landing"); setRoute(""); }
    }).catch(() => { clearTimeout(bootTimer); setScreen("landing"); });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      const u = session?.user ?? null;
      setUser(u);
      if (u) { await upsertProfile(u); const p = await fetchProfile(u.id); setProfile(p); setShowAuth(false); setScreen("dashboard"); setPage("overview"); setRoute("dashboard"); }
      else { setUser(null); setProfile(null); setScreen("landing"); setRoute(""); }
    });
    return () => { clearTimeout(bootTimer); subscription.unsubscribe(); };
  }, []);

  useEffect(() => {
    if (user && !dataLoaded) {
      Promise.all([fetchResumes(user.id), fetchCoverLetters(user.id), fetchOutreachEmails(user.id)]).then(([r, cl, em]) => {
        setResumes(r); setCoverLetters(cl); setOutreachEmails(em); setDataLoaded(true);
      });
    }
  }, [user, dataLoaded]);

  const refreshData = async () => {
    if (!user) return;
    const [r, cl, em, p] = await Promise.all([fetchResumes(user.id), fetchCoverLetters(user.id), fetchOutreachEmails(user.id), fetchProfile(user.id)]);
    setResumes(r); setCoverLetters(cl); setOutreachEmails(em); setProfile(p);
  };

  const signOut = async () => {
    if (timer.current) clearInterval(timer.current);
    await supabase.auth.signOut();
    setUser(null); setProfile(null); setResumes([]); setCoverLetters([]); setOutreachEmails([]); setDataLoaded(false);
    setScreen("landing"); setRoute("");
  };

  const goToBuild = () => { setScreen("build_launcher"); setRoute("build"); };
  const navTo = (p) => {
    if (p === "build") { goToBuild(); return; }
    setPage(p); setScreen("dashboard"); setRoute(`dashboard/${p}`);
  };

  const openResume = (row) => {
    setActiveResume({ ...row.content, _tpl: row.template, _font: row.font });
    setJobData({ co: row.company_name, jd: row.job_description });
    setSavedResumeId(row.id);
    setScreen("builder"); setRoute("builder");
  };

  const generate = useCallback(async (jd, company, candidateText, extraData = {}) => {
    setScreen("generating");
    setGenStage(0);
    setAiProvider(null);
    timer.current = setInterval(() => setGenStage(s => s + 1), 2200);

    const textQuality = candidateText?.trim().length || 0;
    const looksReal = textQuality > 200 && (candidateText.includes("@") || candidateText.match(/\b(experience|skills|education|project|work)\b/i));
    if (!looksReal) {
      clearInterval(timer.current);
      alert("We couldn't read your resume content. Please use 'Fill in details' instead, or upload a text-based PDF.");
      setScreen("build"); return;
    }

    const currentBuildType = buildType;

    if (currentBuildType === "resume") {
      const fallback = buildOffline(candidateText, jd, company);
      try {
        const { text, provider } = await callAI(buildResumePrompt(company, jd, candidateText));
        setAiProvider(provider);
        clearInterval(timer.current);
        const parsed = extractJSON(text, null);
        const result = parsed ? {
          ...fallback, ...parsed,
          experience: parsed.experience?.length > 0 ? parsed.experience.filter(e => e.company && e.company !== "Previous Role") : fallback.experience,
          projects: Array.isArray(parsed.projects) && parsed.projects.length > 0 ? parsed.projects : fallback.projects,
          skills: { technical: parsed.skills?.technical?.length > 0 ? parsed.skills.technical : fallback.skills.technical, soft: parsed.skills?.soft?.length > 0 ? parsed.skills.soft : fallback.skills.soft, tools: parsed.skills?.tools?.length > 0 ? parsed.skills.tools : fallback.skills.tools },
          education: parsed.education?.length > 0 ? parsed.education : fallback.education,
          certifications: Array.isArray(parsed.certifications) ? parsed.certifications : fallback.certifications,
        } : fallback;
        setActiveResume(result); setScreen("builder"); setRoute("builder");
        if (user) { const saved = await saveResume(user.id, result, { co: company, jd }, "ats_pro", "DM Sans", null); if (saved) { setSavedResumeId(saved.id); await refreshData(); } }
      } catch {
        clearInterval(timer.current);
        const fb = buildOffline(candidateText, jd, company);
        setActiveResume(fb); setScreen("builder"); setRoute("builder");
        if (user) { const saved = await saveResume(user.id, fb, { co: company, jd }, "ats_pro", "DM Sans", null); if (saved) { setSavedResumeId(saved.id); await refreshData(); } }
      }
    } else if (currentBuildType === "cover_letter") {
      try {
        const { text, provider } = await callAIText(buildCoverLetterPrompt(company, jd, candidateText, extraData.role));
        setAiProvider(provider);
        clearInterval(timer.current);
        const parsed = extractJSON(text, null);
        if (parsed && user) { await saveCoverLetter(user.id, parsed, { co: company, jd }, null); await refreshData(); }
      } catch { clearInterval(timer.current); }
      setPage("cover_letters"); setScreen("dashboard"); setRoute("dashboard/cover_letters");
    } else if (currentBuildType === "email") {
      try {
        const { text, provider } = await callAIText(buildOutreachEmailPrompt(company, jd, candidateText, extraData.recipientName, extraData.recipientRole, extraData.emailType));
        setAiProvider(provider);
        clearInterval(timer.current);
        const parsed = extractJSON(text, null);
        if (parsed && user) { await saveOutreachEmail(user.id, parsed, { co: company, jd }, null); await refreshData(); }
      } catch { clearInterval(timer.current); }
      setPage("emails"); setScreen("dashboard"); setRoute("dashboard/emails");
    }
  }, [user, buildType]);

  const handleBuildTypeSelect = (type) => { setBuildType(type); setScreen("build"); setRoute("build"); };
  const handleJobNext = (d) => {
    setJobData(d);
    if (d.mode === "questionnaire") { setScreen("questionnaire"); setRoute("build/questions"); }
    else { generate(d.jd, d.co, d.fileText || "", { recipientName: d.recipientName, recipientRole: d.recipientRole, emailType: d.emailType }); }
  };
  const handlePlanSuccess = async () => { if (user) { const p = await fetchProfile(user.id); setProfile(p); } };

  // if (screen === "boot") return (
  //   <><GS />
  //     <div style={{ height: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: C.bg, flexDirection: "column", gap: 16 }}>
  //       <div style={{ width: 56, height: 56, background: `linear-gradient(135deg, ${C.accent}, ${C.violet})`, borderRadius: 14, display: "flex", alignItems: "center", justifyContent: "center", animation: "float 2.5s ease-in-out infinite", boxShadow: "0 0 40px rgba(99,102,241,.3)" }}>
  //         <Icon n="spark" s={26} c="#fff" />
  //       </div>
  //       <Spinner s={20} c={C.accent} />
  //     </div>
  //   </>
  // );

  if (screen === "landing") return <><GS />{showAuth && <AuthModal onClose={() => setShowAuth(false)} />}<Landing onSignIn={() => setShowAuth(true)} /></>;
  if (screen === "build_launcher") return <><GS /><BuildLauncher onSelect={handleBuildTypeSelect} onBack={() => { setScreen("dashboard"); setRoute("dashboard"); }} /></>;
  if (screen === "build") return <><GS /><JobInputPage buildType={buildType} onNext={handleJobNext} onBack={() => { setScreen("build_launcher"); setRoute("build"); }} /></>;
  if (screen === "questionnaire") return <><GS /><QuestionnairePage company={jobData?.co} onDone={ct => generate(jobData.jd, jobData.co, ct, { recipientName: jobData?.recipientName, recipientRole: jobData?.recipientRole, emailType: jobData?.emailType })} onBack={() => setScreen("build")} /></>;
  if (screen === "generating") return <><GS /><GeneratingScreen stage={genStage} provider={aiProvider} company={jobData?.co} buildType={buildType} /></>;
  if (screen === "builder" && activeResume) return <><GS /><BuilderPage resume={activeResume} jobData={jobData} user={user} savedId={savedResumeId} onBack={() => { setScreen("dashboard"); setPage("resumes"); setRoute("dashboard/resumes"); refreshData(); }} /></>;

  if (screen === "dashboard" && user) {
    const renderPage = () => {
      switch (page) {
        case "overview": return <OverviewPage user={user} profile={profile} resumes={resumes} coverLetters={coverLetters} outreachEmails={outreachEmails} onBuild={goToBuild} onOpenResume={openResume} onNav={navTo} />;
        case "resumes": return <ResumesPage resumes={resumes} setResumes={setResumes} onBuild={goToBuild} onOpen={openResume} />;
        case "cover_letters": return <CoverLettersPage coverLetters={coverLetters} setCoverLetters={setCoverLetters} onBuild={goToBuild} />;
        case "emails": return <EmailsPage outreachEmails={outreachEmails} setOutreachEmails={setOutreachEmails} onBuild={goToBuild} />;
        case "plan": return <PlanPage user={user} profile={profile} onPlanSuccess={handlePlanSuccess} />;
        default: return <OverviewPage user={user} profile={profile} resumes={resumes} coverLetters={coverLetters} outreachEmails={outreachEmails} onBuild={goToBuild} onOpenResume={openResume} onNav={navTo} />;
      }
    };
    return (
      <><GS />{showAuth && <AuthModal onClose={() => setShowAuth(false)} />}
        <DashboardLayout user={user} profile={profile} onSignOut={signOut} page={page} onNav={navTo}>{renderPage()}</DashboardLayout>
      </>
    );
  }

  return <><GS /><div style={{ height: "100vh", background: C.bg, display: "flex", alignItems: "center", justifyContent: "center" }}><Spinner s={24} c={C.accent} /></div></>;
}