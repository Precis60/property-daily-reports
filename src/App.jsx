import { useState, useEffect, useRef } from "react";
import {
  Check, X, AlertTriangle, Clock, Camera, Lock, ChevronRight,
  ChevronDown, ChevronLeft, Plus, Trash2, ArrowLeft, Sun, ClipboardList, Settings,
  CalendarDays, ImageOff, ShieldCheck, LogOut, Search, Building2, Users
} from "lucide-react";

/* ---------------------------------------------------------------
   PROPERTY MAINTENANCE — Daily Work Report system
   Worker view  -> submits a field report each day
   Manager view -> PIN-gated morning brief + full log (workers cannot see it)

   Storage is sharded by month (reports:YYYY-MM) so the app can run
   indefinitely — a year of daily reports never sits in one growing file.
---------------------------------------------------------------- */

const AREA_OPTIONS = [
  "Main Residence", "Front Garden", "Rear Garden", "Pool Area", "Tennis Court",
  "Orchard", "Vegetable Garden", "Driveways", "Workshop",
  "North Boundary", "South Boundary", "East Boundary", "West Boundary", "Other",
];
const WORKTYPE_OPTIONS = [
  "Hedging", "Mowing", "Weeding", "Irrigation", "Tree Work", "Planting",
  "Mulching", "Property Repair", "Cleaning", "Machinery", "Materials Collection", "Other",
];
const STATUS_OPTIONS = ["Complete", "Ongoing", "Waiting on materials", "Waiting on instruction"];
const TASK_COUNT_OPTIONS = ["1", "2", "3", "4", "5+"];
const MAX_TASKS = 12;
const STAFF_NAMES = ["Brett", "Chris"];
const DEFAULT_PIN = "2468";
const OPEN_CONTRACTOR_SLOTS = ["Contractor One", "Contractor Two"];
const DEFAULT_STAFF_PINS = { Brett: "1701", Chris: "2802", "Contractor One": "5501", "Contractor Two": "6602" };
const OUTSTANDING_LOOKBACK_DAYS = 90;

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
const todayISO = () => new Date().toISOString().slice(0, 10);
const emptyTask = () => ({
  id: uid(), area: "", areaOther: "", workType: "", workTypeOther: "",
  description: "", mode: "Alone", jointWith: [], jointWithOtherOn: false, jointWithOther: "",
  minutes: "", status: "Complete",
});

function hoursBetween(arrival, departure) {
  if (!arrival || !departure) return 0;
  const [ah, am] = arrival.split(":").map(Number);
  const [dh, dm] = departure.split(":").map(Number);
  let mins = (dh * 60 + dm) - (ah * 60 + am);
  if (mins < 0) mins += 24 * 60;
  return Math.round((mins / 60) * 100) / 100;
}
function fmtHours(h) { return `${h.toFixed(1)} hrs`; }
function normalizeAssignedTo(assignedTo) {
  if (Array.isArray(assignedTo)) return assignedTo;
  if (!assignedTo) return [];
  return [assignedTo];
}
function assignedToLabel(assignedTo) {
  const arr = normalizeAssignedTo(assignedTo);
  return arr.length === 0 ? "Anyone" : arr.join(", ");
}

function joinWithAnd(arr) {
  const items = arr.filter(Boolean);
  if (items.length === 0) return "";
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}
function fmtTime12(t) {
  if (!t) return "";
  const [h, m] = t.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${period}`;
}
function summarizeReport(report) {
  const name = report.workerName || report.workerType;
  const completeTasks = report.tasks.filter((t) => t.status === "Complete");
  const outstandingTasks = report.tasks.filter((t) => t.status !== "Complete");
  const taskPhrases = completeTasks.map((t) => `${t.workType.toLowerCase()} in ${t.area}`);

  let s = `${name} worked ${fmtHours(report.hours)} today`;
  if (report.arrival && report.departure) s += ` (${fmtTime12(report.arrival)}–${fmtTime12(report.departure)})`;
  s += `. `;

  if (completeTasks.length > 0) {
    s += `Completed ${completeTasks.length} of ${report.tasks.length} task${report.tasks.length === 1 ? "" : "s"}: ${joinWithAnd(taskPhrases)}. `;
  } else {
    s += `No tasks were marked complete today. `;
  }

  const jointTasks = report.tasks.filter((t) => t.mode === "Jointly" && t.jointWith?.length);
  if (jointTasks.length > 0) {
    const jointHours = jointTasks.reduce((sum, t) => sum + (t.minutes || 0), 0) / 60;
    const withWhom = joinWithAnd(Array.from(new Set(jointTasks.flatMap((t) => t.jointWith))));
    s += `${jointHours.toFixed(1)} hrs of this was joint work with ${withWhom}. `;
  }

  if (outstandingTasks.length > 0) {
    const outPhrases = outstandingTasks.map((t) => `${t.workType.toLowerCase()} in ${t.area} (${t.status.toLowerCase()})`);
    s += `Still outstanding: ${joinWithAnd(outPhrases)}. `;
  }

  s += report.delays === "Yes" ? `A delay was reported: ${report.delayExplain}${report.delayNotes ? ` ${report.delayNotes}` : ""} ` : `No delays were reported. `;
  s += report.fullCheck === "No" ? `An end-of-day property check was not completed. ` : report.fullCheck === "Yes" ? `A full end-of-day property check was completed. ` : "";
  if (report.tomorrow) s += `Planned for tomorrow: ${report.tomorrow}`;

  return s.trim();
}
function fmtDateLong(iso) {
  if (!iso) return "";
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "long" });
}
function fmtMonthLong(ym) {
  const [y, m] = ym.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-AU", { month: "long", year: "numeric" });
}
function monthOf(iso) { return iso.slice(0, 7); }
function addDays(iso, n) {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}
function addMonths(ym, n) {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function startOfWeek(iso) {
  const d = new Date(iso + "T00:00:00");
  const day = d.getDay();
  const diff = (day === 0 ? -6 : 1) - day; // Monday start
  d.setDate(d.getDate() + diff);
  return d.toISOString().slice(0, 10);
}
function monthsBetween(startISO, endISO) {
  const out = [];
  let ym = monthOf(startISO);
  const endYm = monthOf(endISO);
  while (ym <= endYm) { out.push(ym); ym = addMonths(ym, 1); }
  return out;
}

async function compressImage(file, maxWidth = 720, quality = 0.55) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read file"));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("Could not decode image"));
      img.onload = () => {
        const scale = Math.min(1, maxWidth / img.width);
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

/* ---------------- Supabase-backed storage ----------------
   Reports, assigned tasks, photos, and settings all live in your own
   Supabase project — a real database with a stable REST API. Direct
   fetch calls, no LLM in the loop for reads/writes.
------------------------------------------------------------------ */
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || "https://rmwmwasgdpxlirxntfoy.supabase.co/rest/v1";
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJtd213YXNnZHB4bGlyeG50Zm95Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU0MDgyMjYsImV4cCI6MjEwMDk4NDIyNn0.Zs6VJW79HyLE0Hm7l-FrgRIWljnN3dsTXyvontmDIkE";

async function supabaseFetch(path, { method = "GET", body, timeoutMs = 15000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(`${SUPABASE_URL}${path}`, {
      method,
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        "Content-Type": "application/json",
        Prefer: method === "GET" ? undefined : "return=minimal",
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
  } catch (e) {
    if (e.name === "AbortError") throw new Error("Saving timed out — check your connection and try again.");
    throw new Error("Couldn't reach the database — check your connection and try again.");
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Database error (${res.status}). ${text.slice(0, 150)}`);
  }
  if (res.status === 204) return null;
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

function rowToReport(row) {
  return {
    id: row.id, workerName: row.worker_name || "", workerType: row.worker_type || "",
    date: row.date, arrival: row.arrival || "", departure: row.departure || "",
    hours: Number(row.hours) || 0, tasks: row.tasks || [], photoCount: row.photo_count || 0,
    delays: row.delays || "No", delayExplain: row.delay_explain || "", delayNotes: row.delay_notes || "",
    tomorrow: row.tomorrow || "", fullCheck: row.full_check || "", confirmed: true,
    submittedAt: row.submitted_at || "",
  };
}
function reportToRow(report, photos) {
  return {
    id: report.id, date: report.date, worker_name: report.workerName, worker_type: report.workerType,
    arrival: report.arrival, departure: report.departure, hours: report.hours, tasks: report.tasks,
    photo_count: report.photoCount, delays: report.delays, delay_explain: report.delayExplain,
    delay_notes: report.delayNotes, tomorrow: report.tomorrow, full_check: report.fullCheck,
    submitted_at: report.submittedAt, photos: photos || [],
  };
}

async function createReportInSupabase(report, photos) {
  await supabaseFetch("/reports", { method: "POST", body: [reportToRow(report, photos)] });
}

async function loadIndex() {
  try {
    const rows = await supabaseFetch("/reports?select=date");
    const yms = Array.from(new Set((rows || []).map((r) => (r.date || "").slice(0, 7)))).filter(Boolean);
    return yms.sort().reverse();
  } catch { return []; }
}

async function loadMonth(ym) {
  try {
    const start = `${ym}-01`;
    const [y, m] = ym.split("-").map(Number);
    const nextMonth = new Date(y, m, 1).toISOString().slice(0, 10);
    const rows = await supabaseFetch(`/reports?date=gte.${start}&date=lt.${nextMonth}&select=*`);
    return (rows || []).map(rowToReport);
  } catch { return []; }
}

async function loadSettings() {
  try {
    const rows = await supabaseFetch("/app_settings?id=eq.1&select=manager_pin,staff_pins");
    const row = rows?.[0];
    return {
      managerPin: row?.manager_pin || DEFAULT_PIN,
      staffPins: { ...DEFAULT_STAFF_PINS, ...(row?.staff_pins || {}) },
    };
  } catch { return { managerPin: DEFAULT_PIN, staffPins: DEFAULT_STAFF_PINS }; }
}
async function saveSettings(s) {
  try {
    await supabaseFetch("/app_settings?id=eq.1", {
      method: "PATCH",
      body: { manager_pin: s.managerPin, staff_pins: s.staffPins },
    });
  } catch (e) { console.error("save settings failed", e); }
}

async function loadPhotos(reportId) {
  try {
    const rows = await supabaseFetch(`/reports?id=eq.${reportId}&select=photos`);
    return rows?.[0]?.photos || [];
  } catch { return []; }
}

async function loadAssignedTasks() {
  try {
    const rows = await supabaseFetch("/assigned_tasks?active=eq.true&select=*");
    return (rows || []).map((row) => ({
      id: row.id, date: row.date, text: row.task_text, assignedTo: row.assigned_to || [], createdAt: row.created_at,
      startTime: row.start_time || "", endTime: row.end_time || "",
      acknowledgedBy: row.acknowledged_by || [],
    }));
  } catch { return []; }
}
async function createAssignedTaskInSupabase(task) {
  const base = { id: task.id, date: task.date, task_text: task.text, assigned_to: task.assignedTo, created_at: task.createdAt, active: true };
  try {
    await supabaseFetch("/assigned_tasks", {
      method: "POST",
      body: [{ ...base, start_time: task.startTime || null, end_time: task.endTime || null }],
    });
  } catch (e) {
    if (!/start_time|end_time/i.test(e.message)) throw e;
    if (task.startTime || task.endTime) {
      throw new Error("Expected times need a one-off database update — run supabase/schema.sql in Supabase, or leave the times blank.");
    }
    await supabaseFetch("/assigned_tasks", { method: "POST", body: [base] });
  }
}

async function updateAssignedTaskInSupabase(id, task, clearAcks) {
  const base = { date: task.date, task_text: task.text, assigned_to: task.assignedTo };
  const full = { ...base, start_time: task.startTime || null, end_time: task.endTime || null };
  if (clearAcks) full.acknowledged_by = [];
  try {
    await supabaseFetch(`/assigned_tasks?id=eq.${id}`, { method: "PATCH", body: full });
  } catch (e) {
    if (!/start_time|end_time|acknowledged_by/i.test(e.message)) throw e;
    if (task.startTime || task.endTime) {
      throw new Error("Expected times need a one-off database update — run supabase/schema.sql in Supabase, or leave the times blank.");
    }
    await supabaseFetch(`/assigned_tasks?id=eq.${id}`, { method: "PATCH", body: base });
  }
}

async function acknowledgeAssignedTaskInSupabase(id, name) {
  let rows;
  try {
    rows = await supabaseFetch(`/assigned_tasks?id=eq.${id}&select=acknowledged_by`);
  } catch (e) {
    if (/acknowledged_by/i.test(e.message)) {
      throw new Error("Acknowledgements need a one-off database update — ask your property manager to run supabase/schema.sql.");
    }
    throw e;
  }
  const current = rows?.[0]?.acknowledged_by || [];
  if (current.some((a) => (a.name || "").toLowerCase() === name.toLowerCase())) return;
  const next = [...current, { name, at: new Date().toISOString() }];
  await supabaseFetch(`/assigned_tasks?id=eq.${id}`, { method: "PATCH", body: { acknowledged_by: next } });
}

function monthGridDays(ym) {
  const [y, m] = ym.split("-").map(Number);
  const first = new Date(y, m - 1, 1);
  const daysInMonth = new Date(y, m, 0).getDate();
  const lead = (first.getDay() === 0 ? 6 : first.getDay() - 1); // Monday-first
  const cells = Array(lead).fill(null);
  for (let d = 1; d <= daysInMonth; d += 1) {
    cells.push(`${ym}-${String(d).padStart(2, "0")}`);
  }
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

function fmtShortDay(iso) {
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-AU", { day: "numeric", month: "short" });
}

function fmtDayHeading(iso) {
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  const label = d.toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "long" });
  if (iso === todayISO()) return `Today \u2014 ${label}`;
  return label;
}

function fmtAckTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("en-AU", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}

function expectedWindowLabel(task) {
  if (!task.startTime || !task.endTime) return "";
  return `${fmtTime12(task.startTime)}\u2013${fmtTime12(task.endTime)}`;
}
async function loadSites() {
  try {
    const rows = await supabaseFetch("/sites?active=eq.true&select=id,name,address&order=id");
    return rows || [];
  } catch { return []; }
}

async function loadPeople() {
  try {
    const rows = await supabaseFetch("/people?active=eq.true&select=id,name,role,pin&order=sort_order,name");
    return rows || [];
  } catch { return []; }
}

async function loadSiteAssignments() {
  try {
    const rows = await supabaseFetch("/site_assignments?select=person_id,site_id");
    return rows || [];
  } catch { return []; }
}

// Replaces a person's whole site list in one go.
async function savePersonSites(personId, siteIds) {
  await supabaseFetch(`/site_assignments?person_id=eq.${personId}`, { method: "DELETE" });
  if (!siteIds.length) return;
  await supabaseFetch("/site_assignments", {
    method: "POST",
    body: siteIds.map((siteId) => ({ person_id: personId, site_id: siteId })),
  });
}

async function savePersonPin(personId, pin) {
  await supabaseFetch(`/people?id=eq.${personId}`, { method: "PATCH", body: { pin } });
}

function roleLabel(role) {
  if (role === "manager") return "Manager";
  if (role === "contractor") return "Contractor";
  return "Staff";
}

async function deleteReportInSupabase(id) {
  await supabaseFetch(`/reports?id=eq.${id}`, { method: "DELETE" });
}
async function deactivateAssignedTaskInSupabase(id) {
  await supabaseFetch(`/assigned_tasks?id=eq.${id}`, { method: "PATCH", body: { active: false } });
}

async function exportBackup() {
  const rows = await supabaseFetch("/reports?select=*").catch(() => []);
  const reports = (rows || []).map(rowToReport);
  const photosMap = {};
  (rows || []).forEach((r) => { photosMap[r.id] = r.photos || []; });
  const assignedTasks = await loadAssignedTasks();
  const backup = { app: "property-daily-reports", exportedAt: new Date().toISOString(), reports, assignedTasks, photos: photosMap };
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `property-backup-${todayISO()}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
async function restoreBackup(file) {
  const text = await file.text();
  const data = JSON.parse(text);
  if (!data || !Array.isArray(data.reports)) throw new Error("That file doesn't look like a valid backup.");
  for (const r of data.reports) {
    const photos = (data.photos && (data.photos[r.id] || data.photos[`photos:${r.id}`])) || [];
    await createReportInSupabase(r, photos);
  }
  if (Array.isArray(data.assignedTasks)) {
    for (const t of data.assignedTasks) await createAssignedTaskInSupabase(t);
  }
  return data.reports.length;
}

/* ================================================================== */

export default function App() {
  const [view, setView] = useState("home"); // home | form | submitted | managerGate | manager
  const [monthsIndex, setMonthsIndex] = useState([]);
  const [settings, setSettings] = useState({ managerPin: DEFAULT_PIN, staffPins: DEFAULT_STAFF_PINS });
  const [loading, setLoading] = useState(true);
  const [managerAuthed, setManagerAuthed] = useState(false);
  const [presetName, setPresetName] = useState("");
  const [pendingStaff, setPendingStaff] = useState("");
  const [cacheVersion, setCacheVersion] = useState(0);
  const [assignedTasks, setAssignedTasks] = useState([]);
  const [people, setPeople] = useState([]);
  const cacheRef = useRef({});

  useEffect(() => {
    (async () => {
      const [idx, s, at, ppl] = await Promise.all([loadIndex(), loadSettings(), loadAssignedTasks(), loadPeople()]);
      setMonthsIndex(idx);
      setSettings(s);
      setAssignedTasks(at);
      setPeople(ppl);
      const ym = monthOf(todayISO());
      cacheRef.current[ym] = await loadMonth(ym);
      setLoading(false);
    })();
  }, []);

  async function getMonths(yms) {
    const missing = yms.filter((ym) => !(ym in cacheRef.current));
    if (missing.length) {
      const loaded = await Promise.all(missing.map(loadMonth));
      missing.forEach((ym, i) => { cacheRef.current[ym] = loaded[i]; });
    }
    return yms.flatMap((ym) => cacheRef.current[ym] || []);
  }

  async function refreshMonths(yms) {
    const loaded = await Promise.all(yms.map(loadMonth));
    yms.forEach((ym, i) => { cacheRef.current[ym] = loaded[i]; });
    setCacheVersion((v) => v + 1);
  }

  async function addReport(report, photos) {
    const ym = monthOf(report.date);
    await createReportInSupabase(report, photos);
    cacheRef.current[ym] = await loadMonth(ym);
    if (!monthsIndex.includes(ym)) {
      const nextIndex = [...monthsIndex, ym].sort().reverse();
      setMonthsIndex(nextIndex);
    }
    setCacheVersion((v) => v + 1);
  }

  async function deleteReport(report) {
    const ym = monthOf(report.date);
    await deleteReportInSupabase(report.id);
    cacheRef.current[ym] = await loadMonth(ym);
    if (cacheRef.current[ym].length === 0) setMonthsIndex((prev) => prev.filter((m) => m !== ym));
    setCacheVersion((v) => v + 1);
  }

  async function addAssignedTask(task) {
    await createAssignedTaskInSupabase(task);
    setAssignedTasks(await loadAssignedTasks());
  }

  async function updateAssignedTask(id, task, clearAcks) {
    await updateAssignedTaskInSupabase(id, task, clearAcks);
    setAssignedTasks(await loadAssignedTasks());
  }

  async function acknowledgeAssignedTask(id, name) {
    await acknowledgeAssignedTaskInSupabase(id, name);
    setAssignedTasks(await loadAssignedTasks());
  }

  async function removeAssignedTask(id) {
    await deactivateAssignedTaskInSupabase(id);
    setAssignedTasks(await loadAssignedTasks());
  }

  // People come from the database; fall back to the original hardcoded list
  // so the app still works if that table can't be read.
  const workers = people.length
    ? people.filter((p) => p.role !== "manager")
    : [...STAFF_NAMES.map((name) => ({ id: name, name, role: "staff" })),
       ...OPEN_CONTRACTOR_SLOTS.map((name) => ({ id: name, name, role: "contractor" }))];
  const managerPins = people.filter((p) => p.role === "manager").map((p) => p.pin).filter(Boolean);

  function pinFor(name) {
    return people.find((p) => p.name === name)?.pin || settings.staffPins?.[name] || "";
  }
  function isSharedSlot(name) {
    return OPEN_CONTRACTOR_SLOTS.includes(name);
  }

  async function handleRestored() {
    cacheRef.current = {};
    const idx = await loadIndex();
    setMonthsIndex(idx);
    const ym = monthOf(todayISO());
    cacheRef.current[ym] = await loadMonth(ym);
    setAssignedTasks(await loadAssignedTasks());
    setCacheVersion((v) => v + 1);
  }

  return (
    <div className="lp-root">
      <style>{CSS}</style>
      {loading ? (
        <div className="lp-loading"><Sun size={22} /><span>Loading Property Daily Reports…</span></div>
      ) : view === "home" ? (
        <Home
          workers={workers}
          onWorker={(name) => {
            if (name && pinFor(name)) { setPendingStaff(name); setView("staffGate"); }
            else { setPresetName(name); setView("form"); }
          }}
          onManager={() => setView(managerAuthed ? "manager" : "managerGate")}
        />
      ) : view === "staffGate" ? (
        <StaffGate
          staffName={pendingStaff}
          pin={pinFor(pendingStaff)}
          onBack={() => setView("home")}
          onSuccess={() => {
            setPresetName(isSharedSlot(pendingStaff) ? "" : pendingStaff);
            setView("form");
          }}
        />
      ) : view === "form" ? (
        <WorkerForm
          presetName={presetName}
          workerNames={workers.map((w) => w.name)}
          assignedTasks={assignedTasks}
          onAcknowledge={acknowledgeAssignedTask}
          onBack={() => setView("home")}
          onSubmitted={async (report, photos) => { await addReport(report, photos); setView("submitted"); }}
        />
      ) : view === "submitted" ? (
        <SubmittedScreen onHome={() => setView("home")} />
      ) : view === "managerGate" ? (
        <ManagerGate pin={settings.managerPin} extraPins={managerPins} onBack={() => setView("home")} onSuccess={() => { setManagerAuthed(true); setView("manager"); }} />
      ) : (
        <ManagerDashboard
          workers={workers}
          monthsIndex={monthsIndex}
          getMonths={getMonths}
          refreshMonths={refreshMonths}
          cacheVersion={cacheVersion}
          settings={settings}
          onSettingsChange={async (s) => { setSettings(s); await saveSettings(s); }}
          assignedTasks={assignedTasks}
          onDeleteReport={deleteReport}
          onUpdateAssignedTask={updateAssignedTask}
          onAddAssignedTask={addAssignedTask}
          onRemoveAssignedTask={removeAssignedTask}
          onRestored={handleRestored}
          onExit={() => { setManagerAuthed(false); setView("home"); }}
        />
      )}
    </div>
  );
}

/* ---------------- Home ---------------- */
function Home({ workers, onWorker, onManager }) {
  const today = new Date();
  return (
    <div className="lp-home">
      <div className="lp-home-letterhead">
        <div className="lp-crest">LP</div>
        <div>
          <div className="lp-eyebrow">Property Maintenance</div>
          <h1>Daily Work Report</h1>
        </div>
      </div>
      <p className="lp-home-date">
        {today.toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
      </p>

      <div className="lp-staff-section">
        <span className="lp-eyebrow">Submit Daily Report</span>
        <div className="lp-staff-grid">
          {workers.map((person) => {
            const contractor = person.role === "contractor";
            return (
              <button
                className={`lp-staff-card ${contractor ? "lp-staff-card--other" : ""}`}
                key={person.id}
                onClick={() => onWorker(person.name)}
              >
                <span className={`lp-staff-initial ${contractor ? "lp-staff-initial--other" : ""}`}>
                  {person.name[0]}
                </span>
                <span className="lp-staff-name">{person.name}</span>
                <ChevronRight size={17} className="lp-chev" />
              </button>
            );
          })}
        </div>
      </div>

      <button className="lp-home-card lp-home-card--manager" onClick={onManager}>
        <Lock size={22} />
        <div><h2>Manager dashboard</h2><p>Daily brief, outstanding jobs and full history. PIN required.</p></div>
        <ChevronRight size={20} className="lp-chev" />
      </button>

      <p className="lp-home-footnote">Facts, not opinions — every entry is time-stamped and photo-verified.</p>
    </div>
  );
}

/* ---------------- Worker Form ---------------- */
function WorkerForm({ onBack, onSubmitted, presetName, workerNames, assignedTasks, onAcknowledge }) {
  const [workerType, setWorkerType] = useState("");
  const [workerName, setWorkerName] = useState(presetName || "");
  const nameLocked = Boolean(presetName);
  const [date, setDate] = useState(todayISO());
  const [arrival, setArrival] = useState("");
  const [departure, setDeparture] = useState("");
  const [taskCountChoice, setTaskCountChoice] = useState("");
  const [tasks, setTasks] = useState([emptyTask()]);
  const [addedAssignedIds, setAddedAssignedIds] = useState([]);
  const [ackBusy, setAckBusy] = useState(null);
  const [ackError, setAckError] = useState("");
  const [photos, setPhotos] = useState([]);
  const [photoError, setPhotoError] = useState("");
  const [delays, setDelays] = useState("");
  const [delayExplain, setDelayExplain] = useState("");
  const [delayNotes, setDelayNotes] = useState("");
  const [tomorrow, setTomorrow] = useState("");
  const [fullCheck, setFullCheck] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const relevantAssigned = (assignedTasks || []).filter((t) => {
    if (t.date !== date) return false;
    const names = normalizeAssignedTo(t.assignedTo);
    if (names.length === 0) return true;
    return names.some((n) => n.toLowerCase() === (workerName || "").trim().toLowerCase());
  });

  function hasAcknowledged(task) {
    return (task.acknowledgedBy || []).some((a) => (a.name || "").toLowerCase() === workerName.trim().toLowerCase());
  }

  async function handleAcknowledge(task) {
    const name = workerName.trim();
    if (!name) { setAckError("Enter your name at the top before acknowledging a task."); return; }
    if (hasAcknowledged(task)) return;
    setAckError("");
    setAckBusy(task.id);
    try { await onAcknowledge(task.id, name); }
    catch (e) { setAckError(e.message || "Couldn't record that — try again."); }
    finally { setAckBusy(null); }
  }

  function pullInAssignedTask(task) {
    if (addedAssignedIds.includes(task.id) || tasks.length >= MAX_TASKS) return;
    setTasks((prev) => {
      const base = prev.length === 1 && !prev[0].area && !prev[0].workType && !prev[0].description ? prev.slice(1) : prev;
      const expectedMinutes = task.startTime && task.endTime
        ? String(Math.round(hoursBetween(task.startTime, task.endTime) * 60))
        : "";
      return [...base, { ...emptyTask(), description: task.text, minutes: expectedMinutes, fromAssignedId: task.id }];
    });
    setAddedAssignedIds((prev) => [...prev, task.id]);
    setTaskCountChoice("5+");
  }

  function setTaskCount(choice) {
    setTaskCountChoice(choice);
    const n = choice === "5+" ? 5 : parseInt(choice, 10);
    setTasks((prev) => {
      const next = [...prev];
      while (next.length < n) next.push(emptyTask());
      return next.slice(0, choice === "5+" ? Math.max(n, next.length) : n);
    });
  }
  function updateTask(id, patch) { setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t))); }
  function removeTask(id) { setTasks((prev) => (prev.length > 1 ? prev.filter((t) => t.id !== id) : prev)); }

  async function handlePhotoFiles(fileList) {
    setPhotoError("");
    const files = Array.from(fileList).slice(0, 6 - photos.length);
    try {
      const compressed = await Promise.all(files.map((f) => compressImage(f)));
      setPhotos((prev) => [...prev, ...compressed].slice(0, 6));
    } catch { setPhotoError("One of those photos couldn't be processed — try again."); }
  }
  function removePhoto(idx) { setPhotos((prev) => prev.filter((_, i) => i !== idx)); }

  function validate() {
    if (!workerType) return "Select whether you're a full-time employee or subcontractor.";
    if (!workerName.trim()) return "Enter your name.";
    if (!date) return "Enter today's date.";
    if (!arrival || !departure) return "Enter arrival and departure time.";
    if (!taskCountChoice) return "Select how many tasks you completed.";
    for (const [i, t] of tasks.entries()) {
      if (!t.area || (t.area === "Other" && !t.areaOther.trim())) return `Task ${i + 1}: select an area.`;
      if (!t.workType || (t.workType === "Other" && !t.workTypeOther.trim())) return `Task ${i + 1}: select a work type.`;
      if (!t.description.trim()) return `Task ${i + 1}: describe what you achieved.`;
      if (!t.minutes || Number(t.minutes) <= 0) return `Task ${i + 1}: enter time spent in minutes.`;
      if (t.mode === "Jointly") {
        const hasOther = t.jointWithOtherOn && t.jointWithOther.trim();
        if ((!t.jointWith || t.jointWith.length === 0) && !hasOther) return `Task ${i + 1}: tick who you worked with.`;
      }
    }
    if (photos.length < 3) return "Upload at least 3 photos.";
    if (!delays) return "Select whether anything delayed today's work.";
    if (delays === "Yes" && !delayExplain.trim()) return "Explain what caused the delay.";
    if (!tomorrow.trim()) return "Enter what should be completed tomorrow.";
    if (!fullCheck) return "Select whether you completed a full check of the property.";
    if (!confirmed) return "Confirm this report accurately reflects the work you completed.";
    return "";
  }

  async function handleSubmit() {
    const err = validate();
    if (err) { setError(err); return; }
    setError("");
    setSubmitting(true);
    const report = {
      id: uid(), workerType, workerName: workerName.trim(), date, arrival, departure,
      hours: hoursBetween(arrival, departure),
      tasks: tasks.map((t) => ({
        ...t,
        area: t.area === "Other" ? t.areaOther.trim() : t.area,
        workType: t.workType === "Other" ? t.workTypeOther.trim() : t.workType,
        minutes: Number(t.minutes),
        jointWith: t.mode === "Jointly"
          ? [...(t.jointWith || []), ...(t.jointWithOtherOn && t.jointWithOther.trim() ? [t.jointWithOther.trim()] : [])]
          : [],
      })),
      photoCount: photos.length,
      delays, delayExplain: delays === "Yes" ? delayExplain.trim() : "", delayNotes: delays === "Yes" ? delayNotes.trim() : "",
      tomorrow: tomorrow.trim(), fullCheck, confirmed: true, submittedAt: new Date().toISOString(),
    };
    try {
      await onSubmitted(report, photos);
    } catch (e) {
      setError(e.message || "Couldn't save your report — check your connection and try again. Your answers haven't been lost.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="lp-page">
      <TopBar title="Daily Work Report" onBack={onBack} />
      <div className="lp-form">
        <Section n="1" title="About today">
          <Field label="Worker type"><ChoiceRow options={["Full-time Employee", "Subcontractor"]} value={workerType} onChange={setWorkerType} /></Field>
          <Field label="Your name">
            {nameLocked ? (
              <div className="lp-locked-name"><Lock size={13} /> {workerName}</div>
            ) : (
              <input className="lp-input" value={workerName} onChange={(e) => setWorkerName(e.target.value)} placeholder="Full name" />
            )}
          </Field>
          <div className="lp-row3">
            <Field label="Date"><input type="date" className="lp-input" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
            <Field label="Arrival time"><input type="time" className="lp-input" value={arrival} onChange={(e) => setArrival(e.target.value)} /></Field>
            <Field label="Departure time"><input type="time" className="lp-input" value={departure} onChange={(e) => setDeparture(e.target.value)} /></Field>
          </div>
        </Section>

        <Section n="2" title="Work completed">
          {relevantAssigned.length > 0 && (
            <div className="lp-assigned-for-you">
              <span className="lp-field-label">Tasks assigned to you for {date}</span>
              <ul className="lp-assigned-for-you-list">
                {relevantAssigned.map((t) => {
                  const already = addedAssignedIds.includes(t.id);
                  return (
                    <li key={t.id}>
                      <span>
                        {t.text}
                        {expectedWindowLabel(t) && <em className="lp-assigned-window"> — expected {expectedWindowLabel(t)} ({fmtHours(hoursBetween(t.startTime, t.endTime))})</em>}
                      </span>
                      <div className="lp-assigned-actions">
                        <label className={`lp-checkbox-chip lp-ack-chip ${hasAcknowledged(t) ? "is-acked" : ""}`}>
                          <input
                            type="checkbox"
                            checked={hasAcknowledged(t)}
                            disabled={hasAcknowledged(t) || ackBusy === t.id}
                            onChange={() => handleAcknowledge(t)}
                          />
                          <span>{hasAcknowledged(t) ? "Seen \u2014 acknowledged" : ackBusy === t.id ? "Saving\u2026" : "I've seen this"}</span>
                        </label>
                        <button type="button" className="lp-btn-ghost lp-assigned-add" disabled={already} onClick={() => pullInAssignedTask(t)}>
                          {already ? <><Check size={13} /> Added</> : <><Plus size={13} /> Add to my tasks</>}
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
              {ackError && <p className="lp-error">{ackError}</p>}
            </div>
          )}
          <Field label="How many separate tasks did you complete today?"><ChoiceRow options={TASK_COUNT_OPTIONS} value={taskCountChoice} onChange={setTaskCount} /></Field>
          {tasks.map((t, i) => (
            <TaskBlock key={t.id} index={i} task={t} workerName={workerName} workerNames={workerNames} onChange={(patch) => updateTask(t.id, patch)} onRemove={tasks.length > 1 ? () => removeTask(t.id) : null} />
          ))}
          {taskCountChoice === "5+" && (
            tasks.length < MAX_TASKS ? (
              <button type="button" className="lp-btn-ghost" onClick={() => setTasks((p) => [...p, emptyTask()])}><Plus size={16} /> Add another task</button>
            ) : (
              <p className="lp-hint">Maximum of {MAX_TASKS} tasks per day reached.</p>
            )
          )}
        </Section>

        <Section n="3" title="Photos" hint="Upload at least 3 photos of today's work">
          <div className="lp-photo-grid">
            {photos.map((p, idx) => (
              <div className="lp-photo-thumb" key={idx}>
                <img src={p} alt={`Work photo ${idx + 1}`} />
                <button type="button" className="lp-photo-remove" onClick={() => removePhoto(idx)} aria-label="Remove photo"><X size={13} /></button>
              </div>
            ))}
            {photos.length < 6 && (
              <label className="lp-photo-add">
                <Camera size={20} /><span>Add photo</span>
                <input
                  type="file" accept="image/*" multiple capture="environment" className="lp-file-hidden"
                  onChange={(e) => { if (e.target.files?.length) handlePhotoFiles(e.target.files); e.target.value = ""; }}
                />
              </label>
            )}
          </div>
          <p className="lp-hint">{photos.length}/3 minimum uploaded</p>
          {photoError && <p className="lp-error">{photoError}</p>}
        </Section>

        <Section n="4" title="Delays">
          <Field label="Did anything delay today's work?"><ChoiceRow options={["Yes", "No"]} value={delays} onChange={setDelays} /></Field>
          {delays === "Yes" && (
            <>
              <Field label="Explain"><textarea className="lp-textarea" rows={3} value={delayExplain} onChange={(e) => setDelayExplain(e.target.value)} placeholder="What happened, and what it affected." /></Field>
              <Field label="Notes (optional)"><textarea className="lp-textarea" rows={3} value={delayNotes} onChange={(e) => setDelayNotes(e.target.value)} placeholder="Anything else worth flagging — follow-up needed, who else knows, etc." /></Field>
            </>
          )}
        </Section>

        <Section n="5" title="Tomorrow">
          <Field label="What should be completed tomorrow?">
            <textarea className="lp-textarea" rows={4} value={tomorrow} onChange={(e) => setTomorrow(e.target.value)} placeholder="What's next — jobs to pick up, anything to prep or bring." />
          </Field>
        </Section>

        <Section n="6" title="End of day">
          <Field label="Did you complete a full check of the property before finishing today?">
            <ChoiceRow options={["Yes", "No"]} value={fullCheck} onChange={setFullCheck} />
          </Field>
        </Section>

        <label className="lp-confirm">
          <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
          <span>I confirm this report accurately reflects the work I completed today.</span>
        </label>

        {error && <p className="lp-error lp-error--block"><AlertTriangle size={15} /> {error}</p>}
        <button type="button" className="lp-submit" onClick={handleSubmit} disabled={submitting}>{submitting ? "Submitting…" : "Submit report"}</button>
      </div>
    </div>
  );
}

function TaskBlock({ index, task, workerName, workerNames, onChange, onRemove }) {
  const [open, setOpen] = useState(true);
  const label = task.workType && task.area ? `${task.workType} — ${task.area}` : `Task ${index + 1}`;
  const jointOptions = [
    ...workerNames.filter((n) => n.toLowerCase() !== (workerName || "").trim().toLowerCase()),
    "Manager",
  ];
  function toggleJoint(name) {
    const set = new Set(task.jointWith || []);
    if (set.has(name)) set.delete(name); else set.add(name);
    onChange({ jointWith: Array.from(set) });
  }
  return (
    <div className="lp-task">
      <button type="button" className="lp-task-head" onClick={() => setOpen((o) => !o)}>
        <span className="lp-task-num">{index + 1}</span>
        <span className="lp-task-label">{label}</span>
        <ChevronDown size={16} className={open ? "lp-rot" : ""} />
      </button>
      {open && (
        <div className="lp-task-body">
          <div className="lp-row2">
            <Field label="Area">
              <select className="lp-input" value={task.area} onChange={(e) => onChange({ area: e.target.value })}>
                <option value="">Select…</option>
                {AREA_OPTIONS.map((a) => <option key={a} value={a}>{a}</option>)}
              </select>
              {task.area === "Other" && <input className="lp-input lp-mt6" placeholder="Describe the area" value={task.areaOther} onChange={(e) => onChange({ areaOther: e.target.value })} />}
            </Field>
            <Field label="Work type">
              <select className="lp-input" value={task.workType} onChange={(e) => onChange({ workType: e.target.value })}>
                <option value="">Select…</option>
                {WORKTYPE_OPTIONS.map((w) => <option key={w} value={w}>{w}</option>)}
              </select>
              {task.workType === "Other" && <input className="lp-input lp-mt6" placeholder="Describe the work type" value={task.workTypeOther} onChange={(e) => onChange({ workTypeOther: e.target.value })} />}
            </Field>
          </div>
          <Field label="Describe exactly what you achieved">
            <textarea className="lp-textarea" rows={2} value={task.description} onChange={(e) => onChange({ description: e.target.value })} placeholder="e.g. Reduced hedge by 400mm along north boundary and removed all green waste." />
          </Field>
          <Field label="Did you complete this task"><ChoiceRow options={["Alone", "Jointly"]} value={task.mode} onChange={(v) => onChange({ mode: v })} /></Field>
          {task.mode === "Jointly" && (
            <Field label="Who worked with you? (tick all that apply)">
              <div className="lp-checkbox-grid">
                {jointOptions.map((name) => (
                  <label className="lp-checkbox-chip" key={name}>
                    <input type="checkbox" checked={(task.jointWith || []).includes(name)} onChange={() => toggleJoint(name)} />
                    <span>{name}</span>
                  </label>
                ))}
                <label className="lp-checkbox-chip">
                  <input type="checkbox" checked={task.jointWithOtherOn} onChange={(e) => onChange({ jointWithOtherOn: e.target.checked })} />
                  <span>Another contractor</span>
                </label>
              </div>
              {task.jointWithOtherOn && (
                <input className="lp-input lp-mt6" placeholder="Name" value={task.jointWithOther} onChange={(e) => onChange({ jointWithOther: e.target.value })} />
              )}
            </Field>
          )}
          <div className="lp-row2">
            <Field label="Time spent (minutes)"><input type="number" min="1" className="lp-input" value={task.minutes} onChange={(e) => onChange({ minutes: e.target.value })} placeholder="90" /></Field>
            <Field label="Status">
              <select className="lp-input" value={task.status} onChange={(e) => onChange({ status: e.target.value })}>
                {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
          </div>
          {onRemove && <button type="button" className="lp-btn-ghost lp-btn-danger" onClick={onRemove}><Trash2 size={14} /> Remove this task</button>}
        </div>
      )}
    </div>
  );
}

/* ---------------- small building blocks ---------------- */
function TopBar({ title, onBack, right }) {
  return (
    <div className="lp-topbar">
      <button className="lp-back" onClick={onBack}><ArrowLeft size={18} /></button>
      <span className="lp-topbar-title">{title}</span>
      {right}
    </div>
  );
}
function Section({ n, title, hint, children }) {
  return (
    <section className="lp-section">
      <div className="lp-section-head"><span className="lp-section-n">{n}</span><h3>{title}</h3></div>
      {hint && <p className="lp-hint">{hint}</p>}
      {children}
    </section>
  );
}
function Field({ label, children }) {
  return <label className="lp-field"><span className="lp-field-label">{label}</span>{children}</label>;
}
function ChoiceRow({ options, value, onChange }) {
  return (
    <div className="lp-choices">
      {options.map((o) => (
        <button type="button" key={o} className={`lp-choice ${value === o ? "is-active" : ""}`} onClick={() => onChange(o)}>{o}</button>
      ))}
    </div>
  );
}
function SubmittedScreen({ onHome }) {
  return (
    <div className="lp-submitted">
      <div className="lp-submitted-icon"><Check size={30} /></div>
      <h2>Report submitted</h2>
      <p>Thanks — today's work has been logged for the property manager.</p>
      <button className="lp-submit" onClick={onHome}>Done</button>
    </div>
  );
}

/* ---------------- Staff gate ---------------- */
function StaffGate({ staffName, pin, onBack, onSuccess }) {
  const [value, setValue] = useState("");
  const [err, setErr] = useState("");
  function submit() {
    if (value.trim() === String(pin || "").trim()) onSuccess();
    else { setErr("Incorrect PIN."); setValue(""); }
  }
  return (
    <div className="lp-page">
      <TopBar title="Submit Daily Report" onBack={onBack} />
      <div className="lp-gate">
        <div className="lp-gate-icon"><Lock size={24} /></div>
        <h2>Hi {staffName} — enter your PIN</h2>
        <p>Only you and the property manager know this PIN. It keeps your reports as yours.</p>
        <input
          type="text" inputMode="numeric" pattern="[0-9]*" autoComplete="off" autoCorrect="off"
          autoCapitalize="off" spellCheck="false" name="staff-pin"
          className="lp-input lp-gate-input lp-pin-mask" placeholder="Enter PIN"
          value={value} onChange={(e) => setValue(e.target.value.replace(/\D/g, ""))}
          onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
          autoFocus
        />
        {err && <p className="lp-error">{err}</p>}
        <button type="button" className="lp-submit" onClick={submit}><ShieldCheck size={16} /> Continue</button>
        <p className="lp-hint lp-gate-default">Forgotten your PIN? Ask your property manager.</p>
      </div>
    </div>
  );
}

/* ---------------- Manager gate ---------------- */
function ManagerGate({ pin, extraPins = [], onBack, onSuccess }) {
  const [value, setValue] = useState("");
  const [err, setErr] = useState("");
  const accepted = [pin, ...extraPins].filter(Boolean).map((p) => String(p).trim());
  function submit() {
    if (accepted.includes(value.trim())) onSuccess();
    else { setErr("Incorrect PIN."); setValue(""); }
  }
  return (
    <div className="lp-page">
      <TopBar title="Manager dashboard" onBack={onBack} />
      <div className="lp-gate">
        <div className="lp-gate-icon"><Lock size={24} /></div>
        <h2>Manager access only</h2>
        <p>Daily summaries and reports are only visible to the property manager.</p>
        <input
          type="text" inputMode="numeric" pattern="[0-9]*" autoComplete="off" autoCorrect="off"
          autoCapitalize="off" spellCheck="false" name="manager-pin"
          className="lp-input lp-gate-input lp-pin-mask" placeholder="Enter PIN"
          value={value} onChange={(e) => setValue(e.target.value.replace(/\D/g, ""))}
          onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
          autoFocus
        />
        {err && <p className="lp-error">{err}</p>}
        <button type="button" className="lp-submit" onClick={submit}><ShieldCheck size={16} /> Unlock</button>
        <p className="lp-hint lp-gate-default">Default PIN is {DEFAULT_PIN} until changed in Settings.</p>
      </div>
    </div>
  );
}

/* ---------------- Manager dashboard ---------------- */
function ManagerDashboard({ workers, monthsIndex, getMonths, refreshMonths, cacheVersion, settings, onSettingsChange, assignedTasks, onAddAssignedTask, onRemoveAssignedTask, onUpdateAssignedTask, onDeleteReport, onRestored, onExit }) {
  const [tab, setTab] = useState("brief");
  return (
    <div className="lp-page lp-page--manager">
      <TopBar title="Manager dashboard" onBack={onExit} right={<button className="lp-signout" onClick={onExit}><LogOut size={15} /> Sign out</button>} />
      <div className="lp-tabs">
        <button className={`lp-tab ${tab === "brief" ? "is-active" : ""}`} onClick={() => setTab("brief")}>Morning brief</button>
        <button className={`lp-tab ${tab === "assign" ? "is-active" : ""}`} onClick={() => setTab("assign")}>Assign tasks</button>
        <button className={`lp-tab ${tab === "log" ? "is-active" : ""}`} onClick={() => setTab("log")}>Full log</button>
        <button className={`lp-tab ${tab === "sites" ? "is-active" : ""}`} onClick={() => setTab("sites")}>Sites &amp; people</button>
        <button className={`lp-tab ${tab === "settings" ? "is-active" : ""}`} onClick={() => setTab("settings")}>Settings</button>
      </div>
      {tab === "brief" && <MorningBrief getMonths={getMonths} refreshMonths={refreshMonths} cacheVersion={cacheVersion} />}
      {tab === "assign" && <AssignTasksPanel workers={workers} assignedTasks={assignedTasks} onAdd={onAddAssignedTask} onRemove={onRemoveAssignedTask} onUpdate={onUpdateAssignedTask} />}
      {tab === "log" && <FullLog monthsIndex={monthsIndex} getMonths={getMonths} cacheVersion={cacheVersion} onDeleteReport={onDeleteReport} />}
      {tab === "sites" && <SitesPeoplePanel />}
      {tab === "settings" && <ManagerSettings workers={workers} settings={settings} onChange={onSettingsChange} onRestored={onRestored} />}
    </div>
  );
}

function AssignedTaskRow({ task, onRemove, onUpdate, nameOptions }) {
  const NAME_OPTIONS = nameOptions;
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState(null);

  async function handleRemove() {
    setRemoving(true);
    setError("");
    try { await onRemove(task.id); }
    catch (e) { setError(e.message || "Couldn't remove — try again."); setRemoving(false); }
  }

  function startEditing() {
    const names = normalizeAssignedTo(task.assignedTo);
    setDraft({
      date: task.date, text: task.text, startTime: task.startTime || "", endTime: task.endTime || "",
      isAnyone: names.length === 0, names,
    });
    setError("");
    setEditing(true);
  }

  function toggleDraftName(name) {
    setDraft((d) => ({
      ...d, isAnyone: false,
      names: d.names.includes(name) ? d.names.filter((n) => n !== name) : [...d.names, name],
    }));
  }

  async function handleSave() {
    if (!draft.text.trim()) { setError("Describe the task before saving."); return; }
    if (!draft.isAnyone && draft.names.length === 0) { setError("Tick who this task is for, or choose Anyone."); return; }
    if (Boolean(draft.startTime) !== Boolean(draft.endTime)) { setError("Enter both a start and a finish time, or leave both blank."); return; }
    if (draft.startTime && draft.endTime && hoursBetween(draft.startTime, draft.endTime) === 0) { setError("Finish time must be different to the start time."); return; }
    const next = {
      date: draft.date, text: draft.text.trim(), startTime: draft.startTime, endTime: draft.endTime,
      assignedTo: draft.isAnyone ? [] : draft.names,
    };
    const changedSubstance = next.text !== task.text || next.startTime !== (task.startTime || "") || next.endTime !== (task.endTime || "") || next.date !== task.date;
    setError("");
    setSaving(true);
    try {
      await onUpdate(task.id, next, changedSubstance && (task.acknowledgedBy || []).length > 0);
      setEditing(false);
    } catch (e) {
      setError(e.message || "Couldn't save those changes — try again.");
    } finally {
      setSaving(false);
    }
  }

  const acks = task.acknowledgedBy || [];

  if (editing) {
    return (
      <li>
        <Field label="Date it should appear">
          <input type="date" className="lp-input" value={draft.date} onChange={(e) => setDraft((d) => ({ ...d, date: e.target.value }))} />
        </Field>
        <Field label="Assign to">
          <div className="lp-checkbox-grid">
            <label className="lp-checkbox-chip">
              <input type="checkbox" checked={draft.isAnyone} onChange={() => setDraft((d) => ({ ...d, isAnyone: !d.isAnyone, names: d.isAnyone ? d.names : [] }))} />
              <span>Anyone</span>
            </label>
            {NAME_OPTIONS.map((name) => (
              <label className="lp-checkbox-chip" key={name}>
                <input type="checkbox" checked={draft.names.includes(name)} onChange={() => toggleDraftName(name)} />
                <span>{name}</span>
              </label>
            ))}
          </div>
        </Field>
        <Field label="What needs doing">
          <textarea className="lp-textarea" rows={2} value={draft.text} onChange={(e) => setDraft((d) => ({ ...d, text: e.target.value }))} />
        </Field>
        <div className="lp-row2">
          <Field label="Expected start (optional)">
            <input type="time" className="lp-input" value={draft.startTime} onChange={(e) => setDraft((d) => ({ ...d, startTime: e.target.value }))} />
          </Field>
          <Field label="Expected finish (optional)">
            <input type="time" className="lp-input" value={draft.endTime} onChange={(e) => setDraft((d) => ({ ...d, endTime: e.target.value }))} />
          </Field>
        </div>
        {acks.length > 0 && <p className="lp-hint">Changing the wording, date or times clears the existing acknowledgement so staff have to confirm again.</p>}
        {error && <p className="lp-error">{error}</p>}
        <div className="lp-assigned-edit-actions">
          <button type="button" className="lp-btn-ghost" onClick={handleSave} disabled={saving}><Check size={13} /> {saving ? "Saving…" : "Save changes"}</button>
          <button type="button" className="lp-btn-ghost" onClick={() => setEditing(false)} disabled={saving}>Cancel</button>
        </div>
      </li>
    );
  }

  return (
    <li>
      <div className="lp-assigned-meta">
        <span className="lp-tag">{assignedToLabel(task.assignedTo)}</span>
        {expectedWindowLabel(task) && (
          <span className="lp-tag"><Clock size={11} /> {expectedWindowLabel(task)} ({fmtHours(hoursBetween(task.startTime, task.endTime))})</span>
        )}
      </div>
      <p>{task.text}</p>
      {acks.length > 0 ? (
        <ul className="lp-ack-list">
          {acks.map((a, i) => (
            <li key={i}><Check size={12} /> Acknowledged by {a.name} — {fmtAckTime(a.at)}</li>
          ))}
        </ul>
      ) : (
        <p className="lp-hint"><Clock size={12} /> Not yet acknowledged</p>
      )}
      <div className="lp-assigned-edit-actions">
        <button type="button" className="lp-btn-ghost" onClick={startEditing}><Settings size={13} /> Edit</button>
        <button type="button" className="lp-btn-ghost lp-btn-danger" onClick={handleRemove} disabled={removing}>
          <Trash2 size={13} /> {removing ? "Removing…" : "Remove"}
        </button>
      </div>
      {error && <p className="lp-error">{error}</p>}
    </li>
  );
}

function AssignTasksPanel({ assignedTasks, onAdd, onRemove, onUpdate, workers }) {
  const NAME_OPTIONS = workers.map((w) => w.name);
  const [date, setDate] = useState(todayISO());
  const [isAnyone, setIsAnyone] = useState(true);
  const [selectedNames, setSelectedNames] = useState([]);
  const [text, setText] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [error, setError] = useState("");
  const [added, setAdded] = useState(false);
  const [adding, setAdding] = useState(false);
  const [calMonth, setCalMonth] = useState(monthOf(todayISO()));
  const [selectedDay, setSelectedDay] = useState(todayISO());

  function toggleAnyone() {
    setIsAnyone((prev) => {
      const next = !prev;
      if (next) setSelectedNames([]);
      return next;
    });
  }
  function toggleName(name) {
    setIsAnyone(false);
    setSelectedNames((prev) => (prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name]));
  }

  async function handleAdd() {
    if (!text.trim()) { setError("Describe the task before adding it."); return; }
    if (!isAnyone && selectedNames.length === 0) { setError("Tick who this task is for, or choose Anyone."); return; }
    if (Boolean(startTime) !== Boolean(endTime)) { setError("Enter both a start and a finish time, or leave both blank."); return; }
    if (startTime && endTime && hoursBetween(startTime, endTime) === 0) { setError("Finish time must be different to the start time."); return; }
    setError("");
    setAdding(true);
    try {
      await onAdd({
        id: uid(), date, assignedTo: isAnyone ? [] : selectedNames,
        text: text.trim(), startTime, endTime, createdAt: new Date().toISOString(),
      });
      setText("");
      setAdded(true);
      setTimeout(() => setAdded(false), 1500);
    } catch (e) {
      setError(e.message || "Couldn't save that task — check your connection and try again.");
    } finally {
      setAdding(false);
    }
  }

  const upcoming = [...assignedTasks].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const tasksByDate = new Map();
  upcoming.forEach((t) => {
    if (!tasksByDate.has(t.date)) tasksByDate.set(t.date, []);
    tasksByDate.get(t.date).push(t);
  });

  const thisWeekStart = startOfWeek(todayISO());
  const thisWeekEnd = addDays(thisWeekStart, 6);
  const weekGroups = [];
  upcoming.filter((t) => t.date >= thisWeekStart && t.date <= thisWeekEnd).forEach((t) => {
    const group = weekGroups.find((g) => g.date === t.date);
    if (group) group.tasks.push(t);
    else weekGroups.push({ date: t.date, tasks: [t] });
  });

  return (
    <div className="lp-assign">
      <div className="lp-panel lp-assign-form">
        <h4><Plus size={15} /> Add a task for staff</h4>
        <p className="lp-hint">It'll appear on the report form for everyone it's assigned to, on the date you choose — each of them fills in area, time, and status themselves, same as their own tasks.</p>
        <Field label="Date it should appear">
          <input type="date" className="lp-input" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="Assign to (tick as many as needed)">
          <div className="lp-checkbox-grid">
            <label className="lp-checkbox-chip">
              <input type="checkbox" checked={isAnyone} onChange={toggleAnyone} />
              <span>Anyone</span>
            </label>
            {NAME_OPTIONS.map((name) => (
              <label className="lp-checkbox-chip" key={name}>
                <input type="checkbox" checked={selectedNames.includes(name)} onChange={() => toggleName(name)} />
                <span>{name}</span>
              </label>
            ))}
          </div>
        </Field>
        <Field label="What needs doing">
          <textarea className="lp-textarea" rows={2} value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. Fix the irrigation leak near the north boundary" />
        </Field>
        <div className="lp-row2">
          <Field label="Expected start (optional)">
            <input type="time" className="lp-input" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
          </Field>
          <Field label="Expected finish (optional)">
            <input type="time" className="lp-input" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
          </Field>
        </div>
        {startTime && endTime && (
          <p className="lp-hint">Allowing {fmtHours(hoursBetween(startTime, endTime))} — the staff member sees this window, and their task time is pre-filled with it.</p>
        )}
        {error && <p className="lp-error">{error}</p>}
        <button type="button" className="lp-btn-ghost" onClick={handleAdd} disabled={adding}><Plus size={16} /> {adding ? "Saving…" : added ? "Added" : "Add task"}</button>
        <p className="lp-hint">Add as many as you need — the form clears after each one so you can keep going.</p>
      </div>

      <div className="lp-panel">
        <div className="lp-cal-head">
          <button type="button" className="lp-btn-ghost" aria-label="Previous month" onClick={() => setCalMonth((m) => addMonths(m, -1))}><ChevronLeft size={15} /></button>
          <h4>{fmtMonthLong(calMonth)}</h4>
          <button type="button" className="lp-btn-ghost" aria-label="Next month" onClick={() => setCalMonth((m) => addMonths(m, 1))}><ChevronRight size={15} /></button>
          <button type="button" className="lp-btn-ghost" onClick={() => { setCalMonth(monthOf(todayISO())); setSelectedDay(todayISO()); }}>Today</button>
        </div>
        <div className="lp-cal-weekdays">
          {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => <span key={d}>{d}</span>)}
        </div>
        <div className="lp-cal-grid">
          {monthGridDays(calMonth).map((iso, i) => {
            if (!iso) return <span className="lp-cal-cell is-empty" key={`e${i}`} />;
            const count = tasksByDate.get(iso)?.length || 0;
            const classes = [
              "lp-cal-cell",
              count > 0 ? "has-tasks" : "",
              iso === selectedDay ? "is-selected" : "",
              iso === todayISO() ? "is-today" : "",
            ].join(" ");
            return (
              <button type="button" className={classes} key={iso} onClick={() => setSelectedDay(iso)}>
                <span className="lp-cal-day">{Number(iso.slice(8, 10))}</span>
                {count > 0 && <span className="lp-cal-count">{count}</span>}
              </button>
            );
          })}
        </div>

        <div className="lp-cal-selected">
          <div className="lp-assigned-day-head">
            <span className="lp-assigned-day-date"><CalendarDays size={13} /> {fmtDayHeading(selectedDay)}</span>
            <span className="lp-hint">{(tasksByDate.get(selectedDay) || []).length} task(s)</span>
          </div>
          {(tasksByDate.get(selectedDay) || []).length === 0 ? (
            <EmptyState compact icon={<Check size={16} />} text="Nothing assigned for this day." />
          ) : (
            <ul className="lp-assigned-list">
              {tasksByDate.get(selectedDay).map((t) => <AssignedTaskRow key={t.id} task={t} nameOptions={NAME_OPTIONS} onRemove={onRemove} onUpdate={onUpdate} />)}
            </ul>
          )}
        </div>
      </div>

      <div className="lp-panel">
        <h4><ClipboardList size={15} /> This week ({fmtShortDay(thisWeekStart)} – {fmtShortDay(addDays(thisWeekStart, 6))})</h4>
        {weekGroups.length === 0 ? (
          <EmptyState compact icon={<Check size={16} />} text="No tasks assigned this week." />
        ) : (
          weekGroups.map((group) => {
            const acked = group.tasks.filter((t) => (t.acknowledgedBy || []).length > 0).length;
            return (
              <div className="lp-assigned-day" key={group.date}>
                <div className="lp-assigned-day-head">
                  <span className="lp-assigned-day-date"><CalendarDays size={13} /> {fmtDayHeading(group.date)}</span>
                  <span className="lp-hint">{acked}/{group.tasks.length} acknowledged</span>
                </div>
                <ul className="lp-assigned-list">
                  {group.tasks.map((t) => <AssignedTaskRow key={t.id} task={t} nameOptions={NAME_OPTIONS} onRemove={onRemove} onUpdate={onUpdate} />)}
                </ul>
              </div>
            );
          })
        )}
        <p className="lp-hint">{upcoming.length} task(s) assigned in total — use the calendar above to see any other day.</p>
      </div>
    </div>
  );
}

function MorningBrief({ getMonths, refreshMonths, cacheVersion }) {
  const [selectedDate, setSelectedDate] = useState(todayISO());
  const [rangeReports, setRangeReports] = useState([]);
  const [outstandingReports, setOutstandingReports] = useState([]);
  const [busy, setBusy] = useState(true);

  const weekStart = startOfWeek(selectedDate);

  useEffect(() => {
    let cancelled = false;
    setBusy(true);
    (async () => {
      const weekYms = monthsBetween(weekStart, selectedDate);
      const outstandingStart = addDays(selectedDate, -OUTSTANDING_LOOKBACK_DAYS);
      const outstandingYms = monthsBetween(outstandingStart, selectedDate);
      const [week, outstanding] = await Promise.all([getMonths(weekYms), getMonths(outstandingYms)]);
      if (cancelled) return;
      setRangeReports(week);
      setOutstandingReports(outstanding.filter((r) => r.date >= outstandingStart && r.date <= selectedDate));
      setBusy(false);
    })();
    return () => { cancelled = true; };
  }, [selectedDate, cacheVersion]);

  const todays = rangeReports.filter((r) => r.date === selectedDate);
  const weekReports = rangeReports.filter((r) => r.date >= weekStart && r.date <= selectedDate);

  const byWorker = {};
  todays.forEach((r) => {
    const key = r.workerName || r.workerType;
    if (!byWorker[key]) byWorker[key] = { type: r.workerType, hours: 0, complete: 0, jointHours: 0, delays: [], checkMissing: false };
    byWorker[key].hours += r.hours;
    r.tasks.forEach((t) => {
      if (t.status === "Complete") byWorker[key].complete += 1;
      if (t.mode === "Jointly") byWorker[key].jointHours += (t.minutes || 0) / 60;
    });
    if (r.delays === "Yes") byWorker[key].delays.push(r.delayExplain);
    if (r.fullCheck === "No") byWorker[key].checkMissing = true;
  });

  const outstanding = [];
  outstandingReports.forEach((r) => {
    r.tasks.forEach((t) => { if (t.status !== "Complete") outstanding.push({ ...t, date: r.date, worker: r.workerName || r.workerType }); });
  });
  outstanding.sort((a, b) => (a.date < b.date ? 1 : -1));

  const weekTasksComplete = weekReports.reduce((sum, r) => sum + r.tasks.filter((t) => t.status === "Complete").length, 0);
  const weekPhotos = weekReports.reduce((sum, r) => sum + (r.photoCount || 0), 0);
  const weekHours = weekReports.reduce((sum, r) => sum + r.hours, 0);
  const workerKeys = Object.keys(byWorker);

  return (
    <div className="lp-brief">
      <div className="lp-datebar">
        <button className="lp-nav-btn" onClick={() => setSelectedDate(addDays(selectedDate, -1))} aria-label="Previous day"><ChevronLeft size={16} /></button>
        <input type="date" className="lp-input lp-datebar-input" value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)} />
        <button className="lp-nav-btn" onClick={() => setSelectedDate(addDays(selectedDate, 1))} aria-label="Next day"><ChevronRight size={16} /></button>
        <button className="lp-btn-ghost lp-today-btn" onClick={() => setSelectedDate(todayISO())}>Today</button>
        <button className="lp-btn-ghost" onClick={() => refreshMonths(monthsBetween(weekStart, selectedDate))}>Refresh</button>
      </div>

      <div className="lp-brief-header">
        <div><span className="lp-eyebrow"><Sun size={13} /> Morning brief</span><h2>{fmtDateLong(selectedDate)}</h2></div>
      </div>

      {busy ? (
        <EmptyState icon={<ClipboardList size={22} />} text="Loading…" />
      ) : workerKeys.length === 0 ? (
        <EmptyState icon={<ClipboardList size={22} />} text="No reports submitted for this date yet." />
      ) : (
        <>
          <div className="lp-worker-cards">
            {workerKeys.map((k) => {
              const w = byWorker[k];
              return (
                <div className="lp-worker-card" key={k}>
                  <div className="lp-worker-card-head"><span className="lp-worker-dot" /><h3>{k}</h3><span className="lp-worker-type">{w.type}</span></div>
                  <ul className="lp-stat-list">
                    <li><StatusDot ok={w.hours >= 7} /> {fmtHours(w.hours)}</li>
                    <li><StatusDot ok={w.complete > 0} /> {w.complete} completed task{w.complete === 1 ? "" : "s"}</li>
                    <li><StatusDot ok tone="amber" /> {w.jointHours.toFixed(1)} hrs joint work</li>
                  </ul>
                  {w.delays.length > 0 && <div className="lp-worker-delay"><AlertTriangle size={13} /> {w.delays[0]}</div>}
                  {w.checkMissing && <div className="lp-worker-delay"><AlertTriangle size={13} /> No end-of-day property check</div>}
                </div>
              );
            })}
          </div>

          <DailySummaryPanel reports={todays} date={selectedDate} />
        </>
      )}

      <div className="lp-brief-grid">
        <div className="lp-panel">
          <h4><AlertTriangle size={15} /> Outstanding jobs</h4>
          <p className="lp-hint lp-panel-sub">From the last {OUTSTANDING_LOOKBACK_DAYS} days</p>
          {outstanding.length === 0 ? (
            <EmptyState compact icon={<Check size={16} />} text="Nothing outstanding right now." />
          ) : (
            <ul className="lp-outstanding">
              {outstanding.slice(0, 12).map((o, i) => (
                <li key={i}>
                  <span className="lp-out-dot" />
                  <div><strong>{o.workType} — {o.area}</strong><p>{o.description}</p><span className="lp-out-meta">{o.worker} · {o.status} · {o.date}</span></div>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="lp-panel">
          <h4><CalendarDays size={15} /> This week ({weekStart} → {selectedDate})</h4>
          <ul className="lp-week-stats">
            <li><Check size={14} /> {weekTasksComplete} tasks completed</li>
            <li><Camera size={14} /> {weekPhotos} photos</li>
            <li><Clock size={14} /> {weekHours.toFixed(1)} labour hours</li>
          </ul>
        </div>
      </div>
    </div>
  );
}

function StatusDot({ ok, tone }) {
  const color = tone === "amber" ? "#C97A2B" : ok ? "#4C7A54" : "#B4483A";
  return <span className="lp-status-dot" style={{ background: color }} />;
}

function DailySummaryPanel({ reports, date }) {
  const [copied, setCopied] = useState(false);
  const sorted = [...reports].sort((a, b) => (a.workerName || "").localeCompare(b.workerName || ""));
  const paragraphs = sorted.map((r) => ({ name: r.workerName || r.workerType, text: summarizeReport(r) }));
  const fullText = `Daily summary — ${fmtDateLong(date)}\n\n${paragraphs.map((p) => `${p.name}\n${p.text}`).join("\n\n")}`;

  async function copyAll() {
    try {
      await navigator.clipboard.writeText(fullText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard unavailable — ignore */ }
  }

  return (
    <div className="lp-panel lp-summary-panel">
      <div className="lp-summary-head">
        <h4><ClipboardList size={15} /> Daily summary</h4>
        <button className="lp-btn-ghost" onClick={copyAll}>{copied ? "Copied" : "Copy all"}</button>
      </div>
      {paragraphs.map((p) => (
        <div className="lp-summary-item" key={p.name}>
          <strong>{p.name}</strong>
          <p>{p.text}</p>
        </div>
      ))}
    </div>
  );
}

function FullLog({ monthsIndex, getMonths, cacheVersion, onDeleteReport }) {
  const [selectedYm, setSelectedYm] = useState(monthOf(todayISO()));
  const [monthReports, setMonthReports] = useState([]);
  const [busy, setBusy] = useState(true);
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setBusy(true);
    getMonths([selectedYm]).then((r) => { if (!cancelled) { setMonthReports(r); setBusy(false); } });
    return () => { cancelled = true; };
  }, [selectedYm, cacheVersion]);

  const availableYms = Array.from(new Set([monthOf(todayISO()), selectedYm, ...monthsIndex])).sort().reverse();

  const sorted = [...monthReports].sort((a, b) => (a.date < b.date ? 1 : -1) || (a.submittedAt < b.submittedAt ? 1 : -1));
  const filtered = sorted.filter((r) => {
    const q = query.toLowerCase();
    if (!q) return true;
    return (r.workerName || "").toLowerCase().includes(q) || r.date.includes(q) ||
      r.tasks.some((t) => t.description.toLowerCase().includes(q) || t.area.toLowerCase().includes(q));
  });

  return (
    <div className="lp-log">
      <div className="lp-datebar">
        <button className="lp-nav-btn" onClick={() => setSelectedYm(addMonths(selectedYm, -1))} aria-label="Previous month"><ChevronLeft size={16} /></button>
        <select className="lp-input lp-datebar-input" value={selectedYm} onChange={(e) => setSelectedYm(e.target.value)}>
          {availableYms.map((ym) => <option key={ym} value={ym}>{fmtMonthLong(ym)}{monthsIndex.includes(ym) ? "" : " — no reports"}</option>)}
        </select>
        <button className="lp-nav-btn" onClick={() => setSelectedYm(addMonths(selectedYm, 1))} aria-label="Next month"><ChevronRight size={16} /></button>
        <button className="lp-btn-ghost lp-today-btn" onClick={() => setSelectedYm(monthOf(todayISO()))}>This month</button>
      </div>

      <div className="lp-log-search">
        <Search size={15} />
        <input className="lp-input lp-input--bare" placeholder="Search within this month — worker, date, area or description" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>

      {busy ? (
        <EmptyState icon={<ClipboardList size={22} />} text="Loading…" />
      ) : filtered.length === 0 ? (
        <EmptyState icon={<ClipboardList size={22} />} text={`No reports for ${fmtMonthLong(selectedYm)}${query ? " match your search." : "."}`} />
      ) : (
        <div className="lp-log-list">
          {filtered.map((r) => (
            <LogEntry key={r.id} report={r} open={expanded === r.id} onToggle={() => setExpanded(expanded === r.id ? null : r.id)} onDelete={onDeleteReport} />
          ))}
        </div>
      )}
    </div>
  );
}

function LogEntry({ report, open, onToggle, onDelete }) {
  const [photos, setPhotos] = useState(null);
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteErr, setDeleteErr] = useState("");

  async function handleDelete() {
    setDeleting(true);
    setDeleteErr("");
    try { await onDelete(report); }
    catch (e) { setDeleteErr(e.message || "Couldn't delete that report — try again."); setDeleting(false); }
  }

  useEffect(() => { if (open && photos === null) loadPhotos(report.id).then(setPhotos); }, [open]);
  const completeCount = report.tasks.filter((t) => t.status === "Complete").length;

  return (
    <div className="lp-log-entry">
      <button className="lp-log-entry-head" onClick={onToggle}>
        <div className="lp-log-entry-main">
          <strong>{report.workerName}</strong>
          <span className="lp-tag">{report.workerType}</span>
          {report.delays === "Yes" && <span className="lp-tag lp-tag--warn"><AlertTriangle size={11} /> Delay</span>}
          {report.fullCheck === "No" && <span className="lp-tag lp-tag--warn"><AlertTriangle size={11} /> No end-of-day check</span>}
        </div>
        <div className="lp-log-entry-meta">
          <span>{report.date}</span><span>{fmtHours(report.hours)}</span><span>{completeCount}/{report.tasks.length} complete</span>
          <ChevronDown size={15} className={open ? "lp-rot" : ""} />
        </div>
      </button>
      {open && (
        <div className="lp-log-entry-body">
          <p className="lp-hint">Arrived {report.arrival} · Departed {report.departure}</p>
          {report.tasks.map((t, i) => (
            <div className="lp-log-task" key={t.id || i}>
              <div className="lp-log-task-head">
                <strong>{t.workType} — {t.area}</strong>
                <span className={`lp-status-pill lp-status-pill--${t.status.replace(/\s+/g, "-").toLowerCase()}`}>{t.status}</span>
              </div>
              <p>{t.description}</p>
              <p className="lp-hint">{t.mode}{t.mode === "Jointly" && t.jointWith?.length ? ` with ${t.jointWith.join(", ")}` : ""} · {t.minutes} min</p>
            </div>
          ))}
          {report.delays === "Yes" && <p className="lp-worker-delay"><AlertTriangle size={13} /> {report.delayExplain}</p>}
          {report.delays === "Yes" && report.delayNotes && <p className="lp-hint"><strong>Notes:</strong> {report.delayNotes}</p>}
          <p><strong>Tomorrow:</strong> {report.tomorrow}</p>
          <p>
            <strong>End-of-day property check:</strong>{" "}
            {report.fullCheck === "No" ? <span className="lp-checkfail"><AlertTriangle size={12} /> Not completed</span> : (report.fullCheck || "—")}
          </p>
          <div className="lp-photo-grid">
            {photos === null ? <span className="lp-hint">Loading photos…</span>
              : photos.length === 0 ? <span className="lp-hint"><ImageOff size={13} /> No photos found</span>
              : photos.map((p, i) => <div className="lp-photo-thumb" key={i}><img src={p} alt={`Photo ${i + 1}`} /></div>)}
          </div>
          {onDelete && (
            <div className="lp-log-delete">
              {confirming ? (
                <>
                  <p className="lp-error"><AlertTriangle size={13} /> Permanently delete this report and its photos? This can't be undone.</p>
                  <div className="lp-log-delete-actions">
                    <button type="button" className="lp-btn-ghost lp-btn-danger" onClick={handleDelete} disabled={deleting}>
                      <Trash2 size={13} /> {deleting ? "Deleting…" : "Yes, delete it"}
                    </button>
                    <button type="button" className="lp-btn-ghost" onClick={() => setConfirming(false)} disabled={deleting}>Cancel</button>
                  </div>
                </>
              ) : (
                <button type="button" className="lp-btn-ghost lp-btn-danger" onClick={() => setConfirming(true)}><Trash2 size={13} /> Delete this report</button>
              )}
              {deleteErr && <p className="lp-error">{deleteErr}</p>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ---------------- Sites & people ---------------- */
function SitesPeoplePanel() {
  const [sites, setSites] = useState([]);
  const [people, setPeople] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null); // person id
  const [draft, setDraft] = useState([]);       // site ids being edited
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    (async () => {
      const [s, p, a] = await Promise.all([loadSites(), loadPeople(), loadSiteAssignments()]);
      setSites(s); setPeople(p); setAssignments(a); setLoading(false);
    })();
  }, []);

  const sitesFor = (personId) =>
    assignments.filter((a) => a.person_id === personId).map((a) => a.site_id);
  const siteName = (id) => sites.find((s) => s.id === id)?.name || id;

  function startEdit(person) {
    setErr("");
    setEditing(person.id);
    setDraft(sitesFor(person.id));
  }

  function toggleSite(siteId) {
    setDraft((d) => (d.includes(siteId) ? d.filter((s) => s !== siteId) : [...d, siteId]));
  }

  async function save(personId) {
    setSaving(true); setErr("");
    try {
      await savePersonSites(personId, draft);
      setAssignments(await loadSiteAssignments());
      setEditing(null);
    } catch (e) {
      setErr(e.message || "Couldn't save those site assignments — try again.");
    }
    setSaving(false);
  }

  if (loading) return <div className="lp-settings"><p className="lp-hint">Loading sites and people…</p></div>;

  const workers = people.filter((p) => p.role !== "manager");
  const managers = people.filter((p) => p.role === "manager");

  return (
    <div className="lp-settings">
      <h3><Building2 size={16} /> Sites</h3>
      <p className="lp-hint">{sites.length} site{sites.length === 1 ? "" : "s"}. Names and addresses can be updated later.</p>
      <div className="lp-site-chips">
        {sites.map((s) => (
          <span className="lp-tag" key={s.id}>{s.name} <code className="lp-site-code">{s.id.toUpperCase()}</code></span>
        ))}
      </div>

      <hr className="lp-settings-divider" />

      <h3><Users size={16} /> Site access</h3>
      <p className="lp-hint">
        Tick any combination of sites for each person. Managers see every site automatically.
      </p>
      {err && <p className="lp-error">{err}</p>}

      <div className="lp-person-list">
        {workers.map((person) => {
          const current = sitesFor(person.id);
          const isEditing = editing === person.id;
          return (
            <div className="lp-person-row" key={person.id}>
              <div className="lp-person-head">
                <div>
                  <strong>{person.name}</strong>
                  <span className="lp-worker-type">{roleLabel(person.role)}</span>
                </div>
                {!isEditing && (
                  <button className="lp-btn-ghost" onClick={() => startEdit(person)}>
                    Edit sites
                  </button>
                )}
              </div>

              {isEditing ? (
                <>
                  <div className="lp-site-picker">
                    {sites.map((s) => (
                      <label className={`lp-site-option ${draft.includes(s.id) ? "is-on" : ""}`} key={s.id}>
                        <input type="checkbox" checked={draft.includes(s.id)} onChange={() => toggleSite(s.id)} />
                        <span>{s.name}</span>
                      </label>
                    ))}
                  </div>
                  <div className="lp-person-actions">
                    <button className="lp-btn-ghost" onClick={() => setDraft(sites.map((s) => s.id))}>All sites</button>
                    <button className="lp-btn-ghost" onClick={() => setDraft([])}>None</button>
                    <button className="lp-btn-ghost" onClick={() => save(person.id)} disabled={saving}>
                      {saving ? "Saving…" : "Save"}
                    </button>
                    <button className="lp-btn-ghost" onClick={() => setEditing(null)}>Cancel</button>
                  </div>
                </>
              ) : current.length ? (
                <div className="lp-site-chips">
                  {current.map((id) => <span className="lp-tag" key={id}>{siteName(id)}</span>)}
                </div>
              ) : (
                <p className="lp-hint lp-hint--muted">No sites yet.</p>
              )}
            </div>
          );
        })}
      </div>

      <p className="lp-hint lp-settings-note">
        Managers with full access: {managers.map((m) => m.name).join(", ") || "none"}.
      </p>
    </div>
  );
}

function ManagerSettings({ workers, settings, onChange, onRestored }) {
  const [pin, setPin] = useState(settings.managerPin || DEFAULT_PIN);
  const [saved, setSaved] = useState(false);
  const [staffPins, setStaffPins] = useState({}); // person id -> edited pin
  const [staffSaved, setStaffSaved] = useState(false);
  const [pinSaving, setPinSaving] = useState(false);
  const [pinError, setPinError] = useState("");
  const [exporting, setExporting] = useState(false);
  const [exportErr, setExportErr] = useState("");
  const [restoring, setRestoring] = useState(false);
  const [restoreMsg, setRestoreMsg] = useState("");
  const [restoreErr, setRestoreErr] = useState("");
  const [confirmRestore, setConfirmRestore] = useState(false);

  async function saveStaffPins() {
    setPinSaving(true); setPinError(""); setStaffSaved(false);
    try {
      const edited = Object.entries(staffPins).filter(([id, v]) => v !== workers.find((w) => w.id === id)?.pin);
      await Promise.all(edited.map(([id, v]) => savePersonPin(id, v)));
      setStaffSaved(true);
    } catch (e) {
      setPinError(e.message || "Couldn't save those PINs — try again.");
    }
    setPinSaving(false);
  }

  async function handleExport() {
    setExporting(true); setExportErr("");
    try { await exportBackup(); } catch { setExportErr("Couldn't build the backup file — try again."); }
    setExporting(false);
  }
  function handleFilePicked(file) {
    if (!file) return;
    if (!confirmRestore) { setRestoreErr("Tick the confirmation box first — restoring replaces all current reports."); return; }
    setRestoring(true); setRestoreErr(""); setRestoreMsg("");
    restoreBackup(file)
      .then((count) => { setRestoreMsg(`Restored ${count} report${count === 1 ? "" : "s"} from backup.`); onRestored?.(); })
      .catch((e) => setRestoreErr(e.message || "That file couldn't be restored."))
      .finally(() => setRestoring(false));
  }

  return (
    <div className="lp-settings">
      <h3><Settings size={16} /> Manager PIN</h3>
      <p className="lp-hint">Change the PIN used to unlock the manager dashboard.</p>
      <div className="lp-settings-row">
        <input className="lp-input lp-input--slim" value={pin} onChange={(e) => { setPin(e.target.value); setSaved(false); }} />
        <button className="lp-btn-ghost" onClick={() => { onChange({ ...settings, managerPin: pin }); setSaved(true); }}>Save</button>
      </div>
      {saved && <p className="lp-saved"><Check size={13} /> Saved</p>}
      <p className="lp-hint lp-settings-note">Data is stored centrally and shared between everyone using this app link — workers only ever see the submission form, never past reports or this dashboard.</p>

      <hr className="lp-settings-divider" />

      <h3><Lock size={16} /> Staff PINs</h3>
      <p className="lp-hint">Each PIN unlocks that person's "Submit Daily Report" button. Named staff are locked to their own name; Contractor One and Contractor Two are shared entry points — the PIN keeps them restricted to whoever you give it to, but they still type in their own name once inside.</p>
      <div className="lp-staff-pin-list">
        {workers.map((person) => (
          <div className="lp-settings-row" key={person.id}>
            <span className="lp-staff-pin-label">{person.name}</span>
            <input
              className="lp-input lp-input--slim" inputMode="numeric"
              value={staffPins[person.id] ?? person.pin ?? ""}
              onChange={(e) => { setStaffPins((p) => ({ ...p, [person.id]: e.target.value })); setStaffSaved(false); }}
            />
          </div>
        ))}
        <button className="lp-btn-ghost" onClick={saveStaffPins} disabled={pinSaving}>{pinSaving ? "Saving…" : "Save PINs"}</button>
      </div>
      {pinError && <p className="lp-error">{pinError}</p>}
      {staffSaved && <p className="lp-saved"><Check size={13} /> Saved — reload the app for new PINs to take effect.</p>}

      <hr className="lp-settings-divider" />

      <h3><ShieldCheck size={16} /> Backup &amp; restore</h3>
      <p className="lp-hint">Download a full copy of every report and photo, across every month, as a file you keep yourself. Do this regularly — it's the only copy that survives this app ever being unpublished or reset.</p>
      <button className="lp-btn-ghost" onClick={handleExport} disabled={exporting}>{exporting ? "Preparing backup…" : "Download full backup (.json)"}</button>
      {exportErr && <p className="lp-error">{exportErr}</p>}

      <div className="lp-settings-restore">
        <p className="lp-hint" style={{ marginTop: 16 }}>Restore from a previously downloaded backup file. This replaces all reports currently in the app.</p>
        <label className="lp-confirm lp-confirm--tight">
          <input type="checkbox" checked={confirmRestore} onChange={(e) => setConfirmRestore(e.target.checked)} />
          <span>I understand this will overwrite current data.</span>
        </label>
        <label className={`lp-btn-ghost lp-file-label ${restoring ? "is-disabled" : ""}`}>
          {restoring ? "Restoring…" : "Choose backup file…"}
          <input type="file" accept="application/json" className="lp-file-hidden" disabled={restoring}
            onChange={(e) => { handleFilePicked(e.target.files?.[0]); e.target.value = ""; }} />
        </label>
        {restoreMsg && <p className="lp-saved"><Check size={13} /> {restoreMsg}</p>}
        {restoreErr && <p className="lp-error">{restoreErr}</p>}
      </div>
    </div>
  );
}

function EmptyState({ icon, text, compact }) {
  return <div className={`lp-empty ${compact ? "lp-empty--compact" : ""}`}>{icon}<p>{text}</p></div>;
}

/* ---------------- styles ---------------- */
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600&family=Public+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@500&display=swap');

:root{
  --ink:#1B2B22; --paper:#F7F5F0; --stone:#EFEBDF; --panel:#FFFFFF;
  --brass:#A67C3D; --brass-dark:#8A6530; --green:#4C7A54; --amber:#C97A2B;
  --rust:#B4483A; --line:#DED8C8; --muted:#6B7268;
}
*{box-sizing:border-box;}
body{margin:0;}
.lp-root{font-family:'Public Sans',sans-serif;background:var(--paper);color:var(--ink);min-height:100vh;}
.lp-loading{display:flex;align-items:center;gap:8px;justify-content:center;padding:60px 0;color:var(--muted);}

.lp-home{max-width:520px;margin:0 auto;padding:36px 20px 40px;}
.lp-home-letterhead{display:flex;align-items:center;gap:14px;}
.lp-crest{width:44px;height:44px;border-radius:50%;background:var(--ink);color:var(--paper);display:flex;align-items:center;justify-content:center;font-family:'Fraunces',serif;font-weight:600;font-size:15px;flex:none;}
.lp-eyebrow{display:flex;align-items:center;gap:6px;text-transform:uppercase;letter-spacing:.12em;font-size:11px;font-weight:600;color:var(--brass-dark);}
.lp-home h1{font-family:'Fraunces',serif;font-weight:600;font-size:28px;margin:2px 0 0;}
.lp-home-date{color:var(--muted);margin:14px 0 26px;font-size:14px;}
.lp-home-cards{display:flex;flex-direction:column;gap:12px;}
.lp-staff-section{margin-bottom:16px;}
.lp-staff-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:10px;margin-top:10px;}
@media(max-width:420px){.lp-staff-grid{grid-template-columns:1fr;}}
.lp-staff-card{display:flex;align-items:center;gap:10px;text-align:left;padding:14px;border-radius:14px;border:1px solid var(--line);background:var(--panel);cursor:pointer;transition:transform .15s ease, box-shadow .15s ease;}
.lp-staff-card:hover{transform:translateY(-1px);box-shadow:0 6px 18px rgba(27,43,34,.08);}
.lp-staff-initial{width:32px;height:32px;border-radius:50%;background:var(--brass);color:#fff;font-family:'Fraunces',serif;font-weight:600;font-size:14px;display:flex;align-items:center;justify-content:center;flex:none;}
.lp-staff-initial--other{background:var(--ink);}
.lp-staff-name{flex:1;font-family:'Fraunces',serif;font-weight:600;font-size:14.5px;}
.lp-staff-card--other{border-style:dashed;}
.lp-staff-card .lp-chev{color:var(--muted);flex:none;}
.lp-home-card{display:flex;align-items:center;gap:14px;text-align:left;padding:18px;border-radius:14px;border:1px solid var(--line);background:var(--panel);cursor:pointer;transition:transform .15s ease, box-shadow .15s ease;}
.lp-home-card:hover{transform:translateY(-1px);box-shadow:0 6px 18px rgba(27,43,34,.08);}
.lp-home-card--worker{border-color:var(--brass);}
.lp-home-card h2{font-family:'Fraunces',serif;font-size:16px;font-weight:600;margin:0;}
.lp-home-card p{margin:2px 0 0;font-size:12.5px;color:var(--muted);}
.lp-home-card .lp-chev{margin-left:auto;color:var(--muted);flex:none;}
.lp-home-card svg:first-child{color:var(--brass-dark);flex:none;}
.lp-home-footnote{margin-top:22px;font-size:11.5px;color:var(--muted);text-align:center;font-style:italic;}

.lp-page{max-width:640px;margin:0 auto;padding-bottom:60px;}
.lp-page--manager{max-width:760px;}
.lp-topbar{position:sticky;top:0;z-index:5;display:flex;align-items:center;gap:10px;padding:14px 16px;background:var(--paper);border-bottom:1px solid var(--line);}
.lp-back{background:var(--panel);border:1px solid var(--line);border-radius:10px;width:34px;height:34px;display:flex;align-items:center;justify-content:center;cursor:pointer;color:var(--ink);}
.lp-topbar-title{font-family:'Fraunces',serif;font-weight:600;font-size:16px;}
.lp-signout{margin-left:auto;display:flex;align-items:center;gap:6px;background:none;border:1px solid var(--line);border-radius:8px;padding:6px 10px;font-size:12px;cursor:pointer;color:var(--muted);}

.lp-form{padding:18px 16px 0;}
.lp-section{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:16px;margin-bottom:14px;}
.lp-section-head{display:flex;align-items:center;gap:10px;margin-bottom:10px;}
.lp-section-n{width:22px;height:22px;border-radius:50%;background:var(--ink);color:var(--paper);font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center;font-family:'IBM Plex Mono',monospace;flex:none;}
.lp-section h3{font-family:'Fraunces',serif;font-size:15px;font-weight:600;margin:0;}
.lp-field{display:block;margin-bottom:12px;}
.lp-field:last-child{margin-bottom:0;}
.lp-field-label{display:block;font-size:12.5px;font-weight:600;margin-bottom:6px;color:var(--ink);}
.lp-input,.lp-textarea{width:100%;border:1px solid var(--line);background:#FCFBF8;border-radius:9px;padding:9px 11px;font-size:13.5px;font-family:'Public Sans',sans-serif;color:var(--ink);}
.lp-input:focus,.lp-textarea:focus{outline:2px solid var(--brass);outline-offset:0;border-color:var(--brass);}
.lp-locked-name{display:flex;align-items:center;gap:7px;border:1px solid var(--line);background:var(--stone);border-radius:9px;padding:9px 11px;font-size:13.5px;font-weight:600;color:var(--ink);}
.lp-textarea{resize:vertical;}
.lp-mt6{margin-top:6px;}
.lp-row2{display:grid;grid-template-columns:1fr 1fr;gap:12px;}
.lp-row3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;}
@media(max-width:520px){.lp-row3{grid-template-columns:1fr;}}
.lp-choices{display:flex;flex-wrap:wrap;gap:8px;}
.lp-assigned-for-you{border:1px solid var(--brass);background:#FBF4E8;border-radius:11px;padding:12px;margin-bottom:14px;}
.lp-assigned-for-you-list{list-style:none;margin:8px 0 0;padding:0;display:flex;flex-direction:column;gap:8px;}
.lp-assigned-for-you-list li{display:flex;align-items:center;justify-content:space-between;gap:10px;font-size:13px;}
.lp-assigned-actions{display:flex;align-items:center;gap:8px;flex:none;flex-wrap:wrap;justify-content:flex-end;}
.lp-ack-chip{font-size:12px;padding:5px 9px;}
.lp-ack-chip.is-acked{border-color:var(--green);color:var(--green);}
.lp-cal-head{display:flex;align-items:center;gap:8px;margin-bottom:10px;}
.lp-cal-head h4{flex:1;margin:0;}
.lp-cal-weekdays{display:grid;grid-template-columns:repeat(7,1fr);gap:4px;font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--ink-soft);text-align:center;margin-bottom:4px;}
.lp-cal-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:4px;}
.lp-cal-cell{position:relative;aspect-ratio:1;border:1px solid var(--line);border-radius:9px;background:#fff;font:inherit;font-size:13px;color:var(--ink);display:flex;align-items:center;justify-content:center;cursor:pointer;padding:0;}
.lp-cal-cell.is-empty{border:none;background:none;cursor:default;}
.lp-cal-cell.has-tasks{background:#FBF4E8;border-color:var(--brass);font-weight:700;}
.lp-cal-cell.is-today{box-shadow:inset 0 0 0 2px var(--brass);}
.lp-cal-cell.is-selected{background:var(--green);border-color:var(--green);color:#fff;}
.lp-cal-count{position:absolute;top:2px;right:3px;font-size:9px;font-weight:700;background:var(--green);color:#fff;border-radius:999px;min-width:13px;height:13px;line-height:13px;text-align:center;padding:0 3px;}
.lp-cal-cell.is-selected .lp-cal-count{background:#fff;color:var(--green);}
.lp-cal-selected{margin-top:14px;padding-top:12px;border-top:1px solid var(--line);}
.lp-assigned-edit-actions{display:flex;gap:8px;flex-wrap:wrap;}
.lp-assigned-day{border:1px solid var(--line);border-radius:11px;padding:10px 12px;margin-bottom:12px;}
.lp-assigned-day-head{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;padding-bottom:8px;border-bottom:1px dashed var(--line);margin-bottom:6px;}
.lp-assigned-day-date{display:inline-flex;align-items:center;gap:6px;font-weight:700;font-size:13px;}
.lp-ack-list{margin:6px 0 0;padding:0;list-style:none;font-size:12px;color:var(--green);display:flex;flex-direction:column;gap:2px;}
.lp-assigned-window{color:var(--brass-dark);font-style:normal;font-weight:600;}
.lp-assigned-meta .lp-tag{display:inline-flex;align-items:center;gap:4px;}
.lp-assigned-add{flex:none;white-space:nowrap;}
.lp-assigned-add:disabled{opacity:.6;cursor:default;border-style:solid;color:var(--green);border-color:var(--green);}
.lp-choice{border:1px solid var(--line);background:#FCFBF8;padding:8px 13px;border-radius:20px;font-size:12.5px;cursor:pointer;color:var(--ink);}
.lp-choice.is-active{background:var(--ink);border-color:var(--ink);color:var(--paper);}
.lp-checkbox-grid{display:flex;flex-wrap:wrap;gap:8px;}
.lp-checkbox-chip{display:flex;align-items:center;gap:6px;border:1px solid var(--line);background:#FCFBF8;padding:7px 12px;border-radius:20px;font-size:12.5px;cursor:pointer;}
.lp-checkbox-chip input{margin:0;}
.lp-hint{font-size:11.5px;color:var(--muted);margin:4px 0 0;}
.lp-error{color:var(--rust);font-size:12.5px;display:flex;align-items:center;gap:5px;margin-top:6px;}
.lp-error--block{background:#FBEAE7;border:1px solid #EFC6BE;padding:10px 12px;border-radius:10px;margin:4px 0 12px;}

.lp-task{border:1px solid var(--line);border-radius:11px;margin-bottom:10px;overflow:hidden;}
.lp-task-head{width:100%;display:flex;align-items:center;gap:10px;padding:11px 12px;background:var(--stone);border:none;cursor:pointer;text-align:left;}
.lp-task-num{width:20px;height:20px;border-radius:50%;background:var(--brass);color:#fff;font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center;flex:none;}
.lp-task-label{flex:1;font-size:13px;font-weight:600;}
.lp-rot{transform:rotate(180deg);transition:transform .15s ease;}
.lp-task-body{padding:12px;display:flex;flex-direction:column;gap:12px;}
.lp-btn-ghost{display:inline-flex;align-items:center;gap:6px;background:none;border:1px dashed var(--brass);color:var(--brass-dark);border-radius:9px;padding:8px 12px;font-size:12.5px;cursor:pointer;}
.lp-btn-danger{border-color:var(--rust);color:var(--rust);align-self:flex-start;}

.lp-photo-grid{display:flex;flex-wrap:wrap;gap:10px;}
.lp-photo-thumb{position:relative;width:84px;height:84px;border-radius:10px;overflow:hidden;border:1px solid var(--line);}
.lp-photo-thumb img{width:100%;height:100%;object-fit:cover;display:block;}
.lp-photo-remove{position:absolute;top:3px;right:3px;background:rgba(27,43,34,.75);border:none;color:#fff;border-radius:50%;width:19px;height:19px;display:flex;align-items:center;justify-content:center;cursor:pointer;}
.lp-photo-add{width:84px;height:84px;border-radius:10px;border:1px dashed var(--brass);background:#FCFBF8;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;font-size:10.5px;color:var(--brass-dark);cursor:pointer;}
.lp-file-hidden{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0;}
.lp-file-label{position:relative;cursor:pointer;display:inline-flex;}
.lp-file-label.is-disabled{opacity:.6;cursor:default;}

.lp-confirm{display:flex;gap:10px;align-items:flex-start;font-size:13px;padding:14px 16px;background:var(--panel);border:1px solid var(--line);border-radius:12px;margin:4px 0 14px;}
.lp-confirm input{margin-top:2px;}
.lp-submit{width:100%;background:var(--ink);color:var(--paper);border:none;border-radius:12px;padding:13px;font-size:14.5px;font-weight:600;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:8px;}
.lp-submit:disabled{opacity:.6;}

.lp-submitted{max-width:420px;margin:80px auto;text-align:center;padding:0 20px;}
.lp-submitted-icon{width:56px;height:56px;border-radius:50%;background:var(--green);color:#fff;display:flex;align-items:center;justify-content:center;margin:0 auto 16px;}
.lp-submitted h2{font-family:'Fraunces',serif;font-size:20px;margin:0 0 6px;}
.lp-submitted p{color:var(--muted);font-size:13.5px;margin:0 0 20px;}

.lp-gate{max-width:360px;margin:60px auto 0;text-align:center;padding:0 20px;}
.lp-gate-icon{width:50px;height:50px;border-radius:50%;background:var(--ink);color:var(--paper);display:flex;align-items:center;justify-content:center;margin:0 auto 14px;}
.lp-gate h2{font-family:'Fraunces',serif;font-size:19px;margin:0 0 6px;}
.lp-gate p{color:var(--muted);font-size:13px;margin:0 0 18px;}
.lp-gate-input{text-align:center;letter-spacing:.3em;font-family:'IBM Plex Mono',monospace;margin-bottom:10px;}
.lp-pin-mask{-webkit-text-security:disc;text-security:disc;}
.lp-gate-default{margin-top:14px;}

.lp-site-chips{display:flex;flex-wrap:wrap;gap:6px;margin:8px 0 4px;}
.lp-site-code{font-family:'IBM Plex Mono',monospace;font-size:9.5px;opacity:.65;margin-left:3px;}
.lp-person-list{display:flex;flex-direction:column;gap:10px;margin-top:10px;}
.lp-person-row{border:1px solid var(--line);border-radius:12px;padding:12px 14px;background:var(--panel);}
.lp-person-head{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;}
.lp-person-head strong{font-family:'Fraunces',serif;font-size:14px;margin-right:8px;}
.lp-person-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px;}
.lp-site-picker{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:6px;margin-top:10px;}
.lp-site-option{display:flex;align-items:center;gap:7px;font-size:12.5px;border:1px solid var(--line);border-radius:9px;padding:7px 9px;cursor:pointer;}
.lp-site-option.is-on{border-color:var(--brass);background:var(--stone);}
.lp-hint--muted{margin:8px 0 0;}

.lp-tabs{display:flex;gap:6px;padding:12px 16px 0;border-bottom:1px solid var(--line);overflow-x:auto;}
.lp-tab{background:none;border:none;padding:10px 14px;font-size:13px;font-weight:600;color:var(--muted);cursor:pointer;border-bottom:2px solid transparent;}
.lp-tab.is-active{color:var(--ink);border-color:var(--brass);}

.lp-brief{padding:20px 16px 0;}
.lp-datebar{display:flex;align-items:center;gap:8px;margin-bottom:16px;flex-wrap:wrap;}
.lp-nav-btn{width:32px;height:32px;border-radius:8px;border:1px solid var(--line);background:var(--panel);display:flex;align-items:center;justify-content:center;cursor:pointer;color:var(--ink);flex:none;}
.lp-datebar-input{width:auto;flex:none;font-weight:600;}
.lp-today-btn{margin-left:2px;}
.lp-brief-header{margin-bottom:18px;}
.lp-brief-header h2{font-family:'Fraunces',serif;font-size:22px;margin:2px 0 0;}
.lp-input--slim{width:auto;padding:7px 10px;font-size:12.5px;}
.lp-input--bare{border:none;background:none;flex:1;padding:0;}

.lp-worker-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;margin-bottom:18px;}
.lp-summary-panel{margin-bottom:20px;}
.lp-summary-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;}
.lp-summary-head h4{margin:0;}
.lp-summary-item{padding:12px 0;border-top:1px solid var(--line);}
.lp-summary-item:first-of-type{border-top:none;padding-top:0;}
.lp-summary-item strong{font-family:'Fraunces',serif;font-size:13.5px;}
.lp-summary-item p{font-size:13px;line-height:1.55;margin:5px 0 0;color:var(--ink);}
.lp-worker-card{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:16px;}
.lp-worker-card-head{display:flex;align-items:center;gap:8px;margin-bottom:10px;}
.lp-worker-dot{width:8px;height:8px;border-radius:50%;background:var(--brass);}
.lp-worker-card-head h3{font-family:'Fraunces',serif;font-size:15px;margin:0;}
.lp-worker-type{margin-left:auto;font-size:10.5px;color:var(--muted);background:var(--stone);padding:3px 8px;border-radius:10px;}
.lp-stat-list{list-style:none;padding:0;margin:0;display:flex;flex-direction:column;gap:7px;font-size:13px;}
.lp-stat-list li{display:flex;align-items:center;gap:8px;}
.lp-status-dot{width:9px;height:9px;border-radius:50%;flex:none;}
.lp-worker-delay{margin-top:10px;display:flex;gap:6px;font-size:12px;color:var(--rust);background:#FBEAE7;padding:8px 10px;border-radius:8px;}

.lp-brief-grid{display:grid;grid-template-columns:1.3fr 1fr;gap:14px;margin-bottom:20px;}
@media(max-width:640px){.lp-brief-grid{grid-template-columns:1fr;}}
.lp-panel{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:16px;}
.lp-panel h4{display:flex;align-items:center;gap:7px;font-family:'Fraunces',serif;font-size:14.5px;margin:0 0 2px;}
.lp-panel-sub{margin-bottom:12px;}
.lp-outstanding{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:12px;}
.lp-assign{padding:18px 16px 0;display:flex;flex-direction:column;gap:14px;}
.lp-assign-form h4{display:flex;align-items:center;gap:7px;font-family:'Fraunces',serif;font-size:14.5px;margin:0 0 6px;}
.lp-assign-form .lp-hint{margin-bottom:12px;}
.lp-assigned-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:12px;}
.lp-assigned-list li{border-top:1px solid var(--line);padding-top:12px;}
.lp-assigned-list li:first-child{border-top:none;padding-top:0;}
.lp-assigned-meta{display:flex;gap:6px;margin-bottom:6px;}
.lp-assigned-list p{font-size:13px;margin:0 0 8px;}
.lp-outstanding li{display:flex;gap:9px;}
.lp-out-dot{width:7px;height:7px;border-radius:50%;background:var(--rust);margin-top:6px;flex:none;}
.lp-outstanding strong{font-size:12.5px;}
.lp-outstanding p{font-size:12px;color:var(--muted);margin:2px 0;}
.lp-out-meta{font-size:10.5px;color:var(--muted);font-family:'IBM Plex Mono',monospace;}
.lp-week-stats{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:9px;font-size:13px;}
.lp-week-stats li{display:flex;align-items:center;gap:8px;}

.lp-empty{display:flex;flex-direction:column;align-items:center;gap:8px;padding:34px 0;color:var(--muted);text-align:center;}
.lp-empty--compact{padding:10px 0;flex-direction:row;justify-content:flex-start;}
.lp-empty svg{color:var(--brass);}

.lp-log{padding:18px 16px 0;}
.lp-log-search{display:flex;align-items:center;gap:8px;border:1px solid var(--line);background:var(--panel);border-radius:10px;padding:9px 12px;margin-bottom:14px;color:var(--muted);}
.lp-log-list{display:flex;flex-direction:column;gap:10px;}
.lp-log-entry{background:var(--panel);border:1px solid var(--line);border-radius:12px;overflow:hidden;}
.lp-log-entry-head{width:100%;display:flex;justify-content:space-between;align-items:center;padding:13px 14px;background:none;border:none;cursor:pointer;text-align:left;flex-wrap:wrap;gap:8px;}
.lp-log-entry-main{display:flex;align-items:center;gap:8px;font-size:13.5px;}
.lp-tag{font-size:10.5px;background:var(--stone);padding:3px 8px;border-radius:8px;color:var(--muted);}
.lp-tag--warn{background:#FBEAE7;color:var(--rust);display:flex;align-items:center;gap:4px;}
.lp-log-entry-meta{display:flex;align-items:center;gap:12px;font-size:11.5px;color:var(--muted);font-family:'IBM Plex Mono',monospace;}
.lp-log-entry-body{padding:0 14px 16px;border-top:1px solid var(--line);display:flex;flex-direction:column;gap:10px;padding-top:12px;font-size:13px;}
.lp-log-task{background:var(--stone);border-radius:9px;padding:10px 12px;}
.lp-log-task-head{display:flex;justify-content:space-between;align-items:center;gap:8px;}
.lp-log-task p{margin:4px 0 0;font-size:12.5px;}
.lp-status-pill{font-size:10px;padding:3px 8px;border-radius:8px;font-weight:600;background:#E4EFE5;color:var(--green);white-space:nowrap;}
.lp-status-pill--ongoing{background:#FBF0E2;color:var(--amber);}
.lp-status-pill--waiting-on-materials,.lp-status-pill--waiting-on-instruction{background:#FBEAE7;color:var(--rust);}
.lp-log-delete{border-top:1px dashed var(--line);padding-top:10px;margin-top:2px;}
.lp-log-delete-actions{display:flex;gap:8px;margin-top:8px;}
.lp-checkfail{display:inline-flex;align-items:center;gap:4px;color:var(--rust);font-weight:600;}

.lp-settings{padding:20px 16px;max-width:420px;}
.lp-settings h3{display:flex;align-items:center;gap:7px;font-family:'Fraunces',serif;font-size:16px;margin:0 0 6px;}
.lp-settings-row{display:flex;gap:8px;margin-top:10px;}
.lp-saved{color:var(--green);font-size:12px;display:flex;align-items:center;gap:5px;margin-top:8px;}
.lp-settings-note{margin-top:18px;line-height:1.5;}
.lp-settings-divider{border:none;border-top:1px solid var(--line);margin:26px 0 20px;}
.lp-staff-pin-list{display:flex;flex-direction:column;gap:8px;margin-top:10px;}
.lp-staff-pin-label{width:110px;font-size:13px;font-weight:600;flex:none;}
.lp-staff-pin-list .lp-settings-row{margin-top:0;align-items:center;}
.lp-settings-restore{margin-top:18px;padding-top:14px;border-top:1px dashed var(--line);}
.lp-confirm--tight{padding:10px 12px;margin:8px 0 12px;font-size:12.5px;}
`;
