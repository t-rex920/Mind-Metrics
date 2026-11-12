/* =========================================================
   MindMetrics – frontend logic (vanilla JS)
   ========================================================= */

const API_URL = "https://mind-metrics-doc6.onrender.com/predict"; // FastAPI endpoint
const MAX_SCORE = 10;                            // gauge scale (0–10)
const GAUGE_LENGTH = 540.35;                     // circumference of r=86 circle

/* ---------- DOM references ---------- */
const $ = (id) => document.getElementById(id);
const form = $("predictForm");
const formView = $("formView");
const resultView = $("resultView");
const loader = $("loader");
const toast = $("toast");
const submitBtn = $("submitBtn");

/* ---------- Country list (popular first, then A–Z) ---------- */
const POPULAR = ["India", "USA", "Canada", "Australia", "UK", "Germany", "Mexico", "Turkey", "France"];
const OTHERS = [
  "Afghanistan","Albania","Algeria","Argentina","Armenia","Austria","Azerbaijan","Bahamas","Bahrain","Bangladesh",
  "Belarus","Belgium","Bhutan","Bolivia","Bosnia","Brazil","Bulgaria","Chile","China","Colombia","Costa Rica",
  "Croatia","Cyprus","Czech Republic","Denmark","Ecuador","Egypt","Estonia","Finland","Georgia","Ghana","Greece",
  "Hong Kong","Hungary","Iceland","Indonesia","Iraq","Ireland","Israel","Italy","Jamaica","Japan","Jordan",
  "Kazakhstan","Kenya","Kuwait","Kyrgyzstan","Latvia","Lebanon","Liechtenstein","Lithuania","Luxembourg","Malaysia",
  "Maldives","Malta","Moldova","Monaco","Montenegro","Morocco","Nepal","Netherlands","New Zealand","Nigeria",
  "North Macedonia","Norway","Oman","Pakistan","Panama","Paraguay","Peru","Philippines","Poland","Portugal",
  "Qatar","Romania","Russia","San Marino","Saudi Arabia","Serbia","Singapore","Slovakia","Slovenia","South Africa",
  "South Korea","Spain","Sri Lanka","Sweden","Switzerland","Syria","Taiwan","Tajikistan","Thailand","Trinidad",
  "Ukraine","UAE","Uruguay","Uzbekistan","Vatican City","Venezuela","Vietnam","Yemen","Zimbabwe","Other"
];

(function buildCountrySelect() {
  const sel = $("country");
  const group = (label, list) => {
    const g = document.createElement("optgroup");
    g.label = label;
    list.forEach((c) => g.append(new Option(c, c)));
    sel.append(g);
  };
  group("Popular", POPULAR);
  group("All countries", OTHERS);
})();

/* ---------- Range sliders: live value + filled track ---------- */
document.querySelectorAll(".range").forEach((range) => {
  const out = document.querySelector(`[data-out="${range.id}"]`);
  const update = () => {
    const pct = ((range.value - range.min) / (range.max - range.min)) * 100;
    range.style.setProperty("--p", pct + "%");
    out.textContent = `${range.value} h`;
  };
  range.addEventListener("input", update);
  update();
});

/* ---------- Validation helpers ---------- */
function setError(name, msg) {
  const el = document.querySelector(`[data-error-for="${name}"]`);
  if (!el) return;
  el.textContent = msg || "";
  const field = el.closest(".field");
  if (field) {
    field.classList.remove("invalid");
    if (msg) { void field.offsetWidth; field.classList.add("invalid"); } // restart shake
  }
}
const clearErrors = () => document.querySelectorAll("[data-error-for]").forEach((e) => setError(e.dataset.errorFor, ""));

/** Client-side validation mirroring the Pydantic rules. Returns payload or null. */
function collectAndValidate() {
  clearErrors();
  const fd = new FormData(form);
  const errors = {};

  const age = fd.get("age");
  if (age === "" || age === null) errors.age = "Age is required.";
  else if (!Number.isInteger(+age) || +age < 10 || +age > 100) errors.age = "Enter a whole number between 10 and 100.";

  const unlocks = fd.get("daily_unlocks");
  if (unlocks === "" || unlocks === null) errors.daily_unlocks = "Please enter your daily unlocks.";
  else if (!Number.isInteger(+unlocks) || +unlocks < 0) errors.daily_unlocks = "Enter a whole number of 0 or more.";

  ["country", "gender", "academic_level", "most_used_platform", "purpose_of_use", "stress_level"].forEach((k) => {
    if (!fd.get(k)) errors[k] = "Please choose an option.";
  });

  Object.entries(errors).forEach(([k, v]) => setError(k, v));
  if (Object.keys(errors).length) {
    // focus the first invalid field for accessibility
    const first = document.querySelector(".field.invalid");
    first?.scrollIntoView({ behavior: "smooth", block: "center" });
    return null;
  }

  // Build the payload with the exact types the StudentData model expects
  return {
    age: parseInt(age, 10),
    gender: fd.get("gender"),
    country: fd.get("country"),
    academic_level: fd.get("academic_level"),
    most_used_platform: fd.get("most_used_platform"),
    purpose_of_use: fd.get("purpose_of_use"),
    avg_daily_usage_hours: parseFloat(fd.get("avg_daily_usage_hours")),
    daily_unlocks: parseInt(unlocks, 10),
    study_hours: parseFloat(fd.get("study_hours")),
    physical_activity_hours: parseFloat(fd.get("physical_activity_hours")),
    sleep_hours_per_night: parseFloat(fd.get("sleep_hours_per_night")),
    stress_level: fd.get("stress_level"),
  };
}

// Clear a field's error as soon as the user fixes it
form.addEventListener("input", (e) => e.target.name && setError(e.target.name, ""));

/* ---------- Toast ---------- */
let toastTimer;
function showToast(msg) {
  toast.textContent = msg;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toast.hidden = true), 6000);
}

/* ---------- Smooth view switching ---------- */
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function switchView(from, to) {
  from.classList.add("leave");           // fade/slide out
  await wait(420);
  from.hidden = true;
  from.classList.remove("leave");
  to.classList.add("enter");             // prepare incoming state
  to.hidden = false;
  void to.offsetWidth;                   // force reflow so transition runs
  to.classList.remove("enter");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

/* ---------- Loader ---------- */
const LOADER_MESSAGES = ["Analysing your inputs…", "Consulting the model…", "Crunching the numbers…", "Almost there…"];
let loaderInterval;
function showLoader(on) {
  loader.hidden = !on;
  submitBtn.disabled = on;
  clearInterval(loaderInterval);
  if (on) {
    let i = 0;
    $("loaderText").textContent = LOADER_MESSAGES[0];
    loaderInterval = setInterval(() => ($("loaderText").textContent = LOADER_MESSAGES[++i % LOADER_MESSAGES.length]), 1400);
  }
}

/* ---------- API call ---------- */
async function requestPrediction(payload) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000); // 20s timeout
  try {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const data = await res.json().catch(() => null);

    if (res.status === 422 && data?.detail) {
      // FastAPI validation error → show messages under each field
      const generic = [];
      data.detail.forEach((d) => {
        const field = d.loc?.[d.loc.length - 1];
        if (document.querySelector(`[data-error-for="${field}"]`)) setError(field, d.msg);
        else generic.push(d.msg);
      });
      const err = new Error(generic.join(" ") || "Some inputs are invalid. Please check the highlighted fields.");
      err.handled = true;
      throw err;
    }
    if (!res.ok) throw new Error(data?.detail?.toString() || `Server error (${res.status}). Please try again.`);
    if (typeof data?.predicted_mental_health_score !== "number") throw new Error("Unexpected response from the server.");
    return data.predicted_mental_health_score;
  } catch (err) {
    if (err.name === "AbortError") throw new Error("The request timed out. Is the server running?");
    if (err instanceof TypeError) throw new Error("Cannot reach the backend. Please check your internet connection or try again later.");
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

/* ---------- Result presentation ---------- */
function describeScore(s) {
  // Score tiers → colour, label, message and tips
  if (s >= 8) return { tier: "great", badge: "Excellent", title: "You're thriving! 🌟",
    msg: "Your habits point to a strong mental well-being. Keep up the balance you've built.",
    tips: ["🛌 Keep your sleep routine consistent.", "🏃 Stay active — it's clearly working for you.", "🤝 Share your habits with friends who may need them."] };
  if (s >= 6) return { tier: "good", badge: "Good", title: "You're doing well 👍",
    msg: "Your score is healthy, with a little room to improve. Small tweaks can make a big difference.",
    tips: ["📵 Try short screen-free breaks each day.", "🏃 Add 20–30 minutes of movement.", "😴 Aim for 7–9 hours of sleep."] };
  if (s >= 4) return { tier: "fair", badge: "Moderate", title: "Room to improve 🌱",
    msg: "Some of your daily patterns may be affecting your well-being. Consider gentle, realistic changes.",
    tips: ["⏳ Reduce daily social media time step by step.", "🌙 Protect your sleep — keep phones away at night.", "💬 Talk to someone you trust about how you feel."] };
  return { tier: "low", badge: "Needs attention", title: "Time for self-care 💜",
    msg: "Your inputs suggest your well-being could be under strain. You're not alone — support is available.",
    tips: ["🧑‍⚕️ Consider speaking with a counsellor or doctor.", "📵 Set clear limits on social media use.", "🫂 Lean on friends, family or campus support."] };
}

function renderResult(score) {
  const info = describeScore(score);
  const result = document.querySelector(".result");

  // reset state so the animation can replay on repeated predictions
  result.className = `result tier-${info.tier}`;
  void result.offsetWidth;
  result.classList.add("animate");

  $("resultBadge").textContent = info.badge;
  $("resultTitle").textContent = info.title;
  $("resultMsg").textContent = info.msg;
  $("resultTips").innerHTML = info.tips.map((t) => `<li>${t}</li>`).join("");

  // Gauge fill + animated count-up
  const bar = $("gaugeBar");
  bar.style.transition = "none";
  bar.style.strokeDashoffset = GAUGE_LENGTH;
  void bar.getBoundingClientRect();
  bar.style.transition = "";
  const pct = Math.min(Math.max(score / MAX_SCORE, 0), 1);
  requestAnimationFrame(() => (bar.style.strokeDashoffset = GAUGE_LENGTH * (1 - pct)));

  countUp($("scoreValue"), score, 1800);
}

function countUp(el, target, duration) {
  const start = performance.now();
  const step = (now) => {
    const t = Math.min((now - start) / duration, 1);
    const eased = 1 - Math.pow(1 - t, 3); // ease-out cubic
    el.textContent = (target * eased).toFixed(2);
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

/* ---------- Submit / Back handlers ---------- */
form.addEventListener("submit", async (e) => {
  e.preventDefault();
  toast.hidden = true;
  const payload = collectAndValidate();
  if (!payload) return;

  showLoader(true);
  try {
    // keep the loader visible at least ~1.2s so the animation feels smooth
    const [score] = await Promise.all([requestPrediction(payload), wait(1200)]);
    showLoader(false);
    await switchView(formView, resultView);
    renderResult(score);
  } catch (err) {
    showLoader(false);
    showToast(err.message);
    if (err.handled) document.querySelector(".field.invalid")?.scrollIntoView({ behavior: "smooth", block: "center" });
  }
});

$("backBtn").addEventListener("click", () => switchView(resultView, formView));

/* =========================================================
   Animated background: floating "neural network" particles
   ========================================================= */
(function particles() {
  const canvas = $("bgCanvas");
  const ctx = canvas.getContext("2d");
  let w, h, dots;

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = canvas.width = innerWidth * dpr;
    h = canvas.height = innerHeight * dpr;
    canvas.style.width = innerWidth + "px";
    canvas.style.height = innerHeight + "px";
    const count = Math.round(Math.min(90, (innerWidth * innerHeight) / 16000));
    dots = Array.from({ length: count }, () => ({
      x: Math.random() * w, y: Math.random() * h,
      vx: (Math.random() - 0.5) * 0.35 * dpr, vy: (Math.random() - 0.5) * 0.35 * dpr,
      r: (Math.random() * 1.6 + 0.8) * dpr,
    }));
  }

  function frame() {
    ctx.clearRect(0, 0, w, h);
    const link = 150 * (w / innerWidth);
    for (let i = 0; i < dots.length; i++) {
      const a = dots[i];
      a.x += a.vx; a.y += a.vy;
      if (a.x < 0 || a.x > w) a.vx *= -1;     // bounce off edges
      if (a.y < 0 || a.y > h) a.vy *= -1;

      ctx.beginPath();
      ctx.arc(a.x, a.y, a.r, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(190, 210, 255, 0.75)";
      ctx.fill();

      for (let j = i + 1; j < dots.length; j++) { // connect nearby dots
        const b = dots[j];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (d < link) {
          ctx.strokeStyle = `rgba(140, 170, 255, ${(1 - d / link) * 0.25})`;
          ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        }
      }
    }
    requestAnimationFrame(frame);
  }

  addEventListener("resize", resize);
  resize();
  if (!matchMedia("(prefers-reduced-motion: reduce)").matches) frame();
})();
