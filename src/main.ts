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
  theme: "auto" | "light" | "dark";
  font: "comic" | "clean";
  nextId: number;
};

const KEY = "rage-board-layout-prototype-v2";
const defaults: State = {
  tasks: [],
  shiftHours: 8,
  muted: false,
  volume: 70,
  strategy: "pile",
  placement: "rail",
  theme: "auto",
  font: "comic",
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
const COLORS = ["yellow", "pink", "green", "blue", "orange", "purple"];
const add = (title: string, minutes: number, color = pick(COLORS)) =>
  state.tasks.push({ id: state.nextId++, title, minutes, color });
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
let selectedId: number | null = null;

function render() {
  const { tasks, shiftHours, strategy, placement, theme, font } = state;
  const total = tasks.reduce((sum, t) => sum + t.minutes, 0);
  const pct = Math.round((total / (shiftHours * 60)) * 100);

  const root = document.documentElement;
  root.dataset.theme = theme === "auto" ? (pct >= 100 ? "dark" : "light") : theme;
  root.dataset.placement = placement;
  root.dataset.font = font;

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
  syncValue("lab-font", font);
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
    card.classList.toggle("selected", c.task.id === selectedId);
    card.dataset.id = String(c.task.id);
    card.dataset.note = c.task.color;
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
    for (const color of COLORS) {
      const swatch = document.createElement("button");
      swatch.type = "button";
      swatch.className = "swatch";
      swatch.dataset.note = color;
      swatch.dataset.recolor = color;
      swatch.setAttribute("aria-label", `Make it ${color}`);
      swatch.setAttribute("aria-pressed", String(c.task.color === color));
      actions.append(swatch);
    }
    card.append(title, estimate, actions);
    wall.append(card);
  }

  // A new Task's landing spot is worked out during layout, so keep it.
  save();
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
  const color = new FormData(event.target as HTMLFormElement).get("color") as string;
  add(titleInput.value.trim(), minutes, color === "random" ? undefined : color);
  titleInput.value = "";
  titleInput.focus();
  commit();
});

document.querySelector(".estimates")!.addEventListener("change", (event) => {
  $("custom-row").hidden = (event.target as HTMLInputElement).value !== "custom";
});

for (const color of COLORS) {
  const label = document.createElement("label");
  const input = document.createElement("input");
  input.type = "radio";
  input.name = "color";
  input.value = color;
  input.setAttribute("aria-label", color);
  const swatch = document.createElement("span");
  swatch.className = "swatch";
  swatch.dataset.note = color;
  label.append(input, swatch);
  $("colors").append(label);
}

wall.addEventListener("click", (event) => {
  const target = event.target as HTMLElement;
  const button = target.closest<HTMLElement>("[data-action]");
  if (button) {
    state.tasks = state.tasks.filter((t) => t.id !== Number(button.dataset.id));
    selectedId = null;
    commit();
    return;
  }
  const swatch = target.closest<HTMLElement>("[data-recolor]");
  if (swatch) {
    const id = Number(swatch.closest<HTMLElement>(".card")!.dataset.id);
    state.tasks.find((t) => t.id === id)!.color = swatch.dataset.recolor!;
    commit();
    return;
  }
  // A click on bare wall lets go of the selected note. Clicks on notes are handled on pointerup.
  if (!target.closest(".card") && selectedId !== null) {
    selectedId = null;
    render();
  }
});

// Drag a note anywhere on the wall. A press without movement selects it instead.
wall.addEventListener("pointerdown", (event) => {
  const target = event.target as HTMLElement;
  const el = target.closest<HTMLElement>(".card");
  if (!el || target.closest("button") || state.strategy === "scroll") return;

  // "View from" shrinks the Board, so pointer movement has to be scaled back up to match.
  const scale = Number(getComputedStyle(document.documentElement).getPropertyValue("--view-scale")) || 1;
  const task = state.tasks.find((t) => t.id === Number(el.dataset.id))!;
  const roomX = Math.max(0, wall.clientWidth - el.offsetWidth);
  const roomY = Math.max(0, wall.clientHeight - el.offsetHeight);
  const startX = el.offsetLeft;
  const startY = el.offsetTop;
  let x = startX;
  let y = startY;
  let moved = false;

  el.setPointerCapture(event.pointerId);

  const onMove = (move: PointerEvent) => {
    const dx = (move.clientX - event.clientX) / scale;
    const dy = (move.clientY - event.clientY) / scale;
    if (!moved && Math.hypot(dx, dy) < 4) return;
    moved = true;
    el.classList.add("dragging");
    x = Math.min(roomX, Math.max(0, startX + dx));
    y = Math.min(roomY, Math.max(0, startY + dy));
    el.style.insetInlineStart = `${x}px`;
    el.style.insetBlockStart = `${y}px`;
  };

  const finish = (end: PointerEvent) => {
    el.removeEventListener("pointermove", onMove);
    el.removeEventListener("pointerup", finish);
    el.removeEventListener("pointercancel", finish);
    if (end.type === "pointercancel") {
      render();
      return;
    }
    if (moved) task.pin = { x: roomX ? x / roomX : 0, y: roomY ? y / roomY : 0 };
    else selectedId = selectedId === task.id ? null : task.id;
    // Whatever you touch comes to the top of the pile. Later in the list draws on top.
    if (state.strategy === "pile") {
      state.tasks = [...state.tasks.filter((t) => t !== task), task];
    }
    commit();
  };

  el.addEventListener("pointermove", onMove);
  el.addEventListener("pointerup", finish);
  el.addEventListener("pointercancel", finish);
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
$<HTMLSelectElement>("lab-font").addEventListener("change", (e) => {
  state.font = (e.target as HTMLSelectElement).value as State["font"];
  commit();
});
$("lab-reset").addEventListener("click", () => {
  for (const task of state.tasks) {
    delete task.pin;
    delete task.spot;
  }
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
