/* 인원별 역량 상세 시트 — 다각형(레이더) 차트 + 상위 역량 포인트
 *
 * 색 사용 원칙
 *  - 본인   : 강조색(주황) 실선 + 옅은 채움
 *  - 비교선 : 동일 포지션 평균 — 중립 회색 파선, 채움 없음
 *    (비교선은 동급 카테고리가 아니라 기준선이므로 의도적으로 무채색)
 *    두 계열은 색 외에 실선/파선, 채움 유무로도 구분되고 범례가 항상 붙는다.
 *  - 값 텍스트는 계열색이 아니라 본문 잉크 색을 쓴다.
 */

const CHART = {
  W: 460,
  H: 412,
  cx: 230,
  cy: 192,
  R: 118,
  MAX: 5,
  LABEL_GAP: 20,
  member: "#e8622c",      // 강조색 (앱 accent)
  memberFill: "rgba(232, 98, 44, .16)",
  ref: "#8a8f98",         // 기준선 — 무채색
  grid: "#e3e6ec",
  ink: "#39414f",
  muted: "#6b7280",
};

const SVG_NS = "http://www.w3.org/2000/svg";

function el(name, attrs = {}, text) {
  const node = document.createElementNS(SVG_NS, name);
  Object.entries(attrs).forEach(([k, v]) => node.setAttribute(k, v));
  if (text !== undefined) node.textContent = text;
  return node;
}

/** 긴 항목명을 최대 2줄로 나눈다. */
function wrapLabel(name) {
  if (name.includes("·")) return name.split("·");
  if (name.includes(" ")) {
    const i = name.indexOf(" ");
    return [name.slice(0, i), name.slice(i + 1)];
  }
  if (name.length > 7) {
    const half = Math.ceil(name.length / 2);
    return [name.slice(0, half), name.slice(half)];
  }
  return [name];
}

/** 역할군 순서대로 10개 축을 정렬한다 (같은 역할군이 이웃하도록). */
function axisOrder(defs, position) {
  const roleMap = (defs.roles && defs.roles[position]) || {};
  const ordered = [];
  ["scoring", "creation", "defense", "impact"].forEach((cluster) => {
    (roleMap[cluster] || []).forEach((skill) => ordered.push({ skill, cluster }));
  });
  const known = new Set(ordered.map((a) => a.skill));
  ((defs.skills && defs.skills[position]) || []).forEach((skill) => {
    if (!known.has(skill)) ordered.push({ skill, cluster: null });
  });
  return ordered;
}

/** 같은 포지션 전체 인원의 항목별 평균. */
function positionAverage(members, position, skills) {
  const pool = members.filter((m) => m.position === position);
  const avg = {};
  skills.forEach((skill) => {
    const vals = pool.map((m) => m.skills[skill]).filter((v) => typeof v === "number");
    avg[skill] = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
  });
  return avg;
}

/* ------------------------------------------------------------ 레이더 차트 */
function buildRadar(member, avg, axes, onHover) {
  const { W, H, cx, cy, R, MAX, LABEL_GAP } = CHART;
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

  // 격자: 1~5점 다각형 + 축선 (모두 후퇴색)
  for (let r = 1; r <= MAX; r++) {
    svg.append(
      el("polygon", {
        points: path(axes.map(() => r)),
        fill: "none",
        stroke: CHART.grid,
        "stroke-width": r === MAX ? 1.5 : 1,
      })
    );
  }
  axes.forEach((_, i) => {
    const [x, y] = at(i, MAX);
    svg.append(el("line", { x1: cx, y1: cy, x2: x, y2: y, stroke: CHART.grid, "stroke-width": 1 }));
  });
  [1, 3, 5].forEach((r) => {
    svg.append(
      el("text", { x: cx + 4, y: cy - (R * r) / MAX + 3, fill: CHART.muted, "font-size": 9 }, String(r))
    );
  });

  // 기준선: 동일 포지션 평균 (파선, 채움 없음)
  svg.append(
    el("polygon", {
      points: path(axes.map((a) => avg[a.skill] || 0)),
      fill: "none",
      stroke: CHART.ref,
      "stroke-width": 1.5,
      "stroke-dasharray": "4 3",
    })
  );

  // 본인
  const values = axes.map((a) => member.skills[a.skill] || 0);
  svg.append(
    el("polygon", {
      points: path(values),
      fill: CHART.memberFill,
      stroke: CHART.member,
      "stroke-width": 2,
      "stroke-linejoin": "round",
    })
  );

  // 상위 3개 항목만 직접 라벨 (모든 꼭짓점에 숫자를 찍지 않는다)
  const top3 = new Set(
    axes
      .map((a, i) => ({ i, v: values[i] }))
      .sort((a, b) => b.v - a.v)
      .slice(0, 3)
      .map((x) => x.i)
  );

  axes.forEach((a, i) => {
    const [x, y] = at(i, values[i]);
    const isTop = top3.has(i);
    svg.append(
      el("circle", {
        cx: x,
        cy: y,
        r: isTop ? 4.5 : 3,
        fill: CHART.member,
        stroke: "#fff",
        "stroke-width": 1.5,
      })
    );
    if (isTop) {
      // 값이 최댓값에 붙어 있으면 라벨을 바깥이 아니라 안쪽에 둔다 (축 라벨과 겹침 방지)
      const offset = values[i] >= MAX - 0.35 ? -0.62 : 0.58;
      const [lx, ly] = at(i, Math.max(0.7, Math.min(MAX, values[i] + offset)));
      const label = el(
        "text",
        {
          x: lx,
          y: ly + 3,
          "text-anchor": "middle",
          "font-size": 11,
          "font-weight": 700,
          fill: CHART.ink,
          stroke: "#fff",
          "stroke-width": 3,
          "paint-order": "stroke",
        },
        values[i].toFixed(1)
      );
      svg.append(label);
    }
  });

  // 축 라벨
  axes.forEach((a, i) => {
    const [x, y] = at(i, MAX);
    const dx = x - cx;
    const dy = y - cy;
    const norm = Math.hypot(dx, dy) || 1;
    const lx = x + (dx / norm) * LABEL_GAP;
    const ly = y + (dy / norm) * LABEL_GAP;
    const anchor = Math.abs(dx) < 12 ? "middle" : dx > 0 ? "start" : "end";
    const lines = wrapLabel(a.skill);
    const text = el("text", {
      x: lx,
      y: ly + (dy < -40 ? -2 : 4) - (lines.length - 1) * (dy < 0 ? 10 : 0),
      "text-anchor": anchor,
      "font-size": 10,
      fill: CHART.muted,
    });
    lines.forEach((line, k) => {
      text.append(el("tspan", { x: lx, dy: k === 0 ? 0 : 11 }, line));
    });
    svg.append(text);
  });

  // 호버 히트 영역 (마크보다 크게)
  axes.forEach((a, i) => {
    const [x, y] = at(i, values[i]);
    const hit = el("circle", { cx: x, cy: y, r: 16, fill: "transparent", style: "cursor:pointer" });
    hit.addEventListener("mouseenter", () =>
      onHover({ skill: a.skill, value: values[i], avg: avg[a.skill] || 0, x, y, W, H })
    );
    hit.addEventListener("mouseleave", () => onHover(null));
    svg.append(hit);
  });

  return svg;
}

/* ------------------------------------------------------------ 시트 렌더링 */
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

export function createMemberSheet(defs) {
  const sheet = document.getElementById("sheet");
  const tip = document.getElementById("chartTip");

  function showTip(info) {
    if (!info) {
      tip.hidden = true;
      return;
    }
    tip.hidden = false;
    tip.innerHTML =
      `<b></b><span class="tv"></span><span class="ta"></span>`;
    tip.querySelector("b").textContent = info.skill;
    tip.querySelector(".tv").textContent = `본인 ${info.value.toFixed(1)}`;
    tip.querySelector(".ta").textContent = `포지션 평균 ${info.avg.toFixed(1)}`;
    tip.style.left = (info.x / info.W) * 100 + "%";
    tip.style.top = (info.y / info.H) * 100 + "%";
  }

  function close() {
    sheet.hidden = true;
    tip.hidden = true;
    document.body.classList.remove("no-scroll");
  }

  function open(member, teamName, allMembers) {
    const axes = axisOrder(defs, member.position);
    const skills = axes.map((a) => a.skill);
    const avg = positionAverage(allMembers, member.position, skills);

    /* 헤더 */
    const head = document.getElementById("sheetName");
    head.textContent = member.name;
    if (member.is_guest) head.append(badge("guest", "게스트"));
    if (member.estimated) head.append(badge("est", "추정", "미입력 역량을 동일 포지션 중앙값으로 대체"));
    if (member.position_rank && member.position_rank <= 3)
      head.append(badge("rank", `${member.position} ${member.position_rank}위`));
    if (member.position === "포워드" && member.height_rank && member.height_rank <= 3)
      head.append(badge("hrank", `키 ${member.height_rank}위`));
    if (member.age_bonus) head.append(badge("bonus", `+${member.age_bonus}`, "55세 이상 가중치"));

    document.getElementById("sheetSub").textContent = [
      teamName,
      member.position,
      member.age ? `${member.age}세` : null,
      member.height_cm ? `${member.height_cm}cm` : null,
    ]
      .filter(Boolean)
      .join(" · ");

    /* 요약 타일 */
    const tiles = document.getElementById("sheetTiles");
    tiles.innerHTML = "";
    const posAvgLevel =
      allMembers.filter((m) => m.position === member.position).reduce((s, m) => s + m.level, 0) /
      Math.max(1, allMembers.filter((m) => m.position === member.position).length);
    tiles.append(
      tile("역량평균", member.level.toFixed(2), `포지션 평균 ${posAvgLevel.toFixed(2)}`),
      tile(
        "실질 전력",
        member.effective_level.toFixed(2),
        member.age_bonus ? `역량 + 가중치 ${member.age_bonus}` : "가중치 없음"
      ),
      tile(
        "포지션 순위",
        member.position_rank ? `${member.position_rank}위` : "—",
        `${member.position} 역량 기준`
      ),
      tile(
        "신장",
        member.height_cm ? `${member.height_cm}cm` : "—",
        member.height_rank ? `${member.position} 키 ${member.height_rank}위` : "미입력"
      )
    );

    /* 차트 */
    const box = document.getElementById("radarBox");
    box.innerHTML = "";
    if (member.estimated) {
      const note = document.createElement("p");
      note.className = "chart-note";
      note.textContent =
        "역량을 입력하지 않아 동일 포지션 중앙값으로 추정한 값입니다 — 평균선과 거의 겹칩니다.";
      box.append(note);
    }
    box.append(buildRadar(member, avg, axes, showTip));

    const legend = document.getElementById("chartLegend");
    legend.innerHTML =
      `<span class="lg"><i class="sw-member"></i>${member.name}</span>` +
      `<span class="lg"><i class="sw-ref"></i>${member.position} 평균 (${
        allMembers.filter((m) => m.position === member.position).length
      }명)</span>`;

    /* 상위 역량 포인트 / 보완 포인트 */
    const ranked = skills
      .map((skill) => ({ skill, value: member.skills[skill] || 0, avg: avg[skill] || 0 }))
      .sort((a, b) => b.value - a.value || a.skill.localeCompare(b.skill));

    const points = document.getElementById("sheetPoints");
    points.innerHTML = "";

    const strong = document.createElement("div");
    strong.className = "point-block";
    strong.innerHTML = `<h3>상위 역량 포인트 <span class="hint-inline">TOP 3</span></h3>`;
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

    /* 역할군 요약 */
    const rolesBox = document.getElementById("sheetRoles");
    rolesBox.innerHTML = `<h3>역할군 <span class="hint-inline">항목 평균</span></h3>`;
    const labels = defs.role_labels || {};
    Object.keys(labels).forEach((key) => {
      const val = (member.roles && member.roles[key]) || 0;
      const line = document.createElement("div");
      line.className = "role-line";
      line.innerHTML = `<span></span><div class="rbar"><i></i></div><span style="text-align:right"></span>`;
      line.children[0].textContent = labels[key];
      line.querySelector("i").style.width = (val / 5) * 100 + "%";
      line.children[2].textContent = val.toFixed(2);
      rolesBox.append(line);
    });

    /* 표로 보기 (색에만 의존하지 않도록 항상 제공) */
    const table = document.getElementById("sheetTable");
    table.innerHTML = "";
    const t = document.createElement("table");
    t.className = "member-table";
    t.innerHTML =
      "<thead><tr><th>역량 항목</th><th>본인</th><th>포지션 평균</th><th>차이</th></tr></thead>";
    const tb = document.createElement("tbody");
    skills.forEach((skill) => {
      const v = member.skills[skill] || 0;
      const a = avg[skill] || 0;
      const tr = document.createElement("tr");
      const diff = v - a;
      tr.innerHTML = `<td></td><td class="num"></td><td class="num"></td><td class="num"></td>`;
      tr.children[0].textContent = skill;
      tr.children[1].textContent = v.toFixed(1);
      tr.children[2].textContent = a.toFixed(2);
      tr.children[3].textContent = (diff >= 0 ? "+" : "−") + Math.abs(diff).toFixed(2);
      tb.append(tr);
    });
    t.append(tb);
    table.append(t);

    sheet.hidden = false;
    document.body.classList.add("no-scroll");
    document.getElementById("sheetClose").focus();
  }

  document.getElementById("sheetClose").addEventListener("click", close);
  sheet.addEventListener("click", (e) => {
    if (e.target === sheet) close();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !sheet.hidden) close();
  });

  return { open, close };
}
