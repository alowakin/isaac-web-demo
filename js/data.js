/* Shared data + availability engine for the demo.
   In production this would be replaced by the clinic's EHR / HIPAA-compliant
   scheduling API. Here everything lives in the browser (localStorage). */
(function () {
  const STORE_KEY = "pfm-demo-v1";

  const CLINIC = {
    name: "Papillion Family Medicine",
    phone: "(402) 502-3600",
    phoneHref: "tel:+14025023600",
    fax: "(402) 502-3606",
    address: "555 Fortune Drive, Papillion, NE 68046",
    // Office hours: Mon–Fri, two blocks with a lunch break
    blocks: {
      am: { label: "Morning", start: "08:30", end: "12:00" },
      pm: { label: "Afternoon", start: "13:00", end: "16:30" },
    },
    holidays: ["2026-11-26", "2026-11-27", "2026-12-24", "2026-12-25", "2026-12-31", "2027-01-01"],
    bookingWindowDays: 28,
    minLeadMinutes: 120,
  };

  const VISIT_TYPES = [
    { id: "new", name: "New patient visit", desc: "First visit, history & exam", minutes: 40 },
    { id: "sick", name: "Sick visit", desc: "Cold, flu, sinus, infections", minutes: 20 },
    { id: "physical", name: "Annual physical", desc: "Wellness & preventive care", minutes: 40 },
    { id: "followup", name: "Follow-up / chronic care", desc: "Diabetes, blood pressure, cholesterol", minutes: 20 },
    { id: "sport", name: "School, sports or work physical", desc: "Forms completed same day", minutes: 20 },
    { id: "child", name: "Well-child & immunizations", desc: "Infants, kids & teens", minutes: 20 },
    { id: "women", name: "Well-woman / Pap exam", desc: "Women's health", minutes: 40 },
    { id: "injury", name: "Injury or pain", desc: "Sprains, back & neck pain, work comp", minutes: 20 },
  ];

  const DEFAULT_PROVIDERS = [
    {
      id: "mantler", name: "Dr. Mantler", initials: "M", title: "Family Physician · Co-founder",
      slotMinutes: 20, acceptingNew: true,
      week: { 1: { on: true, am: true, pm: true }, 2: { on: true, am: true, pm: true }, 3: { on: true, am: true, pm: false },
              4: { on: true, am: true, pm: true }, 5: { on: true, am: true, pm: true } },
      timeOff: [],
    },
    {
      id: "naegele", name: "Dr. Naegele", initials: "N", title: "Family Physician · Co-founder",
      slotMinutes: 20, acceptingNew: true,
      week: { 1: { on: true, am: true, pm: true }, 2: { on: true, am: true, pm: true }, 3: { on: true, am: true, pm: true },
              4: { on: true, am: true, pm: true }, 5: { on: false, am: false, pm: false } },
      timeOff: [],
    },
  ];

  /* ---------- storage (fails gracefully in private mode) ---------- */
  function load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) { /* ignore */ }
    return null;
  }
  // settings.mode: "instant" = patient books directly, "request" = staff call to confirm
  const fresh = () => ({ providers: structuredClone(DEFAULT_PROVIDERS), bookings: [], settings: { mode: "request" } });
  let state = load() || fresh();
  state.settings = state.settings || { mode: "request" };
  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) { /* ignore */ }
  }
  function reset() { state = fresh(); save(); }

  /* ---------- date helpers ---------- */
  const pad = (n) => String(n).padStart(2, "0");
  const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const toMin = (hhmm) => { const [h, m] = hhmm.split(":").map(Number); return h * 60 + m; };
  const fmtTime = (min) => {
    const h = Math.floor(min / 60), m = min % 60, ap = h >= 12 ? "PM" : "AM";
    return `${((h + 11) % 12) + 1}:${pad(m)} ${ap}`;
  };
  const fmtDateLong = (d) => d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
  const parseYmd = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };

  // Deterministic pseudo-random "already booked" slots so the calendar looks realistic
  function hash(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return (h >>> 0) / 4294967295;
  }
  function isFakeBooked(pid, date, min) { return hash(`${pid}|${date}|${min}`) < 0.42; }

  function isRealBooked(pid, date, start, end) {
    return state.bookings.some((b) => b.providerId === pid && b.date === date && b.start < end && start < b.end);
  }

  // Time off is a list of ranges {start, end, note}; plain "YYYY-MM-DD" strings (older saves) still work
  function isOff(provider, date) {
    return provider.timeOff.some((t) => typeof t === "string" ? t === date : date >= t.start && date <= t.end);
  }

  /* ---------- availability engine ---------- */
  function providerSlots(provider, dateObj, visitMinutes) {
    const date = ymd(dateObj);
    const dow = dateObj.getDay();
    const day = provider.week[dow];
    if (!day || !day.on) return [];
    if (CLINIC.holidays.includes(date) || isOff(provider, date)) return [];

    const now = new Date();
    const nowMin = ymd(now) === date ? now.getHours() * 60 + now.getMinutes() + CLINIC.minLeadMinutes : -1;
    const step = provider.slotMinutes;
    const need = Math.ceil(visitMinutes / step);
    const out = [];

    ["am", "pm"].forEach((key) => {
      if (!day[key]) return;
      const bStart = toMin(CLINIC.blocks[key].start), bEnd = toMin(CLINIC.blocks[key].end);
      for (let t = bStart; t + need * step <= bEnd; t += step) {
        if (t < nowMin) continue;
        let free = true;
        for (let k = 0; k < need; k++) {
          if (isFakeBooked(provider.id, date, t + k * step)) { free = false; break; }
        }
        if (free && isRealBooked(provider.id, date, t, t + visitMinutes)) free = false;
        if (free) out.push({ providerId: provider.id, date, start: t, end: t + visitMinutes, block: key });
      }
    });
    return out;
  }

  // providerId may be "any" -> merge, keeping the first provider free at each time
  function slotsFor(providerId, dateObj, visitMinutes, newPatient) {
    const list = state.providers.filter((p) => (providerId === "any" || p.id === providerId) && (!newPatient || p.acceptingNew));
    const byTime = new Map();
    list.forEach((p) => providerSlots(p, dateObj, visitMinutes).forEach((s) => {
      if (!byTime.has(s.start)) byTime.set(s.start, s);
    }));
    return [...byTime.values()].sort((a, b) => a.start - b.start);
  }

  function addBooking(b) {
    const rec = {
      ...b, id: "PFM-" + Math.random().toString(36).slice(2, 8).toUpperCase(), createdAt: new Date().toISOString(),
      status: state.settings.mode === "request" ? "requested" : "confirmed",
    };
    state.bookings.push(rec);
    save();
    return rec;
  }

  window.PFM = {
    CLINIC, VISIT_TYPES,
    get state() { return state; },
    save, reset, slotsFor, addBooking, isOff,
    util: { ymd, toMin, fmtTime, fmtDateLong, parseYmd, pad },
    provider: (id) => state.providers.find((p) => p.id === id),
    visit: (id) => VISIT_TYPES.find((v) => v.id === id),
  };
})();
