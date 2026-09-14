/* 약식 팀 편성 — 포지션 구분 없음, 6항목 + 키, 무작위 랜덤 */
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
    body.innerHTML = '<tr class="empty"><td colspan="5">아직 등록된 인원이 없습니다.</td></tr>';
  } else {
    members.forEach((m) => {
      const tr = document.createElement("tr");

      const tdName = document.createElement("td");
      tdName.textContent = m.name;
      if (m.is_guest)  { const g = document.createElement("span"); g.className = "guest"; g.textContent = "게스트"; tdName.append(g); }
      if (m.estimated) { const e = document.createElement("span"); e.className = "est";   e.textContent = "추정";   tdName.append(e); }

      const tdLv = document.createElement("td");
      tdLv.className = "num"; tdLv.textContent = m.level.toFixed(1);

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

      tr.append(tdName, tdLv, tdH, tdBars, tdDel);
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
  const pills = [
    `총원 <b>${members.length}</b>명`,
    `평균 레벨 <b>${avg.toFixed(1)}</b>`,
    `${k}팀 배분 <b>${sizes}</b>`,
  ];
  if (withHeight) {
    const avgH = members.filter((m) => m.height_cm).reduce((s, m) => s + m.height_cm, 0) / withHeight;
    pills.push(`평균 키 <b>${avgH.toFixed(1)}cm</b>`);
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

  const avgs      = teams.map((t) => t.members.reduce((s, m) => s + m.level, 0) / Math.max(1, t.members.length));
  const globalAvg = allMembers().reduce((s, m) => s + m.level, 0) / Math.max(1, allMembers().length);
  const spread    = Math.max(...avgs) - Math.min(...avgs);
  const devRate   = globalAvg > 0 ? (spread / globalAvg) * 100 : 0;

  // 항목별 팀간 최대 편차
  const skillSpreads = SKILL_DEFS.map(({ key, label }) => {
    const sAvgs = teams.map((t) =>
      t.members.reduce((a, m) => a + (m.skills[key] ?? 3), 0) / Math.max(1, t.members.length)
    );
    return { label, spread: Math.max(...sAvgs) - Math.min(...sAvgs) };
  });
  const worstSkill = skillSpreads.reduce((a, b) => a.spread > b.spread ? a : b);

  // 키 편차 (있는 인원만)
  const heightAvgs = teams.map((t) => {
    const withH = t.members.filter((m) => m.height_cm);
    return withH.length ? withH.reduce((s, m) => s + m.height_cm, 0) / withH.length : null;
  });
  const validH = heightAvgs.filter((v) => v !== null);
  const heightSpread = validH.length >= 2 ? Math.max(...validH) - Math.min(...validH) : null;

  grid.append(
    metricCard("레벨 편차율", devRate.toFixed(1) + "%",
      "팀 평균 기준 · 목표 5% 이내", devRate <= 5 ? "good" : "bad"),
    metricCard("팀간 레벨 편차", spread.toFixed(2),
      "팀 평균 최대 − 최소", spread <= 0.3 ? "good" : spread <= 0.6 ? "" : "bad"),
    metricCard("키 편차", heightSpread !== null ? heightSpread.toFixed(1) + "cm" : "—",
      "팀 평균 키 최대 − 최소 · 참고용", ""),
    metricCard("항목 최대 편차", worstSkill.spread.toFixed(2),
      `${worstSkill.label}에서 가장 큼`, ""),
    ...avgs.map((a, i) => metricCard(
      `${teams[i].name} 평균`, a.toFixed(2),
      (() => {
        const withH = teams[i].members.filter((m) => m.height_cm);
        const hStr  = withH.length ? ` · 키 ${(withH.reduce((s, m) => s + m.height_cm, 0) / withH.length).toFixed(0)}cm` : "";
        const diff  = a - globalAvg;
        return `${diff >= 0 ? "+" : ""}${diff.toFixed(2)}${hStr}`;
      })(), ""
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
    const avg       = team.members.reduce((s, m) => s + m.level, 0) / Math.max(1, team.members.length);
    const globalAvg = allMembers().reduce((s, m) => s + m.level, 0) / Math.max(1, allMembers().length);
    const diff      = avg - globalAvg;
    const withH     = team.members.filter((m) => m.height_cm);
    const avgH      = withH.length ? withH.reduce((s, m) => s + m.height_cm, 0) / withH.length : null;

    const card = document.createElement("div");
    card.className = "team-card q-team-card";
    card.style.setProperty("--team-color", team.color);

    /* 헤더 */
    const head   = document.createElement("div"); head.className = "team-head";
    const nameEl = document.createElement("div"); nameEl.className = "team-name";
    nameEl.contentEditable = "true"; nameEl.spellcheck = false; nameEl.textContent = team.name;
    nameEl.addEventListener("blur", () => { team.name = nameEl.textContent.trim() || team.name; });
    const lvEl = document.createElement("div"); lvEl.className = "team-level";
    lvEl.innerHTML =
      `평균 <b>${avg.toFixed(2)}</b>` +
      (avgH ? ` · 키 <b>${avgH.toFixed(0)}cm</b>` : "") +
      `<br><span class="diff ${diff >= 0 ? "pos" : "neg"}">${diff >= 0 ? "+" : ""}${diff.toFixed(2)}</span>`;
    head.append(nameEl, lvEl);

    /* 요약 pills */
    const sum = document.createElement("div"); sum.className = "team-summary";
    const pills = [`인원 <b>${team.members.length}</b>명`];
    if (avgH) pills.push(`평균 키 <b>${avgH.toFixed(0)}cm</b>`);
    pills.forEach((html) => {
      const p = document.createElement("span"); p.className = "pill"; p.innerHTML = html; sum.append(p);
    });

    /* 명단 */
    const ul = document.createElement("ul"); ul.className = "roster";
    team.members.forEach((m) => {
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
      if (m.height_cm) {
        const meta = document.createElement("span"); meta.className = "meta";
        meta.textContent = m.height_cm + "cm"; who.append(meta);
      }

      const right  = document.createElement("div");
      const lvNum  = document.createElement("div"); lvNum.className = "lv"; lvNum.textContent = m.level.toFixed(2);
      const bar    = document.createElement("div"); bar.className = "bar";
      const fill   = document.createElement("i");   fill.style.width = Math.max(2, (m.level / 5) * 100) + "%";
      bar.append(fill); right.append(lvNum, bar);

      li.append(who, right); ul.append(li);
    });

    /* 항목별 팀 평균 */
    const roles = document.createElement("div"); roles.className = "roles";
    SKILL_DEFS.forEach(({ key, label }) => {
      const avgS = team.members.reduce((a, m) => a + (m.skills[key] ?? 3), 0) / Math.max(1, team.members.length);
      const line = document.createElement("div"); line.className = "role-line";
      const lbl  = document.createElement("span"); lbl.textContent = label.split("/")[0];
      const barW = document.createElement("div"); barW.className = "rbar";
      const i    = document.createElement("i");   i.style.width = (avgS / 5) * 100 + "%"; barW.append(i);
      const num  = document.createElement("span"); num.style.textAlign = "right"; num.textContent = avgS.toFixed(2);
      line.append(lbl, barW, num); roles.append(line);
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

    card.append(head, sum, ul, roles);
    box.append(card);
  });

  if (scroll) window.scrollTo({ top: 0, behavior: "smooth" });
}

/* ------------------------------------------------------------------ 텍스트 복사 */
function buildCopyText(teams) {
  return teams.map((t) => {
    const avg  = (t.members.reduce((s, m) => s + m.level, 0) / Math.max(1, t.members.length)).toFixed(1);
    const list = t.members.map((m) =>
      `  ${m.name}${m.is_guest ? "(게스트)" : ""} ${m.level.toFixed(1)}${m.height_cm ? " " + m.height_cm + "cm" : ""}`
    ).join("\n");
    return `【${t.name}】 (${t.members.length}명, 평균 ${avg})\n${list}`;
  }).join("\n\n");
}

/* ------------------------------------------------------------------ 이벤트 바인딩 */
function bindForm() {
  $("#memberForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const fd      = new FormData(e.target);
    const name    = (fd.get("name") || "").trim();
    if (!name) return;
    const height_cm = fd.get("height_cm") ? Number(fd.get("height_cm")) : null;
    const skills  = collectSkills();
    const level   = calcLevel(skills);
    members.push({ id: nextId++, name, height_cm, skills, level, is_guest: fd.get("is_guest") === "on", estimated: false });
    saveMembers(); renderMembers();
    const msg = $("#formMsg"); msg.className = "msg ok";
    msg.textContent = `'${name}' 추가 완료 · 레벨 ${level.toFixed(1)}${height_cm ? " · " + height_cm + "cm" : ""}`;
    e.target.reset(); resetSkillFields(); e.target.querySelector("input[name=name]").focus();
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
