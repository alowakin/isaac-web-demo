(function () {
  const { CLINIC, VISIT_TYPES, slotsFor, addBooking, util, provider, visit, state } = window.PFM;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];

  const sel = { ptype: "returning", visitId: null, providerId: null, date: null, slot: null };
  let step = 1;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  let weekStart = startOfWeek(today);

  function startOfWeek(d) { const x = new Date(d); x.setDate(x.getDate() - x.getDay()); return x; }
  function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
  const lastBookable = addDays(today, CLINIC.bookingWindowDays);

  // Preselect provider from ?provider=
  const qp = new URLSearchParams(location.search).get("provider");
  if (qp && provider(qp)) sel.providerId = qp;

  /* ---------- Step navigation ---------- */
  function go(n) {
    step = n;
    $$(".step").forEach((s) => s.classList.toggle("active", +s.dataset.step === n));
    $$(".stepper li").forEach((li, i) => { li.className = i + 1 < n ? "done" : i + 1 === n ? "active" : ""; });
    if (n === 3) renderCalendar();
    window.scrollTo({ top: 0, behavior: "smooth" });
    const h = $(`.step[data-step="${n}"] h2`); if (h) { h.setAttribute("tabindex", "-1"); h.focus({ preventScroll: true }); }
    updateSummary();
  }
  $$("[data-next]").forEach((b) => b.addEventListener("click", () => go(step + 1)));
  $$("[data-back]").forEach((b) => b.addEventListener("click", () => go(step - 1)));
  const nextBtn = (n) => $(`.step[data-step="${n}"] [data-next]`);

  /* ---------- Step 1: visit type ---------- */
  function renderVisits() {
    const grid = $("#visitGrid");
    grid.innerHTML = VISIT_TYPES
      .filter((v) => sel.ptype === "new" ? true : v.id !== "new")
      .map((v) => `<button type="button" class="choice${sel.visitId === v.id ? " selected" : ""}" data-id="${v.id}" aria-pressed="${sel.visitId === v.id}">
          <strong>${v.name}</strong><span>${v.desc}</span><span class="meta">${v.minutes} min</span></button>`).join("");
    $$(".choice", grid).forEach((c) => c.addEventListener("click", () => {
      sel.visitId = c.dataset.id; sel.slot = null; renderVisits(); nextBtn(1).disabled = false; updateSummary();
    }));
    nextBtn(1).disabled = !sel.visitId;
  }
  $$('input[name="ptype"]').forEach((r) => r.addEventListener("change", () => {
    sel.ptype = r.value;
    if (sel.ptype === "new") sel.visitId = "new";
    else if (sel.visitId === "new") sel.visitId = null;
    sel.slot = null;
    renderVisits(); renderProviders(); updateSummary();
  }));

  /* ---------- Step 2: provider ---------- */
  function renderProviders() {
    const grid = $("#providerGrid");
    const list = state.providers.filter((p) => sel.ptype !== "new" || p.acceptingNew);
    const cards = [{ id: "any", name: "First available", title: "Fastest way to be seen", initials: "★" }, ...list];
    grid.innerHTML = cards.map((p, i) => `<button type="button" class="choice${sel.providerId === p.id ? " selected" : ""}" data-id="${p.id}" aria-pressed="${sel.providerId === p.id}">
        <div class="avatar ${p.id === "any" ? "any" : i % 2 === 0 ? "alt" : ""}">${p.initials}</div>
        <strong>${p.name}</strong><span>${p.title}</span>
        ${p.id !== "any" && sel.ptype === "new" ? '<span class="meta">Accepting new patients</span>' : ""}</button>`).join("");
    $$(".choice", grid).forEach((c) => c.addEventListener("click", () => {
      sel.providerId = c.dataset.id; sel.slot = null; renderProviders(); nextBtn(2).disabled = false; updateSummary();
    }));
    if (sel.providerId && !cards.some((c) => c.id === sel.providerId)) sel.providerId = null;
    nextBtn(2).disabled = !sel.providerId;
  }

  /* ---------- Step 3: calendar + slots ---------- */
  const visitMin = () => visit(sel.visitId).minutes;
  const daySlots = (d) => (d < today || d > lastBookable) ? [] : slotsFor(sel.providerId, d, visitMin(), sel.ptype === "new");

  function renderCalendar() {
    // Auto-jump to first week with availability
    if (!sel.date) {
      for (let i = 0; i <= CLINIC.bookingWindowDays; i++) {
        const d = addDays(today, i);
        if (daySlots(d).length) { sel.date = d; weekStart = startOfWeek(d); break; }
      }
    }
    const days = [...Array(7)].map((_, i) => addDays(weekStart, i));
    const end = days[6];
    $("#weekLabel").textContent = weekStart.getMonth() === end.getMonth()
      ? `${weekStart.toLocaleDateString("en-US", { month: "long" })} ${weekStart.getDate()}–${end.getDate()}`
      : `${weekStart.toLocaleDateString("en-US", { month: "short", day: "numeric" })} – ${end.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
    $("#prevWeek").disabled = weekStart <= startOfWeek(today);
    $("#nextWeek").disabled = addDays(weekStart, 7) > lastBookable;

    $("#dateStrip").innerHTML = days.map((d) => {
      const n = daySlots(d).length;
      const isSel = sel.date && util.ymd(d) === util.ymd(sel.date);
      const closed = CLINIC.holidays.includes(util.ymd(d));
      return `<button type="button" class="date-btn${isSel ? " selected" : ""}" data-d="${util.ymd(d)}" ${n ? "" : "disabled"}
          aria-label="${util.fmtDateLong(d)}, ${n ? n + " times available" : "no availability"}">
          <small>${d.toLocaleDateString("en-US", { weekday: "short" })}</small><b>${d.getDate()}</b>
          <span class="avail">${n ? n + " open" : closed ? "Holiday" : "—"}</span></button>`;
    }).join("");
    $$(".date-btn").forEach((b) => b.addEventListener("click", () => {
      sel.date = util.parseYmd(b.dataset.d); sel.slot = null; renderCalendar(); updateSummary();
    }));
    renderSlots();
  }
  $("#prevWeek").addEventListener("click", () => { weekStart = addDays(weekStart, -7); renderCalendar(); });
  $("#nextWeek").addEventListener("click", () => { weekStart = addDays(weekStart, 7); renderCalendar(); });

  function renderSlots() {
    const area = $("#slotArea");
    const inWeek = sel.date && sel.date >= weekStart && sel.date < addDays(weekStart, 7);
    if (!inWeek) { area.innerHTML = `<div class="empty" style="margin-top:20px">Select a day above to see open times.</div>`; nextBtn(3).disabled = true; return; }
    const slots = daySlots(sel.date);
    if (!slots.length) { area.innerHTML = `<div class="empty" style="margin-top:20px">No openings this day. Try another date or call us.</div>`; nextBtn(3).disabled = true; return; }
    const groups = { am: slots.filter((s) => s.block === "am"), pm: slots.filter((s) => s.block === "pm") };
    const showProv = sel.providerId === "any";
    area.innerHTML = `<div class="slots-head">${util.fmtDateLong(sel.date)}<span>${slots.length} times available · ${visitMin()} min visit</span></div>` +
      ["am", "pm"].filter((k) => groups[k].length).map((k) => `<div class="slot-group"><h5>${CLINIC.blocks[k].label}</h5><div class="slots">` +
        groups[k].map((s) => {
          const isSel = sel.slot && sel.slot.start === s.start && sel.slot.date === s.date;
          return `<button type="button" class="slot${isSel ? " selected" : ""}" data-start="${s.start}" aria-pressed="${!!isSel}">${util.fmtTime(s.start)}${showProv ? `<small>${provider(s.providerId).name}</small>` : ""}</button>`;
        }).join("") + `</div></div>`).join("");
    $$(".slot", area).forEach((b) => b.addEventListener("click", () => {
      sel.slot = slots.find((s) => s.start === +b.dataset.start); renderSlots(); updateSummary();
    }));
    nextBtn(3).disabled = !sel.slot;
  }

  /* ---------- Summary ---------- */
  function setVal(id, text) { const el = $(id); el.textContent = text || "Not selected yet"; el.classList.toggle("empty-val", !text); }
  function updateSummary() {
    const v = sel.visitId && visit(sel.visitId);
    setVal("#sumVisit", v ? `${v.name} · ${v.minutes} min` : "");
    const pid = sel.slot ? sel.slot.providerId : sel.providerId;
    setVal("#sumProv", pid ? (pid === "any" ? "First available" : provider(pid).name) : "");
    setVal("#sumTime", sel.slot ? `${util.fmtDateLong(util.parseYmd(sel.slot.date))} at ${util.fmtTime(sel.slot.start)}` : "");
  }

  /* ---------- Step 4: details ---------- */
  const form = $("#detailsForm");
  const phoneOk = (v) => v.replace(/\D/g, "").length >= 10;
  const emailOk = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
  $("#phone").addEventListener("input", (e) => {
    const d = e.target.value.replace(/\D/g, "").slice(0, 10);
    e.target.value = d.length > 6 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : d.length > 3 ? `(${d.slice(0, 3)}) ${d.slice(3)}` : d;
  });
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    let ok = true;
    const check = (id, valid) => { const f = $("#" + id).closest(".field"); f.classList.toggle("invalid", !valid); if (!valid) ok = false; };
    check("fname", $("#fname").value.trim());
    check("lname", $("#lname").value.trim());
    check("dob", $("#dob").value);
    check("phone", phoneOk($("#phone").value));
    check("email", emailOk($("#email").value));
    check("insurance", $("#insurance").value);
    if (!$("#consent").checked) { ok = false; toast("Please check the agreement box to continue"); }
    if (!ok) { const f = $(".field.invalid input, .field.invalid select"); if (f) f.focus(); return; }

    const rec = addBooking({
      providerId: sel.slot.providerId, date: sel.slot.date, start: sel.slot.start, end: sel.slot.end,
      visitId: sel.visitId, patientType: sel.ptype,
      patient: { first: $("#fname").value.trim(), last: $("#lname").value.trim(), phone: $("#phone").value, email: $("#email").value.trim() },
      insurance: $("#insurance").value, remind: $("#remind").value,
    });
    showConfirmation(rec);
  });

  function showConfirmation(rec) {
    const v = visit(rec.visitId), p = provider(rec.providerId), d = util.parseYmd(rec.date);
    const pending = rec.status === "requested";
    $("#confirmTitle").textContent = pending ? "Request received!" : "You're all set!";
    $("#confirmMsg").textContent = pending
      ? `Thanks, ${rec.patient.first}! Your preferred time is on hold. Our front desk will call you at ${rec.patient.phone} within one business day to confirm.`
      : `Thanks, ${rec.patient.first}! A confirmation ${rec.remind === "Email" ? "email" : "text"} would be sent to you now, with a reminder the day before.`;
    $("#confirmDetails").innerHTML = [
      [pending ? "Request #" : "Confirmation #", rec.id], ["Status", pending ? "Waiting for staff to confirm" : "Confirmed"],
      ["Visit", v.name], ["Provider", p.name],
      [pending ? "Preferred date" : "Date", util.fmtDateLong(d)], [pending ? "Preferred time" : "Time", util.fmtTime(rec.start)],
      ["Where", "555 Fortune Drive, Papillion"],
    ].map(([a, b]) => `<div><span>${a}</span><span>${b}</span></div>`).join("");
    $("#icsBtn").style.display = pending ? "none" : "";
    $("#arriveMin").textContent = rec.patientType === "new" ? "15" : "5";
    $("#icsBtn").onclick = () => downloadIcs(rec, v, p);
    $(".summary").style.display = "none";
    $(".stepper").style.visibility = "hidden";
    go(5);
  }

  function downloadIcs(rec, v, p) {
    const d = rec.date.replace(/-/g, "");
    const t = (m) => `${util.pad(Math.floor(m / 60))}${util.pad(m % 60)}00`;
    const ics = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//PFM Demo//EN", "BEGIN:VEVENT",
      `UID:${rec.id}@pfm-demo`, `DTSTART:${d}T${t(rec.start)}`, `DTEND:${d}T${t(rec.end)}`,
      `SUMMARY:${v.name} with ${p.name}`, `LOCATION:${CLINIC.address}`,
      `DESCRIPTION:Papillion Family Medicine ${CLINIC.phone}. Confirmation ${rec.id}`, "END:VEVENT", "END:VCALENDAR"].join("\r\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([ics], { type: "text/calendar" }));
    a.download = "papillion-appointment.ics"; a.click();
  }

  function toast(msg) {
    const t = $("#toast"); t.textContent = msg; t.classList.add("show");
    clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove("show"), 2800);
  }

  // Request mode: patients pick a preferred time, staff confirm by phone
  if (state.settings.mode === "request") {
    $("#s3h").textContent = "Pick your preferred time";
    $("#modeNote").style.display = "block";
    $("#submitBtn").textContent = "Send Request";
  }

  renderVisits(); renderProviders(); updateSummary();
})();
