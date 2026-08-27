/* 결과 화면 (WEBAPP_SPEC.md §3.3) */
import { createMemberSheet } from "/static/member-sheet.js";

const $ = (sel) => document.querySelector(sel);

const ROLE_LABELS = { scoring: "득점", creation: "창출", defense: "수비", impact: "전환/골밑" };
let RESULT = null;
let SHEET = null;
let DRAGGING = null;   // { id, from } — 드래그 중인 인원
let DRAG_MOVED = false; // 드래그 직후의 click 으로 차트가 열리는 것을 막는다

function allMembers() {
  return RESULT ? RESULT.teams.flatMap((t) => t.members) : [];
}

async function api(path, options = {}) {
  const res = await fetch(path, options);
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const detail = data && data.detail;
    throw new Error(typeof detail === "string" ? detail : `요청 실패 (${res.status})`);
  }
  return data;
}

function savedNames() {
  try {
    return JSON.parse(localStorage.getItem("teamNames") || "[]");
  } catch {
    return [];
  }
}

function currentNames() {
  return [...document.querySelectorAll(".team-name")].map((el) => el.textContent.trim());
}

/* ------------------------------------------------------------ 렌더링 */
function renderWarnings(warnings) {
  const box = $("#warnings");
  box.innerHTML = "";
  if (!warnings || !warnings.length) return;
  const div = document.createElement("div");
  div.className = "banner";
  div.append("확인이 필요한 사항이 있습니다.");
  const ul = document.createElement("ul");
  warnings.forEach((w) => {
    const li = document.createElement("li");
    li.textContent = w;
    ul.append(li);
  });
  div.append(ul);
  box.append(div);
}

function metricCard(label, value, note, state) {
  const div = document.createElement("div");
  div.className = "metric" + (state ? " " + state : "");
  div.innerHTML =
    `<div class="m-label"></div><div class="m-value"></div><div class="m-note"></div>`;
  div.querySelector(".m-label").textContent = label;
  div.querySelector(".m-value").textContent = value;
  div.querySelector(".m-note").textContent = note || "";
  return div;
}

function renderMetrics(m) {
  const grid = $("#metricGrid");
  grid.innerHTML = "";
  grid.append(
    metricCard(
      "레벨 편차율 (평균)",
      m.level_deviation_rate_avg.toFixed(2) + "%",
      "목표 5% 이내 · 팀 평균 레벨 기준",
      m.level_deviation_rate_avg <= 5 ? "good" : "bad"
    ),
    metricCard(
      "레벨 편차율 (합계)",
      m.level_deviation_rate.toFixed(2) + "%",
      m.equal_team_sizes ? "목표 5% 이내" : "팀 인원수가 달라 참고용",
      m.equal_team_sizes ? (m.level_deviation_rate <= 5 ? "good" : "bad") : ""
    ),
    metricCard(
      "포지션 쿼터 위반",
      m.quota_violations + "팀",
      "목표 0팀",
      m.quota_violations === 0 ? "good" : "bad"
    ),
    metricCard("역할군 균형 지수", m.role_balance_index.toFixed(3), "낮을수록 우수"),
    metricCard(
      "신장 편차",
      m.height_gap === null || m.height_gap === undefined ? "—" : m.height_gap.toFixed(1) + "cm",
      "참고용"
    ),
    metricCard(
      "역량 상위권 분산",
      m.top_separation_violations + "건 위반",
      "1순위 · 포지션별 역량 1~3위",
      m.top_separation_violations === 0 ? "good" : "bad"
    ),
    metricCard(
      "신장 상위권 분산",
      m.height_separation_violations + "건 위반",
      "2순위 · 포워드 키 1~3위",
      m.height_separation_violations === 0 ? "good" : "bad"
    ),
    metricCard(
      "창출형 부재 팀",
      m.creation_shortage_teams + "팀",
      "볼 배급 인원 기준",
      m.creation_shortage_teams === 0 ? "good" : "bad"
    )
  );
}

function renderTeams(teams) {
  const box = $("#teams");
  box.innerHTML = "";
  const stored = savedNames();
  const maxLevel = 6; // 역량 5점 + 나이 보너스 1점

  teams.forEach((team, idx) => {
    const card = document.createElement("div");
    card.className = "team-card";

    /* 헤더: 팀 이름(수정 가능) + 평균 레벨 */
    const head = document.createElement("div");
    head.className = "team-head";
    const name = document.createElement("div");
    name.className = "team-name";
    name.contentEditable = "true";
    name.spellcheck = false;
    name.textContent = stored[idx] || team.name;
    name.addEventListener("blur", () =>
      localStorage.setItem("teamNames", JSON.stringify(currentNames()))
    );
    const lv = document.createElement("div");
    lv.className = "team-level";
    const s0 = team.summary;
    lv.innerHTML =
      `실질 <b>${s0.avg_effective_level.toFixed(2)}</b><br>` +
      `역량 ${s0.avg_level.toFixed(2)} · 합계 ${s0.sum_effective_level.toFixed(1)}`;
    lv.title = "실질 전력 = 역량평균 + 55세 이상 보너스";
    head.append(name, lv);

    /* 요약 pill */
    const sum = document.createElement("div");
    sum.className = "team-summary";
    const s = team.summary;
    const pills = [
      `인원 <b>${team.members.length}</b>`,
      `가드 <b>${s.guards}</b> · 포워드 <b>${s.forwards}</b>`,
      `평균 키 <b>${s.avg_height ? s.avg_height.toFixed(1) : "—"}</b>`,
      `창출형 <b>${s.creators}</b>`,
    ];
    if (s.bonus_players) pills.push(`55세 이상 <b>${s.bonus_players}</b>`);
    if (s.top_ranked.length) pills.push(s.top_ranked.join(" · "));
    if (s.top_height.length) pills.push(s.top_height.join(" · "));
    pills.forEach((html) => {
      const p = document.createElement("span");
      p.className = "pill";
      p.innerHTML = html;
      sum.append(p);
    });

    /* 명단 */
    const ul = document.createElement("ul");
    ul.className = "roster";
    ul.setAttribute("aria-label", `${team.name} 명단 — 인원을 클릭하면 역량 차트가 열립니다`);
    team.members.forEach((m) => {
      const li = document.createElement("li");
      li.className = "clickable";
      li.tabIndex = 0;
      li.draggable = true;
      li.dataset.memberId = m.id;
      li.setAttribute("role", "button");
      li.title = `${m.name} — 클릭: 역량 차트 / 드래그: 팀 이동 (숫자키 1~${teams.length} 로도 이동)`;

      const openSheet = () => SHEET && SHEET.open(m, name.textContent.trim(), allMembers());
      li.addEventListener("click", () => {
        if (DRAG_MOVED) return; // 드래그로 끝난 동작이면 차트를 열지 않는다
        openSheet();
      });
      li.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          openSheet();
          return;
        }
        const target = Number(e.key);
        if (target >= 1 && target <= teams.length && target - 1 !== idx) {
          e.preventDefault();
          moveMember(m.id, target - 1);
        }
      });
      li.addEventListener("dragstart", (e) => {
        DRAGGING = { id: m.id, from: idx };
        DRAG_MOVED = false;
        li.classList.add("dragging");
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", m.id);
      });
      li.addEventListener("dragend", () => {
        li.classList.remove("dragging");
        DRAGGING = null;
        document.querySelectorAll(".team-card.drop-target").forEach((c) =>
          c.classList.remove("drop-target")
        );
        setTimeout(() => (DRAG_MOVED = false), 0);
      });

      const who = document.createElement("div");
      who.className = "who";
      const nm = document.createElement("span");
      nm.className = "nm";
      nm.textContent = m.name;
      who.append(nm);
      if (m.is_guest) {
        const g = document.createElement("span");
        g.className = "guest";
        g.textContent = "게스트";
        who.append(g);
      }
      if (m.estimated) {
        const e = document.createElement("span");
        e.className = "est";
        e.textContent = "추정";
        who.append(e);
      }
      if (m.position_rank && m.position_rank <= 3) {
        const r = document.createElement("span");
        r.className = "rank";
        r.textContent = `${m.position_rank}위`;
        r.title = `${m.position} 역량 ${m.position_rank}위`;
        who.append(r);
      }
      if (m.position === "포워드" && m.height_rank && m.height_rank <= 3) {
        const h = document.createElement("span");
        h.className = "hrank";
        h.textContent = `키 ${m.height_rank}위`;
        h.title = `포워드 신장 ${m.height_rank}위`;
        who.append(h);
      }
      if (m.age_bonus) {
        const b = document.createElement("span");
        b.className = "bonus";
        b.textContent = `+${m.age_bonus}`;
        b.title = `55세 이상 가중치 ${m.age_bonus}점`;
        who.append(b);
      }

      const pos = document.createElement("span");
      pos.className = "pos " + m.position;
      pos.textContent = m.position;

      const right = document.createElement("div");
      const lvEl = document.createElement("div");
      lvEl.className = "lv";
      lvEl.textContent = m.effective_level.toFixed(2);
      if (m.age_bonus) lvEl.title = `역량 ${m.level.toFixed(2)} + 보너스 ${m.age_bonus}`;
      const bar = document.createElement("div");
      bar.className = "bar";
      const fill = document.createElement("i");
      fill.style.width = Math.max(2, (m.effective_level / maxLevel) * 100) + "%";
      bar.append(fill);
      right.append(lvEl, bar);

      const meta = document.createElement("div");
      meta.className = "meta";
      meta.textContent = [m.height_cm ? m.height_cm + "cm" : null, m.age ? m.age + "세" : null]
        .filter(Boolean)
        .join(" · ");
      who.append(meta);

      li.append(who, pos, right);
      ul.append(li);
    });

    /* 역할군 프로파일 */
    const roles = document.createElement("div");
    roles.className = "roles";
    Object.keys(ROLE_LABELS).forEach((key) => {
      const val = s.roles[key] || 0;
      const line = document.createElement("div");
      line.className = "role-line";
      const label = document.createElement("span");
      label.textContent = ROLE_LABELS[key];
      const barWrap = document.createElement("div");
      barWrap.className = "rbar";
      const i = document.createElement("i");
      i.style.width = (val / 5) * 100 + "%";
      barWrap.append(i);
      const num = document.createElement("span");
      num.style.textAlign = "right";
      num.textContent = val.toFixed(2);
      line.append(label, barWrap, num);
      roles.append(line);
    });

    card.addEventListener("dragover", (e) => {
      if (!DRAGGING || DRAGGING.from === idx) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      card.classList.add("drop-target");
    });
    card.addEventListener("dragleave", (e) => {
      if (!card.contains(e.relatedTarget)) card.classList.remove("drop-target");
    });
    card.addEventListener("drop", (e) => {
      e.preventDefault();
      card.classList.remove("drop-target");
      const id = (e.dataTransfer && e.dataTransfer.getData("text/plain")) || (DRAGGING && DRAGGING.id);
      const from = DRAGGING ? DRAGGING.from : -1;
      DRAG_MOVED = true;
      if (id && from !== idx) moveMember(id, idx);
    });

    card.append(head, sum, ul, roles);
    box.append(card);
  });
}

/** 인원을 다른 팀으로 옮기고 서버에서 요약·지표를 다시 계산한다. */
async function moveMember(memberId, toTeam) {
  if (!RESULT) return;
  const assignment = RESULT.teams.map((t) =>
    t.members.map((m) => m.id).filter((id) => id !== memberId)
  );
  if (toTeam < 0 || toTeam >= assignment.length) return;
  assignment[toTeam].push(memberId);

  const box = $("#teams");
  box.classList.add("busy");
  try {
    const data = await api("/api/teams/rearrange", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assignment, team_names: currentNames() }),
    });
    render(data);
    flashMoved(memberId);
  } catch (err) {
    alert(err.message);
  } finally {
    box.classList.remove("busy");
  }
}

/** 방금 옮긴 인원을 잠깐 강조한다. */
function flashMoved(memberId) {
  const li = document.querySelector(`.roster li[data-member-id="${CSS.escape(memberId)}"]`);
  if (!li) return;
  li.classList.add("moved");
  li.scrollIntoView({ block: "nearest" });
  setTimeout(() => li.classList.remove("moved"), 1400);
}

function renderExcluded(excluded) {
  const card = $("#excludedCard");
  if (!excluded || !excluded.length) {
    card.hidden = true;
    return;
  }
  card.hidden = false;
  $("#excludedList").textContent = excluded.map((m) => `${m.name}(${m.position})`).join(", ");
}

function render(result) {
  RESULT = result;
  const head = $("#seedLine");
  head.textContent =
    `총 ${result.teams.reduce((n, t) => n + t.members.length, 0)}명 · ${result.teams.length}개 팀 · 랜덤 시드 ${result.seed}`;
  if (result.manual) {
    const tag = document.createElement("span");
    tag.className = "manual-tag";
    tag.textContent = "수동 조정됨";
    tag.title = "인원을 손으로 옮긴 상태입니다. '다시 편성'을 누르면 자동 편성으로 되돌아갑니다.";
    head.append(" ", tag);
  }
  renderWarnings(result.warnings);
  renderMetrics(result.metrics);
  renderTeams(result.teams);
  renderExcluded(result.excluded);
}

/* ------------------------------------------------------------ 액션 */
function bindActions() {
  $("#reshuffleBtn").addEventListener("click", async () => {
    let options = { team_count: 3, use_height: true, iterations: 3000 };
    try {
      const saved = JSON.parse(localStorage.getItem("balanceOptions") || "null");
      if (saved) options = saved;
    } catch {
      /* 저장된 옵션이 없으면 기본값 사용 */
    }
    options.seed = null; // 재편성은 항상 새 시드로
    $("#overlay").hidden = false;
    try {
      const data = await api("/api/teams/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ options, team_names: currentNames() }),
      });
      render(data);
    } catch (err) {
      alert(err.message);
    } finally {
      $("#overlay").hidden = true;
    }
  });

  $("#exportBtn").addEventListener("click", async () => {
    const res = await fetch("/api/teams/export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ team_names: currentNames() }),
    });
    if (!res.ok) {
      alert("xlsx 내보내기에 실패했습니다.");
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "team_result.xlsx";
    a.click();
    URL.revokeObjectURL(url);
  });

  $("#copyBtn").addEventListener("click", async () => {
    if (!RESULT) return;
    const names = currentNames();
    const lines = RESULT.teams.map((t, i) => {
      const header = `[${names[i] || t.name}] 평균 ${t.summary.avg_level.toFixed(2)} · 가드 ${t.summary.guards} / 포워드 ${t.summary.forwards}`;
      const roster = t.members
        .map((m) => `  - ${m.name} (${m.position}, ${m.level.toFixed(2)})`)
        .join("\n");
      return header + "\n" + roster;
    });
    const text = lines.join("\n\n");
    try {
      await navigator.clipboard.writeText(text);
      $("#copyBtn").textContent = "복사됨!";
      setTimeout(() => ($("#copyBtn").textContent = "텍스트 복사"), 1500);
    } catch {
      prompt("아래 내용을 복사하세요.", text);
    }
  });
}

/* ------------------------------------------------------------------ 시작 */
(async function init() {
  bindActions();
  try {
    SHEET = createMemberSheet(await api("/api/skills"));
  } catch (err) {
    console.error("역량 정의를 불러오지 못했습니다", err);
  }
  try {
    render(await api("/api/teams/result"));
    // ?member=<id> 로 특정 인원의 차트를 바로 열 수 있다 (링크 공유용)
    const wanted = new URLSearchParams(location.search).get("member");
    if (wanted && SHEET) {
      for (const t of RESULT.teams) {
        const hit = t.members.find((m) => m.id === wanted);
        if (hit) {
          SHEET.open(hit, t.name, allMembers());
          break;
        }
      }
    }
  } catch (err) {
    $("#teams").innerHTML = "";
    const div = document.createElement("div");
    div.className = "banner";
    div.textContent = err.message + " 인원 입력 화면에서 팀 편성을 실행해 주세요.";
    $("#warnings").append(div);
  }
})();
