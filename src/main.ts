// Rough layout prototype: no effects, no sound. Throwaway, never merged.
import "@fontsource/comic-relief/latin-400.css";
import "@fontsource/comic-relief/latin-700.css";
import {
  Angry, Briefcase, Check, Clock, Coffee, createElement, createIcons, Flame, Frown, Grip, Hourglass, Meh,
  Minus, Plus, Shuffle, Smile, StickyNote, Sunrise, Trash2, Volume2, VolumeX, X, type IconNode,
} from "lucide";
import { layOut, noteSize, type Task } from "./layout";
import "./style.css";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

type State = {
  tasks: Task[];
  shiftHours: number;
  muted: boolean;
  volume: number;
  font: "relief" | "comic" | "clean";
  surface: "cork" | "dots";
  nextId: number;
};

const KEY = "rage-board-layout-prototype-v3";
const defaults: State = {
  tasks: [],
  shiftHours: 8,
  muted: false,
  volume: 70,
  font: "relief",
  surface: "cork",
  nextId: 1,
};

const load = (): State => ({ ...defaults, ...JSON.parse(localStorage.getItem(KEY) ?? "{}") });
let state = load();
const save = () => localStorage.setItem(KEY, JSON.stringify(state));

const STAGES: { name: string; icon: IconNode }[] = [
  { name: "Calm", icon: Smile },
  { name: "Uneasy", icon: Meh },
  { name: "Stressed", icon: Frown },
  { name: "Unhinged", icon: Angry },
  { name: "Meltdown", icon: Flame },
];
const stageOf = (pct: number) => STAGES[Math.min(4, Math.floor(pct / 25))];

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
const LONG_REQUESTS = [
  "Reformat all 240 invoices before the auditors arrive on Thursday, and make sure the totals still match the old spreadsheet",
  "Can you pull together a short summary of everything that happened on the migration project since March, including who decided what and why, in case anyone asks at the quarterly review next week, and keep it to one page",
  "Quick one: find out why the shared calendar shows every meeting twice for people in the Brisbane office but only on Tuesdays, write up what you find, tell the whole team, and then fix it before the all-hands, because the CEO noticed it this morning and has already asked about it twice and would really like an answer today please",
];
const ESTIMATES = [15, 15, 30, 30, 30, 60, 60, 60, 120, 120, 240];
const COLORS = ["yellow", "pink", "green", "blue", "orange", "purple"];
const pick = <T,>(list: T[]) => list[Math.floor(Math.random() * list.length)];
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

function icon(node: IconNode) {
  const svg = createElement(node);
  svg.setAttribute("aria-hidden", "true");
  return svg;
}

const wall = $("wall");

/**
 * Long titles shrink until the whole thing fits on the note. A title too long for even the
 * smallest size fades out at the bottom, and the full text is one click away in the editor.
 */
function fitTitle(card: HTMLElement, title: HTMLElement, size: number) {
  const smallest = Math.max(11, size * 0.06);
  let font = size * 0.15;
  title.style.fontSize = `${font}px`;
  while (font > smallest && (title.scrollHeight > title.clientHeight + 1 || title.scrollWidth > title.clientWidth + 1)) {
    font = Math.max(smallest, font * 0.92);
    title.style.fontSize = `${font}px`;
  }
  if (title.scrollHeight > title.clientHeight + 1) {
    card.classList.add("cut-off");
    card.title = title.textContent ?? "";
  }
}

function render() {
  const { tasks, shiftHours, font, surface } = state;
  const total = tasks.reduce((sum, t) => sum + t.minutes, 0);
  const pct = Math.round((total / (shiftHours * 60)) * 100);
  const stage = stageOf(pct);

  const root = document.documentElement;
  root.dataset.font = font;
  root.dataset.surface = surface;
  root.dataset.stage = stage.name.toLowerCase();

  $("overload-value").textContent = `${pct}%`;
  $("meter-fill").style.inlineSize = `${Math.min(pct, 100)}%`;
  $("stage-name").textContent = stage.name;
  $("stage-icon").replaceChildren(icon(stage.icon));
  $("total-hours").textContent = formatTime(total);
  $("task-count").textContent = String(tasks.length);
  $("shift").textContent = `${shiftHours}h`;
  $("empty").hidden = tasks.length > 0;

  $<HTMLInputElement>("volume").value = String(state.volume);
  $<HTMLSelectElement>("lab-font").value = font;
  const surfaceLabel = surface === "cork" ? "Switch to dotted paper" : "Switch to corkboard";
  $("surface").setAttribute("aria-label", surfaceLabel);
  $("surface").title = surfaceLabel;
  const mute = $("mute");
  mute.setAttribute("aria-pressed", String(state.muted));
  mute.setAttribute("aria-label", state.muted ? "Unmute" : "Mute");

  // clientWidth ignores the "View from" scaling, so distance doesn't change the layout.
  const size = noteSize(wall.clientWidth, wall.clientHeight);
  wall.querySelectorAll(".card").forEach((el) => el.remove());

  for (const { task, x, y, rot } of layOut(tasks, wall.clientWidth, wall.clientHeight)) {
    const card = document.createElement("article");
    card.className = "card";
    card.dataset.id = String(task.id);
    card.dataset.note = task.color;
    card.style.cssText =
      `inset-inline-start:${x}px;inset-block-start:${y}px;inline-size:${size}px;block-size:${size}px;` +
      `--note-size:${size}px;rotate:${rot}deg`;

    const title = document.createElement("h3");
    title.textContent = task.title;

    const estimate = document.createElement("span");
    estimate.className = "card-estimate";
    estimate.textContent = formatTime(task.minutes);

    const done = document.createElement("button");
    done.type = "button";
    done.className = "card-done";
    done.dataset.done = String(task.id);
    done.setAttribute("aria-label", `Done: ${task.title}`);
    done.append(icon(Check));

    card.append(title, estimate, done);
    wall.append(card);
    fitTitle(card, title, size);
  }

  // A new Task's landing spot is worked out during layout, so keep it.
  save();
}

const commit = () => {
  save();
  render();
};

// Adding a Task
const titleInput = $<HTMLInputElement>("title");
const estimateSelect = $<HTMLSelectElement>("estimate");
let chosenColor = "random";

$<HTMLFormElement>("add").addEventListener("submit", (event) => {
  event.preventDefault();
  const custom = estimateSelect.value === "custom";
  const minutes = custom ? Number($<HTMLInputElement>("custom").value) * 60 : Number(estimateSelect.value);
  if (!titleInput.value.trim() || !(minutes > 0)) return;
  add(titleInput.value.trim(), minutes, chosenColor === "random" ? undefined : chosenColor);
  titleInput.value = "";
  titleInput.focus();
  commit();
});

estimateSelect.addEventListener("change", () => {
  $("custom-row").hidden = estimateSelect.value !== "custom";
});

function swatchButton(color: string, attribute: string) {
  const swatch = document.createElement("button");
  swatch.type = "button";
  swatch.className = "swatch";
  swatch.dataset.note = color;
  swatch.setAttribute(attribute, color);
  swatch.setAttribute("aria-label", color);
  return swatch;
}

const showChosenColor = () => {
  const current = $("color-current");
  if (chosenColor === "random") current.replaceChildren(icon(Shuffle));
  else {
    const dot = document.createElement("span");
    dot.className = "swatch";
    dot.dataset.note = chosenColor;
    current.replaceChildren(dot);
  }
  $("color-label").textContent = chosenColor === "random" ? "Random" : chosenColor[0].toUpperCase() + chosenColor.slice(1);
};

for (const color of COLORS) $("color-swatches").append(swatchButton(color, "data-pick"));
$("color-menu").addEventListener("click", (event) => {
  const choice = (event.target as HTMLElement).closest<HTMLElement>("[data-pick]");
  if (!choice) return;
  chosenColor = choice.dataset.pick!;
  showChosenColor();
  $("color-menu").hidePopover();
});
showChosenColor();

// The note, up close
const editor = $<HTMLDialogElement>("editor");
const editorTitle = $<HTMLTextAreaElement>("editor-title");
const editorHours = $<HTMLInputElement>("editor-hours");
let editingId: number | null = null;
const editing = () => state.tasks.find((t) => t.id === editingId);

function openEditor(task: Task) {
  editingId = task.id;
  editor.dataset.note = task.color;
  editorTitle.value = task.title;
  editorHours.value = String(task.minutes / 60);
  markEditorColor(task.color);
  editor.showModal();
  editorTitle.focus();
}

function markEditorColor(color: string) {
  $("editor-swatches").querySelectorAll<HTMLElement>(".swatch").forEach((swatch) => {
    swatch.setAttribute("aria-pressed", String(swatch.dataset.note === color));
  });
}

for (const color of COLORS) $("editor-swatches").append(swatchButton(color, "data-recolor"));

editorTitle.addEventListener("input", () => {
  const task = editing();
  // A blank title isn't saved, so clearing the box by accident can't lose the note's text.
  if (task && editorTitle.value.trim()) {
    task.title = editorTitle.value.trim();
    commit();
  }
});
editorHours.addEventListener("input", () => {
  const task = editing();
  const hours = Number(editorHours.value);
  if (task && hours > 0) {
    task.minutes = hours * 60;
    commit();
  }
});
$("editor-swatches").addEventListener("click", (event) => {
  const swatch = (event.target as HTMLElement).closest<HTMLElement>("[data-recolor]");
  const task = editing();
  if (!swatch || !task) return;
  task.color = swatch.dataset.recolor!;
  editor.dataset.note = task.color;
  markEditorColor(task.color);
  commit();
});

const removeEditing = () => {
  state.tasks = state.tasks.filter((t) => t.id !== editingId);
  editor.close();
  commit();
};
$("editor-done").addEventListener("click", removeEditing);
$("editor-remove").addEventListener("click", removeEditing);
editor.addEventListener("close", () => {
  editingId = null;
});
// Clicking the dim area around the note closes it.
editor.addEventListener("click", (event) => {
  if (event.target === editor) {
    const box = editor.getBoundingClientRect();
    const outside =
      event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom;
    if (outside) editor.close();
  }
});

// Notes on the wall
wall.addEventListener("click", (event) => {
  const done = (event.target as HTMLElement).closest<HTMLElement>("[data-done]");
  if (!done) return;
  state.tasks = state.tasks.filter((t) => t.id !== Number(done.dataset.done));
  commit();
});

// Drag a note anywhere on the wall. A press without movement opens it instead.
wall.addEventListener("pointerdown", (event) => {
  const target = event.target as HTMLElement;
  const el = target.closest<HTMLElement>(".card");
  if (!el || target.closest("button")) return;

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
    // Whatever you touch comes to the top of the pile. Later in the list draws on top.
    state.tasks = [...state.tasks.filter((t) => t !== task), task];
    commit();
    if (!moved) openEditor(task);
  };

  el.addEventListener("pointermove", onMove);
  el.addEventListener("pointerup", finish);
  el.addEventListener("pointercancel", finish);
});

// Shift and sound
const changeShift = (by: number) => {
  state.shiftHours = Math.min(24, Math.max(1, state.shiftHours + by));
  commit();
};
$("shift-down").addEventListener("click", () => changeShift(-0.5));
$("shift-up").addEventListener("click", () => changeShift(0.5));
$("mute").addEventListener("click", () => {
  state.muted = !state.muted;
  commit();
});
$<HTMLInputElement>("volume").addEventListener("input", (event) => {
  state.volume = Number((event.target as HTMLInputElement).value);
  commit();
});

$("surface").addEventListener("click", () => {
  state.surface = state.surface === "cork" ? "dots" : "cork";
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
  } else if (awkward === "long") {
    state.tasks = [];
    for (const title of LONG_REQUESTS) add(title, 60);
  } else if (awkward === "huge") {
    state.tasks = [];
    add("Rebuild the entire reporting system", 720);
  } else return;
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
  const typing = (event.target as HTMLElement).matches("input, select, textarea");
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

createIcons({
  icons: { Briefcase, Check, Clock, Coffee, Grip, Hourglass, Minus, Plus, Shuffle, StickyNote, Sunrise, Trash2, Volume2, VolumeX, X },
  attrs: { "aria-hidden": "true" },
});

$("today").textContent = new Date().toLocaleDateString(undefined, {
  weekday: "long",
  day: "numeric",
  month: "long",
});
render();
// Titles are fitted by measuring them, so measure again once the bundled font has arrived.
document.fonts.ready.then(render);
