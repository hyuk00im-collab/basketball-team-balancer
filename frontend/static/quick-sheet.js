/* 약식 편성용 인원 상세 시트 — 6항목 레이더 차트 (포지션 구분 없음) */

const SKILL_DEFS = [
  { key: "슈팅",     label: "슈팅",        desc: "슛 정확도 전반" },
  { key: "드리블",   label: "드리블",      desc: "볼핸들링·돌파" },
  { key: "패스",     label: "패스/시야",   desc: "코트비전·패스 능력" },
  { key: "수비",     label: "수비",        desc: "개인 수비 전반" },
  { key: "리바운드", label: "리바운드",    desc: "골밑 장악·박스아웃" },
  { key: "체력",     label: "체력/스피드", desc: "운동 능력·지구력" },
];

const CHART = {
  W: 460, H: 412, cx: 230, cy: 192, R: 118, MAX: 5, LABEL_GAP: 24,
  member:     "#e8622c",
  memberFill: "rgba(232, 98, 44, .16)",
  ref:        "#8a8f98",
  grid:       "#e3e6ec",
  ink:        "#39414f",
  muted:      "#6b7280",
};

const SVG_NS = "http://www.w3.org/2000/svg";

function el(name, attrs = {}, text) {
  const node = document.createElementNS(SVG_NS, name);
  Object.entries(attrs).forEach(([k, v]) => node.setAttribute(k, v));
  if (text !== undefined) node.textContent = text;
  return node;
}

/** 전체 인원 항목별 평균 (기준선용). */
function globalAverage(allMembers) {
  const avg = {};
  SKILL_DEFS.forEach(({ key }) => {
    const vals = allMembers.map((m) => m.skills[key]).filter((v) => typeof v === "number");
    avg[key] = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
  });
  return avg;
}

/** 6축 레이더 차트 SVG를 만든다. */
function buildRadar(member, avg, onHover) {
  const { W, H, cx, cy, R, MAX, LABEL_GAP } = CHART;
  const axes = SKILL_DEFS;
  const n = axes.length;
  const angle = (i) => ((-90 + (360 / n) * i) * Math.PI) / 180;
  const at = (i, v) => [
    cx + Math.cos(angle(i)) * R * (v / MAX),
    cy + Math.sin(angle(i)) * R * (v / MAX),
  ];
  const path = (values) => values.map((v, i) => at(i, v).join(",")).join(" ");

  const svg = el("svg", {
    viewBox: `0 0 ${W} ${H}`,
    width: "100%",
    role: "img",
    "aria-label": `${member.name} 역량 프로파일 다각형 차트`,
  });

  // 격자: 1~5점 다각형 + 축선
  for (let r = 1; r <= MAX; r++) {
    svg.append(el("polygon", {
      points: path(axes.map(() => r)),
      fill: "none", stroke: CHART.grid,
      "stroke-width": r === MAX ? 1.5 : 1,
    }));
  }
  axes.forEach((_, i) => {
    const [x, y] = at(i, MAX);
    svg.append(el("line", { x1: cx, y1: cy, x2: x, y2: y, stroke: CHART.grid, "stroke-width": 1 }));
  });
  [1, 3, 5].forEach((r) => {
    svg.append(el("text", { x: cx + 4, y: cy - (R * r) / MAX + 3, fill: CHART.muted, "font-size": 9 }, String(r)));
  });

  // 기준선: 전체 평균 (파선)
  svg.append(el("polygon", {
    points: path(axes.map((a) => avg[a.key] || 0)),
    fill: "none", stroke: CHART.ref,
    "stroke-width": 1.5, "stroke-dasharray": "4 3",
  }));

  // 본인 폴리곤
  const values = axes.map((a) => member.skills[a.key] || 0);
  svg.append(el("polygon", {
    points: path(values),
    fill: CHART.memberFill, stroke: CHART.member,
    "stroke-width": 2, "stroke-linejoin": "round",
  }));

  // 상위 3개 항목 라벨
  const top3 = new Set(
    axes.map((a, i) => ({ i, v: values[i] }))
      .sort((a, b) => b.v - a.v)
      .slice(0, 3)
      .map((x) => x.i)
  );
  axes.forEach((a, i) => {
    const [x, y] = at(i, values[i]);
    const isTop = top3.has(i);
    svg.append(el("circle", { cx: x, cy: y, r: isTop ? 4.5 : 3, fill: CHART.member, stroke: "#fff", "stroke-width": 1.5 }));
    if (isTop) {
      const offset = values[i] >= MAX - 0.35 ? -0.62 : 0.58;
      const [lx, ly] = at(i, Math.max(0.7, Math.min(MAX, values[i] + offset)));
      svg.append(el("text", {
        x: lx, y: ly + 3, "text-anchor": "middle",
        "font-size": 11, "font-weight": 700, fill: CHART.ink,
        stroke: "#fff", "stroke-width": 3, "paint-order": "stroke",
      }, values[i].toFixed(1)));
    }
  });

  // 축 라벨
  axes.forEach((a, i) => {
    const [x, y] = at(i, MAX);
    const dx = x - cx, dy = y - cy;
    const norm = Math.hypot(dx, dy) || 1;
    const lx = x + (dx / norm) * LABEL_GAP;
    const ly = y + (dy / norm) * LABEL_GAP;
    const anchor = Math.abs(dx) < 12 ? "middle" : dx > 0 ? "start" : "end";
    const parts = a.label.split("/");
    const text = el("text", {
      x: lx,
      y: ly + (dy < -40 ? -2 : 4) - (parts.length - 1) * (dy < 0 ? 10 : 0),
      "text-anchor": anchor, "font-size": 10.5, fill: CHART.muted,
    });
    parts.forEach((line, k) => text.append(el("tspan", { x: lx, dy: k === 0 ? 0 : 12 }, line)));
    svg.append(text);
  });

  // 호버 히트 영역
  axes.forEach((a, i) => {
    const [x, y] = at(i, values[i]);
    const hit = el("circle", { cx: x, cy: y, r: 16, fill: "transparent", style: "cursor:pointer" });
    hit.addEventListener("mouseenter", () =>
      onHover({ skill: a.label, value: values[i], avg: avg[a.key] || 0, x, y, W, H })
    );
    hit.addEventListener("mouseleave", () => onHover(null));
    svg.append(hit);
  });

  return svg;
}

/* -------------------------------------------------------- 타일 / 포인트 행 */
function tile(label, value, note) {
  const d = document.createElement("div");
  d.className = "tile";
  d.innerHTML = `<div class="t-label"></div><div class="t-value"></div><div class="t-note"></div>`;
  d.querySelector(".t-label").textContent = label;
  d.querySelector(".t-value").textContent = value;
  d.querySelector(".t-note").textContent = note || "";
  return d;
}

function badge(cls, text, title) {
  const s = document.createElement("span");
  s.className = cls;
  s.textContent = text;
  if (title) s.title = title;
  return s;
}

function pointRow(skill, value, avg, kind) {
  const row = document.createElement("li");
  row.className = "point " + kind;
  const diff = value - avg;
  const sign = diff >= 0 ? "+" : "−";
  row.innerHTML =
    `<span class="p-name"></span>` +
    `<span class="p-bar"><i></i></span>` +
    `<span class="p-val"></span>` +
    `<span class="p-diff"></span>`;
  row.querySelector(".p-name").textContent = skill;
  row.querySelector(".p-bar i").style.width = (value / 5) * 100 + "%";
  row.querySelector(".p-val").textContent = value.toFixed(1);
  const d = row.querySelector(".p-diff");
  d.textContent = `평균 ${sign}${Math.abs(diff).toFixed(1)}`;
  d.classList.add(diff >= 0 ? "up" : "down");
  return row;
}

/* -------------------------------------------------------- 외부 API */
export function createQuickMemberSheet() {
  const sheet = document.getElementById("sheet");
  const tip   = document.getElementById("chartTip");

  function showTip(info) {
    if (!info) { tip.hidden = true; return; }
    tip.hidden = false;
    tip.innerHTML = `<b></b><span class="tv"></span><span class="ta"></span>`;
    tip.querySelector("b").textContent = info.skill;
    tip.querySelector(".tv").textContent = `본인 ${info.value.toFixed(1)}`;
    tip.querySelector(".ta").textContent = `전체 평균 ${info.avg.toFixed(1)}`;
    tip.style.left = (info.x / info.W) * 100 + "%";
    tip.style.top  = (info.y / info.H) * 100 + "%";
  }

  function close() {
    sheet.hidden = true;
    tip.hidden = true;
    document.body.classList.remove("no-scroll");
  }

  function open(member, teamName, allMembers) {
    const avg = globalAverage(allMembers);

    /* 헤더 */
    const head = document.getElementById("sheetName");
    head.innerHTML = "";
    head.textContent = member.name;
    if (member.is_guest)  head.append(badge("guest", "게스트"));
    if (member.estimated) head.append(badge("est", "추정", "미입력 역량을 중앙값으로 대체"));

    document.getElementById("sheetSub").textContent = [
      teamName,
      member.position || null,
      member.height_cm ? `${member.height_cm}cm` : null,
    ].filter(Boolean).join(" · ");

    /* 요약 타일 */
    const tiles = document.getElementById("sheetTiles");
    tiles.innerHTML = "";
    const globalAvgLevel = allMembers.reduce((s, m) => s + m.level, 0) / Math.max(1, allMembers.length);
    const diff = member.level - globalAvgLevel;
    const rankSorted = [...allMembers].sort((a, b) => b.level - a.level);
    const rank = rankSorted.findIndex((m) => m.id === member.id) + 1;
    // 키 순위 (키 입력된 인원 중)
    const withHeight = allMembers.filter((m) => m.height_cm);
    const heightRank = member.height_cm && withHeight.length
      ? [...withHeight].sort((a, b) => b.height_cm - a.height_cm).findIndex((m) => m.id === member.id) + 1
      : null;

    tiles.append(
      tile("역량 평균",  member.level.toFixed(2),   `전체 평균 ${globalAvgLevel.toFixed(2)}`),
      tile("전체 대비",  (diff >= 0 ? "+" : "") + diff.toFixed(2), diff >= 0 ? "평균 이상" : "평균 이하"),
      tile("전체 순위",  rank ? `${rank}위` : "—",  `전체 ${allMembers.length}명 중`),
      tile("키",
        member.height_cm ? `${member.height_cm}cm` : "—",
        heightRank ? `키 ${heightRank}위 / ${withHeight.length}명` : "미입력"
      )
    );

    /* 차트 */
    const box = document.getElementById("radarBox");
    box.innerHTML = "";
    if (member.estimated) {
      const note = document.createElement("p");
      note.className = "chart-note";
      note.textContent = "역량을 직접 입력하지 않아 중앙값으로 추정한 값입니다.";
      box.append(note);
    }
    box.append(buildRadar(member, avg, showTip));

    document.getElementById("chartLegend").innerHTML =
      `<span class="lg"><i class="sw-member"></i>${member.name}</span>` +
      `<span class="lg"><i class="sw-ref"></i>전체 평균 (${allMembers.length}명)</span>`;

    /* 상위/보완 포인트 */
    const ranked = SKILL_DEFS
      .map(({ key, label }) => ({ skill: label, value: member.skills[key] ?? 0, avg: avg[key] || 0 }))
      .sort((a, b) => b.value - a.value);

    const points = document.getElementById("sheetPoints");
    points.innerHTML = "";
    const strong = document.createElement("div");
    strong.className = "point-block";
    strong.innerHTML = `<h3>상위 역량 <span class="hint-inline">TOP 3</span></h3>`;
    const ulS = document.createElement("ul");
    ranked.slice(0, 3).forEach((r) => ulS.append(pointRow(r.skill, r.value, r.avg, "strong")));
    strong.append(ulS);

    const weak = document.createElement("div");
    weak.className = "point-block";
    weak.innerHTML = `<h3>보완 포인트 <span class="hint-inline">하위 2</span></h3>`;
    const ulW = document.createElement("ul");
    ranked.slice(-2).forEach((r) => ulW.append(pointRow(r.skill, r.value, r.avg, "weak")));
    weak.append(ulW);

    points.append(strong, weak);

    /* 항목별 전체 비교 표 */
    const tableWrap = document.getElementById("sheetTable");
    tableWrap.innerHTML = "";
    const t = document.createElement("table");
    t.className = "member-table";
    t.innerHTML = "<thead><tr><th>역량 항목</th><th>본인</th><th>전체 평균</th><th>차이</th></tr></thead>";
    const tb = document.createElement("tbody");
    SKILL_DEFS.forEach(({ key, label }) => {
      const v = member.skills[key] ?? 0;
      const a = avg[key] || 0;
      const d = v - a;
      const tr = document.createElement("tr");
      tr.innerHTML = `<td></td><td class="num"></td><td class="num"></td><td class="num"></td>`;
      tr.children[0].textContent = label;
      tr.children[1].textContent = v.toFixed(1);
      tr.children[2].textContent = a.toFixed(2);
      tr.children[3].textContent = (d >= 0 ? "+" : "−") + Math.abs(d).toFixed(2);
      tb.append(tr);
    });
    t.append(tb);
    tableWrap.append(t);

    /* sheetRoles 숨김 (약식은 역할군 없음) */
    const rolesBox = document.getElementById("sheetRoles");
    if (rolesBox) rolesBox.innerHTML = "";

    sheet.hidden = false;
    document.body.classList.add("no-scroll");
    document.getElementById("sheetClose").focus();
  }

  document.getElementById("sheetClose").addEventListener("click", close);
  sheet.addEventListener("click", (e) => { if (e.target === sheet) close(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !sheet.hidden) close(); });

  return { open, close };
}
