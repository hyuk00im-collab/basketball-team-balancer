/* 인원 입력 화면 (WEBAPP_SPEC.md §3.1) */
const $ = (sel) => document.querySelector(sel);

let SKILL_DEFS = { 가드: [], 포워드: [] };
let members = [];

/* ------------------------------------------------------------------ 유틸 */
async function api(path, options = {}) {
  const res = await fetch(path, options);
  if (res.status === 204) return null;
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const detail = data && data.detail;
    throw new Error(typeof detail === "string" ? detail : `요청 실패 (${res.status})`);
  }
  return data;
}

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
    items.forEach((t) => {
      const li = document.createElement("li");
      li.textContent = t;
      ul.append(li);
    });
    el.append(ul);
  }
}

/* ------------------------------------------------------ 역량 슬라이더 폼 */
function renderSkillFields(position) {
  const box = $("#skillFields");
  box.innerHTML = "";
  (SKILL_DEFS[position] || []).forEach((name) => {
    const row = document.createElement("div");
    row.className = "skill-row";

    const label = document.createElement("span");
    label.textContent = name;

    const range = document.createElement("input");
    range.type = "range";
    range.min = "0";
    range.max = "5";
    range.step = "0.5";
    range.value = "3";
    range.dataset.skill = name;
    range.dataset.touched = "0";

    const val = document.createElement("span");
    val.className = "val";
    val.textContent = "—";

    range.addEventListener("input", () => {
      range.dataset.touched = "1";
      row.classList.add("filled");
      val.textContent = Number(range.value).toFixed(1);
    });

    row.append(label, range, val);
    box.append(row);
  });
}

function collectSkills() {
  const skills = {};
  $("#skillFields")
    .querySelectorAll("input[type=range]")
    .forEach((r) => {
      if (r.dataset.touched === "1") skills[r.dataset.skill] = Number(r.value);
    });
  return skills;
}

function clearSkills() {
  $("#skillFields")
    .querySelectorAll(".skill-row")
    .forEach((row) => {
      const r = row.querySelector("input[type=range]");
      r.value = "3";
      r.dataset.touched = "0";
      row.classList.remove("filled");
      row.querySelector(".val").textContent = "—";
    });
}

/* ------------------------------------------------------------ 인원 목록 */
function renderMembers() {
  const body = $("#memberBody");
  $("#memberCount").textContent = members.length;
  body.innerHTML = "";

  if (!members.length) {
    body.innerHTML = '<tr class="empty"><td colspan="6">아직 등록된 인원이 없습니다.</td></tr>';
  } else {
    members.forEach((m) => {
      const tr = document.createElement("tr");

      const tdName = document.createElement("td");
      tdName.append(m.name);
      if (m.is_guest) {
        const g = document.createElement("span");
        g.className = "guest";
        g.textContent = "게스트";
        tdName.append(g);
      }
      if (m.estimated) {
        const e = document.createElement("span");
        e.className = "est";
        e.textContent = "추정";
        tdName.append(e);
      }
      if (m.position_rank && m.position_rank <= 3) {
        const r = document.createElement("span");
        r.className = "rank";
        r.textContent = `${m.position} ${m.position_rank}위`;
        r.title = "포지션별 역량 상위 3명은 서로 다른 팀에 배정됩니다";
        tdName.append(r);
      }
      if (m.position === "포워드" && m.height_rank && m.height_rank <= 3) {
        const h = document.createElement("span");
        h.className = "hrank";
        h.textContent = `키 ${m.height_rank}위`;
        h.title = "포워드 신장 상위 3명도 서로 다른 팀에 배정됩니다 (2순위)";
        tdName.append(h);
      }
      if (m.age_bonus) {
        const b = document.createElement("span");
        b.className = "bonus";
        b.textContent = `+${m.age_bonus}`;
        b.title = `55세 이상 가중치 ${m.age_bonus}점 — 실질 전력 ${m.effective_level.toFixed(2)}`;
        tdName.append(b);
      }

      const tdPos = document.createElement("td");
      const pos = document.createElement("span");
      pos.className = "pos " + m.position;
      pos.textContent = m.position;
      tdPos.append(pos);

      const tdLv = document.createElement("td");
      tdLv.className = "num";
      tdLv.textContent = m.level.toFixed(2);
      if (m.age_bonus) tdLv.title = `실질 전력 ${m.effective_level.toFixed(2)} (보너스 +${m.age_bonus})`;

      const tdAge = document.createElement("td");
      tdAge.className = "num";
      tdAge.textContent = m.age ? m.age : "—";
      tdAge.title = m.birth_year ? `${m.birth_year}년생` : "";

      const tdH = document.createElement("td");
      tdH.className = "num";
      tdH.textContent = m.height_cm ? m.height_cm : "—";

      const tdDel = document.createElement("td");
      const btn = document.createElement("button");
      btn.className = "del";
      btn.title = "삭제";
      btn.textContent = "×";
      btn.addEventListener("click", () => removeMember(m.id));
      tdDel.append(btn);

      tr.append(tdName, tdPos, tdLv, tdAge, tdH, tdDel);
      body.append(tr);
    });
  }

  renderStats();
  $("#generateBtn").disabled = members.length < 3;
}

function renderStats() {
  const row = $("#statRow");
  row.innerHTML = "";
  if (!members.length) return;

  const guards = members.filter((m) => m.position === "가드").length;
  const avg = members.reduce((s, m) => s + m.level, 0) / members.length;
  const base = Math.floor(members.length / 3);
  const rem = members.length % 3;
  const sizes = [0, 1, 2].map((i) => base + (i < rem ? 1 : 0)).join("-");

  const seniors = members.filter((m) => m.age_bonus).length;
  const pills = [
    `가드 <b>${guards}</b> · 포워드 <b>${members.length - guards}</b>`,
    `평균 레벨 <b>${avg.toFixed(2)}</b>`,
    `3팀 배분 <b>${sizes}</b>`,
  ];
  if (seniors) pills.push(`55세 이상 <b>${seniors}</b> <span class="hint-inline">(가중치 반영)</span>`);
  pills.forEach((html) => {
    const p = document.createElement("span");
    p.className = "pill";
    p.innerHTML = html;
    row.append(p);
  });
}

async function loadMembers() {
  members = await api("/api/members");
  renderMembers();
}

async function removeMember(id) {
  try {
    await api(`/api/members/${encodeURIComponent(id)}`, { method: "DELETE" });
    await loadMembers();
  } catch (err) {
    setMsg($("#genMsg"), err.message, "error");
  }
}

/* ------------------------------------------------------------ 파일 업로드 */
async function uploadFile(file) {
  const msg = $("#uploadMsg");
  if (!file) return;
  setMsg(msg, `'${file.name}' 업로드 중…`);
  const form = new FormData();
  form.append("file", file);
  try {
    const data = await api("/api/upload", { method: "POST", body: form });
    members = data.members;
    renderMembers();
    setMsgList(
      msg,
      `${data.added.length}명을 불러왔습니다.`,
      data.warnings,
      data.warnings.length ? "" : "ok"
    );
  } catch (err) {
    setMsg(msg, err.message, "error");
  }
}

/* ------------------------------------------------------------ 이벤트 연결 */
function bindUpload() {
  const zone = $("#dropzone");
  const input = $("#fileInput");
  zone.addEventListener("click", () => input.click());
  input.addEventListener("change", () => {
    uploadFile(input.files[0]);
    input.value = "";
  });
  ["dragenter", "dragover"].forEach((ev) =>
    zone.addEventListener(ev, (e) => {
      e.preventDefault();
      zone.classList.add("over");
    })
  );
  ["dragleave", "drop"].forEach((ev) =>
    zone.addEventListener(ev, (e) => {
      e.preventDefault();
      zone.classList.remove("over");
    })
  );
  zone.addEventListener("drop", (e) => uploadFile(e.dataTransfer.files[0]));
}

function bindForm() {
  $("#positionSelect").addEventListener("change", (e) => renderSkillFields(e.target.value));

  // 출생년도 입력 시 현재 연도 기준으로 나이 자동 계산 (엑셀의 =YEAR(TODAY())-출생년도 와 동일)
  $("#birthYear").addEventListener("input", () => {
    const by = Number($("#birthYear").value);
    const thisYear = new Date().getFullYear();
    $("#ageInput").value = by >= 1930 && by <= thisYear ? thisYear - by : "";
  });
  $("#skipSkills").addEventListener("click", clearSkills);

  $("#memberForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = e.target;
    const fd = new FormData(form);
    const payload = {
      name: (fd.get("name") || "").trim(),
      position: fd.get("position"),
      birth_year: fd.get("birth_year") ? Number(fd.get("birth_year")) : null,
      age: fd.get("age") ? Number(fd.get("age")) : null,
      height_cm: fd.get("height_cm") ? Number(fd.get("height_cm")) : null,
      is_guest: fd.get("is_guest") === "on",
      skills: collectSkills(),
    };
    try {
      const added = await api("/api/members", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      await loadMembers();
      const note = added.estimated ? " (미입력 역량은 중앙값으로 추정)" : "";
      setMsg($("#formMsg"), `'${added.name}' 추가 완료 · 레벨 ${added.level.toFixed(2)}${note}`, "ok");
      form.reset();
      $("#ageInput").value = "";
      renderSkillFields($("#positionSelect").value);
      form.querySelector("input[name=name]").focus();
    } catch (err) {
      setMsg($("#formMsg"), err.message, "error");
    }
  });
}

function bindActions() {
  $("#clearAll").addEventListener("click", async () => {
    if (!members.length) return;
    if (!confirm("등록된 인원을 모두 삭제할까요?")) return;
    await api("/api/members", { method: "DELETE" });
    await loadMembers();
    setMsg($("#genMsg"), "");
  });

  $("#generateBtn").addEventListener("click", async () => {
    const seedRaw = $("#optSeed").value;
    const body = {
      options: {
        team_count: 3,
        seed: seedRaw === "" ? null : Number(seedRaw),
        use_height: $("#optHeight").checked,
        iterations: Number($("#optIter").value || 3000),
      },
    };
    localStorage.setItem("balanceOptions", JSON.stringify(body.options)); // 결과 화면의 '다시 편성'에서 재사용
    $("#overlay").hidden = false;
    try {
      await api("/api/teams/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      location.href = "/result";
    } catch (err) {
      setMsg($("#genMsg"), err.message, "error");
    } finally {
      $("#overlay").hidden = true;
    }
  });
}

/* ------------------------------------------------------------------ 시작 */
(async function init() {
  bindUpload();
  bindForm();
  bindActions();
  try {
    const defs = await api("/api/skills");
    SKILL_DEFS = defs.skills;
  } catch (err) {
    setMsg($("#formMsg"), "역량 항목을 불러오지 못했습니다: " + err.message, "error");
  }
  renderSkillFields($("#positionSelect").value);
  await loadMembers();
})();
