import { useState, useEffect, useRef, useCallback } from "react";
import { createClient } from "@supabase/supabase-js";

// ─── SUPABASE ────────────────────────────────────────────────────────────────
const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_DEFAULT_KEY
);
const SectionTitleDark = ({ label, ac }) => (
  <div style={{ marginBottom: 8, paddingBottom: 4, borderBottom: `1px solid ${ac}30` }}>
    <span style={{ fontSize: 8, fontWeight: 800, color: ac, textTransform: "uppercase", letterSpacing: "2.5px" }}>{label}</span>
  </div>
);
// ─── PLANS ───────────────────────────────────────────────────────────────────
const PLANS = {
  free: {
    name: "Free",
    inr: 0,
    resumeLimit: 2,
    features: ["2 AI-tailored resumes", "All templates", "PDF export", "ATS keyword matching"],
    cta: "Current Plan",
    color: "#92857a",
  },
  pay_per: {
    name: "Pay Per Resume",
    inr: 30,
    resumeLimit: 9999,
    features: ["₹30 per resume", "No subscription", "All templates", "Full AI tailoring", "PDF + edit"],
    cta: "Pay as you go",
    popular: true,
    color: "#7c6355",
  },
  lifetime: {
    name: "Lifetime",
    inr: 999,
    resumeLimit: 9999,
    features: ["Unlimited resumes", "All templates forever", "Priority AI", "One-time payment"],
    cta: "Get Lifetime Access",
    badge: "Best Value",
    color: "#a0845c",
  },
};

const INR_TO = { USD: 0.012, GBP: 0.0095, EUR: 0.011, INR: 1, AUD: 0.018, CAD: 0.016 };
const CURRENCY_SYMBOLS = { USD: "$", GBP: "£", EUR: "€", INR: "₹", AUD: "A$", CAD: "C$" };
const CURRENCY_MAP = { US: "USD", GB: "GBP", IN: "INR", AU: "AUD", CA: "CAD", DE: "EUR", FR: "EUR" };

function fmtPrice(inr, currency = "INR") {
  if (!currency || currency === "INR") return `₹${inr}`;
  const rate = INR_TO[currency] || 0.012;
  const val = Math.round(inr * rate);
  return `${CURRENCY_SYMBOLS[currency] || "$"}${val}`;
}

// ─── RAZORPAY ────────────────────────────────────────────────────────────────
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
      theme: { color: "#7c6355" },
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
    console.log("🔵 Trying provider:", p.id);

    try {
      const t = await p.run(prompt);

      console.log(`🟢 [${p.id}] RAW RESPONSE (${t?.length} chars):\n`, t?.slice(0, 500));

      if (!t || typeof t !== "string" || t.trim().length === 0) {
        console.warn(`⚠️ [${p.id}] Empty response, skipping`);
        errors.push({ provider: p.id, reason: "empty_response" });
        continue;
      }

      // Validate it looks like JSON before returning
      const trimmed = t.trim();
      const looksLikeJSON = trimmed.includes("{") && trimmed.includes("}");

      if (!looksLikeJSON) {
        console.warn(`⚠️ [${p.id}] Response doesn't contain JSON, skipping. Preview:`, trimmed.slice(0, 100));
        errors.push({ provider: p.id, reason: "no_json_detected", preview: trimmed.slice(0, 100) });
        continue;
      }

      console.log(`✅ [${p.id}] Valid response, returning`);
      return { text: t, provider: p.label };

    } catch (e) {
      console.log(`❌ [${p.id}] Provider failed:`, e.message);

      if (e instanceof RateLimit) {
        cooldown[e.message] = now + 3600000;
        errors.push({ provider: p.id, reason: "rate_limit" });
        continue;
      }

      // Non-rate-limit errors: log but try next provider
      errors.push({ provider: p.id, reason: e.message });
    }
  }

  console.error("🚨 All providers failed. Summary:", errors);
  throw new Error(`ALL_FAILED: ${JSON.stringify(errors)}`);
}

// ─── PROMPT ────────────────────────────────────────────────────────────────
// FIX 1 & 2: Rewrote the rules to strictly forbid invention and enforce
// rewriting only what the candidate actually wrote.
function buildPrompt(company, jd, candidateText) {
  const finalPrompt = `You are a world-class technical resume writer. Your task is to produce a complete, ATS-optimized, 100% factual resume JSON for a candidate applying to ${company}.
 
════════════════════════════════════════
COMPANY: ${company}
════════════════════════════════════════
 
JOB DESCRIPTION:
"""
${jd}
"""
 
CANDIDATE BACKGROUND:
"""
${candidateText.slice(0, 8000)}
"""
════════════════════════════════════════
 
YOUR MISSION:
Rewrite the candidate's resume so it speaks ${company}'s exact language — their culture signals, technical requirements, and values — using ONLY the candidate's real experience. Never fabricate.
 
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STEP 1 — EXTRACT COMPANY CULTURAL VALUES from the JD.
For ${company}, identify values like: ownership, speed, async communication, intellectual honesty, AI-native workflow, builder identity, low ego.
You will weave these into bullets naturally where the candidate's REAL work supports them.
 
STEP 2 — EXTRACT ALL JD TECHNICAL KEYWORDS.
List every tech requirement: languages, frameworks, tools, systems, practices.
You will prioritize these in skills and bullets.
 
STEP 3 — MAP CANDIDATE BACKGROUND to both.
For EACH bullet: take what the candidate actually wrote → rewrite with:
  (a) stronger action verb (Build/Ship/Engineer/Design/Architect/Own/Deploy/Automate/Optimize/Scale)
  (b) one JD keyword woven in naturally if applicable
  (c) one cultural signal woven in if the work supports it (e.g., "owned end-to-end", "shipped in 48h", "zero downtime")
  SAME FACTS. SAME COUNT. NO INVENTION.
 
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ABSOLUTE RULES — VIOLATIONS ARE UNACCEPTABLE:
 
1. NEVER invent metrics, percentages, user counts, or achievements the candidate didn't write.
2. NEVER add technologies the candidate didn't mention.
3. Output EXACTLY the same number of bullets per role as the candidate provided.
4. PROJECTS — CRITICAL RULE: Count every single project the candidate listed. If they listed 5, output 5. If they listed 3, output 3. Do not skip, merge, or drop any project. This is non-negotiable.
5. Summary: 2-3 sentences. Mention ${company}. Reference their culture (ownership, AI-native, builder identity). Use ONLY facts from candidate background.
6. Skills: List JD-matching skills first. Only include what candidate actually has.
7. Forbidden bullet starters: "Responsible for", "Helped", "Assisted", "Worked on", "Participated in".
8. FORBIDDEN in bullets: any metric the candidate didn't write (e.g., "40%", "10K users", "3x faster").
 
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
BEFORE WRITING EACH EXPERIENCE ENTRY:
  → Read candidate's exact bullets for that role
  → Count them (e.g., 6 bullets)
  → Rewrite exactly that many — no more, no less
 
BEFORE WRITING PROJECTS:
  → List every project name from the candidate text
  → Count them (e.g., 5 projects)
  → Output exactly that many in the "projects" array
  → For each: include name, tech, link (if mentioned), description, and rewritten bullets
 
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
OUTPUT: Return ONLY valid JSON starting with { and ending with }. No markdown fences. No explanation. No preamble.
 
{
  "name": "candidate full name from background",
  "currentTitle": "title that best matches the JD",
  "email": "from candidate",
  "phone": "from candidate or empty string",
  "location": "from candidate or empty string",
  "linkedin": "full URL from candidate or empty string",
  "github": "full URL from candidate or empty string",
  "portfolio": "full URL from candidate or empty string",
  "summary": "2-3 sentences. Open with candidate's strongest relevant trait. Mention ${company}. Signal cultural fit (ownership, AI-native, builder) using real facts only.",
  "experience": [
    {
      "title": "exact title from candidate",
      "company": "exact company from candidate",
      "period": "exact dates from candidate",
      "location": "location from candidate or Remote",
      "bullets": [
        "Each bullet = rewritten from candidate's real bullet. Stronger verb. 1 JD keyword. 1 culture signal if supported. SAME FACTS."
      ]
    }
  ],
  "projects": [
    {
      "name": "exact project name from candidate",
      "tech": "tech stack candidate actually listed for this project",
      "link": "URL if candidate mentioned one, else empty string",
      "description": "one-line description from candidate's actual project description",
      "bullets": [
        "Rewritten bullet from candidate's actual project bullet. Stronger verb. JD keyword if applicable."
      ]
    }
  ],
  "skills": {
    "technical": ["JD-matching skills the candidate actually has — list these FIRST, then other skills"],
    "soft": ["max 3 soft skills directly evidenced by candidate's work — e.g. Ownership-driven, Async-first communication, Intellectually honest"],
    "tools": ["actual tools candidate mentioned"]
  },
  "education": [
    {
      "degree": "from candidate",
      "school": "from candidate",
      "year": "from candidate",
      "gpa": ""
    }
  ],
  "certifications": ["only certifications or achievements candidate explicitly mentioned — empty array if none"]
  
}
  OUTPUT: Return ONLY valid JSON starting with { and ending with }. No markdown. No explanation.
  `;

  console.log("📩 FINAL PROMPT LENGTH:", finalPrompt.length, "chars");
  console.log("📩 FINAL PROMPT PREVIEW:\n", finalPrompt.slice(0, 400));

  return finalPrompt;
}

// ─── FIX 4: extractProjectsFallback — parses projects from raw candidate text
// when AI fails, so offline path doesn't silently drop projects.
function extractProjectsFallback(text) {
  const lower = text.toLowerCase();
  const idx = lower.indexOf('project');
  if (idx === -1) return [];
  const lines = text.slice(idx).split('\n').filter(l => l.trim());
  const projects = [];
  let current = null;
  for (const line of lines.slice(0, 40)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith('•') || trimmed.startsWith('-') || trimmed.startsWith('*')) {
      if (current) current.bullets.push(trimmed.replace(/^[•\-\*]\s*/, '').trim());
    } else if (trimmed.toLowerCase().startsWith('tech:') || trimmed.toLowerCase().startsWith('stack:')) {
      if (current) current.tech = trimmed.replace(/^(tech|stack):\s*/i, '').trim();
    } else if (trimmed.toLowerCase().startsWith('link:') || trimmed.toLowerCase().startsWith('github:') || trimmed.startsWith('http')) {
      if (current) current.link = trimmed.replace(/^(link|github):\s*/i, '').trim();
    } else if (trimmed.length > 3) {
      if (current) projects.push(current);
      current = { name: trimmed, tech: '', link: '', description: '', bullets: [] };
    }
  }
  if (current) projects.push(current);
  return projects.slice(0, 5);
}

// ─── OFFLINE FALLBACK ──────────────────────────────────────────────────────────
function buildOffline(candidateText, jd, company) {
  console.log("⚠️ FALLBACK TRIGGERED (buildOffline)");
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
    summary: `Experienced engineer applying to ${company}. Strong full-stack background focused on shipping production-quality software. Committed to building scalable systems with real business impact.`,
    experience: [{
      title: "Software Engineer",
      company: "Previous Role",
      period: "2022 – Present",
      location: "Remote",
      bullets: [
        "Built and shipped production web applications with React and Node.js",
        "Designed and maintained RESTful APIs serving thousands of users",
        "Improved application performance and reliability through systematic optimization"
      ]
    }],
    // FIX 4: use extractProjectsFallback instead of empty array
    projects: extractProjectsFallback(candidateText),
    skills: { technical: ["React", "JavaScript", "Node.js", "SQL"], soft: [], tools: ["Git", "Docker"] },
    education: [{ degree: "Bachelor's Degree", school: "", year: "", gpa: "" }],
    certifications: [],
  };
}

function extractJSON(raw, fallback) {
  if (!raw || typeof raw !== "string") {
    console.warn("⚠️ extractJSON received non-string:", typeof raw);
    return fallback;
  }

  console.log("🟣 extractJSON input length:", raw.length);

  const strategies = [
    // 1. Direct parse (AI returned clean JSON)
    (s) => JSON.parse(s.trim()),

    // 2. Strip markdown fences
    (s) => JSON.parse(s.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim()),

    // 3. Extract first {...} block (most reliable for LLM output)
    (s) => {
      const start = s.indexOf("{");
      const end = s.lastIndexOf("}");
      if (start === -1 || end === -1 || end <= start) throw new Error("no_braces");
      return JSON.parse(s.slice(start, end + 1));
    },

    // 4. Regex match (handles extra text before/after JSON)
    (s) => {
      const m = s.match(/\{[\s\S]*\}/);
      if (!m) throw new Error("no_match");
      return JSON.parse(m[0]);
    },

    // 5. Aggressive cleanup — remove common LLM artifacts
    (s) => {
      const cleaned = s
        .replace(/^[^{]*/s, "")           // trim everything before first {
        .replace(/[^}]*$/s, "")           // trim everything after last }
        .replace(/,\s*([}\]])/g, "$1")    // remove trailing commas
        .replace(/(['"])?([a-zA-Z_][a-zA-Z0-9_]*)(['"])?:/g, '"$2":') // unquoted keys
        .trim();
      return JSON.parse(cleaned);
    },
  ];

  for (let i = 0; i < strategies.length; i++) {
    try {
      const result = strategies[i](raw);
      if (result && typeof result === "object" && !Array.isArray(result)) {
        console.log(`✅ extractJSON succeeded with strategy ${i + 1}`);
        return result;
      }
    } catch (e) {
      console.log(`🟡 Strategy ${i + 1} failed:`, e.message);
    }
  }

  console.error("❌ All JSON parse strategies failed. Raw preview:", raw.slice(0, 300));
  return fallback;
}

// ─── SUPABASE HELPERS ──────────────────────────────────────────────────────────
async function upsertProfile(user) {
  try {
    const { data } = await supabase.from("profiles").select("id").eq("id", user.id).single();
    if (!data) {
      await supabase.from("profiles").insert({
        id: user.id,
        email: user.email,
        full_name: user.user_metadata?.full_name || "",
        avatar_url: user.user_metadata?.avatar_url || "",
        plan: "free",
        resume_count: 0,
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

async function saveResume(userId, resumeData, jobData, template, font, existingId) {
  const payload = {
    user_id: userId,
    title: `${resumeData.name || "Resume"} → ${jobData?.co || "Untitled"}`,
    company_name: jobData?.co || "",
    job_description: jobData?.jd || "",
    content: resumeData,
    template: template || "classic",
    font: font || "Lora",
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

async function deleteResume(id) {
  return supabase.from("resumes").delete().eq("id", id);
}

// ─── TEMPLATES ────────────────────────────────────────────────────────────────
const TEMPLATES = [
  // ── ORIGINAL 6 ──
  { id: "classic", n: "Classic", ac: "#7c6355", bg: "#ffffff", hBg: "#3d2b1f", hTx: "#f5f0eb" },
  { id: "warm", n: "Warm Sand", ac: "#a0845c", bg: "#faf7f2", hBg: "#5c4033", hTx: "#fdf6ed" },
  { id: "minimal", n: "Minimal", ac: "#2d2016", bg: "#ffffff", hBg: "#ffffff", hTx: "#2d2016" },
  { id: "slate", n: "Slate", ac: "#6b7280", bg: "#f9fafb", hBg: "#1f2937", hTx: "#f9fafb" },
  { id: "parchment", n: "Parchment", ac: "#8b6914", bg: "#fdf8f0", hBg: "#4a3000", hTx: "#fdf8f0" },
  { id: "modern", n: "Modern", ac: "#374151", bg: "#ffffff", hBg: "#111827", hTx: "#f9fafb" },

  // ── 3 NEW TRENDING ──
  {
    id: "nova",
    n: "Nova",          // Dark mode / tech-startup aesthetic
    ac: "#6ee7b7",      // Emerald accent on dark
    bg: "#0f172a",      // Deep navy body
    hBg: "#020617",     // Near-black header
    hTx: "#e2e8f0",     // Light slate text
    dark: true,         // Custom flag used in ResumeView
  },
  {
    id: "executive",
    n: "Executive",     // C-suite / finance / consulting serif layout
    ac: "#1e3a5f",      // Deep navy accent
    bg: "#fafafa",      // Off-white
    hBg: "#1e3a5f",     // Navy header
    hTx: "#ffffff",
  },
  {
    id: "tokyo",
    n: "Tokyo",         // Bold editorial — left color bar, oversized name
    ac: "#e11d48",      // Rose red
    bg: "#ffffff",
    hBg: "#e11d48",     // Red header bar
    hTx: "#ffffff",
  },
];

const FONTS = [
  { n: "Lora", v: "'Lora',serif" },
  { n: "Playfair", v: "'Playfair Display',serif" },
  { n: "Inter", v: "'Inter',sans-serif" },
  { n: "Crimson", v: "'Crimson Text',serif" },
];

// ─── COLOR TOKENS ─────────────────────────────────────────────────────────────
const C = {
  bg: "#faf8f5",
  surface: "#ffffff",
  surfaceAlt: "#f5f0ea",
  border: "#e8ddd4",
  borderLight: "#f0ebe4",
  text: "#2d1f14",
  textMuted: "#8a7060",
  textLight: "#b5a090",
  accent: "#7c6355",
  accentDark: "#5c4033",
  accentLight: "#a08070",
  accentBg: "#f2ece6",
  brown: "#3d2b1f",
  tan: "#c4a882",
  cream: "#fdf9f5",
  gold: "#a0845c",
};

// ─── GLOBAL STYLES ─────────────────────────────────────────────────────────────
const GS = () => (
  <style>{`
    @import url('https://fonts.googleapis.com/css2?family=Lora:ital,wght@0,400;0,500;0,600;0,700;1,400;1,500&family=Playfair+Display:ital,wght@0,400;0,600;0,700;0,800;1,400;1,600&family=Inter:wght@300;400;500;600;700&family=Crimson+Text:ital,wght@0,400;0,600;1,400;1,600&display=swap');
    *{box-sizing:border-box;margin:0;padding:0}
    html{scroll-behavior:smooth}
    body{font-family:'Inter',sans-serif;-webkit-font-smoothing:antialiased;background:${C.bg}}
    @keyframes spin{to{transform:rotate(360deg)}}
    @keyframes fadeIn{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
    @keyframes fadeInUp{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:none}}
    @keyframes slideInLeft{from{opacity:0;transform:translateX(-16px)}to{opacity:1;transform:none}}
    @keyframes float{0%,100%{transform:translateY(0)}50%{transform:translateY(-5px)}}
    @keyframes blink{0%,100%{opacity:1}50%{opacity:.3}}
    @keyframes marquee{0%{transform:translateX(0)}100%{transform:translateX(-50%)}}
    @keyframes shimmer{0%{background-position:-400px 0}100%{background-position:400px 0}}
    @keyframes scaleIn{from{opacity:0;transform:scale(.96)}to{opacity:1;transform:scale(1)}}
    .fade-in{animation:fadeIn .4s ease both}
    .fade-in-1{animation:fadeIn .5s .08s ease both}
    .fade-in-2{animation:fadeIn .5s .18s ease both}
    .fade-in-3{animation:fadeIn .5s .3s ease both}
    .fade-in-4{animation:fadeIn .5s .45s ease both}
    .scale-in{animation:scaleIn .25s ease both}
    .slide-in-left{animation:slideInLeft .3s ease both}
    .ske{background:linear-gradient(90deg,${C.borderLight} 0%,${C.border} 50%,${C.borderLight} 100%);background-size:400px 100%;animation:shimmer 1.5s infinite linear;border-radius:5px}
    
    .btn-primary{display:inline-flex;align-items:center;gap:8px;padding:11px 22px;background:${C.brown};color:#fdf9f5;border:none;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer;transition:all .18s;font-family:'Inter',sans-serif;letter-spacing:-.1px;white-space:nowrap}
    .btn-primary:hover:not(:disabled){background:${C.accentDark};transform:translateY(-1px);box-shadow:0 6px 20px rgba(61,43,31,.25)}
    .btn-primary:active:not(:disabled){transform:none}
    .btn-primary:disabled{opacity:.45;cursor:not-allowed}
    
    .btn-secondary{display:inline-flex;align-items:center;gap:8px;padding:10px 20px;background:${C.surface};color:${C.text};border:1.5px solid ${C.border};border-radius:8px;font-size:14px;font-weight:500;cursor:pointer;transition:all .18s;font-family:'Inter',sans-serif;white-space:nowrap}
    .btn-secondary:hover{background:${C.accentBg};border-color:${C.accentLight};color:${C.accentDark}}
    
    .btn-ghost{display:inline-flex;align-items:center;gap:6px;padding:9px 16px;background:none;color:${C.textMuted};border:1.5px solid ${C.border};border-radius:8px;font-size:13px;font-weight:500;cursor:pointer;transition:all .18s;font-family:'Inter',sans-serif;white-space:nowrap}
    .btn-ghost:hover{color:${C.text};background:${C.accentBg};border-color:${C.accentLight}}
    
    .btn-danger{display:inline-flex;align-items:center;gap:6px;padding:8px 14px;background:rgba(220,38,38,.06);color:#dc2626;border:1px solid rgba(220,38,38,.15);border-radius:7px;font-size:13px;font-weight:500;cursor:pointer;transition:all .18s;font-family:'Inter',sans-serif}
    .btn-danger:hover{background:rgba(220,38,38,.12);border-color:rgba(220,38,38,.3)}
    
    .input-light{width:100%;padding:11px 14px;background:${C.surface};border:1.5px solid ${C.border};border-radius:8px;color:${C.text};font-size:14px;font-family:'Inter',sans-serif;transition:all .18s;resize:vertical;outline:none;line-height:1.6}
    .input-light::placeholder{color:${C.textLight}}
    .input-light:focus{border-color:${C.accent};background:#fff;box-shadow:0 0 0 3px rgba(124,99,85,.08)}
    
    .card{background:${C.surface};border:1.5px solid ${C.border};border-radius:12px;transition:all .18s}
    .card:hover{border-color:${C.accentLight}}
    
    ::-webkit-scrollbar{width:4px;height:4px}
    ::-webkit-scrollbar-track{background:transparent}
    ::-webkit-scrollbar-thumb{background:${C.border};border-radius:2px}
    ::-webkit-scrollbar-thumb:hover{background:${C.accentLight}}
    
    @media(max-width:768px){.desktop-only{display:none!important}}
    @media print{
      body{background:white!important;margin:0!important}
      #resume-canvas{box-shadow:none!important;border:none!important;margin:0!important;border-radius:0!important}
      .no-print{display:none!important}
      @page{margin:0;size:A4}
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
    chart: "M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z",
    home: "M2.25 12l8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25",
    user: "M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z",
    edit: "M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125",
    sv: "M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0111.186 0z",
    back: "M19 12H5M12 5l-7 7 7 7",
    link: "M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244",
    mail: "M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75",
    phone: "M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 002.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 01-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 00-1.091-.852H4.5A2.25 2.25 0 002.25 4.5v2.25z",
    pin: "M15 10.5a3 3 0 11-6 0 3 3 0 016 0z M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z",
    tag: "M9.568 3H5.25A2.25 2.25 0 003 5.25v4.318c0 .597.237 1.17.659 1.591l9.581 9.581c.699.699 1.78.872 2.658.592a18.634 18.634 0 005.9-5.9c.28-.878.107-1.96-.592-2.658L9.568 3z M6 6h.008v.008H6V6z",
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

// ─── LOGO ─────────────────────────────────────────────────────────────────────
const Logo = ({ size = "md" }) => {
  const sz = size === "sm" ? { icon: 26, font: 13, iconSz: 14 } : { icon: 34, font: 15, iconSz: 16 };
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <div style={{ width: sz.icon, height: sz.icon, background: C.brown, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
        <Icon n="spark" s={sz.iconSz} c="#fdf9f5" />
      </div>
      <span style={{ fontFamily: "'Lora',serif", fontWeight: 700, fontSize: sz.font, color: C.text, letterSpacing: "-0.3px" }}>resume<span style={{ color: C.accent }}>ai</span></span>
    </div>
  );
};

// ─── LANDING PAGE ─────────────────────────────────────────────────────────────
const Landing = ({ onSignIn }) => {
  const [vis, setVis] = useState(false);
  useEffect(() => { setTimeout(() => setVis(true), 60); }, []);

  return (
    <div style={{ fontFamily: "'Inter',sans-serif", background: C.bg, color: C.text, minHeight: "100vh" }}>
      {/* NAV */}
      <header style={{ position: "fixed", top: 0, left: 0, right: 0, zIndex: 200, background: "rgba(250,248,245,.94)", backdropFilter: "blur(20px)", borderBottom: `1px solid ${C.border}` }}>
        <div style={{ maxWidth: 1100, margin: "0 auto", padding: "0 28px", height: 58, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <Logo />
          <nav style={{ display: "flex", alignItems: "center", gap: 4 }}>
            {[["How it works", "#how"], ["Pricing", "#pricing"]].map(([l, h], i) => (
              <a key={i} href={h} style={{ fontSize: 13, color: C.textMuted, textDecoration: "none", padding: "6px 14px", borderRadius: 7, fontWeight: 500, transition: "color .15s" }}
                onMouseEnter={e => e.currentTarget.style.color = C.text}
                onMouseLeave={e => e.currentTarget.style.color = C.textMuted}>{l}</a>
            ))}
            <button onClick={onSignIn} style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "9px 20px", background: C.brown, color: "#fdf9f5", border: "none", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", transition: "all .18s" }}
              onMouseEnter={e => { e.currentTarget.style.background = C.accentDark; e.currentTarget.style.transform = "translateY(-1px)"; }}
              onMouseLeave={e => { e.currentTarget.style.background = C.brown; e.currentTarget.style.transform = "none"; }}>
              <Icon n="google" s={14} /> Sign in
            </button>
          </nav>
        </div>
      </header>

      {/* HERO */}
      <section style={{ paddingTop: 120, paddingBottom: 80, maxWidth: 1100, margin: "0 auto", padding: "120px 28px 80px", textAlign: "center" }}>
        <div className={vis ? "fade-in" : ""} style={{ display: "inline-flex", alignItems: "center", gap: 7, marginBottom: 30, padding: "5px 16px 5px 8px", background: `${C.accent}12`, border: `1px solid ${C.accent}30`, borderRadius: 100 }}>
          <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#22c55e", animation: "blink 2.5s infinite" }} />
          <span style={{ fontSize: 12, color: C.accent, fontWeight: 700 }}>AI-tailored · ATS-optimized · First 2 free</span>
        </div>

        <h1 className={vis ? "fade-in-1" : ""} style={{ fontFamily: "'Playfair Display',serif", fontSize: "clamp(44px,7vw,88px)", fontWeight: 800, lineHeight: .92, letterSpacing: "-2px", marginBottom: 0, color: C.text }}>
          The resume that<br />
          <em style={{ color: C.accent, fontStyle: "italic" }}>gets you hired.</em>
        </h1>

        <p className={vis ? "fade-in-2" : ""} style={{ fontSize: 17, color: C.textMuted, lineHeight: 1.8, maxWidth: 500, margin: "26px auto 38px", fontWeight: 400 }}>
          Paste any job description. AI extracts ATS keywords, reads company culture, and writes bullets using only your real experience.
        </p>

        <div className={vis ? "fade-in-3" : ""} style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap", marginBottom: 70 }}>
          <button onClick={onSignIn} style={{ display: "inline-flex", alignItems: "center", gap: 9, padding: "14px 30px", background: C.brown, color: "#fdf9f5", border: "none", borderRadius: 10, fontSize: 15, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", transition: "all .2s", boxShadow: `0 4px 20px ${C.brown}30` }}
            onMouseEnter={e => { e.currentTarget.style.transform = "translateY(-2px)"; e.currentTarget.style.boxShadow = `0 10px 30px ${C.brown}40`; }}
            onMouseLeave={e => { e.currentTarget.style.transform = "none"; e.currentTarget.style.boxShadow = `0 4px 20px ${C.brown}30`; }}>
            <Icon n="google" s={16} /> Start free — no credit card
          </button>
          <a href="#how" style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "14px 24px", background: "none", color: C.text, border: `1.5px solid ${C.border}`, borderRadius: 10, fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", textDecoration: "none", transition: "all .2s" }}
            onMouseEnter={e => e.currentTarget.style.borderColor = C.accentLight}
            onMouseLeave={e => e.currentTarget.style.borderColor = C.border}>
            See how it works <Icon n="arr" s={14} c={C.text} />
          </a>
        </div>

        {/* Preview mockup */}
        <div className={vis ? "fade-in-4" : ""} style={{ maxWidth: 820, margin: "0 auto", background: C.surface, border: `1.5px solid ${C.border}`, borderRadius: 18, padding: "18px", boxShadow: `0 20px 60px ${C.brown}15` }}>
          <div style={{ display: "flex", gap: 6, marginBottom: 14, alignItems: "center" }}>
            {["#ef4444", "#f59e0b", "#22c55e"].map((c, i) => <div key={i} style={{ width: 9, height: 9, borderRadius: "50%", background: c }} />)}
            <div style={{ flex: 1, height: 22, background: C.accentBg, borderRadius: 5, display: "flex", alignItems: "center", paddingLeft: 10 }}>
              <span style={{ fontSize: 11, color: C.textLight }}>resumeai.app/builder</span>
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            {[
              { label: "Job Description", accent: false, bars: [85, 70, 90, 60, 80, 50, 75] },
              { label: "✓ Tailored Resume", accent: true, bars: [80, 95, 70, 88, 75, 60, 82] },
            ].map((p, i) => (
              <div key={i} style={{ background: p.accent ? `${C.accentBg}` : C.bg, border: `1px solid ${p.accent ? C.accent + "40" : C.border}`, borderRadius: 10, padding: "16px" }}>
                <div style={{ fontSize: 9, fontWeight: 800, color: p.accent ? C.accent : C.textLight, marginBottom: 10, letterSpacing: "1px", textTransform: "uppercase" }}>{p.label}</div>
                {p.bars.map((w, j) => <div key={j} style={{ height: 6, borderRadius: 3, marginBottom: 6, width: `${w}%`, background: j === 0 ? (p.accent ? C.accent + "60" : C.border) : p.accent ? C.accent + "22" : C.borderLight }} />)}
              </div>
            ))}
          </div>
          <div style={{ position: "absolute", top: "calc(50% + 10px)", left: "50%", transform: "translate(-50%,-50%)", width: 40, height: 40, background: C.brown, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: `0 4px 16px ${C.brown}40`, border: `3px solid ${C.surface}` }}>
            <Icon n="spark" s={17} c="#fdf9f5" />
          </div>
        </div>

        {/* Stats */}
        <div className={vis ? "fade-in-4" : ""} style={{ display: "flex", gap: 0, paddingTop: 48, marginTop: 40, borderTop: `1px solid ${C.border}`, flexWrap: "wrap", justifyContent: "center", maxWidth: 680, margin: "40px auto 0" }}>
          {[
            { n: "75%", d: "resumes never seen by humans" },
            { n: "6s", d: "recruiter scans your resume" },
            { n: "3×", d: "more callbacks with tailored resume" },
            { n: "Free", d: "first 2 resumes, always" },
          ].map((s, i) => (
            <div key={i} style={{ paddingRight: 28, paddingLeft: i > 0 ? 28 : 0, borderLeft: i > 0 ? `1px solid ${C.border}` : "none", textAlign: "center", marginBottom: 10 }}>
              <div style={{ fontFamily: "'Playfair Display',serif", fontSize: 24, fontWeight: 800, letterSpacing: "-1px", lineHeight: 1, marginBottom: 4, color: C.text }}>{s.n}</div>
              <div style={{ fontSize: 11, color: C.textLight, maxWidth: 100, lineHeight: 1.4 }}>{s.d}</div>
            </div>
          ))}
        </div>
      </section>

      {/* MARQUEE */}
      <div style={{ background: C.accentBg, padding: "12px 0", overflow: "hidden", borderTop: `1px solid ${C.border}`, borderBottom: `1px solid ${C.border}` }}>
        <div style={{ display: "flex", animation: "marquee 30s linear infinite", width: "max-content" }}>
          {[...Array(2)].flatMap(() => ["ATS-Optimized", "Keyword Matched", "Company Culture Aligned", "5 AI Providers", "Real Experience Only", "PDF Export", "6 Templates", "No BS Bullets"].map((item) => (
            <span key={Math.random()} style={{ padding: "0 24px", fontSize: 12, fontWeight: 600, color: C.textMuted, whiteSpace: "nowrap" }}>
              {item} <span style={{ marginLeft: 24, color: C.tan }}>◆</span>
            </span>
          )))}
        </div>
      </div>

      {/* HOW IT WORKS */}
      <section id="how" style={{ padding: "90px 28px", maxWidth: 1100, margin: "0 auto" }}>
        <div style={{ textAlign: "center", marginBottom: 56 }}>
          <p style={{ fontSize: 11, fontWeight: 700, color: C.textLight, letterSpacing: "2.5px", marginBottom: 12, textTransform: "uppercase" }}>Process</p>
          <h2 style={{ fontFamily: "'Playfair Display',serif", fontSize: "clamp(28px,4vw,48px)", fontWeight: 800, letterSpacing: "-1.5px" }}>Job post → interview.</h2>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 2, background: C.border, borderRadius: 16, overflow: "hidden" }}>
          {[
            { n: "01", t: "Paste the job", d: "Drop in the full job description and company name. More detail = better tailoring.", icon: "doc" },
            { n: "02", t: "Share your background", d: "Upload existing resume or fill guided questions about your experience.", icon: "user" },
            { n: "03", t: "AI tailors it", d: "Extracts every JD keyword, maps your skills, writes punchy ATS-optimized bullets.", icon: "spark" },
            { n: "04", t: "Download & apply", d: "Clean PDF, recruiter-friendly layout, keyword-matched to beat any ATS filter.", icon: "dl" },
          ].map((s, i) => (
            <div key={i} style={{ background: C.surface, padding: "34px 26px", transition: "background .18s" }}
              onMouseEnter={e => e.currentTarget.style.background = C.cream}
              onMouseLeave={e => e.currentTarget.style.background = C.surface}>
              <div style={{ width: 42, height: 42, background: C.accentBg, border: `1px solid ${C.border}`, borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 18 }}>
                <Icon n={s.icon} s={18} c={C.accent} />
              </div>
              <div style={{ fontSize: 10, fontWeight: 700, color: C.textLight, letterSpacing: "1.5px", marginBottom: 8 }}>{s.n}</div>
              <div style={{ fontFamily: "'Lora',serif", fontWeight: 600, fontSize: 15, marginBottom: 8, color: C.text }}>{s.t}</div>
              <div style={{ fontSize: 13, color: C.textMuted, lineHeight: 1.75 }}>{s.d}</div>
            </div>
          ))}
        </div>
      </section>

      {/* PRICING */}
      <section id="pricing" style={{ padding: "90px 28px", background: C.accentBg, borderTop: `1px solid ${C.border}` }}>
        <div style={{ maxWidth: 1100, margin: "0 auto" }}>
          <div style={{ textAlign: "center", marginBottom: 50 }}>
            <p style={{ fontSize: 11, fontWeight: 700, color: C.textLight, letterSpacing: "2.5px", marginBottom: 12, textTransform: "uppercase" }}>Pricing</p>
            <h2 style={{ fontFamily: "'Playfair Display',serif", fontSize: "clamp(28px,4vw,48px)", fontWeight: 800, letterSpacing: "-1.5px", marginBottom: 8 }}>Simple, honest.</h2>
            <p style={{ fontSize: 14, color: C.textMuted }}>First 2 resumes free · ₹30 per resume after · Or go lifetime</p>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(250px,1fr))", gap: 12, maxWidth: 880, margin: "0 auto" }}>
            {Object.entries(PLANS).map(([key, plan]) => (
              <div key={key} style={{ borderRadius: 16, padding: "30px 24px", position: "relative", border: plan.popular ? `2px solid ${C.accent}` : `1.5px solid ${C.border}`, background: plan.popular ? C.brown : C.surface, transition: "transform .18s", boxShadow: plan.popular ? `0 16px 50px ${C.brown}25` : "none" }}
                onMouseEnter={e => e.currentTarget.style.transform = "translateY(-3px)"}
                onMouseLeave={e => e.currentTarget.style.transform = "none"}>
                {plan.popular && <div style={{ position: "absolute", top: -11, left: "50%", transform: "translateX(-50%)", background: C.accent, color: "#fff", fontSize: 10, fontWeight: 800, padding: "3px 14px", borderRadius: 100, whiteSpace: "nowrap" }}>MOST POPULAR</div>}
                {plan.badge && <div style={{ position: "absolute", top: -11, left: "50%", transform: "translateX(-50%)", background: C.gold, color: "#fff", fontSize: 10, fontWeight: 800, padding: "3px 14px", borderRadius: 100, whiteSpace: "nowrap" }}>{plan.badge}</div>}
                <div style={{ fontWeight: 700, fontSize: 11, color: plan.popular ? "rgba(253,249,245,.5)" : C.textLight, marginBottom: 8, letterSpacing: ".5px", textTransform: "uppercase" }}>{plan.name}</div>
                <div style={{ fontFamily: "'Playfair Display',serif", fontSize: 40, fontWeight: 800, letterSpacing: "-1.5px", color: plan.popular ? "#fdf9f5" : C.text, marginBottom: 4 }}>
                  {plan.inr === 0 ? "Free" : `₹${plan.inr}`}
                </div>
                <div style={{ fontSize: 12, color: plan.popular ? "rgba(253,249,245,.4)" : C.textLight, marginBottom: 22 }}>{plan.inr === 0 ? "forever" : plan.inr === 30 ? "per resume" : "one-time"}</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 9, marginBottom: 26 }}>
                  {plan.features.map((f, i) => (
                    <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
                      <Icon n="chk" s={11} c={plan.popular ? "rgba(253,249,245,.6)" : C.accent} />
                      <span style={{ fontSize: 13, color: plan.popular ? "rgba(253,249,245,.8)" : C.textMuted, lineHeight: 1.4 }}>{f}</span>
                    </div>
                  ))}
                </div>
                <button onClick={onSignIn} style={{ width: "100%", padding: "12px 0", borderRadius: 8, border: plan.popular ? `1.5px solid rgba(253,249,245,.2)` : `1.5px solid ${C.border}`, background: plan.popular ? "rgba(253,249,245,.12)" : C.brown, color: plan.popular ? "#fdf9f5" : "#fdf9f5", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", transition: "all .18s" }}
                  onMouseEnter={e => e.currentTarget.style.background = plan.popular ? "rgba(253,249,245,.22)" : C.accentDark}
                  onMouseLeave={e => e.currentTarget.style.background = plan.popular ? "rgba(253,249,245,.12)" : C.brown}>
                  {plan.cta}
                </button>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FINAL CTA */}
      <section style={{ padding: "100px 28px", textAlign: "center", background: C.surface, borderTop: `1px solid ${C.border}` }}>
        <div style={{ maxWidth: 520, margin: "0 auto" }}>
          <h2 style={{ fontFamily: "'Playfair Display',serif", fontSize: "clamp(30px,5vw,60px)", fontWeight: 900, letterSpacing: "-2px", lineHeight: .9, marginBottom: 18, color: C.text }}>
            Stop losing<br /><em style={{ color: C.accent }}>to the algorithm.</em>
          </h2>
          <p style={{ fontSize: 15, color: C.textMuted, lineHeight: 1.75, marginBottom: 32 }}>Build a resume that passes every ATS filter and speaks the company's exact language.</p>
          <button onClick={onSignIn} style={{ display: "inline-flex", alignItems: "center", gap: 9, padding: "14px 32px", background: C.brown, color: "#fdf9f5", border: "none", borderRadius: 10, fontSize: 15, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", transition: "all .2s" }}
            onMouseEnter={e => e.currentTarget.style.background = C.accentDark}
            onMouseLeave={e => e.currentTarget.style.background = C.brown}>
            <Icon n="google" s={16} /> Start free with Google
          </button>
          <div style={{ marginTop: 12, fontSize: 12, color: C.textLight }}>No credit card · No subscription · Instant PDF</div>
        </div>
      </section>

      <footer style={{ borderTop: `1px solid ${C.border}`, padding: "22px 28px", display: "flex", alignItems: "center", justifyContent: "space-between", maxWidth: 1100, margin: "0 auto", flexWrap: "wrap", gap: 10 }}>
        <Logo size="sm" />
        <span style={{ fontSize: 12, color: C.textLight }}>Build smarter. Get hired faster.</span>
      </footer>
    </div>
  );
};

// ─── AUTH MODAL ────────────────────────────────────────────────────────────────
const AuthModal = ({ onClose }) => {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const signIn = async () => {
    setBusy(true); setErr(null);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin }
    });
    if (error) { setErr(error.message); setBusy(false); }
  };

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }} onClick={onClose}>
      <div style={{ position: "absolute", inset: 0, background: "rgba(61,43,31,.5)", backdropFilter: "blur(12px)" }} />
      <div className="scale-in" style={{ position: "relative", background: C.surface, borderRadius: 20, padding: 40, maxWidth: 360, width: "100%", textAlign: "center", boxShadow: `0 30px 80px ${C.brown}25`, border: `1.5px solid ${C.border}` }} onClick={e => e.stopPropagation()}>
        <button onClick={onClose} style={{ position: "absolute", top: 14, right: 14, background: C.accentBg, border: "none", cursor: "pointer", borderRadius: 7, padding: 7, transition: "background .15s" }}>
          <Icon n="x" s={14} c={C.textMuted} />
        </button>
        <div style={{ width: 50, height: 50, background: C.brown, borderRadius: 13, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 20px" }}>
          <Icon n="spark" s={22} c="#fdf9f5" />
        </div>
        <h2 style={{ fontFamily: "'Playfair Display',serif", fontSize: 22, fontWeight: 700, color: C.text, marginBottom: 8 }}>Welcome to ResumeAI</h2>
        <p style={{ fontSize: 14, color: C.textMuted, lineHeight: 1.6, marginBottom: 26 }}>Sign in to build AI-tailored resumes, save your work, and download polished PDFs.</p>
        {err && <div style={{ background: "rgba(220,38,38,.06)", border: "1px solid rgba(220,38,38,.15)", borderRadius: 7, padding: "10px 14px", fontSize: 13, color: "#dc2626", marginBottom: 14 }}>{err}</div>}
        <button onClick={signIn} disabled={busy} style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 10, padding: "12px 20px", background: C.surface, border: `1.5px solid ${C.border}`, borderRadius: 9, cursor: busy ? "wait" : "pointer", fontSize: 14, fontWeight: 600, color: C.text, transition: "all .18s", boxShadow: `0 1px 4px ${C.brown}08`, fontFamily: "'Inter',sans-serif" }}
          onMouseEnter={e => { if (!busy) e.currentTarget.style.background = C.cream; }}
          onMouseLeave={e => e.currentTarget.style.background = C.surface}>
          {busy ? <Spinner s={16} c={C.text} /> : <Icon n="google" s={17} />}
          {busy ? "Connecting..." : "Continue with Google"}
        </button>
        <p style={{ fontSize: 11, color: C.textLight, marginTop: 16 }}>First 2 resumes are completely free</p>
      </div>
    </div>
  );
};

// ─── SIDEBAR ──────────────────────────────────────────────────────────────────
const Sidebar = ({ page, onNav, user, profile, onSignOut, collapsed, onToggle }) => {
  const planKey = profile?.plan || "free";
  const name = user?.user_metadata?.full_name || user?.email?.split("@")[0] || "You";
  const avatar = user?.user_metadata?.avatar_url;
  const resumeCount = profile?.resume_count || 0;

  const navItems = [
    { id: "overview", label: "Dashboard", icon: "home" },
    { id: "resumes", label: "My Resumes", icon: "doc" },
    { id: "build", label: "Build Resume", icon: "spark", accent: true },
    { id: "plan", label: "Upgrade Plan", icon: "crown" },
  ];

  return (
    <div style={{ width: collapsed ? 60 : 236, background: C.surface, height: "100vh", position: "fixed", left: 0, top: 0, zIndex: 100, display: "flex", flexDirection: "column", transition: "width .22s cubic-bezier(.4,0,.2,1)", borderRight: `1.5px solid ${C.border}`, overflow: "hidden" }}>
      {/* Logo */}
      <div style={{ padding: "0 14px", display: "flex", alignItems: "center", justifyContent: "space-between", height: 58, borderBottom: `1.5px solid ${C.border}`, flexShrink: 0 }}>
        {collapsed ? (
          <div style={{ width: 32, height: 32, background: C.brown, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto", cursor: "pointer" }} onClick={onToggle}>
            <Icon n="spark" s={15} c="#fdf9f5" />
          </div>
        ) : (
          <>
            <Logo size="sm" />
            <button onClick={onToggle} style={{ background: "none", border: "none", cursor: "pointer", color: C.textLight, padding: 4 }}>
              <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 6l-6 6 6 6" /></svg>
            </button>
          </>
        )}
      </div>

      {/* Nav */}
      <nav style={{ padding: "10px 8px", flex: 1, overflowY: "auto" }}>
        {navItems.map(item => {
          const active = page === item.id;
          return (
            <button key={item.id} onClick={() => onNav(item.id)} style={{ width: "100%", display: "flex", alignItems: "center", gap: 9, padding: collapsed ? "10px 0" : "10px 11px", background: item.accent && !active ? `${C.accent}10` : active ? `${C.accent}15` : "none", border: active ? `1px solid ${C.accent}35` : item.accent && !active ? `1px solid ${C.accent}18` : "1px solid transparent", borderRadius: 8, color: active ? C.accentDark : item.accent ? C.accent : C.textMuted, cursor: "pointer", fontSize: 13, fontWeight: active ? 600 : 500, fontFamily: "'Inter',sans-serif", transition: "all .15s", marginBottom: 3, justifyContent: collapsed ? "center" : "flex-start", position: "relative" }}
              onMouseEnter={e => { if (!active) { e.currentTarget.style.background = item.accent ? `${C.accent}14` : C.accentBg; e.currentTarget.style.color = C.text; } }}
              onMouseLeave={e => { if (!active) { e.currentTarget.style.background = item.accent ? `${C.accent}10` : "none"; e.currentTarget.style.color = active ? C.accentDark : item.accent ? C.accent : C.textMuted; } }}>
              {active && <div style={{ position: "absolute", left: 0, top: "50%", transform: "translateY(-50%)", width: 3, height: 16, background: C.accent, borderRadius: "0 2px 2px 0" }} />}
              <Icon n={item.icon} s={15} c={active ? C.accent : item.accent ? C.accent : "currentColor"} />
              {!collapsed && <span>{item.label}</span>}
            </button>
          );
        })}
      </nav>

      {/* Plan info */}
      {!collapsed && planKey === "free" && (
        <div style={{ margin: "0 8px 8px", padding: "11px 12px", background: `${C.accent}08`, border: `1px solid ${C.accent}20`, borderRadius: 9 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: C.accent, marginBottom: 6 }}>Free · {Math.min(resumeCount, 2)}/2 resumes</div>
          <div style={{ height: 3, background: C.border, borderRadius: 2, marginBottom: 7 }}>
            <div style={{ height: "100%", background: C.accent, borderRadius: 2, width: `${Math.min(100, (Math.min(resumeCount, 2) / 2) * 100)}%`, transition: "width .5s" }} />
          </div>
          <button onClick={() => onNav("plan")} style={{ fontSize: 11, color: C.accent, background: "none", border: "none", cursor: "pointer", fontWeight: 700, padding: 0, fontFamily: "'Inter',sans-serif" }}>Upgrade for ₹30/resume →</button>
        </div>
      )}

      {/* Account */}
      <div style={{ padding: "8px", borderTop: `1.5px solid ${C.border}`, flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9, padding: collapsed ? "10px 0" : "10px", borderRadius: 8, justifyContent: collapsed ? "center" : "flex-start" }}>
          {avatar ? (
            <img src={avatar} style={{ width: 30, height: 30, borderRadius: "50%", flexShrink: 0, border: `2px solid ${C.border}` }} alt="" />
          ) : (
            <div style={{ width: 30, height: 30, background: C.brown, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, fontSize: 12, fontWeight: 700, color: "#fdf9f5" }}>
              {name[0]?.toUpperCase()}
            </div>
          )}
          {!collapsed && (
            <>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</div>
                <div style={{ fontSize: 10, color: C.textLight, textTransform: "capitalize" }}>{planKey} plan</div>
              </div>
              <button onClick={onSignOut} style={{ background: "none", border: "none", cursor: "pointer", color: C.textLight, padding: 4, borderRadius: 5, transition: "color .15s", flexShrink: 0 }} title="Sign out"
                onMouseEnter={e => e.currentTarget.style.color = "#dc2626"}
                onMouseLeave={e => e.currentTarget.style.color = C.textLight}>
                <Icon n="out" s={13} c="currentColor" />
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

// ─── DASHBOARD LAYOUT ──────────────────────────────────────────────────────────
const DashboardLayout = ({ user, profile, onSignOut, children, page, onNav }) => {
  const [collapsed, setCollapsed] = useState(window.innerWidth < 900);
  return (
    <div style={{ display: "flex", minHeight: "100vh", background: C.bg, fontFamily: "'Inter',sans-serif" }}>
      <Sidebar page={page} onNav={onNav} user={user} profile={profile} onSignOut={onSignOut} collapsed={collapsed} onToggle={() => setCollapsed(c => !c)} />
      <div style={{ flex: 1, marginLeft: collapsed ? 60 : 236, transition: "margin-left .22s cubic-bezier(.4,0,.2,1)", minWidth: 0, overflowX: "hidden" }}>
        {children}
      </div>
    </div>
  );
};

// ─── OVERVIEW PAGE ─────────────────────────────────────────────────────────────
const OverviewPage = ({ user, profile, resumes, onBuild, onOpenResume }) => {
  const name = user?.user_metadata?.full_name?.split(" ")[0] || "there";
  const planKey = profile?.plan || "free";
  const recent = resumes.slice(0, 4);
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  return (
    <div style={{ padding: "36px 36px 60px", maxWidth: 940, color: C.text }} className="fade-in">
      <div style={{ marginBottom: 32 }}>
        <h1 style={{ fontFamily: "'Playfair Display',serif", fontSize: 28, fontWeight: 800, letterSpacing: "-0.5px", color: C.text, marginBottom: 4 }}>{greeting}, {name} 👋</h1>
        <p style={{ fontSize: 14, color: C.textMuted }}>Your resume dashboard</p>
      </div>

      {/* Hero action */}
      <div style={{ background: C.accentBg, border: `1.5px solid ${C.accent}25`, borderRadius: 16, padding: "28px 32px", marginBottom: 26, display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 18 }}>
        <div>
          <h2 style={{ fontFamily: "'Lora',serif", fontSize: 18, fontWeight: 700, color: C.text, marginBottom: 6 }}>Build a tailored resume</h2>
          <p style={{ fontSize: 13, color: C.textMuted, maxWidth: 440, lineHeight: 1.65 }}>Paste a job description — AI extracts ATS keywords, reads culture signals, and writes targeted bullets using only your real experience.</p>
        </div>
        <button className="btn-primary" onClick={onBuild} style={{ padding: "12px 24px", fontSize: 14, flexShrink: 0 }}>
          <Icon n="spark" s={14} c="#fdf9f5" /> New Resume <Icon n="arr" s={13} c="#fdf9f5" />
        </button>
      </div>

      {/* Stats */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(145px,1fr))", gap: 10, marginBottom: 32 }}>
        {[
          { label: "Resumes Built", value: resumes.length, icon: "doc", color: C.accent },
          { label: "Companies Targeted", value: [...new Set(resumes.map(r => r.company_name).filter(Boolean))].length, icon: "bolt", color: C.gold },
          { label: "Current Plan", value: planKey.charAt(0).toUpperCase() + planKey.slice(1), icon: "crown", color: "#92857a" },
          { label: "AI Generated", value: resumes.length, icon: "spark", color: "#10b981" },
        ].map((s, i) => (
          <div key={i} className="card" style={{ padding: "18px 16px" }}>
            <div style={{ width: 34, height: 34, background: s.color + "15", borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 12 }}>
              <Icon n={s.icon} s={15} c={s.color} />
            </div>
            <div style={{ fontFamily: "'Playfair Display',serif", fontSize: 26, fontWeight: 800, letterSpacing: "-1px", color: C.text, marginBottom: 2 }}>{s.value}</div>
            <div style={{ fontSize: 12, color: C.textMuted }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Recent */}
      <div>
        <h2 style={{ fontFamily: "'Lora',serif", fontSize: 15, fontWeight: 700, color: C.text, marginBottom: 14 }}>Recent Resumes</h2>
        {recent.length === 0 ? (
          <div style={{ textAlign: "center", padding: "56px 24px", border: `1.5px dashed ${C.border}`, borderRadius: 14, background: C.surface }}>
            <div style={{ width: 52, height: 52, background: C.accentBg, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px" }}>
              <Icon n="doc" s={22} c={C.accent} />
            </div>
            <p style={{ fontSize: 15, color: C.textMuted, marginBottom: 4, fontWeight: 600 }}>No resumes yet</p>
            <p style={{ fontSize: 13, color: C.textLight, marginBottom: 20 }}>Build your first AI-tailored resume in minutes</p>
            <button className="btn-primary" onClick={onBuild}>Build your first resume</button>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
            {recent.map(r => {
              const tpl = TEMPLATES.find(t => t.id === r.template) || TEMPLATES[0];
              const date = new Date(r.updated_at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
              return (
                <div key={r.id} onClick={() => onOpenResume(r)} className="card" style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 18px", cursor: "pointer" }}
                  onMouseEnter={e => { e.currentTarget.style.background = C.accentBg; e.currentTarget.style.borderColor = C.accentLight; }}
                  onMouseLeave={e => { e.currentTarget.style.background = C.surface; e.currentTarget.style.borderColor = C.border; }}>
                  <div style={{ width: 38, height: 38, background: tpl.ac + "18", borderRadius: 9, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    <Icon n="doc" s={16} c={tpl.ac} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 13, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginBottom: 2 }}>{r.title}</div>
                    <div style={{ fontSize: 11, color: C.textLight }}>{r.company_name || "—"} · {date}</div>
                  </div>
                  <span style={{ fontSize: 10, fontWeight: 700, color: tpl.ac, background: tpl.ac + "15", padding: "3px 10px", borderRadius: 100, border: `1px solid ${tpl.ac}25`, flexShrink: 0 }}>{tpl.n}</span>
                  <Icon n="arr" s={13} c={C.textLight} />
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

// ─── MY RESUMES PAGE ──────────────────────────────────────────────────────────
const ResumesPage = ({ profile, resumes, setResumes, onBuild, onOpen }) => {
  const [search, setSearch] = useState("");
  const planKey = profile?.plan || "free";
  const limit = PLANS[planKey]?.resumeLimit || 2;
  const canCreate = resumes.length < limit || planKey !== "free";
  const filtered = resumes.filter(r => !search || r.title?.toLowerCase().includes(search.toLowerCase()) || r.company_name?.toLowerCase().includes(search.toLowerCase()));

  const del = async (id, e) => {
    e.stopPropagation();
    if (!confirm("Delete this resume?")) return;
    await deleteResume(id);
    setResumes(r => r.filter(x => x.id !== id));
  };

  return (
    <div style={{ padding: "36px 36px 60px", color: C.text }} className="fade-in">
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 28, flexWrap: "wrap", gap: 14 }}>
        <div>
          <h1 style={{ fontFamily: "'Playfair Display',serif", fontSize: 26, fontWeight: 800, letterSpacing: "-0.5px", color: C.text, marginBottom: 4 }}>My Resumes</h1>
          <p style={{ fontSize: 13, color: C.textMuted }}>{resumes.length} resume{resumes.length !== 1 ? "s" : ""} created</p>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          {resumes.length > 2 && <input className="input-light" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search..." style={{ width: 190, padding: "9px 13px", fontSize: 13 }} />}
          <button onClick={onBuild} className="btn-primary"><Icon n="pls" s={13} c="#fdf9f5" /> New Resume</button>
        </div>
      </div>

      {!canCreate && planKey === "free" && (
        <div style={{ background: "rgba(160,132,92,.08)", border: "1px solid rgba(160,132,92,.25)", borderRadius: 10, padding: "12px 18px", fontSize: 13, color: C.gold, marginBottom: 20, display: "flex", alignItems: "center", gap: 10 }}>
          <Icon n="crown" s={15} c={C.gold} />
          You've used all 2 free resumes. Pay ₹30 per resume or go Lifetime for unlimited.
          <button onClick={onBuild} style={{ marginLeft: "auto", fontSize: 12, color: C.gold, background: "none", border: `1px solid ${C.gold}40`, borderRadius: 6, padding: "4px 11px", cursor: "pointer", fontWeight: 700, fontFamily: "'Inter',sans-serif" }}>Upgrade →</button>
        </div>
      )}

      {filtered.length === 0 ? (
        <div style={{ textAlign: "center", padding: "76px 24px", border: `1.5px dashed ${C.border}`, borderRadius: 14, background: C.surface }}>
          <Icon n="doc" s={30} c={C.border} />
          <p style={{ fontSize: 15, color: C.textMuted, marginTop: 14, marginBottom: 4, fontWeight: 600 }}>{resumes.length === 0 ? "No resumes yet" : "Nothing matches"}</p>
          {resumes.length === 0 && <button className="btn-primary" onClick={onBuild} style={{ marginTop: 16 }}>Build your first resume</button>}
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(280px,1fr))", gap: 10 }}>
          {filtered.map(r => {
            const tpl = TEMPLATES.find(t => t.id === r.template) || TEMPLATES[0];
            const date = new Date(r.updated_at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
            return (
              <div key={r.id} onClick={() => onOpen(r)} className="card" style={{ padding: "20px", cursor: "pointer", position: "relative" }}
                onMouseEnter={e => { e.currentTarget.style.background = C.accentBg; e.currentTarget.style.borderColor = C.accentLight; }}
                onMouseLeave={e => { e.currentTarget.style.background = C.surface; e.currentTarget.style.borderColor = C.border; }}>
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 14 }}>
                  <div style={{ width: 42, height: 42, background: tpl.ac + "18", borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <Icon n="doc" s={18} c={tpl.ac} />
                  </div>
                  <button onClick={e => del(r.id, e)} style={{ background: "none", border: "none", cursor: "pointer", padding: 5, borderRadius: 6, transition: "all .15s", color: C.textLight }}
                    onMouseEnter={e => { e.currentTarget.style.background = "rgba(220,38,38,.08)"; e.currentTarget.style.color = "#dc2626"; }}
                    onMouseLeave={e => { e.currentTarget.style.background = "none"; e.currentTarget.style.color = C.textLight; }}>
                    <Icon n="tr" s={13} c="currentColor" />
                  </button>
                </div>
                <div style={{ fontFamily: "'Lora',serif", fontWeight: 700, fontSize: 14, color: C.text, marginBottom: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.title}</div>
                <div style={{ fontSize: 12, color: C.textMuted, marginBottom: 14 }}>{r.company_name || "No company"} · {date}</div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <span style={{ fontSize: 10, fontWeight: 700, color: tpl.ac, background: tpl.ac + "15", padding: "3px 10px", borderRadius: 100, border: `1px solid ${tpl.ac}25` }}>{tpl.n}</span>
                  <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: C.textMuted }}><Icon n="edit" s={10} c={C.textMuted} />Edit</div>
                </div>
              </div>
            );
          })}
        </div>
      )}
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
      amount,
      label: `ResumeAI ${PLANS[key].name}`,
      user,
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
      <h1 style={{ fontFamily: "'Playfair Display',serif", fontSize: 26, fontWeight: 800, letterSpacing: "-0.5px", color: C.text, marginBottom: 4 }}>Plans & Pricing</h1>
      <p style={{ fontSize: 13, color: C.textMuted, marginBottom: 30 }}>One-time payments · No subscription · Secure via Razorpay</p>

      {msg && (
        <div style={{ background: msg.t === "ok" ? "rgba(16,185,129,.06)" : "rgba(220,38,38,.06)", border: `1px solid ${msg.t === "ok" ? "rgba(16,185,129,.2)" : "rgba(220,38,38,.2)"}`, borderRadius: 9, padding: "11px 16px", fontSize: 13, color: msg.t === "ok" ? "#10b981" : "#dc2626", marginBottom: 22, display: "flex", alignItems: "center", gap: 8 }}>
          <Icon n={msg.t === "ok" ? "chkCircle" : "x"} s={15} c={msg.t === "ok" ? "#10b981" : "#dc2626"} />
          {msg.m}
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(235px,1fr))", gap: 12, maxWidth: 860 }}>
        {Object.entries(PLANS).map(([key, plan]) => {
          const isCurrent = planKey === key;
          return (
            <div key={key} className="card" style={{ padding: "26px 22px", position: "relative", border: isCurrent ? `1.5px solid ${C.accent}50` : plan.popular ? `1.5px solid ${C.accent}30` : `1.5px solid ${C.border}`, background: plan.popular ? C.accentBg : C.surface }}>
              {plan.badge && !isCurrent && <div style={{ position: "absolute", top: -10, left: "50%", transform: "translateX(-50%)", background: C.gold, color: "#fff", fontSize: 9, fontWeight: 800, padding: "3px 12px", borderRadius: 100, whiteSpace: "nowrap" }}>{plan.badge}</div>}
              {isCurrent && <div style={{ position: "absolute", top: -10, right: 12, background: "#10b981", color: "#fff", fontSize: 9, fontWeight: 800, padding: "3px 10px", borderRadius: 100 }}>✓ Current</div>}
              <div style={{ fontWeight: 700, fontSize: 11, color: plan.color, marginBottom: 7, letterSpacing: ".5px", textTransform: "uppercase" }}>{plan.name}</div>
              <div style={{ fontFamily: "'Playfair Display',serif", fontSize: 38, fontWeight: 800, letterSpacing: "-1.5px", color: C.text, marginBottom: 3 }}>
                {plan.inr === 0 ? "Free" : `₹${plan.inr}`}
              </div>
              <div style={{ fontSize: 11, color: C.textLight, marginBottom: 20 }}>{plan.inr === 0 ? "forever" : plan.inr === 30 ? "per resume" : "one-time"}</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 24 }}>
                {plan.features.map((f, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 7 }}>
                    <Icon n="chk" s={11} c={C.accent} />
                    <span style={{ fontSize: 12, color: C.textMuted, lineHeight: 1.4 }}>{f}</span>
                  </div>
                ))}
              </div>
              <button onClick={() => !isCurrent && handlePay(key, plan.inr)} disabled={isCurrent || paying === key}
                className={isCurrent ? "btn-ghost" : "btn-primary"}
                style={{ width: "100%", justifyContent: "center", opacity: isCurrent ? 0.5 : 1, cursor: isCurrent ? "default" : "pointer" }}>
                {paying === key ? <><Spinner s={12} c="#fdf9f5" /> Processing...</> : isCurrent ? "Current plan" : plan.cta}
              </button>
            </div>
          );
        })}
      </div>
      <div style={{ marginTop: 20, padding: "12px 16px", background: C.surface, borderRadius: 9, border: `1.5px solid ${C.border}`, fontSize: 12, color: C.textMuted, maxWidth: 860 }}>
        🔒 Secure payments via Razorpay · UPI, cards, net banking · No auto-renewal ever
      </div>
    </div>
  );
};

// ─── JOB INPUT PAGE ────────────────────────────────────────────────────────────
const JobInputPage = ({ onNext, onBack }) => {
  const [co, setCo] = useState("");
  const [jd, setJd] = useState("");
  const [mode, setMode] = useState(null);
  const [file, setFile] = useState(null);
  const [fileText, setFileText] = useState("");
  const [drag, setDrag] = useState(false);
  const [step, setStep] = useState(1);

  const onFile = async (f) => {
    if (!f) return;
    setFile(f);

    const isPDF = f.type === "application/pdf" || f.name.endsWith(".pdf");

    if (!isPDF) {
      // For .txt / .doc files, readAsText works fine
      const reader = new FileReader();
      reader.onload = e => setFileText(e.target.result);
      reader.readAsText(f);
      return;
    }

    // ✅ PDF: use pdf.js to extract real text
    try {
      // Load pdf.js from CDN if not already loaded
      if (!window.pdfjsLib) {
        await new Promise((resolve, reject) => {
          const script = document.createElement("script");
          script.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
          script.onload = resolve;
          script.onerror = reject;
          document.head.appendChild(script);
        });
        window.pdfjsLib.GlobalWorkerOptions.workerSrc =
          "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
      }

      const arrayBuffer = await f.arrayBuffer();
      const pdf = await window.pdfjsLib.getDocument({ data: arrayBuffer }).promise;

      let fullText = "";
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        const pageText = content.items.map(item => item.str).join(" ");
        fullText += pageText + "\n";
      }

      if (fullText.trim().length < 50) {
        // PDF had no extractable text (scanned image PDF)
        alert("This PDF appears to be a scanned image. Please upload a text-based PDF or use the 'Fill in details' option instead.");
        setFile(null);
        setFileText("");
        return;
      }

      console.log("✅ PDF extracted:", fullText.length, "chars");
      console.log("📄 Preview:", fullText.slice(0, 300));
      setFileText(fullText);

    } catch (err) {
      console.error("PDF extraction failed:", err);
      alert("Could not read this PDF. Try uploading as .txt or use 'Fill in details' instead.");
      setFile(null);
      setFileText("");
    }
  };

  const proceed = () => {
    if (mode === "upload") onNext({ co, jd, mode, fileText });
    else if (mode === "questionnaire") onNext({ co, jd, mode });
  };

  const hdr = { background: C.surface, borderBottom: `1.5px solid ${C.border}`, padding: "0 28px", height: 56, display: "flex", alignItems: "center", justifyContent: "space-between" };

  return (
    <div style={{ minHeight: "100vh", background: C.bg, fontFamily: "'Inter',sans-serif", display: "flex", flexDirection: "column" }}>
      <header style={hdr}>
        <button onClick={onBack} style={{ background: "none", border: "none", cursor: "pointer", display: "flex", alignItems: "center", gap: 6, color: C.textMuted, fontSize: 13, fontFamily: "'Inter',sans-serif" }}>
          <Icon n="back" s={14} c={C.textMuted} /> Back
        </button>
        <Logo size="sm" />
        <div style={{ width: 60 }} />
      </header>

      <div style={{ flex: 1, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "48px 24px" }}>
        <div style={{ width: "100%", maxWidth: 620 }} className="fade-in">
          {/* Progress */}
          <div style={{ display: "flex", gap: 6, marginBottom: 38 }}>
            {[1, 2].map(i => (
              <div key={i} style={{ flex: 1, height: 3, borderRadius: 2, background: i <= step ? C.accent : C.border, transition: "background .3s" }} />
            ))}
          </div>

          {step === 1 && (
            <div>
              <h1 style={{ fontFamily: "'Playfair Display',serif", fontSize: 26, fontWeight: 800, letterSpacing: "-0.5px", color: C.text, marginBottom: 6 }}>Target role</h1>
              <p style={{ fontSize: 14, color: C.textMuted, marginBottom: 30, lineHeight: 1.6 }}>The more detail you give, the better the AI tailoring</p>

              <div style={{ marginBottom: 18 }}>
                <label style={{ fontSize: 11, fontWeight: 700, color: C.textMuted, letterSpacing: ".5px", textTransform: "uppercase", display: "block", marginBottom: 7 }}>Company Name *</label>
                <input className="input-light" value={co} onChange={e => setCo(e.target.value)} placeholder="e.g. Google, Stripe, Infosys..." autoFocus />
              </div>

              <div style={{ marginBottom: 30 }}>
                <label style={{ fontSize: 11, fontWeight: 700, color: C.textMuted, letterSpacing: ".5px", textTransform: "uppercase", display: "block", marginBottom: 7 }}>
                  Job Description * <span style={{ fontSize: 10, color: C.textLight, fontWeight: 400, letterSpacing: 0, textTransform: "none" }}>— paste the full JD for best results</span>
                </label>
                <textarea className="input-light" value={jd} onChange={e => setJd(e.target.value)} placeholder="Paste the full job description here — requirements, responsibilities, company culture, must-haves, everything." rows={11} style={{ minHeight: 250 }} />
                {jd.length > 0 && <div style={{ fontSize: 11, color: C.textLight, marginTop: 5 }}>{jd.split(/\s+/).filter(Boolean).length} words</div>}
              </div>

              <button className="btn-primary" onClick={() => { if (co.trim() && jd.trim()) setStep(2); }} disabled={!co.trim() || !jd.trim()} style={{ padding: "12px 28px", fontSize: 14 }}>
                Continue <Icon n="arr" s={14} c="#fdf9f5" />
              </button>
            </div>
          )}

          {step === 2 && (
            <div>
              <h1 style={{ fontFamily: "'Playfair Display',serif", fontSize: 26, fontWeight: 800, letterSpacing: "-0.5px", color: C.text, marginBottom: 6 }}>Your background</h1>
              <p style={{ fontSize: 14, color: C.textMuted, marginBottom: 28 }}>How do you want to share your experience?</p>

              <div style={{ display: "grid", gap: 10, marginBottom: 26 }}>
                {[
                  { id: "upload", icon: "up", title: "Upload existing resume", desc: "Upload PDF or text — AI extracts your background and rewrites it for this role" },
                  { id: "questionnaire", icon: "user", title: "Fill in details", desc: "Answer guided questions and AI builds a tailored resume from scratch" },
                ].map(opt => (
                  <div key={opt.id} onClick={() => setMode(opt.id)} style={{ padding: "20px 22px", borderRadius: 12, border: mode === opt.id ? `2px solid ${C.accent}` : `1.5px solid ${C.border}`, background: mode === opt.id ? C.accentBg : C.surface, cursor: "pointer", transition: "all .18s", display: "flex", alignItems: "flex-start", gap: 14 }}>
                    <div style={{ width: 44, height: 44, background: mode === opt.id ? C.accent + "20" : C.accentBg, borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
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
                  style={{ border: `2px dashed ${drag ? C.accent : file ? "#10b981" : C.border}`, borderRadius: 10, padding: "28px", textAlign: "center", cursor: "pointer", background: drag ? C.accentBg : file ? "rgba(16,185,129,.04)" : C.surface, transition: "all .18s", marginBottom: 20 }}>
                  <input id="rf-input" type="file" accept=".txt,.pdf,.doc,.docx" style={{ display: "none" }} onChange={e => onFile(e.target.files?.[0])} />
                  <div style={{ marginBottom: 8 }}>
                    {file ? <Icon n="chkCircle" s={28} c="#10b981" /> : <Icon n="up" s={28} c={C.textLight} />}
                  </div>
                  {file ? (
                    <div>
                      <div style={{ fontSize: 14, color: "#10b981", fontWeight: 600 }}>✓ {file.name}</div>
                      {fileText ? (
                        <div style={{ fontSize: 11, color: C.textMuted, marginTop: 4 }}>
                          {fileText.length} characters extracted ✓
                        </div>
                      ) : (
                        <div style={{ fontSize: 11, color: C.gold, marginTop: 4 }}>
                          Extracting text...
                        </div>
                      )}
                    </div>
                  ) : (
                    <>
                      <div style={{ fontSize: 14, color: C.textMuted, fontWeight: 500, marginBottom: 4 }}>
                        Drop resume here or click to browse
                      </div>
                      <div style={{ fontSize: 12, color: C.textLight }}>
                        PDF, TXT — must be a text-based PDF (not scanned)
                      </div>
                    </>
                  )}
                </div>
              )}

              <div style={{ display: "flex", gap: 10 }}>
                <button className="btn-ghost" onClick={() => setStep(1)}>← Back</button>
                <button className="btn-primary" onClick={proceed} disabled={!mode || (mode === "upload" && !fileText)}>
                  {mode === "questionnaire" ? <>Fill in details <Icon n="arr" s={14} c="#fdf9f5" /></> : <><Icon n="spark" s={14} c="#fdf9f5" /> Generate Resume</>}
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
    { key: "yearsExp", label: "Years of Professional Experience", placeholder: "e.g. 3+ years", type: "input", required: true },
    { key: "expText", label: "Work Experience", placeholder: `Job Title at Company (Start – End)\n• What you built with what tech\n• Metrics: users, %, time saved\n• Key achievements\n\nInclude ALL work experience.`, type: "textarea", rows: 13, required: true },
    { key: "projectsText", label: "Projects (your actual projects)", placeholder: `Project Name - What it does\nTech: React, Node.js, etc\nLink: github.com/...\n• Key feature\n• Another feature\n\nOnly real projects you built.`, type: "textarea", rows: 9 },
    { key: "skillsText", label: "Technical Skills & Tools", placeholder: "e.g. React, TypeScript, Node.js, Python, PostgreSQL, Docker, AWS...", type: "textarea", rows: 3, required: true },
    { key: "educationText", label: "Education", placeholder: "BSc Computer Science\nMVM College\n2021 – 2024 | Mumbai", type: "textarea", rows: 4, required: true },
    { key: "achievementsText", label: "Certifications / Achievements", placeholder: "e.g. AWS Certified Developer, Hackathon winner...\nLeave blank if none.", type: "textarea", rows: 3 },
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
    <div style={{ minHeight: "100vh", background: C.bg, fontFamily: "'Inter',sans-serif", display: "flex", flexDirection: "column" }}>
      <header style={{ background: C.surface, borderBottom: `1.5px solid ${C.border}`, padding: "0 28px", height: 56, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <button onClick={onBack} style={{ background: "none", border: "none", cursor: "pointer", display: "flex", alignItems: "center", gap: 6, color: C.textMuted, fontSize: 13, fontFamily: "'Inter',sans-serif" }}>
          <Icon n="back" s={14} c={C.textMuted} /> Back
        </button>
        <div style={{ fontSize: 12, color: C.textMuted, fontWeight: 500 }}>{step + 1} / {fields.length}{company && <span style={{ color: C.accent }}> → {company}</span>}</div>
        <div style={{ width: 60 }} />
      </header>

      <div style={{ height: 3, background: C.border }}>
        <div style={{ height: "100%", background: C.accent, transition: "width .35s ease", width: `${((step + 1) / fields.length) * 100}%` }} />
      </div>

      <div style={{ flex: 1, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "44px 24px" }}>
        <div style={{ width: "100%", maxWidth: 580 }} key={step} className="fade-in">
          <div style={{ fontSize: 10, fontWeight: 700, color: C.textLight, letterSpacing: "1.5px", marginBottom: 8 }}>STEP {step + 1} / {fields.length}</div>
          <h2 style={{ fontFamily: "'Playfair Display',serif", fontSize: 24, fontWeight: 800, color: C.text, letterSpacing: "-0.5px", marginBottom: 5 }}>
            {f.label}{f.required && <span style={{ color: C.accent }}> *</span>}
          </h2>
          <p style={{ fontSize: 13, color: C.textMuted, marginBottom: 20 }}>{f.required ? "Required for best quality" : "Optional — skip if not applicable"}</p>

          {f.type === "input" ? (
            <input className="input-light" value={ans[f.key] || ""} onChange={e => setAns(a => ({ ...a, [f.key]: e.target.value }))} placeholder={f.placeholder} style={{ marginBottom: 26 }} onKeyDown={e => { if (e.key === "Enter" && step < fields.length - 1) setStep(s => s + 1); }} autoFocus />
          ) : (
            <textarea className="input-light" value={ans[f.key] || ""} onChange={e => setAns(a => ({ ...a, [f.key]: e.target.value }))} placeholder={f.placeholder} rows={f.rows || 6} style={{ marginBottom: 26 }} autoFocus />
          )}

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {step > 0 && <button className="btn-ghost" onClick={() => setStep(s => s - 1)}>← Back</button>}
            {step < fields.length - 1 ? (
              <button className="btn-primary" onClick={() => setStep(s => s + 1)} disabled={f.required && !ans[f.key]?.trim()}>
                Next <Icon n="arr" s={13} c="#fdf9f5" />
              </button>
            ) : (
              <button className="btn-primary" onClick={() => onDone(buildCandidateText(ans))} disabled={!allDone}>
                <Icon n="spark" s={14} c="#fdf9f5" /> Generate My Resume
              </button>
            )}
            {!f.required && step < fields.length - 1 && (
              <button className="btn-ghost" onClick={() => setStep(s => s + 1)} style={{ fontSize: 12 }}>Skip →</button>
            )}
          </div>

          {/* Dots */}
          <div style={{ marginTop: 28, display: "flex", flexWrap: "wrap", gap: 5 }}>
            {fields.map((fi, i) => (
              <button key={i} onClick={() => setStep(i)} style={{ width: 24, height: 24, borderRadius: 6, border: "none", cursor: "pointer", fontSize: 9, fontWeight: 700, fontFamily: "'Inter',sans-serif", background: i === step ? C.accent : ans[fi.key]?.trim() ? "rgba(16,185,129,.15)" : C.border, color: i === step ? "#fdf9f5" : ans[fi.key]?.trim() ? "#10b981" : C.textLight, transition: "all .15s" }}>
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
const GeneratingScreen = ({ stage, provider, company }) => {
  const msgs = [
    `Reading the job description for ${company || "this company"}...`,
    "Extracting ATS keywords and requirements...",
    "Analyzing company culture signals...",
    "Mapping your experience to JD requirements...",
    "Crafting your professional summary...",
    "Rewriting your bullets with stronger language...",
    "Optimizing skills for ATS...",
    "Final polish and review...",
  ];

  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh", background: C.bg, fontFamily: "'Inter',sans-serif" }}>
      <div style={{ maxWidth: 440, textAlign: "center", padding: "48px 24px" }}>
        <div style={{ width: 64, height: 64, borderRadius: "50%", background: C.accentBg, border: `1.5px solid ${C.border}`, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 24px", animation: "float 3s ease-in-out infinite" }}>
          <Icon n="spark" s={28} c={C.accent} />
        </div>
        <h2 style={{ fontFamily: "'Playfair Display',serif", fontSize: 22, fontWeight: 800, letterSpacing: "-0.3px", marginBottom: 8, color: C.text }}>Tailoring your resume</h2>
        {provider && (
          <div style={{ fontSize: 11, fontWeight: 700, color: C.accent, background: C.accentBg, border: `1px solid ${C.accent}30`, padding: "4px 14px", borderRadius: 100, display: "inline-flex", alignItems: "center", gap: 6, marginBottom: 14 }}>
            <div style={{ width: 5, height: 5, borderRadius: "50%", background: C.accent, animation: "blink 1.2s infinite" }} />
            {provider}
          </div>
        )}
        <p key={stage} style={{ color: C.textMuted, fontSize: 14, marginBottom: 36, animation: "fadeIn .5s ease", lineHeight: 1.6 }}>{msgs[stage % msgs.length]}</p>

        <div style={{ background: C.surface, borderRadius: 10, padding: "18px 20px", border: `1.5px solid ${C.border}`, marginBottom: 22, textAlign: "left" }}>
          {[70, 45, 90, 60, 80, 55, 75].map((w, i) => (
            <div key={i} style={{ display: "flex", gap: 8, marginBottom: 7 }}>
              <div className="ske" style={{ width: 45, height: 6, flexShrink: 0 }} />
              <div className="ske" style={{ width: `${w}%`, height: 6 }} />
            </div>
          ))}
        </div>

        <div style={{ height: 4, background: C.border, borderRadius: 2 }}>
          <div style={{ height: "100%", background: C.accent, borderRadius: 2, width: `${Math.min(95, (stage + 1) * 12)}%`, transition: "width 2s ease" }} />
        </div>
        <div style={{ marginTop: 9, fontSize: 11, color: C.textLight }}>This takes 10–25 seconds...</div>
      </div>
    </div>
  );
};

// ─── RESUME VIEW ──────────────────────────────────────────────────────────────
const ResumeView = ({ resume: r, tpl, font }) => {
  if (!r) return null;
  const t = TEMPLATES.find(x => x.id === tpl) || TEMPLATES[0];
  const ff = (FONTS || [{ n: "Lora", v: "'Lora',serif" }]).find(f => f.n === font)?.v || "'Lora',serif";

  // ── FIXED: hasProjects check ──
  const validProjects = Array.isArray(r.projects)
    ? r.projects.filter(p => p && (p.name || p.description || (Array.isArray(p.bullets) && p.bullets.length > 0)))
    : [];
  const hasProjects = validProjects.length > 0;
  const hasCerts = r.certifications?.filter(c => c)?.length > 0;
  const allSkills = [...(r.skills?.technical || []), ...(r.skills?.soft || []), ...(r.skills?.tools || [])].filter(Boolean);

  // ── TOKYO template — editorial left-bar layout ──
  if (tpl === "tokyo") {
    return (
      <div id="resume-canvas" style={{ fontFamily: ff, fontSize: 10, background: "#fff", minHeight: 1056, display: "flex" }}>
        {/* Red left bar */}
        <div style={{ width: 8, background: t.ac, flexShrink: 0 }} />
        <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
          {/* Header */}
          <div style={{ padding: "28px 28px 18px", borderBottom: `3px solid ${t.ac}` }}>
            <div style={{ fontSize: 30, fontFamily: "'Playfair Display',serif", fontWeight: 900, color: "#0f0f0f", letterSpacing: "-1px", lineHeight: 1 }}>{r.name || "Your Name"}</div>
            <div style={{ fontSize: 12, fontWeight: 700, color: t.ac, textTransform: "uppercase", letterSpacing: "3px", marginTop: 4 }}>{r.currentTitle}</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "3px 18px", marginTop: 10 }}>
              {[r.email, r.phone, r.location, r.linkedin, r.github, r.portfolio].filter(Boolean).map((v, i) => (
                <span key={i} style={{ fontSize: 9, color: "#6b7280" }}>{v}</span>
              ))}
            </div>
          </div>
          {/* Body — 2 col */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 170px", flex: 1 }}>
            <div style={{ padding: "18px 22px 18px 28px", borderRight: `1px solid #f1f5f9` }}>
              {r.summary && (
                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 8, fontWeight: 900, color: t.ac, letterSpacing: "2.5px", textTransform: "uppercase", marginBottom: 6, paddingBottom: 3, borderBottom: `2px solid ${t.ac}` }}>SUMMARY</div>
                  <p style={{ fontSize: 10.5, lineHeight: 1.8, color: "#374151" }}>{r.summary}</p>
                </div>
              )}
              {r.experience?.filter(e => e.title || e.company)?.length > 0 && (
                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 8, fontWeight: 900, color: t.ac, letterSpacing: "2.5px", textTransform: "uppercase", marginBottom: 8, paddingBottom: 3, borderBottom: `2px solid ${t.ac}` }}>EXPERIENCE</div>
                  {r.experience.filter(e => e.title || e.company).map((e, i) => (
                    <div key={i} style={{ marginBottom: 14 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                        <span style={{ fontWeight: 800, fontSize: 11, color: "#0f172a" }}>{e.title}</span>
                        <span style={{ fontSize: 8.5, color: "#94a3b8", whiteSpace: "nowrap", marginLeft: 8 }}>{e.period}</span>
                      </div>
                      <div style={{ fontSize: 10, color: t.ac, fontWeight: 700, marginBottom: 4 }}>{e.company}{e.location && e.location !== e.company ? ` · ${e.location}` : ""}</div>
                      <ul style={{ paddingLeft: 0, margin: 0, display: "flex", flexDirection: "column", gap: 3 }}>
                        {(e.bullets || []).filter(b => b?.trim()).map((b, j) => (
                          <li key={j} style={{ fontSize: 10.5, color: "#374151", lineHeight: 1.65, listStyle: "none", display: "flex", gap: 6 }}>
                            <span style={{ color: t.ac, fontWeight: 900, fontSize: 8, marginTop: 4.5, flexShrink: 0 }}>▸</span><span>{b}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              )}
              {hasProjects && (
                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 8, fontWeight: 900, color: t.ac, letterSpacing: "2.5px", textTransform: "uppercase", marginBottom: 8, paddingBottom: 3, borderBottom: `2px solid ${t.ac}` }}>PROJECTS</div>
                  {validProjects.map((p, i) => (
                    <div key={i} style={{ marginBottom: 10, padding: "8px 10px", border: `1.5px solid #f1f5f9`, borderLeft: `3px solid ${t.ac}`, borderRadius: 4 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                        <span style={{ fontWeight: 800, fontSize: 10.5, color: "#0f172a" }}>{p.name}</span>
                        {p.link && <span style={{ fontSize: 8.5, color: t.ac }}>{p.link}</span>}
                      </div>
                      {p.tech && <div style={{ fontSize: 8.5, color: "#6b7280", fontStyle: "italic", margin: "2px 0" }}>{p.tech}</div>}
                      {p.description && <p style={{ fontSize: 10, color: "#374151", margin: "3px 0", lineHeight: 1.55 }}>{p.description}</p>}
                      {(p.bullets || []).filter(b => b?.trim()).map((b, j) => (
                        <div key={j} style={{ fontSize: 10, color: "#374151", display: "flex", gap: 5, lineHeight: 1.5 }}>
                          <span style={{ color: t.ac, fontSize: 7.5, marginTop: 3.5 }}>▸</span><span>{b}</span>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </div>
            {/* Right sidebar */}
            <div style={{ padding: "18px 18px 18px 16px", background: "#fafafa" }}>
              {allSkills.length > 0 && (
                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 8, fontWeight: 900, color: t.ac, letterSpacing: "2.5px", textTransform: "uppercase", marginBottom: 7, paddingBottom: 3, borderBottom: `2px solid ${t.ac}` }}>SKILLS</div>
                  {r.skills?.technical?.length > 0 && (<><div style={{ fontSize: 7.5, fontWeight: 700, color: "#94a3b8", marginBottom: 4, textTransform: "uppercase", letterSpacing: "1px" }}>Technical</div><div style={{ display: "flex", flexWrap: "wrap", gap: 3, marginBottom: 9 }}>{r.skills.technical.map((s, i) => (<span key={i} style={{ fontSize: 8.5, fontWeight: 600, color: t.ac, background: t.ac + "12", padding: "2px 7px", borderRadius: 3 }}>{s}</span>))}</div></>)}
                  {r.skills?.tools?.length > 0 && (<><div style={{ fontSize: 7.5, fontWeight: 700, color: "#94a3b8", marginBottom: 4, textTransform: "uppercase", letterSpacing: "1px" }}>Tools</div><div style={{ display: "flex", flexWrap: "wrap", gap: 3, marginBottom: 9 }}>{r.skills.tools.map((s, i) => (<span key={i} style={{ fontSize: 8.5, color: "#6b7280", background: "#f3f4f6", padding: "2px 7px", borderRadius: 3, border: "1px solid #e5e7eb" }}>{s}</span>))}</div></>)}
                  {r.skills?.soft?.length > 0 && (<><div style={{ fontSize: 7.5, fontWeight: 700, color: "#94a3b8", marginBottom: 4, textTransform: "uppercase", letterSpacing: "1px" }}>Soft Skills</div>{r.skills.soft.map((s, i) => (<div key={i} style={{ fontSize: 9.5, color: "#6b7280", marginBottom: 2 }}>{s}</div>))}</>)}
                </div>
              )}
              {r.education?.filter(e => e.degree || e.school)?.length > 0 && (
                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 8, fontWeight: 900, color: t.ac, letterSpacing: "2.5px", textTransform: "uppercase", marginBottom: 7, paddingBottom: 3, borderBottom: `2px solid ${t.ac}` }}>EDUCATION</div>
                  {r.education.filter(e => e.degree || e.school).map((e, i) => (<div key={i} style={{ marginBottom: 8 }}><div style={{ fontWeight: 700, fontSize: 10, color: "#0f172a" }}>{e.degree}</div><div style={{ fontSize: 9.5, color: t.ac }}>{e.school}</div>{e.year && <div style={{ fontSize: 8.5, color: "#94a3b8" }}>{e.year}</div>}</div>))}
                </div>
              )}
              {hasCerts && (
                <div>
                  <div style={{ fontSize: 8, fontWeight: 900, color: t.ac, letterSpacing: "2.5px", textTransform: "uppercase", marginBottom: 7, paddingBottom: 3, borderBottom: `2px solid ${t.ac}` }}>CERTS</div>
                  {r.certifications.filter(c => c).map((c, i) => (<div key={i} style={{ fontSize: 9.5, color: "#374151", marginBottom: 4, display: "flex", gap: 5 }}><span style={{ color: t.ac }}>◆</span><span>{c}</span></div>))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── NOVA template — dark mode tech layout ──
  if (tpl === "nova") {
    const darkBorder = "rgba(110,231,183,0.12)";
    return (
      <div id="resume-canvas" style={{ fontFamily: ff, fontSize: 10, background: t.bg, color: t.hTx, minHeight: 1056 }}>
        <div style={{ padding: "30px 32px 22px", background: t.hBg, borderBottom: `1px solid ${darkBorder}` }}>
          <h1 style={{ fontFamily: "'Playfair Display',serif", fontSize: 26, fontWeight: 800, color: "#f1f5f9", letterSpacing: "-0.5px", marginBottom: 4 }}>{r.name}</h1>
          {r.currentTitle && <div style={{ fontSize: 11, color: t.ac, fontWeight: 700, letterSpacing: "1px", marginBottom: 10 }}>{r.currentTitle}</div>}
          <div style={{ display: "flex", flexWrap: "wrap", gap: "3px 18px" }}>
            {[r.email, r.phone, r.location, r.linkedin, r.github, r.portfolio].filter(Boolean).map((v, i) => (
              <span key={i} style={{ fontSize: 9, color: "rgba(226,232,240,0.55)" }}>{v}</span>
            ))}
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 180px" }}>
          <div style={{ padding: "20px 22px 20px 32px", borderRight: `1px solid ${darkBorder}` }}>
            {r.summary && <div style={{ marginBottom: 18 }}><SectionTitleDark label="SUMMARY" ac={t.ac} /><p style={{ fontSize: 10.5, lineHeight: 1.85, color: "rgba(226,232,240,0.8)" }}>{r.summary}</p></div>}
            {r.experience?.filter(e => e.title || e.company)?.length > 0 && (
              <div style={{ marginBottom: 18 }}>
                <SectionTitleDark label="EXPERIENCE" ac={t.ac} />
                {r.experience.filter(e => e.title || e.company).map((e, i) => (
                  <div key={i} style={{ marginBottom: 14, paddingLeft: 10, borderLeft: `2px solid ${t.ac}40` }}>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span style={{ fontWeight: 700, fontSize: 11, color: "#f1f5f9" }}>{e.title}</span>
                      <span style={{ fontSize: 8.5, color: "rgba(226,232,240,0.4)", marginLeft: 8, whiteSpace: "nowrap" }}>{e.period}</span>
                    </div>
                    <div style={{ fontSize: 10, color: t.ac, fontWeight: 600, marginBottom: 5 }}>{e.company}</div>
                    {(e.bullets || []).filter(b => b?.trim()).map((b, j) => (
                      <div key={j} style={{ fontSize: 10.5, color: "rgba(226,232,240,0.75)", lineHeight: 1.7, display: "flex", gap: 6, marginBottom: 3 }}>
                        <span style={{ color: t.ac, fontSize: 7.5, marginTop: 4.5, flexShrink: 0 }}>▸</span><span>{b}</span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )}
            {hasProjects && (
              <div>
                <SectionTitleDark label="PROJECTS" ac={t.ac} />
                {validProjects.map((p, i) => (
                  <div key={i} style={{ marginBottom: 11, padding: "9px 12px", background: "rgba(110,231,183,0.04)", border: `1px solid ${darkBorder}`, borderRadius: 6 }}>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span style={{ fontWeight: 700, fontSize: 10.5, color: "#f1f5f9" }}>{p.name}</span>
                      {p.link && <span style={{ fontSize: 8.5, color: t.ac }}>{p.link}</span>}
                    </div>
                    {p.tech && <div style={{ fontSize: 8.5, color: t.ac + "cc", fontStyle: "italic", margin: "2px 0" }}>{p.tech}</div>}
                    {p.description && <p style={{ fontSize: 10, color: "rgba(226,232,240,0.65)", margin: "3px 0" }}>{p.description}</p>}
                    {(p.bullets || []).filter(b => b?.trim()).map((b, j) => (
                      <div key={j} style={{ fontSize: 10, color: "rgba(226,232,240,0.65)", display: "flex", gap: 5, lineHeight: 1.55 }}>
                        <span style={{ color: t.ac, fontSize: 7.5, marginTop: 3.5 }}>▸</span><span>{b}</span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>
          {/* Sidebar */}
          <div style={{ padding: "20px 18px", background: "rgba(2,6,23,0.4)" }}>
            {allSkills.length > 0 && (
              <div style={{ marginBottom: 18 }}>
                <SectionTitleDark label="SKILLS" ac={t.ac} />
                {r.skills?.technical?.length > 0 && <><div style={{ fontSize: 7.5, color: "rgba(226,232,240,0.35)", fontWeight: 700, marginBottom: 4, letterSpacing: "1px" }}>TECHNICAL</div><div style={{ display: "flex", flexWrap: "wrap", gap: 3, marginBottom: 9 }}>{r.skills.technical.map((s, i) => <span key={i} style={{ fontSize: 8.5, color: t.ac, background: t.ac + "15", padding: "2px 7px", borderRadius: 3, fontWeight: 600 }}>{s}</span>)}</div></>}
                {r.skills?.tools?.length > 0 && <><div style={{ fontSize: 7.5, color: "rgba(226,232,240,0.35)", fontWeight: 700, marginBottom: 4, letterSpacing: "1px" }}>TOOLS</div><div style={{ display: "flex", flexWrap: "wrap", gap: 3, marginBottom: 9 }}>{r.skills.tools.map((s, i) => <span key={i} style={{ fontSize: 8.5, color: "rgba(226,232,240,0.6)", background: "rgba(255,255,255,0.06)", padding: "2px 7px", borderRadius: 3, border: "1px solid rgba(255,255,255,0.08)" }}>{s}</span>)}</div></>}
                {r.skills?.soft?.length > 0 && <>{r.skills.soft.map((s, i) => <div key={i} style={{ fontSize: 9.5, color: "rgba(226,232,240,0.6)", marginBottom: 3, display: "flex", gap: 5 }}><span style={{ color: t.ac }}>◆</span>{s}</div>)}</>}
              </div>
            )}
            {r.education?.filter(e => e.degree || e.school)?.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <SectionTitleDark label="EDUCATION" ac={t.ac} />
                {r.education.filter(e => e.degree || e.school).map((e, i) => (
                  <div key={i} style={{ marginBottom: 8 }}>
                    <div style={{ fontWeight: 700, fontSize: 10, color: "#f1f5f9" }}>{e.degree}</div>
                    <div style={{ fontSize: 9.5, color: t.ac }}>{e.school}</div>
                    {e.year && <div style={{ fontSize: 8.5, color: "rgba(226,232,240,0.35)" }}>{e.year}</div>}
                  </div>
                ))}
              </div>
            )}
            {hasCerts && (
              <div>
                <SectionTitleDark label="CERTS" ac={t.ac} />
                {r.certifications.filter(c => c).map((c, i) => (
                  <div key={i} style={{ fontSize: 9.5, color: "rgba(226,232,240,0.6)", marginBottom: 4, display: "flex", gap: 5 }}>
                    <span style={{ color: t.ac }}>◆</span><span>{c}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ── EXECUTIVE template — premium navy serif ──
  if (tpl === "executive") {
    return (
      <div id="resume-canvas" style={{ fontFamily: ff, fontSize: 10, background: t.bg, minHeight: 1056 }}>
        <div style={{ background: t.hBg, padding: "32px 36px 24px" }}>
          <h1 style={{ fontFamily: "'Playfair Display',serif", fontSize: 28, fontWeight: 800, color: "#fff", letterSpacing: "-0.5px", marginBottom: 4 }}>{r.name}</h1>
          {r.currentTitle && <div style={{ fontSize: 11, color: "rgba(255,255,255,0.65)", fontWeight: 500, letterSpacing: "1.5px", textTransform: "uppercase", marginBottom: 12 }}>{r.currentTitle}</div>}
          <div style={{ display: "flex", flexWrap: "wrap", gap: "3px 20px" }}>
            {[r.email, r.phone, r.location, r.linkedin, r.github, r.portfolio].filter(Boolean).map((v, i) => (
              <span key={i} style={{ fontSize: 9, color: "rgba(255,255,255,0.55)" }}>{v}</span>
            ))}
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 190px" }}>
          <div style={{ padding: "22px 24px 22px 36px", borderRight: `1px solid #e2e8f0` }}>
            {r.summary && <div style={{ marginBottom: 18, paddingBottom: 16, borderBottom: `1px solid #e2e8f0` }}><p style={{ fontSize: 11, lineHeight: 1.85, color: "#374151", fontStyle: "italic" }}>{r.summary}</p></div>}
            {r.experience?.filter(e => e.title || e.company)?.length > 0 && (
              <div style={{ marginBottom: 18 }}>
                <div style={{ fontSize: 8, fontWeight: 800, color: t.ac, letterSpacing: "2.5px", marginBottom: 10, textTransform: "uppercase" }}>Professional Experience</div>
                {r.experience.filter(e => e.title || e.company).map((e, i) => (
                  <div key={i} style={{ marginBottom: 15 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                      <span style={{ fontFamily: "'Playfair Display',serif", fontWeight: 700, fontSize: 11.5, color: "#0f172a" }}>{e.title}</span>
                      <span style={{ fontSize: 8.5, color: "#94a3b8" }}>{e.period}</span>
                    </div>
                    <div style={{ fontSize: 10, color: t.ac, fontWeight: 700, marginBottom: 6 }}>{e.company}</div>
                    {(e.bullets || []).filter(b => b?.trim()).map((b, j) => (
                      <div key={j} style={{ fontSize: 10.5, color: "#374151", lineHeight: 1.7, display: "flex", gap: 7, marginBottom: 3 }}>
                        <span style={{ color: t.ac, fontWeight: 900, fontSize: 8, marginTop: 4.5 }}>■</span><span>{b}</span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )}
            {hasProjects && (
              <div>
                <div style={{ fontSize: 8, fontWeight: 800, color: t.ac, letterSpacing: "2.5px", marginBottom: 10, textTransform: "uppercase" }}>Key Projects</div>
                {validProjects.map((p, i) => (
                  <div key={i} style={{ marginBottom: 11, paddingLeft: 10, borderLeft: `2px solid ${t.ac}30` }}>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span style={{ fontWeight: 700, fontSize: 10.5, color: "#0f172a" }}>{p.name}</span>
                      {p.link && <span style={{ fontSize: 8.5, color: t.ac }}>{p.link}</span>}
                    </div>
                    {p.tech && <div style={{ fontSize: 8.5, color: "#94a3b8", fontStyle: "italic", marginBottom: 3 }}>{p.tech}</div>}
                    {p.description && <p style={{ fontSize: 10, color: "#374151", margin: "2px 0 4px" }}>{p.description}</p>}
                    {(p.bullets || []).filter(b => b?.trim()).map((b, j) => (
                      <div key={j} style={{ fontSize: 10, color: "#374151", display: "flex", gap: 5, lineHeight: 1.55 }}>
                        <span style={{ color: t.ac, fontSize: 7.5, marginTop: 3.5 }}>■</span><span>{b}</span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>
          <div style={{ padding: "22px 20px", background: "#f8fafc" }}>
            {allSkills.length > 0 && (
              <div style={{ marginBottom: 18 }}>
                <div style={{ fontSize: 8, fontWeight: 800, color: t.ac, letterSpacing: "2px", marginBottom: 9, textTransform: "uppercase" }}>Core Skills</div>
                {r.skills?.technical?.map((s, i) => <div key={i} style={{ fontSize: 9.5, color: "#374151", marginBottom: 3, display: "flex", gap: 5 }}><span style={{ color: t.ac }}>■</span>{s}</div>)}
                {r.skills?.tools?.length > 0 && <><div style={{ fontSize: 8, fontWeight: 700, color: "#94a3b8", letterSpacing: "1px", margin: "9px 0 5px" }}>TOOLS</div>{r.skills.tools.map((s, i) => <div key={i} style={{ fontSize: 9.5, color: "#374151", marginBottom: 3 }}>{s}</div>)}</>}
              </div>
            )}
            {r.education?.filter(e => e.degree || e.school)?.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 8, fontWeight: 800, color: t.ac, letterSpacing: "2px", marginBottom: 9, textTransform: "uppercase" }}>Education</div>
                {r.education.filter(e => e.degree || e.school).map((e, i) => (
                  <div key={i} style={{ marginBottom: 9 }}>
                    <div style={{ fontFamily: "'Playfair Display',serif", fontWeight: 700, fontSize: 10, color: "#0f172a" }}>{e.degree}</div>
                    <div style={{ fontSize: 9.5, color: t.ac }}>{e.school}</div>
                    {e.year && <div style={{ fontSize: 8.5, color: "#94a3b8" }}>{e.year}</div>}
                  </div>
                ))}
              </div>
            )}
            {hasCerts && (
              <div>
                <div style={{ fontSize: 8, fontWeight: 800, color: t.ac, letterSpacing: "2px", marginBottom: 7, textTransform: "uppercase" }}>Certifications</div>
                {r.certifications.filter(c => c).map((c, i) => <div key={i} style={{ fontSize: 9.5, color: "#374151", marginBottom: 4 }}>{c}</div>)}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ── DEFAULT (all original templates) — re-use original ResumeView logic ──
  const isMinimal = tpl === "minimal";
  const SectionTitle = ({ label }) => (
    <div style={{ marginBottom: 8, paddingBottom: 4, borderBottom: `1.5px solid ${isMinimal ? "#2d1f14" : t.ac + "60"}` }}>
      <span style={{ fontFamily: "'Lora',serif", fontSize: 8.5, fontWeight: 700, color: isMinimal ? "#2d1f14" : t.ac, textTransform: "uppercase", letterSpacing: "2px" }}>{label}</span>
    </div>
  );

  return (
    <div id="resume-canvas" style={{ fontFamily: ff, fontSize: 10, lineHeight: 1.6, color: "#1a1a1a", background: t.bg, minHeight: 1056 }}>
      <div style={{ background: t.hBg, padding: "28px 32px 22px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16 }}>
          <div style={{ flex: 1 }}>
            <h1 style={{ fontFamily: "'Playfair Display',serif", fontSize: 24, fontWeight: 800, color: t.hTx, marginBottom: 3, letterSpacing: "-0.5px", lineHeight: 1.05 }}>{r.name || "Your Name"}</h1>
            {r.currentTitle && <div style={{ fontSize: 11.5, color: isMinimal ? t.ac : t.hTx + "cc", fontWeight: 600, marginBottom: 10 }}>{r.currentTitle}</div>}
            <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 16px" }}>
              {[r.email, r.phone, r.location].filter(Boolean).map((v, i) => (
                <span key={i} style={{ fontSize: 9, color: isMinimal ? "#6b7280" : t.hTx + "90" }}>{v}</span>
              ))}
            </div>
            {(r.linkedin || r.github || r.portfolio) && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: "3px 14px", marginTop: 6 }}>
                {[r.linkedin, r.github, r.portfolio].filter(Boolean).map((v, i) => (
                  <span key={i} style={{ fontSize: 9, color: isMinimal ? t.ac : t.hTx + "80", fontWeight: 500 }}>{v}</span>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 185px", gap: 0, alignItems: "start" }}>
        <div style={{ padding: "20px 20px 20px 32px", borderRight: `1px solid ${t.ac}15` }}>
          {r.summary && <div style={{ marginBottom: 18 }}><SectionTitle label="Professional Summary" /><p style={{ fontSize: 10.5, lineHeight: 1.85, color: "#374151" }}>{r.summary}</p></div>}
          {r.experience?.filter(e => e.title || e.company)?.length > 0 && (
            <div style={{ marginBottom: 18 }}>
              <SectionTitle label="Work Experience" />
              {r.experience.filter(e => e.title || e.company).map((e, i) => (
                <div key={i} style={{ marginBottom: 15, paddingLeft: 10, borderLeft: `2px solid ${t.ac}30` }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 3 }}>
                    <div>
                      <div style={{ fontFamily: "'Lora',serif", fontWeight: 700, fontSize: 11, color: "#0f172a" }}>{e.title}</div>
                      <div style={{ fontSize: 10, color: t.ac, fontWeight: 600, marginTop: 1 }}>{e.company}{e.location && e.location !== e.company ? ` · ${e.location}` : ""}</div>
                    </div>
                    {e.period && <div style={{ fontSize: 8.5, color: "#94a3b8", flexShrink: 0, marginLeft: 8, background: t.ac + "08", padding: "2px 7px", borderRadius: 3, border: `1px solid ${t.ac}15`, whiteSpace: "nowrap" }}>{e.period}</div>}
                  </div>
                  <ul style={{ paddingLeft: 0, marginTop: 5, display: "flex", flexDirection: "column", gap: 3.5 }}>
                    {(e.bullets || []).filter(b => b?.trim()).map((b, j) => (
                      <li key={j} style={{ fontSize: 10.5, color: "#374151", lineHeight: 1.65, listStyle: "none", display: "flex", alignItems: "flex-start", gap: 6 }}>
                        <span style={{ color: t.ac, fontSize: 8, marginTop: 4.5, flexShrink: 0, fontWeight: 900 }}>▸</span><span>{b}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
          {hasProjects && (
            <div style={{ marginBottom: 18 }}>
              <SectionTitle label="Projects" />
              {validProjects.map((p, i) => (
                <div key={i} style={{ marginBottom: 12, padding: "9px 11px", background: t.ac + "06", borderRadius: 6, border: `1px solid ${t.ac}12` }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 2 }}>
                    <span style={{ fontFamily: "'Lora',serif", fontWeight: 700, fontSize: 10.5, color: "#0f172a" }}>{p.name}</span>
                    {p.link && <span style={{ fontSize: 8.5, color: t.ac, fontWeight: 600 }}>{p.link}</span>}
                  </div>
                  {p.tech && <div style={{ fontSize: 8.5, color: t.ac, fontWeight: 700, marginBottom: 3 }}>{p.tech}</div>}
                  {p.description && <p style={{ fontSize: 10, color: "#374151", lineHeight: 1.6, margin: 0, marginBottom: p.bullets?.length ? 4 : 0 }}>{p.description}</p>}
                  {(p.bullets || []).filter(b => b?.trim()).map((b, j) => (
                    <div key={j} style={{ fontSize: 10, color: "#374151", lineHeight: 1.55, display: "flex", alignItems: "flex-start", gap: 5 }}>
                      <span style={{ color: t.ac, fontSize: 7.5, marginTop: 4 }}>▸</span><span>{b}</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
        <div style={{ padding: "20px 20px 20px 18px" }}>
          {allSkills.length > 0 && (
            <div style={{ marginBottom: 18 }}>
              <SectionTitle label="Skills" />
              {r.skills?.technical?.length > 0 && <><div style={{ fontSize: 8, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "1px", marginBottom: 5 }}>Technical</div><div style={{ display: "flex", flexWrap: "wrap", gap: 3, marginBottom: 10 }}>{r.skills.technical.slice(0, 14).map((s, i) => <span key={i} style={{ fontSize: 8.5, fontWeight: 600, color: t.ac, background: t.ac + "12", padding: "2.5px 7px", borderRadius: 3, border: `1px solid ${t.ac}20` }}>{s}</span>)}</div></>}
              {r.skills?.tools?.length > 0 && <><div style={{ fontSize: 8, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "1px", marginBottom: 5 }}>Tools</div><div style={{ display: "flex", flexWrap: "wrap", gap: 3, marginBottom: 10 }}>{r.skills.tools.slice(0, 10).map((s, i) => <span key={i} style={{ fontSize: 8.5, color: "#6b7280", background: "#f3f4f6", padding: "2.5px 7px", borderRadius: 3, border: "1px solid #e5e7eb" }}>{s}</span>)}</div></>}
              {r.skills?.soft?.length > 0 && <>{r.skills.soft.slice(0, 4).map((s, i) => <div key={i} style={{ fontSize: 9.5, color: "#6b7280", marginBottom: 2, display: "flex", alignItems: "center", gap: 5 }}><span style={{ color: t.ac, fontSize: 7 }}>◆</span>{s}</div>)}</>}
            </div>
          )}
          {r.education?.filter(e => e.degree || e.school)?.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <SectionTitle label="Education" />
              {r.education.filter(e => e.degree || e.school).map((e, i) => (
                <div key={i} style={{ marginBottom: 10 }}>
                  <div style={{ fontFamily: "'Lora',serif", fontWeight: 700, fontSize: 10, color: "#0f172a" }}>{e.degree}</div>
                  <div style={{ fontSize: 9.5, color: t.ac, fontWeight: 600, marginTop: 1 }}>{e.school}</div>
                  {(e.year || e.gpa) && <div style={{ fontSize: 8.5, color: "#94a3b8", marginTop: 2 }}>{[e.year, e.gpa].filter(Boolean).join(" · ")}</div>}
                </div>
              ))}
            </div>
          )}
          {hasCerts && (
            <div>
              <SectionTitle label="Certifications" />
              {r.certifications.filter(c => c).map((c, i) => (
                <div key={i} style={{ fontSize: 9.5, color: "#374151", lineHeight: 1.55, display: "flex", gap: 5, marginBottom: 5 }}>
                  <span style={{ color: t.ac, flexShrink: 0 }}>◆</span><span>{c}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// ─── BUILDER PAGE ──────────────────────────────────────────────────────────────
const BuilderPage = ({ resume: initialResume, jobData, user, savedId: initSavedId, onBack }) => {
  const [resume, setResume] = useState(initialResume);
  const [tpl, setTpl] = useState(initialResume?._tpl || "classic");
  const [font, setFont] = useState(initialResume?._font || "Lora");
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

  const saveToDB = async () => {
    if (!user) return;
    setSaving(true);
    try {
      const data = await saveResume(user.id, resume, jobData, tpl, font, savedId);
      if (data && !savedId) setSavedId(data.id);
      setSaveMsg("Saved ✓");
    } catch {
      setSaveMsg("Save failed");
    }
    setSaving(false);
    setTimeout(() => setSaveMsg(null), 2500);
  };

  return (
    <div style={{ minHeight: "100vh", background: C.bg, fontFamily: "'Inter',sans-serif", display: "flex", flexDirection: "column" }}>
      {/* Header */}
      <header className="no-print" style={{ background: C.surface, borderBottom: `1.5px solid ${C.border}`, padding: "0 18px", height: 56, display: "flex", alignItems: "center", gap: 10, position: "sticky", top: 0, zIndex: 50 }}>
        <button className="btn-ghost" onClick={onBack} style={{ padding: "7px 12px", fontSize: 12 }}>← Back</button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: "'Lora',serif", fontSize: 13, fontWeight: 600, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {resume?.name || "Resume"}{jobData?.co ? ` → ${jobData.co}` : ""}
          </div>
        </div>

        {/* Tabs */}
        <div style={{ display: "flex", gap: 2, background: C.accentBg, borderRadius: 8, padding: "3px", border: `1px solid ${C.border}` }}>
          {["preview", "edit"].map(t => (
            <button key={t} onClick={() => setTab(t)} style={{ padding: "6px 16px", borderRadius: 6, border: "none", cursor: "pointer", fontSize: 12, fontWeight: 600, fontFamily: "'Inter',sans-serif", transition: "all .15s", background: tab === t ? C.surface : "none", color: tab === t ? C.text : C.textMuted, boxShadow: tab === t ? `0 1px 4px ${C.brown}10` : "none" }}>
              {t === "preview" ? "Preview" : "Edit"}
            </button>
          ))}
        </div>

        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {saveMsg && <span style={{ fontSize: 12, color: saveMsg.includes("✓") ? "#10b981" : "#dc2626", fontWeight: 600 }}>{saveMsg}</span>}
          {user && (
            <button className="btn-secondary" onClick={saveToDB} disabled={saving} style={{ fontSize: 12, padding: "7px 13px", gap: 5 }}>
              {saving ? <Spinner s={12} c={C.textMuted} /> : <Icon n="sv" s={12} c={C.textMuted} />}{saving ? "Saving..." : "Save"}
            </button>
          )}
          <button className="btn-primary" onClick={() => window.print()} style={{ fontSize: 12, padding: "7px 15px", gap: 5 }}>
            <Icon n="dl" s={12} c="#fdf9f5" /> Download PDF
          </button>
        </div>
      </header>

      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        {/* Left panel */}
        <div className="no-print desktop-only" style={{ width: 210, borderRight: `1.5px solid ${C.border}`, padding: "18px 12px", overflowY: "auto", background: C.surface, flexShrink: 0 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: C.textLight, letterSpacing: "1.5px", marginBottom: 10 }}>TEMPLATE</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 5, marginBottom: 24 }}>
            {TEMPLATES.map(t => (
              <button key={t.id} onClick={() => setTpl(t.id)} style={{ padding: "9px 6px", borderRadius: 7, border: tpl === t.id ? `2px solid ${t.ac}` : `1.5px solid ${C.border}`, background: tpl === t.id ? t.ac + "12" : C.accentBg, cursor: "pointer", fontSize: 10, fontWeight: 600, fontFamily: "'Inter',sans-serif", color: tpl === t.id ? t.ac : C.textMuted, transition: "all .15s" }}>
                <div style={{ width: "100%", height: 24, background: t.hBg, borderRadius: 3, marginBottom: 5 }} />
                {t.n}
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

        {/* Main content */}
        <div style={{ flex: 1, overflowY: "auto", padding: "26px 22px", background: C.accentBg }}>
          {tab === "preview" ? (
            <div style={{ maxWidth: 794, margin: "0 auto", boxShadow: `0 4px 40px ${C.brown}18`, borderRadius: 4, overflow: "hidden", border: `1px solid ${C.border}` }}>
              <ResumeView resume={resume} tpl={tpl} font={font} />
            </div>
          ) : (
            <div style={{ maxWidth: 740, margin: "0 auto", display: "flex", flexDirection: "column", gap: 14 }}>
              {/* Contact */}
              <div className="card" style={{ padding: "22px" }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: C.textMuted, letterSpacing: ".5px", marginBottom: 14, textTransform: "uppercase" }}>Contact Info</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  {[["name", "Full Name"], ["currentTitle", "Title"], ["email", "Email"], ["phone", "Phone"], ["location", "Location"], ["linkedin", "LinkedIn"], ["github", "GitHub"], ["portfolio", "Portfolio"]].map(([k, l]) => (
                    <div key={k}>
                      <label style={{ fontSize: 11, color: C.textMuted, display: "block", marginBottom: 4, fontWeight: 500 }}>{l}</label>
                      <input className="input-light" value={resume?.[k] || ""} onChange={e => updateField(k, e.target.value)} style={{ fontSize: 13 }} />
                    </div>
                  ))}
                </div>
              </div>

              {/* Summary */}
              <div className="card" style={{ padding: "22px" }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: C.textMuted, letterSpacing: ".5px", marginBottom: 10, textTransform: "uppercase" }}>Professional Summary</div>
                <textarea className="input-light" value={resume?.summary || ""} onChange={e => updateField("summary", e.target.value)} rows={4} style={{ fontSize: 13 }} />
              </div>

              {/* Experience */}
              <div className="card" style={{ padding: "22px" }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: C.textMuted, letterSpacing: ".5px", marginBottom: 16, textTransform: "uppercase" }}>Experience</div>
                {(resume?.experience || []).map((exp, i) => (
                  <div key={i} style={{ marginBottom: 20, paddingBottom: 20, borderBottom: i < (resume.experience.length - 1) ? `1px solid ${C.border}` : "none" }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: C.accent, marginBottom: 9 }}>Role {i + 1}</div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 9, marginBottom: 10 }}>
                      {[["title", "Job Title"], ["company", "Company"], ["period", "Period (e.g. Jan 2023 – Present)"], ["location", "Location"]].map(([k, l]) => (
                        <div key={k}>
                          <label style={{ fontSize: 11, color: C.textMuted, display: "block", marginBottom: 4, fontWeight: 500 }}>{l}</label>
                          <input className="input-light" value={exp[k] || ""} onChange={e => {
                            const exps = JSON.parse(JSON.stringify(resume.experience));
                            exps[i][k] = e.target.value;
                            updateField("experience", exps);
                          }} style={{ fontSize: 13 }} />
                        </div>
                      ))}
                    </div>
                    <div>
                      <label style={{ fontSize: 11, color: C.textMuted, display: "block", marginBottom: 4, fontWeight: 500 }}>Bullet Points (one per line)</label>
                      <textarea className="input-light" value={(exp.bullets || []).join("\n")} onChange={e => {
                        const exps = JSON.parse(JSON.stringify(resume.experience));
                        exps[i].bullets = e.target.value.split("\n");
                        updateField("experience", exps);
                      }} rows={5} style={{ fontSize: 13 }} />
                    </div>
                  </div>
                ))}
              </div>

              {/* Projects */}
              <div className="card" style={{ padding: "22px" }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: C.textMuted, letterSpacing: ".5px", marginBottom: 14, textTransform: "uppercase" }}>Projects</div>
                {(resume?.projects || []).length === 0 && <div style={{ fontSize: 13, color: C.textLight, fontStyle: "italic" }}>No projects — AI will add from your background</div>}
                {(resume?.projects || []).map((proj, i) => (
                  <div key={i} style={{ marginBottom: 18, paddingBottom: 18, borderBottom: i < (resume.projects.length - 1) ? `1px solid ${C.border}` : "none" }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: C.accent, marginBottom: 9 }}>Project {i + 1}</div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 9, marginBottom: 10 }}>
                      {[["name", "Project Name"], ["tech", "Tech Stack"], ["link", "Link (GitHub/Live)"], ["description", "One-line description"]].map(([k, l]) => (
                        <div key={k}>
                          <label style={{ fontSize: 11, color: C.textMuted, display: "block", marginBottom: 4, fontWeight: 500 }}>{l}</label>
                          <input className="input-light" value={proj[k] || ""} onChange={e => {
                            const ps = JSON.parse(JSON.stringify(resume.projects));
                            ps[i][k] = e.target.value;
                            updateField("projects", ps);
                          }} style={{ fontSize: 13 }} />
                        </div>
                      ))}
                    </div>
                    <div>
                      <label style={{ fontSize: 11, color: C.textMuted, display: "block", marginBottom: 4, fontWeight: 500 }}>Bullet Points (one per line)</label>
                      <textarea className="input-light" value={(proj.bullets || []).join("\n")} onChange={e => {
                        const ps = JSON.parse(JSON.stringify(resume.projects));
                        ps[i].bullets = e.target.value.split("\n");
                        updateField("projects", ps);
                      }} rows={3} style={{ fontSize: 13 }} />
                    </div>
                  </div>
                ))}
              </div>

              {/* Skills */}
              <div className="card" style={{ padding: "22px" }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: C.textMuted, letterSpacing: ".5px", marginBottom: 12, textTransform: "uppercase" }}>Skills</div>
                {[["technical", "Technical Skills (comma separated)"], ["soft", "Soft Skills (comma separated)"], ["tools", "Tools & Technologies (comma separated)"]].map(([k, l]) => (
                  <div key={k} style={{ marginBottom: 11 }}>
                    <label style={{ fontSize: 11, color: C.textMuted, display: "block", marginBottom: 4, fontWeight: 500 }}>{l}</label>
                    <input className="input-light" value={(resume?.skills?.[k] || []).join(", ")} onChange={e => {
                      const skills = JSON.parse(JSON.stringify(resume.skills || {}));
                      skills[k] = e.target.value.split(",").map(s => s.trim()).filter(Boolean);
                      updateField("skills", skills);
                    }} style={{ fontSize: 13 }} />
                  </div>
                ))}
              </div>

              {/* Education */}
              <div className="card" style={{ padding: "22px" }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: C.textMuted, letterSpacing: ".5px", marginBottom: 12, textTransform: "uppercase" }}>Education</div>
                {(resume?.education || []).map((edu, i) => (
                  <div key={i} style={{ marginBottom: 14 }}>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 9 }}>
                      {[["degree", "Degree"], ["school", "School / University"], ["year", "Year"], ["gpa", "GPA (optional)"]].map(([k, l]) => (
                        <div key={k}>
                          <label style={{ fontSize: 11, color: C.textMuted, display: "block", marginBottom: 4, fontWeight: 500 }}>{l}</label>
                          <input className="input-light" value={edu[k] || ""} onChange={e => {
                            const edus = JSON.parse(JSON.stringify(resume.education));
                            edus[i][k] = e.target.value;
                            updateField("education", edus);
                          }} style={{ fontSize: 13 }} />
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              {/* Certifications */}
              <div className="card" style={{ padding: "22px" }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: C.textMuted, letterSpacing: ".5px", marginBottom: 10, textTransform: "uppercase" }}>Certifications</div>
                <textarea className="input-light" value={(resume?.certifications || []).filter(c => c).join("\n")} onChange={e => updateField("certifications", e.target.value.split("\n").map(s => s.trim()).filter(Boolean))} rows={3} style={{ fontSize: 13 }} placeholder="One certification per line" />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// ─── MAIN APP ──────────────────────────────────────────────────────────────────
export default function App() {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [screen, setScreen] = useState("boot");
  const [page, setPage] = useState("overview");
  const [showAuth, setShowAuth] = useState(false);
  const [resumes, setResumes] = useState([]);
  const [resumesLoaded, setResumesLoaded] = useState(false);

  const [jobData, setJobData] = useState(null);
  const [activeResume, setActiveResume] = useState(null);
  const [savedResumeId, setSavedResumeId] = useState(null);
  const [genStage, setGenStage] = useState(0);
  const [aiProvider, setAiProvider] = useState(null);
  const timer = useRef(null);


  const setRoute = useCallback((path) => {
    window.history.pushState({}, "", `/${path}`);
  }, []);

  useEffect(() => {
    const bootTimer = setTimeout(() => { if (screen === "boot") setScreen("landing"); }, 3000);

    supabase.auth.getSession().then(async ({ data: { session } }) => {
      clearTimeout(bootTimer);
      const u = session?.user ?? null;
      setUser(u);
      if (u) {
        await upsertProfile(u);
        const p = await fetchProfile(u.id);
        setProfile(p);
        setScreen("dashboard");
        setRoute("dashboard");
      } else {
        setScreen("landing");
        setRoute("");
      }
    }).catch(() => { clearTimeout(bootTimer); setScreen("landing"); });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      const u = session?.user ?? null;
      setUser(u);
      if (u) {
        await upsertProfile(u);
        const p = await fetchProfile(u.id);
        setProfile(p);
        setShowAuth(false);
        setScreen("dashboard");
        setPage("overview");
        setRoute("dashboard");
      } else {
        setUser(null); setProfile(null);
        setScreen("landing");
        setRoute("");
      }
    });

    return () => { clearTimeout(bootTimer); subscription.unsubscribe(); };
  }, []);

  useEffect(() => {
    if (user && !resumesLoaded) {
      fetchResumes(user.id).then(data => {
        setResumes(data);
        console.log("🧾 FINAL RESUME DATA:", data);
        setResumesLoaded(true);
      });
    }
  }, [user, resumesLoaded]);

  const signOut = async () => {
    if (timer.current) clearInterval(timer.current);
    await supabase.auth.signOut();
    setUser(null); setProfile(null); setResumes([]); setResumesLoaded(false);
    setScreen("landing"); setRoute("");
  };

  const goToBuild = () => { setScreen("build"); setRoute("build"); };

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
  const generate = useCallback(async (jd, company, candidateText) => {
    setScreen("generating");
    setGenStage(0);
    setAiProvider(null);
    timer.current = setInterval(() => setGenStage(s => s + 1), 2200);

    const fallback = buildOffline(candidateText, jd, company);

    // ✅ NEW: Guard against empty or garbled candidate text
    const textQuality = candidateText?.trim().length || 0;
    const looksLikeRealResume = textQuality > 200 &&
      (candidateText.includes("@") || // has email
        candidateText.match(/\b(experience|skills|education|project|work)\b/i)); // has resume keywords

    if (!looksLikeRealResume) {
      console.error("❌ candidateText looks empty or garbled. Length:", textQuality);
      clearInterval(timer.current);
      // Don't hallucinate — send user back with a clear message
      alert("We couldn't read your resume content. Please use 'Fill in details' instead, or upload a text-based PDF (not a scanned image).");
      setScreen("build");
      return;
    }

    try {
      const prompt = buildPrompt(company, jd, candidateText);
      const { text, provider } = await callAI(prompt);
      setAiProvider(provider);
      clearInterval(timer.current);

      console.log("🟢 AI succeeded via:", provider);
      console.log("🟢 Raw text length:", text.length);

      const parsed = extractJSON(text, null);

      if (!parsed) {
        console.warn("⚠️ JSON parse failed entirely, using offline fallback");
        setActiveResume(fallback);
        setScreen("builder");
        setRoute("builder");

        if (user) {
          saveResume(user.id, fallback, { co: company, jd }, "classic", "Lora", null)
            .then(saved => {
              if (saved) {
                setSavedResumeId(saved.id);
                fetchResumes(user.id).then(data => setResumes(data));
                fetchProfile(user.id).then(p => setProfile(p));
              }
            })
            .catch(() => { });
        }
      } else {
        const merged = {
          ...fallback,
          ...parsed,
          experience: parsed.experience?.length > 0 ? parsed.experience : fallback.experience,
          projects: Array.isArray(parsed.projects) && parsed.projects.length > 0 ? parsed.projects : fallback.projects,
          skills: {
            technical: parsed.skills?.technical?.length > 0 ? parsed.skills.technical : fallback.skills.technical,
            soft: parsed.skills?.soft?.length > 0 ? parsed.skills.soft : fallback.skills.soft,
            tools: parsed.skills?.tools?.length > 0 ? parsed.skills.tools : fallback.skills.tools,
          },
          education: parsed.education?.length > 0 ? parsed.education : fallback.education,
          certifications: Array.isArray(parsed.certifications) ? parsed.certifications : fallback.certifications,
          _engine: provider,
        };

        if (merged.experience) {
          merged.experience = merged.experience.filter(e =>
            e.company &&
            !["Previous Role", "Company Name"].includes(e.company) &&
            e.company.trim().length > 0
          );
        }

        console.log("✅ Final merged resume:", {
          name: merged.name,
          experienceCount: merged.experience?.length,
          projectCount: merged.projects?.length,
          engine: merged._engine,
        });

        // ✅ CRITICAL: navigate FIRST, save in background — never block on await
        setActiveResume(merged);
        setScreen("builder");
        setRoute("builder");

        if (user) {
          saveResume(user.id, merged, { co: company, jd }, "classic", "Lora", null)
            .then(saved => {
              if (saved) {
                setSavedResumeId(saved.id);
                fetchResumes(user.id).then(data => setResumes(data));
                fetchProfile(user.id).then(p => setProfile(p));
              }
            })
            .catch(saveErr => console.warn("Auto-save failed:", saveErr.message));
        }
      }

    } catch (err) {
      clearInterval(timer.current);
      console.error("🚨 generate() caught error:", err.message);

      setActiveResume(fallback);
      setScreen("builder");
      setRoute("builder");

      if (user) {
        saveResume(user.id, fallback, { co: company, jd }, "classic", "Lora", null)
          .then(saved => {
            if (saved) {
              setSavedResumeId(saved.id);
              fetchResumes(user.id).then(data => setResumes(data));
              fetchProfile(user.id).then(p => setProfile(p));
            }
          })
          .catch(() => { });
      }
    }
    // ✅ No setScreen/setRoute here — each branch handles its own navigation
  }, [user]);

  const handleJobNext = (d) => {
    setJobData(d);
    if (d.mode === "questionnaire") { setScreen("questionnaire"); setRoute("build/questions"); }
    else { generate(d.jd, d.co, d.fileText || ""); }
  };

  const handlePlanSuccess = async () => {
    if (user) { const p = await fetchProfile(user.id); setProfile(p); }
  };

  // Boot screen
  if (screen === "boot") return (
    <>
      <GS />
      <div style={{ height: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: C.bg, flexDirection: "column", gap: 16 }}>
        <div style={{ width: 50, height: 50, background: C.brown, borderRadius: 13, display: "flex", alignItems: "center", justifyContent: "center", animation: "float 2.5s ease-in-out infinite" }}>
          <Icon n="spark" s={24} c="#fdf9f5" />
        </div>
        <Spinner s={20} c={C.accent} />
      </div>
    </>
  );

  if (screen === "landing") return (
    <><GS />{showAuth && <AuthModal onClose={() => setShowAuth(false)} />}<Landing onSignIn={() => setShowAuth(true)} /></>
  );

  if (screen === "build") return (
    <><GS /><JobInputPage onNext={handleJobNext} onBack={() => { setScreen("dashboard"); setRoute("dashboard"); }} /></>
  );

  if (screen === "questionnaire") return (
    <><GS /><QuestionnairePage company={jobData?.co} onDone={(ct) => generate(jobData.jd, jobData.co, ct)} onBack={() => setScreen("build")} /></>
  );

  if (screen === "generating") return (
    <><GS /><GeneratingScreen stage={genStage} provider={aiProvider} company={jobData?.co} /></>
  );

  if (screen === "builder" && activeResume) return (
    <><GS /><BuilderPage resume={activeResume} jobData={jobData} user={user} savedId={savedResumeId} onBack={() => {
      setScreen("dashboard"); setPage("resumes"); setRoute("dashboard/resumes");
      if (user) fetchResumes(user.id).then(data => setResumes(data));
    }} /></>
  );

  if (screen === "dashboard" && user) {
    const renderPage = () => {
      switch (page) {
        case "overview": return <OverviewPage user={user} profile={profile} resumes={resumes} onBuild={goToBuild} onOpenResume={openResume} />;
        case "resumes": return <ResumesPage profile={profile} resumes={resumes} setResumes={setResumes} onBuild={goToBuild} onOpen={openResume} />;
        case "plan": return <PlanPage user={user} profile={profile} onPlanSuccess={handlePlanSuccess} />;
        default: return <OverviewPage user={user} profile={profile} resumes={resumes} onBuild={goToBuild} onOpenResume={openResume} />;
      }
    };

    return (
      <>
        <GS />
        {showAuth && <AuthModal onClose={() => setShowAuth(false)} />}
        <DashboardLayout user={user} profile={profile} onSignOut={signOut} page={page} onNav={navTo}>
          {renderPage()}
        </DashboardLayout>
      </>
    );
  }

  return (
    <><GS /><div style={{ height: "100vh", background: C.bg, display: "flex", alignItems: "center", justifyContent: "center" }}><Spinner s={24} c={C.accent} /></div></>
  );
}