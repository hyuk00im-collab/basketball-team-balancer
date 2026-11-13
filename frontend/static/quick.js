/* 약식 팀 편성 — 가드/포워드 2분류, 6항목 + 키, 무작위 랜덤 */
import { createQuickMemberSheet } from "./quick-sheet.js";

const $ = (sel) => document.querySelector(sel);

const SKILL_DEFS = [
  { key: "슈팅",     label: "슈팅",        desc: "슛 정확도 전반" },
  { key: "드리블",   label: "드리블",      desc: "볼핸들링·돌파" },
  { key: "패스",     label: "패스/시야",   desc: "코트비전·패스 능력" },
  { key: "수비",     label: "수비",        desc: "개인 수비 전반" },
  { key: "리바운드", label: "리바운드",    desc: "골밑 장악·박스아웃" },
  { key: "체력",     label: "체력/스피드", desc: "운동 능력·지구력" },
];

const TEAM_COLORS = ["#e8622c", "#2563eb", "#059669", "#7c3aed"];
const TEAM_NAMES  = ["팀 A", "팀 B", "팀 C", "팀 D"];
const POSITIONS   = ["가드", "포워드"];
const DEFAULT_POSITION = POSITIONS[0];

const STORAGE_KEY = "quick_members";
let members    = [];
let nextId     = 1;
let TEAMS      = [];
let SHEET      = null;
let DRAGGING   = null;
let DRAG_MOVED = false;

/* ------------------------------------------------------------------ 스토리지 */
function saveMembers() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ members, nextId }));
}
function loadMembers() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const p = JSON.parse(raw);
    members = p.members || [];
    nextId  = p.nextId  || members.length + 1;
  } catch (_) { members = []; }
}

/* ------------------------------------------------------------------ 유틸 */
function setMsg(el, text, kind = "") {
  el.className = "msg " + kind;
  el.textContent = text || "";
}
function setMsgList(el, title, items, kind = "") {
  el.className = "msg " + kind;
  el.innerHTML = "";
  if (title) el.append(title);
  if (items && items.length) {
    const ul = document.createElement("ul");
    items.forEach((t) => { const li = document.createElement("li"); li.textContent = t; ul.append(li); });
    el.append(ul);
  }
}
function calcLevel(skills) {
  const vals = SKILL_DEFS.map((s) => skills[s.key] ?? 3);
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}
function allMembers() {
  return TEAMS.flatMap((t) => t.members);
}

/* ------------------------------------------------------------------ 슬라이더 */
function renderSkillFields() {
  const box = $("#skillFields");
  box.innerHTML = "";
  SKILL_DEFS.forEach((s) => {
    const row = document.createElement("div");
    row.className = "skill-row";
    const label = document.createElement("span");
    label.textContent = s.label; label.title = s.desc;
    const range = document.createElement("input");
    range.type = "range"; range.min = "0"; range.max = "5"; range.step = "0.5"; range.value = "3";
    range.dataset.skill = s.key;
    const val = document.createElement("span");
    val.className = "val"; val.textContent = "3.0";
    range.addEventListener("input", () => { row.classList.add("filled"); val.textContent = Number(range.value).toFixed(1); });
    row.append(label, range, val);
    box.append(row);
  });
}
function collectSkills() {
  const skills = {};
  $("#skillFields").querySelectorAll("input[type=range]").forEach((r) => { skills[r.dataset.skill] = Number(r.value); });
  return skills;
}
function resetSkillFields() {
  $("#skillFields").querySelectorAll(".skill-row").forEach((row) => {
    const r = row.querySelector("input[type=range]");
    r.value = "3"; row.classList.remove("filled"); row.querySelector(".val").textContent = "3.0";
  });
}

/* ------------------------------------------------------------------ 입력 인원 목록 */
function renderMembers() {
  const body = $("#memberBody");
  $("#memberCount").textContent = members.length;
  body.innerHTML = "";
  if (!members.length) {
    body.innerHTML = '<tr class="empty"><td colspan="7">아직 등록된 인원이 없습니다.</td></tr>';
  } else {
    members.forEach((m) => {
      const tr = document.createElement("tr");

      const tdName = document.createElement("td");
      tdName.textContent = m.name;
      if (m.is_guest)  { const g = document.createElement("span"); g.className = "guest"; g.textContent = "게스트"; tdName.append(g); }
      if (m.estimated) { const e = document.createElement("span"); e.className = "est";   e.textContent = "추정";   tdName.append(e); }

      const tdPos = document.createElement("td");
      const posTag = document.createElement("span");
      posTag.className = "pos " + (m.position || DEFAULT_POSITION);
      posTag.textContent = m.position || DEFAULT_POSITION;
      tdPos.append(posTag);

      const tdLv = document.createElement("td");
      tdLv.className = "num"; tdLv.textContent = m.level.toFixed(1);

      const tdAge = document.createElement("td");
      tdAge.className = "num"; tdAge.textContent = m.age ? m.age : "—";

      const tdH = document.createElement("td");
      tdH.className = "num"; tdH.textContent = m.height_cm ? m.height_cm + "cm" : "—";

      const tdBars = document.createElement("td");
      const barsWrap = document.createElement("div"); barsWrap.className = "tm-bars";
      SKILL_DEFS.forEach((s) => {
        const bar = document.createElement("span"); bar.className = "mini-bar";
        bar.style.setProperty("--v", `${((m.skills[s.key] ?? 3) / 5) * 100}%`);
        bar.title = `${s.label}: ${m.skills[s.key] ?? 3}`; barsWrap.append(bar);
      });
      tdBars.append(barsWrap);

      const tdDel = document.createElement("td");
      const btn = document.createElement("button"); btn.className = "del"; btn.title = "삭제"; btn.textContent = "×";
      btn.addEventListener("click", () => { members = members.filter((x) => x.id !== m.id); saveMembers(); renderMembers(); });
      tdDel.append(btn);

      tr.append(tdName, tdPos, tdLv, tdAge, tdH, tdBars, tdDel);
      body.append(tr);
    });
  }
  renderStats();
  $("#generateBtn").disabled = members.length < 2;
}

function renderStats() {
  const row = $("#statRow"); row.innerHTML = "";
  if (!members.length) return;
  const avg = members.reduce((s, m) => s + m.level, 0) / members.length;
  const k   = Number($("#teamCount").value);
  const base = Math.floor(members.length / k);
  const rem  = members.length % k;
  const sizes = Array.from({ length: k }, (_, i) => base + (i < rem ? 1 : 0)).join("-");
  const withHeight = members.filter((m) => m.height_cm).length;
  const guards  = members.filter((m) => (m.position || DEFAULT_POSITION) === "가드").length;
  const forwards = members.length - guards;
  const pills = [
    `총원 <b>${members.length}</b>명`,
    `가드 <b>${guards}</b> · 포워드 <b>${forwards}</b>`,
    `평균 레벨 <b>${avg.toFixed(1)}</b>`,
    `${k}팀 배분 <b>${sizes}</b>`,
  ];
  if (withHeight) {
    const avgH = members.filter((m) => m.height_cm).reduce((s, m) => s + m.height_cm, 0) / withHeight;
    pills.push(`평균 키 <b>${avgH.toFixed(1)}cm</b>`);
  }
  const withAge = members.filter((m) => m.age).length;
  if (withAge) {
    const avgAge = members.filter((m) => m.age).reduce((s, m) => s + m.age, 0) / withAge;
    pills.push(`평균 나이 <b>${avgAge.toFixed(1)}세</b>`);
  }
  pills.forEach((html) => {
    const p = document.createElement("span"); p.className = "pill"; p.innerHTML = html; row.append(p);
  });
}

/* ------------------------------------------------------------------ 파일 업로드 */
async function uploadFile(file) {
  const msg = $("#uploadMsg");
  if (!file) return;
  setMsg(msg, `'${file.name}' 업로드 중…`);
  const form = new FormData(); form.append("file", file);
  try {
    const res  = await fetch("/api/quick/upload", { method: "POST", body: form });
    const text = await res.text();
    const data = text ? JSON.parse(text) : null;
    if (!res.ok) throw new Error((data && data.detail) || `요청 실패 (${res.status})`);
    (data.added || []).forEach((m) => members.push({ ...m, id: nextId++ }));
    saveMembers(); renderMembers();
    setMsgList(msg, `${data.added.length}명을 불러왔습니다.`, data.warnings, data.warnings.length ? "" : "ok");
  } catch (err) { setMsg(msg, err.message, "error"); }
}
function bindUpload() {
  const zone = $("#dropzone"), input = $("#fileInput");
  zone.addEventListener("click", () => input.click());
  input.addEventListener("change", () => { uploadFile(input.files[0]); input.value = ""; });
  ["dragenter", "dragover"].forEach((ev) => zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.add("over"); }));
  ["dragleave", "drop"].forEach((ev)    => zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.remove("over"); }));
  zone.addEventListener("drop", (e) => uploadFile(e.dataTransfer.files[0]));
}
async function downloadXlsx(url, filename, btn) {
  const label = btn.textContent; btn.disabled = true; btn.textContent = "준비 중…";
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error("파일을 만들지 못했습니다.");
    const blob = await res.blob();
    const href = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = href; a.download = filename; a.click();
    URL.revokeObjectURL(href);
  } catch (err) { setMsg($("#uploadMsg"), err.message, "error"); }
  finally { btn.disabled = false; btn.textContent = label; }
}

/* ------------------------------------------------------------------ 편성 */
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function buildTeams(k) {
  const shuffled = shuffle(members);
  const teams = Array.from({ length: k }, (_, i) => ({
    idx: i, name: TEAM_NAMES[i] || `팀 ${i + 1}`,
    color: TEAM_COLORS[i] || "#555", members: [],
  }));
  shuffled.forEach((m, j) => teams[j % k].members.push(m));
  return teams;
}

/* ------------------------------------------------------------------ 메트릭 */
function metricCard(label, value, note, state) {
  const div = document.createElement("div");
  div.className = "metric" + (state ? " " + state : "");
  div.innerHTML = `<div class="m-label"></div><div class="m-value"></div><div class="m-note"></div>`;
  div.querySelector(".m-label").textContent = label;
  div.querySelector(".m-value").textContent = value;
  div.querySelector(".m-note").textContent  = note || "";
  return div;
}

function renderMetrics(teams) {
  const grid = $("#metricGrid"); grid.innerHTML = "";

  const sizes      = teams.map((t) => t.members.length);
  const sizeSpread = Math.max(...sizes) - Math.min(...sizes);
  const guardCounts = teams.map((t) => t.members.filter((m) => (m.position || DEFAULT_POSITION) === "가드").length);
  const guardSpread = Math.max(...guardCounts) - Math.min(...guardCounts);

  grid.append(
    metricCard("총 인원", String(allMembers().length), `${teams.length}팀 배분`, ""),
    metricCard("팀별 인원수", sizes.join("-"), "최대 − 최소", sizeSpread <= 1 ? "good" : "bad"),
    metricCard("가드 인원수 편차", String(guardSpread), "팀간 가드 수 최대 − 최소", guardSpread <= 1 ? "good" : "bad"),
    ...teams.map((t, i) => metricCard(
      `${t.name} 구성`,
      `가드 ${guardCounts[i]} · 포워드 ${t.members.length - guardCounts[i]}`,
      `인원 ${t.members.length}명`, ""
    ))
  );
}

/* ------------------------------------------------------------------ 인원 이동 */
function moveMember(memberId, toTeamIdx) {
  const src = TEAMS.findIndex((t) => t.members.some((m) => m.id === memberId));
  if (src === toTeamIdx || src === -1) return;
  const mover = TEAMS[src].members.find((m) => m.id === memberId);
  TEAMS[src].members = TEAMS[src].members.filter((m) => m.id !== memberId);
  TEAMS[toTeamIdx].members.push(mover);
  renderResult(TEAMS, false);
  flashMoved(memberId);
}
function flashMoved(memberId) {
  const li = document.querySelector(`.roster li[data-member-id="${memberId}"]`);
  if (!li) return;
  li.classList.add("moved"); li.scrollIntoView({ block: "nearest" });
  setTimeout(() => li.classList.remove("moved"), 1400);
}

/* ------------------------------------------------------------------ 결과 렌더 */
function renderResult(teams, scroll = true) {
  TEAMS = teams;
  renderMetrics(teams);

  const box = $("#teamsArea"); box.innerHTML = "";

  teams.forEach((team, idx) => {
    const guardCount   = team.members.filter((m) => (m.position || DEFAULT_POSITION) === "가드").length;
    const forwardCount = team.members.length - guardCount;
    const withHeight = team.members.filter((m) => m.height_cm);
    const avgHeight = withHeight.length ? withHeight.reduce((s, m) => s + m.height_cm, 0) / withHeight.length : null;

    const card = document.createElement("div");
    card.className = "team-card q-team-card";
    card.style.setProperty("--team-color", team.color);

    /* 헤더 */
    const head   = document.createElement("div"); head.className = "team-head";
    const nameEl = document.createElement("div"); nameEl.className = "team-name";
    nameEl.contentEditable = "true"; nameEl.spellcheck = false; nameEl.textContent = team.name;
    nameEl.addEventListener("blur", () => { team.name = nameEl.textContent.trim() || team.name; });
    const lvEl = document.createElement("div"); lvEl.className = "team-level";
    lvEl.innerHTML = `인원 <b>${team.members.length}</b>명`;
    head.append(nameEl, lvEl);

    /* 요약 pills */
    const sum = document.createElement("div"); sum.className = "team-summary";
    const pills = [`가드 <b>${guardCount}</b>`, `포워드 <b>${forwardCount}</b>`];
    if (avgHeight !== null) pills.push(`평균 키 <b>${avgHeight.toFixed(1)}cm</b>`);
    pills.forEach((html) => {
      const p = document.createElement("span"); p.className = "pill"; p.innerHTML = html; sum.append(p);
    });

    /* 명단 — 가드 먼저, 포워드 나중 */
    const ul = document.createElement("ul"); ul.className = "roster";
    const sortedMembers = [...team.members].sort((a, b) => {
      const rank = (m) => (m.position || DEFAULT_POSITION) === "가드" ? 0 : 1;
      return rank(a) - rank(b);
    });
    sortedMembers.forEach((m) => {
      const li = document.createElement("li");
      li.className = "clickable"; li.tabIndex = 0; li.draggable = true;
      li.dataset.memberId = m.id;
      li.title = `${m.name} — 클릭: 역량 차트 / 드래그: 팀 이동 (숫자키 1~${teams.length})`;

      const openSheet = () => SHEET && SHEET.open(m, nameEl.textContent.trim(), allMembers());
      li.addEventListener("click",   () => { if (DRAG_MOVED) return; openSheet(); });
      li.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openSheet(); return; }
        const t = Number(e.key);
        if (t >= 1 && t <= teams.length && t - 1 !== idx) { e.preventDefault(); moveMember(m.id, t - 1); }
      });
      li.addEventListener("dragstart", (e) => {
        DRAGGING = { id: m.id, fromIdx: idx }; DRAG_MOVED = false;
        li.classList.add("dragging"); e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", String(m.id));
      });
      li.addEventListener("dragend", () => {
        li.classList.remove("dragging"); DRAGGING = null;
        document.querySelectorAll(".team-card.drop-target").forEach((c) => c.classList.remove("drop-target"));
        setTimeout(() => (DRAG_MOVED = false), 0);
      });

      const who = document.createElement("div"); who.className = "who";
      const nm  = document.createElement("span"); nm.className = "nm"; nm.textContent = m.name;
      who.append(nm);
      if (m.is_guest)  { const g = document.createElement("span"); g.className = "guest"; g.textContent = "게스트"; who.append(g); }
      if (m.estimated) { const e = document.createElement("span"); e.className = "est";   e.textContent = "추정";   who.append(e); }

      const htEl = document.createElement("span"); htEl.className = "lv";
      htEl.textContent = m.height_cm ? `${m.height_cm}cm` : "—";

      const posTag = document.createElement("span");
      posTag.className = "pos " + (m.position || DEFAULT_POSITION);
      posTag.textContent = m.position || DEFAULT_POSITION;

      li.append(who, htEl, posTag); ul.append(li);
    });

    /* 드롭 이벤트 */
    card.addEventListener("dragover", (e) => {
      if (!DRAGGING || DRAGGING.fromIdx === idx) return;
      e.preventDefault(); e.dataTransfer.dropEffect = "move"; card.classList.add("drop-target");
    });
    card.addEventListener("dragleave", (e) => { if (!card.contains(e.relatedTarget)) card.classList.remove("drop-target"); });
    card.addEventListener("drop", (e) => {
      e.preventDefault(); card.classList.remove("drop-target");
      const id   = Number(e.dataTransfer.getData("text/plain") || (DRAGGING && DRAGGING.id));
      const from = DRAGGING ? DRAGGING.fromIdx : -1;
      DRAG_MOVED = true;
      if (id && from !== idx) moveMember(id, idx);
    });

    card.append(head, sum, ul);
    box.append(card);
  });

  if (scroll) window.scrollTo({ top: 0, behavior: "smooth" });
}

/* ------------------------------------------------------------------ 텍스트 복사 */
function buildCopyText(teams) {
  return teams.map((t) => {
    const guardCount = t.members.filter((m) => (m.position || DEFAULT_POSITION) === "가드").length;
    const list = t.members.map((m) => {
      const extra = [m.height_cm ? `${m.height_cm}cm` : null].filter(Boolean).join(" · ");
      return `  ${m.name}(${m.position || DEFAULT_POSITION})${extra ? " " + extra : ""}${m.is_guest ? " 게스트" : ""}`;
    }).join("\n");
    return `【${t.name}】 (${t.members.length}명, 가드 ${guardCount}·포워드 ${t.members.length - guardCount})\n${list}`;
  }).join("\n\n");
}

/* ------------------------------------------------------------------ 이벤트 바인딩 */
function bindForm() {
  // 출생년도 입력 시 현재 연도 기준으로 나이 자동 계산 (정밀 편성과 동일한 방식)
  $("#birthYear").addEventListener("input", () => {
    const by = Number($("#birthYear").value);
    const thisYear = new Date().getFullYear();
    $("#ageInput").value = by >= 1930 && by <= thisYear ? thisYear - by : "";
  });

  $("#memberForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const fd      = new FormData(e.target);
    const name    = (fd.get("name") || "").trim();
    if (!name) return;
    const position   = POSITIONS.includes(fd.get("position")) ? fd.get("position") : DEFAULT_POSITION;
    const birth_year = fd.get("birth_year") ? Number(fd.get("birth_year")) : null;
    const age        = birth_year ? new Date().getFullYear() - birth_year : (fd.get("age") ? Number(fd.get("age")) : null);
    const height_cm  = fd.get("height_cm") ? Number(fd.get("height_cm")) : null;
    const skills  = collectSkills();
    const level   = calcLevel(skills);
    members.push({ id: nextId++, name, position, birth_year, age, height_cm, skills, level, is_guest: fd.get("is_guest") === "on", estimated: false });
    saveMembers(); renderMembers();
    const msg = $("#formMsg"); msg.className = "msg ok";
    msg.textContent = `'${name}'(${position}) 추가 완료 · 레벨 ${level.toFixed(1)}${age ? " · " + age + "세" : ""}${height_cm ? " · " + height_cm + "cm" : ""}`;
    e.target.reset(); resetSkillFields(); $("#ageInput").value = ""; e.target.querySelector("input[name=name]").focus();
  });
  $("#resetSkills").addEventListener("click", resetSkillFields);
}

function bindActions() {
  $("#dlSample").addEventListener("click",   (e) => downloadXlsx("/api/quick/sample",           "quick_level_sheet.xlsx",    e.currentTarget));
  $("#dlTemplate").addEventListener("click", (e) => downloadXlsx("/api/quick/sample?empty=true", "quick_level_template.xlsx", e.currentTarget));

  $("#clearAll").addEventListener("click", () => {
    if (!members.length) return;
    if (!confirm("등록된 인원을 모두 삭제할까요?")) return;
    members = []; nextId = 1; saveMembers(); renderMembers(); setMsg($("#genMsg"), "");
  });

  $("#teamCount").addEventListener("change", renderStats);

  $("#generateBtn").addEventListener("click", () => {
    const k = Number($("#teamCount").value);
    const teams = buildTeams(k);
    $("#resultTitle").textContent  = `편성 결과 — ${k}팀 무작위`;
    $("#inputSection").hidden      = true;
    $("#resultSection").hidden     = false;
    renderResult(teams);
  });

  $("#reshuffleBtn").addEventListener("click", () => {
    renderResult(buildTeams(TEAMS.length || Number($("#teamCount").value)));
  });

  $("#backBtn").addEventListener("click", () => {
    $("#resultSection").hidden = true;
    $("#inputSection").hidden  = false;
    renderMembers();
  });

  $("#copyBtn").addEventListener("click", async () => {
    if (!TEAMS.length) return;
    const text = buildCopyText(TEAMS);
    try {
      await navigator.clipboard.writeText(text);
      const btn = $("#copyBtn"); btn.textContent = "복사됨 ✓";
      setTimeout(() => (btn.textContent = "텍스트 복사"), 1500);
    } catch (_) { prompt("아래 내용을 복사하세요:", text); }
  });
}

/* ------------------------------------------------------------------ 시작 */
loadMembers();
renderSkillFields();
bindUpload();
bindForm();
bindActions();
renderMembers();
SHEET = createQuickMemberSheet();
