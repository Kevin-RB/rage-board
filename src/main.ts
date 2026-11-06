// Rough layout prototype: no effects, no sound. Throwaway, never merged.
import { isTall, layOut, type Strategy, type Task } from "./layout";
import "./style.css";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

type State = {
  tasks: Task[];
  shiftHours: number;
  muted: boolean;
  volume: number;
  strategy: Strategy;
  placement: "rail" | "band";
  theme: "light" | "dark";
  nextId: number;
};

const KEY = "rage-board-layout-prototype";
const defaults: State = {
  tasks: [],
  shiftHours: 8,
  muted: false,
  volume: 70,
  strategy: "hybrid",
  placement: "rail",
  theme: "light",
  nextId: 1,
};

const load = (): State => ({ ...defaults, ...JSON.parse(localStorage.getItem(KEY) ?? "{}") });
let state = load();
const save = () => localStorage.setItem(KEY, JSON.stringify(state));

const STAGES = ["Calm", "Uneasy", "Stressed", "Unhinged"];
const stageName = (pct: number) => (pct >= 100 ? "Meltdown" : STAGES[Math.floor(pct / 25)]);

const formatTime = (minutes: number) => {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return [h && `${h}h`, m && `${m}m`].filter(Boolean).join(" ") || "0h";
};

const REQUESTS = [
  "Quick favour",
  "Update the Q3 deck",
  "Hop on a call about the call",
  "Can you just look at the printer",
  "Rebuild the budget spreadsheet",
  "Send the numbers again",
  "Review the review process",
  "Take notes at the offsite planning sync",
  "One small change to the homepage",
  "Fix the thing from last week",
  "Reformat all 240 invoices before the auditors arrive on Thursday",
  "Onboard the new contractor",
  "Chase legal",
  "Find out who owns this",
  "Clean up the shared drive",
  "Write the newsletter",
  "Prepare the board pack",
  "Migrate the wiki",
  "Book the team lunch",
  "Sit in on the vendor demo",
  "Rewrite the handover doc",
  "Answer the survey about surveys",
];
const ESTIMATES = [15, 15, 30, 30, 30, 60, 60, 60, 120, 120, 240];
const pick = <T,>(list: T[]) => list[Math.floor(Math.random() * list.length)];
const add = (title: string, minutes: number) => state.tasks.push({ id: state.nextId++, title, minutes });
const addFake = (minutes = pick(ESTIMATES)) => add(pick(REQUESTS), minutes);

function fillTo(percent: number) {
  state.tasks = [];
  const target = (state.shiftHours * 60 * percent) / 100;
  let total = 0;
  while (total < target) {
    const minutes = Math.min(pick(ESTIMATES), Math.ceil((target - total) / 15) * 15);
    addFake(minutes);
    total += minutes;
  }
}

const wall = $("wall");
const phoneQuery = matchMedia("(max-width: 700px)");

function render() {
  const { tasks, shiftHours, strategy, placement, theme } = state;
  document.documentElement.dataset.theme = theme;
  document.documentElement.dataset.placement = placement;

  const total = tasks.reduce((sum, t) => sum + t.minutes, 0);
  const pct = Math.round((total / (shiftHours * 60)) * 100);
  $("overload-value").textContent = `${pct}%`;
  $("meter-fill").style.inlineSize = `${Math.min(pct, 100)}%`;
  $("stage-name").textContent = stageName(pct);
  $("total-hours").textContent = formatTime(total);
  $("task-count").textContent = `${tasks.length} ${tasks.length === 1 ? "Task" : "Tasks"}`;
  $("empty").hidden = tasks.length > 0;

  const syncValue = (id: string, value: string) => {
    const el = $<HTMLInputElement>(id);
    if (document.activeElement !== el) el.value = value;
  };
  syncValue("shift", String(shiftHours));
  syncValue("volume", String(state.volume));
  syncValue("lab-strategy", strategy);
  syncValue("lab-placement", placement);
  syncValue("lab-theme", theme);
  const mute = $("mute");
  mute.textContent = state.muted ? "Muted" : "Sound on";
  mute.setAttribute("aria-pressed", String(state.muted));

  // clientWidth ignores the "View from" scaling, so distance doesn't change the layout.
  const layout = layOut(strategy, tasks, shiftHours * 60, wall.clientWidth, wall.clientHeight, phoneQuery.matches);

  wall.querySelectorAll(".card, .sizer").forEach((el) => el.remove());
  wall.classList.toggle("scrolls", strategy === "scroll");
  wall.classList.toggle("slots", !!layout.slot);
  if (layout.slot) {
    wall.style.setProperty("--slot-w", `${layout.slot.w}px`);
    wall.style.setProperty("--slot-h", `${layout.slot.h}px`);
  }
  if (layout.contentHeight > wall.clientHeight) {
    const sizer = document.createElement("div");
    sizer.className = "sizer";
    sizer.style.blockSize = `${layout.contentHeight}px`;
    wall.append(sizer);
  }

  for (const c of layout.cards) {
    const card = document.createElement("article");
    card.className = `card${c.piled ? " piled" : ""}${isTall(c.w, c.h) ? " tall" : ""}`;
    card.style.cssText =
      `inset-inline-start:${c.x}px;inset-block-start:${c.y}px;inline-size:${c.w}px;block-size:${c.h}px;` +
      `font-size:${c.font}px;--lines:${c.lines};rotate:${c.rot}deg`;

    const title = document.createElement("h3");
    title.textContent = c.task.title;
    const estimate = document.createElement("span");
    estimate.className = "card-estimate";
    estimate.textContent = formatTime(c.task.minutes);
    const actions = document.createElement("div");
    actions.className = "card-actions";
    for (const [label, name] of [["Done", "done"], ["Remove", "remove"]]) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = label;
      button.setAttribute("aria-label", `${label}: ${c.task.title}`);
      button.dataset.action = name;
      button.dataset.id = String(c.task.id);
      actions.append(button);
    }
    card.append(title, estimate, actions);
    wall.append(card);
  }
}

const commit = () => {
  save();
  render();
};

// The Board
$<HTMLFormElement>("add").addEventListener("submit", (event) => {
  event.preventDefault();
  const titleInput = $<HTMLInputElement>("title");
  const chosen = new FormData(event.target as HTMLFormElement).get("estimate");
  const minutes = chosen === "custom" ? Number($<HTMLInputElement>("custom").value) * 60 : Number(chosen);
  if (!titleInput.value.trim() || !(minutes > 0)) return;
  add(titleInput.value.trim(), minutes);
  titleInput.value = "";
  titleInput.focus();
  commit();
});

document.querySelector(".estimates")!.addEventListener("change", (event) => {
  $("custom-row").hidden = (event.target as HTMLInputElement).value !== "custom";
});

wall.addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest<HTMLElement>("[data-action]");
  if (!button) return;
  state.tasks = state.tasks.filter((t) => t.id !== Number(button.dataset.id));
  commit();
});

$<HTMLInputElement>("shift").addEventListener("input", (event) => {
  const hours = Number((event.target as HTMLInputElement).value);
  if (hours > 0) {
    state.shiftHours = hours;
    commit();
  }
});
$("mute").addEventListener("click", () => {
  state.muted = !state.muted;
  commit();
});
$<HTMLInputElement>("volume").addEventListener("input", (event) => {
  state.volume = Number((event.target as HTMLInputElement).value);
  commit();
});

const confirmDialog = $<HTMLDialogElement>("confirm");
$("new-day").addEventListener("click", () => confirmDialog.showModal());
confirmDialog.addEventListener("close", () => {
  if (confirmDialog.returnValue === "ok") {
    state.tasks = [];
    commit();
  }
});

// Prototype controls
const lab = $<HTMLFormElement>("lab");
const embedded = new URLSearchParams(location.search).has("embed");
lab.hidden = embedded;

lab.addEventListener("submit", (event) => event.preventDefault());
lab.addEventListener("click", (event) => {
  const { fill, add: addCount, case: awkward } = (event.target as HTMLElement).dataset;
  if (fill) fillTo(Number(fill));
  else if (addCount) for (let i = 0; i < Number(addCount); i++) addFake();
  else if (awkward === "many") {
    state.tasks = [];
    for (let i = 0; i < 100; i++) addFake();
  } else if (awkward === "tiny") {
    state.tasks = [];
    for (let i = 0; i < 50; i++) addFake(15);
  } else if (awkward === "huge") {
    state.tasks = [];
    add("Rebuild the entire reporting system", 720);
  } else return;
  commit();
});

$<HTMLSelectElement>("lab-strategy").addEventListener("change", (e) => {
  state.strategy = (e.target as HTMLSelectElement).value as Strategy;
  commit();
});
$<HTMLSelectElement>("lab-placement").addEventListener("change", (e) => {
  state.placement = (e.target as HTMLSelectElement).value as State["placement"];
  commit();
});
$<HTMLSelectElement>("lab-theme").addEventListener("change", (e) => {
  state.theme = (e.target as HTMLSelectElement).value as State["theme"];
  commit();
});
// Assumes about 70 cm from the screen at your desk: at twice the distance, things look half the size.
$<HTMLSelectElement>("lab-distance").addEventListener("change", (e) => {
  document.documentElement.style.setProperty("--view-scale", (e.target as HTMLSelectElement).value);
});

$("lab-phone").addEventListener("click", () => {
  const frame = $<HTMLIFrameElement>("phone-frame");
  if (!frame.src) frame.src = `${location.pathname}?embed`;
  $<HTMLDialogElement>("phone").showModal();
});
const toggleLab = () => lab.classList.toggle("is-hidden");
$("lab-hide").addEventListener("click", toggleLab);
addEventListener("keydown", (event) => {
  const typing = (event.target as HTMLElement).matches("input, select");
  if (event.key.toLowerCase() === "h" && !typing) toggleLab();
});

// Keep the desktop and the phone view in step, and redraw when the wall changes size.
addEventListener("storage", (event) => {
  if (event.key === KEY) {
    state = load();
    render();
  }
});
new ResizeObserver(render).observe(wall);

const syncUtilities = () => {
  $<HTMLDetailsElement>("utilities").open = !phoneQuery.matches;
};
phoneQuery.addEventListener("change", syncUtilities);
syncUtilities();

$("today").textContent = new Date().toLocaleDateString(undefined, {
  weekday: "long",
  day: "numeric",
  month: "long",
});
render();
