/* ==========================================================
   لوحة تحكم الأدمن - المنطق الكامل
   ========================================================== */

const GRACE_MINUTES = 20; // هامش السماح بالدقايق حوالين معاد الحصة عشان يقدر يسجل حضور
const LATE_MINUTES = 15; // بعد اد ايه من المعاد يعتبر "فايت معادو"

// ---------- حماية الصفحة: لازم تسجيل دخول ----------
auth.onAuthStateChanged((user) => {
  if (!user) window.location.href = "index.html";
  else init();
});

document.getElementById("logoutBtn").addEventListener("click", () => {
  auth.signOut().then(() => (window.location.href = "index.html"));
});

// ---------- التابات ----------
const tabs = document.querySelectorAll(".tab-item");
const panels = document.querySelectorAll(".tab-panel");
tabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    tabs.forEach((t) => t.classList.remove("active"));
    tab.classList.add("active");
    panels.forEach((p) => p.classList.add("hidden"));
    document.getElementById("tab-" + tab.dataset.tab).classList.remove("hidden");
    if (tab.dataset.tab === "attendance") refreshMissedList();
    if (tab.dataset.tab === "overview") loadOverview();
  });
});

function goToTab(name) {
  document.querySelector(`.tab-item[data-tab="${name}"]`).click();
}

async function init() {
  trackPresence("admin");
  await loadOverview(); // بيحمّل studentsCache عشان أعداد الطلاب في كل مجموعة تظهر صح من أول مرة
  await loadTeachersCache();
  addSubjectRow(subjectsWrap);
  loadTodayAttendance();
  refreshMissedList();
  loadPaymentRequests();
}

/* ==========================================================
   المدرسين والمجموعات (Teachers cache + CRUD)
   ========================================================== */
let teachersCache = {}; // { teacherId: {name, groups:{groupId:{label,day,time,fee}}} }

async function loadTeachersCache() {
  const snap = await db.ref("teachers").get();
  teachersCache = snap.exists() ? snap.val() : {};
  renderTeachersList();
  return teachersCache;
}

document.getElementById("teacherForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = document.getElementById("t_name").value.trim();
  if (!name) return;
  await db.ref("teachers").push({ name, groups: {} });
  document.getElementById("t_name").value = "";
  showToast("تم إضافة المدرس", "success");
  await loadTeachersCache();
});

function renderTeachersList() {
  const wrap = document.getElementById("teachersList");
  const empty = document.getElementById("teachersEmpty");
  const entries = Object.entries(teachersCache);
  if (!entries.length) {
    wrap.innerHTML = "";
    empty.classList.remove("hidden");
    return;
  }
  empty.classList.add("hidden");
  wrap.innerHTML = "";

  entries.forEach(([teacherId, t]) => {
    const groups = t.groups || {};
    const counts = computeGroupCounts(teacherId);
    const totalStudents = Object.values(counts).reduce((a, b) => a + b, 0);

    const card = el(`
      <div class="teacher-card">
        <div class="t-head">
          <div class="t-name">🧑‍🏫 ${escapeHtml(t.name)} <span style="color:var(--text-light); font-weight:600; font-size:12px;">(${totalStudents} طالب)</span></div>
          <button class="icon-btn" data-del-teacher>🗑️</button>
        </div>
        <div class="groups-pills"></div>
        <form class="add-group-form" style="margin-top:12px; display:flex; gap:8px; flex-wrap:wrap;">
          <input class="form-control" style="flex:1; min-width:120px;" placeholder="اسم المجموعة (مثال: مجموعة الساعة 3)" data-label required>
          <input class="form-control" style="width:120px;" placeholder="الأيام" data-day required>
          <input type="time" class="form-control" style="width:110px;" data-time required>
          <input type="number" class="form-control" style="width:90px;" placeholder="المصاريف" data-fee required>
          <button type="submit" class="btn btn-outline">+ إضافة مجموعة</button>
        </form>
      </div>`);

    const pillsWrap = card.querySelector(".groups-pills");
    Object.entries(groups).forEach(([groupId, g]) => {
      const pill = el(`<span class="group-pill">${escapeHtml(g.label)} - ${escapeHtml(g.day)} - ${escapeHtml(g.time)} <span class="count">${counts[groupId] || 0}</span> <b data-del-group="${groupId}" style="cursor:pointer; color:var(--pink);">✕</b></span>`);
      pill.querySelector("[data-del-group]").addEventListener("click", async () => {
        if (!confirm("حذف هذه المجموعة؟")) return;
        await db.ref(`teachers/${teacherId}/groups/${groupId}`).remove();
        await loadTeachersCache();
      });
      pillsWrap.appendChild(pill);
    });

    card.querySelector("[data-del-teacher]").addEventListener("click", async () => {
      if (!confirm("حذف هذا المدرس وكل مجموعاته؟")) return;
      await db.ref("teachers/" + teacherId).remove();
      await loadTeachersCache();
    });

    card.querySelector(".add-group-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const f = e.target;
      const label = f.querySelector("[data-label]").value.trim();
      const day = f.querySelector("[data-day]").value.trim();
      const time = f.querySelector("[data-time]").value;
      const fee = f.querySelector("[data-fee]").value;
      await db.ref(`teachers/${teacherId}/groups`).push({ label, day, time, fee });
      showToast("تم إضافة المجموعة", "success");
      await loadTeachersCache();
    });

    wrap.appendChild(card);
  });
}

// عدد الطلاب المسجلين في كل مجموعة لمدرس معين (بيدور جوه بيانات كل الطلاب)
let studentsCache = {};
function computeGroupCounts(teacherId) {
  const counts = {};
  Object.values(studentsCache).forEach((s) => {
    Object.values(s.subjects || {}).forEach((sub) => {
      if (sub.teacherId === teacherId && sub.groupId) {
        counts[sub.groupId] = (counts[sub.groupId] || 0) + 1;
      }
    });
  });
  return counts;
}

/* ==========================================================
   مكوّن صف "مادة / مجموعة" مع اختيار مدرس وتعبئة تلقائية
   ========================================================== */
function subjectRowTemplate(data = {}) {
  return `
    <div class="subject-row" data-row style="display:block;">
      <div class="row-2" style="margin-bottom:10px;">
        <div class="form-group" style="margin-bottom:0;">
          <label>اختر مدرس (للتعبئة التلقائية)</label>
          <select class="form-control" data-teacher-select></select>
        </div>
        <div class="form-group" style="margin-bottom:0;">
          <label>اختر المجموعة</label>
          <select class="form-control" data-group-select disabled><option value="">اختر مدرس أولاً</option></select>
        </div>
      </div>
      <div class="row-3">
        <div class="form-group" style="margin-bottom:0;">
          <label>اسم المادة / المجموعة</label>
          <input type="text" class="form-control" data-field="name" value="${escapeHtml(data.name || "")}" placeholder="مثال: رياضيات - مجموعة 3">
        </div>
        <div class="form-group" style="margin-bottom:0;">
          <label>الأيام</label>
          <input type="text" class="form-control" data-field="day" value="${escapeHtml(data.day || "")}" placeholder="مثال: حد - تلات - خميس">
        </div>
        <div class="form-group" style="margin-bottom:0;">
          <label>الميعاد</label>
          <input type="time" class="form-control" data-field="time" value="${escapeHtml(data.time || "")}">
        </div>
      </div>
      <div class="row-2" style="margin-top:10px; align-items:end;">
        <div class="form-group" style="margin-bottom:0;">
          <label>المصاريف (ج)</label>
          <input type="number" class="form-control" data-field="fee" value="${escapeHtml(data.fee ?? "")}" placeholder="مثال: 300">
        </div>
        <button type="button" class="btn btn-danger" data-remove>حذف هذه المادة ✕</button>
      </div>
    </div>`;
}

function addSubjectRow(container, data = {}) {
  const row = el(subjectRowTemplate(data));
  row.dataset.teacherId = data.teacherId || "";
  row.dataset.groupId = data.groupId || "";

  const teacherSelect = row.querySelector("[data-teacher-select]");
  const groupSelect = row.querySelector("[data-group-select]");

  teacherSelect.innerHTML = '<option value="">— بدون —</option>' + Object.entries(teachersCache).map(([id, t]) => `<option value="${id}" ${id === data.teacherId ? "selected" : ""}>${escapeHtml(t.name)}</option>`).join("");

  function fillGroups(teacherId, selectedGroupId) {
    const t = teachersCache[teacherId];
    if (!t || !t.groups || !Object.keys(t.groups).length) {
      groupSelect.innerHTML = '<option value="">لا توجد مجموعات</option>';
      groupSelect.disabled = true;
      return;
    }
    groupSelect.disabled = false;
    groupSelect.innerHTML = '<option value="">اختر مجموعة</option>' + Object.entries(t.groups).map(([gid, g]) => `<option value="${gid}" ${gid === selectedGroupId ? "selected" : ""}>${escapeHtml(g.label)} (${escapeHtml(g.day)} - ${escapeHtml(g.time)})</option>`).join("");
  }

  if (data.teacherId) fillGroups(data.teacherId, data.groupId);

  teacherSelect.addEventListener("change", () => {
    row.dataset.teacherId = teacherSelect.value;
    row.dataset.groupId = "";
    fillGroups(teacherSelect.value, "");
  });

  groupSelect.addEventListener("change", () => {
    row.dataset.groupId = groupSelect.value;
    const t = teachersCache[teacherSelect.value];
    const g = t && t.groups ? t.groups[groupSelect.value] : null;
    if (g) {
      row.querySelector('[data-field="name"]').value = `${t.name} - ${g.label}`;
      row.querySelector('[data-field="day"]').value = g.day;
      row.querySelector('[data-field="time"]').value = g.time;
      row.querySelector('[data-field="fee"]').value = g.fee;
    }
  });

  row.querySelector("[data-remove]").addEventListener("click", () => row.remove());
  container.appendChild(row);
}

function collectSubjects(container) {
  const subjects = {};
  container.querySelectorAll("[data-row]").forEach((row, i) => {
    const name = row.querySelector('[data-field="name"]').value.trim();
    const day = row.querySelector('[data-field="day"]').value.trim();
    const time = row.querySelector('[data-field="time"]').value.trim();
    const fee = row.querySelector('[data-field="fee"]').value.trim();
    if (name) {
      subjects["s" + i + "_" + Date.now()] = {
        name, day, time, fee: fee || "0",
        teacherId: row.dataset.teacherId || "",
        groupId: row.dataset.groupId || "",
      };
    }
  });
  return subjects;
}

/* ==========================================================
   TAB: إنشاء حساب طالب جديد
   ========================================================== */
const subjectsWrap = document.getElementById("subjectsWrap");
document.getElementById("addSubjectBtn").addEventListener("click", () => addSubjectRow(subjectsWrap));

document.getElementById("createForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = document.getElementById("createBtn");
  btn.disabled = true;
  btn.innerHTML = '<span class="spin"></span> جاري الإنشاء...';

  try {
    const name = document.getElementById("c_name").value.trim();
    const grade = document.getElementById("c_grade").value.trim();
    const parentPhone = document.getElementById("c_parentPhone").value.trim();
    const address = document.getElementById("c_address").value.trim();
    const subjects = collectSubjects(subjectsWrap);

    const code = await generateUniqueStudentId();

    await db.ref("students/" + code).set({
      code, name, grade, parentPhone,
      address: address || "غير محدد",
      subjects, grades: {}, attendance: {}, notes: {}, payments: {},
      createdAt: new Date().toISOString(),
    });

    const link = SITE_BASE_URL + "student.html?id=" + code;
    document.getElementById("resultCode").textContent = "كود الطالب: " + code;
    document.getElementById("resultLink").value = link;

    const qrBox = document.getElementById("resultQr");
    qrBox.innerHTML = "";
    new QRCode(qrBox, { text: link, width: 170, height: 170 });

    document.getElementById("createResult").classList.remove("hidden");
    document.getElementById("createForm").reset();
    subjectsWrap.innerHTML = "";
    addSubjectRow(subjectsWrap);

    showToast("تم إنشاء حساب الطالب بنجاح", "success");
    loadOverview();
  } catch (err) {
    console.error(err);
    showToast("حدث خطأ أثناء الإنشاء: " + err.message, "error");
  } finally {
    btn.disabled = false;
    btn.innerHTML = "إنشاء الحساب وتوليد الكود";
  }
});

/* ==========================================================
   TAB: الرئيسية (Overview)
   ========================================================== */
async function loadOverview() {
  const snap = await db.ref("students").get();
  studentsCache = snap.exists() ? snap.val() : {};
  const students = Object.entries(studentsCache);

  document.getElementById("ov_totalStudents").textContent = students.length;

  const today = todayKey();
  const presentToday = new Set();
  students.forEach(([code, s]) => {
    Object.values(s.attendance || {}).forEach((a) => {
      if (a.type === "in" && a.date === today) presentToday.add(code);
    });
  });
  document.getElementById("ov_todayPresent").textContent = presentToday.size;

  let paid = 0, unpaid = 0;
  students.forEach(([, s]) => {
    const res = isStudentPaidThisMonth(s);
    if (res.paid) paid++; else unpaid++;
  });
  document.getElementById("ov_paidCount").textContent = paid;
  document.getElementById("ov_unpaidCount").textContent = unpaid;

  const reqSnap = await db.ref("paymentRequests").orderByChild("status").equalTo("pending").get();
  document.getElementById("ov_requestsCount").textContent = reqSnap.exists() ? Object.keys(reqSnap.val()).length : 0;

  attachLiveOverviewListeners();
}

let liveListenersAttached = false;
function attachLiveOverviewListeners() {
  if (liveListenersAttached) return;
  liveListenersAttached = true;
  // متصلين الآن (presence) - listener مباشر
  db.ref("presence").on("value", (s) => {
    document.getElementById("ov_online").textContent = s.exists() ? Object.keys(s.val()).length : 0;
  });
  // عدد مرات الفتح
  db.ref("stats/pageViews").on("value", (s) => {
    document.getElementById("ov_pageViews").textContent = s.val() || 0;
  });
}

function isStudentPaidThisMonth(student) {
  const subjects = Object.entries(student.subjects || {});
  if (!subjects.length) return { paid: true, unpaidSubjects: [] };
  const monthKey = currentMonthKey();
  const payments = (student.payments || {})[monthKey] || {};
  const unpaidSubjects = subjects.filter(([key]) => !payments[key]).map(([key, s]) => ({ key, name: s.name }));
  return { paid: unpaidSubjects.length === 0, unpaidSubjects };
}

// ----- Modal: كل الطلاب -----
document.getElementById("openAllStudentsBtn").addEventListener("click", async () => {
  const snap = await db.ref("students").get();
  studentsCache = snap.exists() ? snap.val() : {};
  renderAllStudentsList(studentsCache);
  document.getElementById("allStudentsModal").classList.remove("hidden");
});
document.getElementById("closeAllStudentsModal").addEventListener("click", () => {
  document.getElementById("allStudentsModal").classList.add("hidden");
});
document.getElementById("allStudentsSearch").addEventListener("input", (e) => {
  const q = e.target.value.trim().toLowerCase();
  const filtered = Object.fromEntries(Object.entries(studentsCache).filter(([code, s]) => code.includes(q) || (s.name || "").toLowerCase().includes(q)));
  renderAllStudentsList(filtered);
});

function renderAllStudentsList(students) {
  const wrap = document.getElementById("allStudentsList");
  const entries = Object.entries(students);
  if (!entries.length) {
    wrap.innerHTML = '<p class="empty-box">لا يوجد طلاب</p>';
    return;
  }
  wrap.innerHTML = "";
  entries.forEach(([code, s]) => {
    const row = el(`<div class="student-list-row"><span class="name">${escapeHtml(s.name)}</span><span class="code">${escapeHtml(code)}</span></div>`);
    row.addEventListener("click", () => {
      document.getElementById("allStudentsModal").classList.add("hidden");
      goToTab("edit");
      document.getElementById("e_code").value = code;
      searchStudentForEdit();
    });
    wrap.appendChild(row);
  });
}

/* ==========================================================
   TAB: إضافة درجات الامتحانات (3 مربعات)
   ========================================================== */
let g_currentCode = null;

document.getElementById("g_searchBtn").addEventListener("click", searchStudentForGrades);
document.getElementById("g_code").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); searchStudentForGrades(); } });

async function searchStudentForGrades() {
  const code = document.getElementById("g_code").value.trim();
  if (!code) return showToast("اكتب كود الطالب أولاً", "error");

  const snap = await db.ref("students/" + code).get();
  if (!snap.exists()) {
    showToast("لا يوجد طالب بهذا الكود", "error");
    document.getElementById("g_studentBox").style.display = "none";
    document.getElementById("gradeForm").classList.add("hidden");
    return;
  }
  const student = snap.val();
  g_currentCode = code;
  document.getElementById("g_studentName").textContent = `${student.name} - ${student.grade || ""}`;
  document.getElementById("g_studentBox").style.display = "flex";
  document.getElementById("gradeForm").classList.remove("hidden");
  renderGradesTable(student.grades || {});
}

document.getElementById("gradeForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!g_currentCode) return;

  const examName = document.getElementById("g_examName").value.trim();
  const examDate = document.getElementById("g_examDate").value;
  const score = document.getElementById("g_score").value;
  const maxScore = document.getElementById("g_maxScore").value;

  try {
    await db.ref("students/" + g_currentCode + "/grades").push({
      examName, date: examDate, score: Number(score), maxScore: Number(maxScore), createdAt: new Date().toISOString(),
    });
    showToast("تم حفظ الدرجة بنجاح", "success");
    document.getElementById("gradeForm").reset();
    const snap = await db.ref("students/" + g_currentCode + "/grades").get();
    renderGradesTable(snap.val() || {});
  } catch (err) {
    showToast("حدث خطأ أثناء الحفظ: " + err.message, "error");
  }
});

function renderGradesTable(grades) {
  const tbody = document.querySelector("#g_gradesTable tbody");
  const emptyBox = document.getElementById("g_emptyGrades");
  tbody.innerHTML = "";
  const entries = Object.values(grades || {}).sort((a, b) => (a.date < b.date ? 1 : -1));
  if (!entries.length) {
    emptyBox.classList.remove("hidden");
    document.getElementById("g_gradesTable").classList.add("hidden");
    return;
  }
  emptyBox.classList.add("hidden");
  document.getElementById("g_gradesTable").classList.remove("hidden");
  entries.forEach((g) => {
    tbody.appendChild(el(`<tr><td>${escapeHtml(g.examName)}</td><td>${escapeHtml(g.date || "-")}</td><td>${g.score} / ${g.maxScore}</td></tr>`));
  });
}

/* ==========================================================
   TAB: تعديل بروفايل طالب
   ========================================================== */
let e_currentCode = null;
const e_subjectsWrap = document.getElementById("e_subjectsWrap");
document.getElementById("e_addSubjectBtn").addEventListener("click", () => addSubjectRow(e_subjectsWrap));

document.getElementById("e_searchBtn").addEventListener("click", searchStudentForEdit);
document.getElementById("e_code").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); searchStudentForEdit(); } });

async function searchStudentForEdit() {
  const code = document.getElementById("e_code").value.trim();
  if (!code) return showToast("اكتب كود الطالب أولاً", "error");

  const snap = await db.ref("students/" + code).get();
  if (!snap.exists()) {
    showToast("لا يوجد طالب بهذا الكود", "error");
    document.getElementById("editForm").classList.add("hidden");
    return;
  }
  const student = snap.val();
  e_currentCode = code;

  document.getElementById("e_name").value = student.name || "";
  document.getElementById("e_grade").value = student.grade || "";
  document.getElementById("e_parentPhone").value = student.parentPhone || "";
  document.getElementById("e_address").value = student.address || "";

  e_subjectsWrap.innerHTML = "";
  const subjects = student.subjects || {};
  if (Object.keys(subjects).length === 0) addSubjectRow(e_subjectsWrap);
  else Object.values(subjects).forEach((s) => addSubjectRow(e_subjectsWrap, s));

  document.getElementById("editForm").classList.remove("hidden");
}

document.getElementById("editForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!e_currentCode) return;
  try {
    await db.ref("students/" + e_currentCode).update({
      name: document.getElementById("e_name").value.trim(),
      grade: document.getElementById("e_grade").value.trim(),
      parentPhone: document.getElementById("e_parentPhone").value.trim(),
      address: document.getElementById("e_address").value.trim(),
      subjects: collectSubjects(e_subjectsWrap),
    });
    showToast("تم حفظ التعديلات بنجاح", "success");
  } catch (err) {
    showToast("حدث خطأ أثناء الحفظ: " + err.message, "error");
  }
});

document.getElementById("e_deleteBtn").addEventListener("click", async () => {
  if (!e_currentCode) return showToast("ابحث عن طالب أولاً", "error");
  if (!confirm("هل أنت متأكد من حذف هذا الطالب نهائياً؟ لا يمكن التراجع.")) return;
  try {
    await db.ref("students/" + e_currentCode).remove();
    showToast("تم حذف الطالب", "success");
    document.getElementById("editForm").classList.add("hidden");
    document.getElementById("e_code").value = "";
    e_currentCode = null;
  } catch (err) {
    showToast("حدث خطأ أثناء الحذف: " + err.message, "error");
  }
});

/* ==========================================================
   TAB: الحضور والانصراف (يدوي / باركود / كاميرا) - ذكي بالمعاد والدفع
   ========================================================== */
let html5QrCode = null;
let scanning = false;
let scanLock = false;

const manualCodeInput = document.getElementById("manualCodeInput");
manualCodeInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    const code = manualCodeInput.value.trim();
    if (code) handleAttendanceScan(code, { override: false });
    manualCodeInput.value = "";
  }
});

document.getElementById("toggleScanBtn").addEventListener("click", () => {
  if (!scanning) startScanner(); else stopScanner();
});

function startScanner() {
  html5QrCode = new Html5Qrcode("qr-reader");
  html5QrCode
    .start({ facingMode: "environment" }, { fps: 10, qrbox: 250 }, onScanSuccess, () => {})
    .then(() => { scanning = true; document.getElementById("toggleScanBtn").textContent = "⏹ إيقاف الكاميرا"; })
    .catch((err) => showToast("تعذر تشغيل الكاميرا: " + err, "error"));
}
function stopScanner() {
  if (html5QrCode) html5QrCode.stop().then(() => { scanning = false; document.getElementById("toggleScanBtn").textContent = "📷 تشغيل الكاميرا (QR)"; });
}

function extractCodeFromText(text) {
  try {
    const url = new URL(text);
    const id = url.searchParams.get("id");
    if (id) return id;
  } catch (_) {}
  const match = text.match(/(\d{3,})/);
  return match ? match[1] : text.trim();
}

async function onScanSuccess(decodedText) {
  if (scanLock) return;
  scanLock = true;
  setTimeout(() => (scanLock = false), 3500);
  await handleAttendanceScan(extractCodeFromText(decodedText), { override: false });
}

async function handleAttendanceScan(code, { override }) {
  const resultBox = document.getElementById("scanResult");
  const snap = await db.ref("students/" + code).get();
  if (!snap.exists()) {
    resultBox.className = "scan-result";
    resultBox.innerHTML = "❌ كود غير معروف: " + escapeHtml(code);
    resultBox.classList.remove("hidden");
    return;
  }
  const student = snap.val();

  // 1) تحقق من الدفع
  if (!override) {
    const payStatus = isStudentPaidThisMonth(student);
    if (!payStatus.paid) {
      resultBox.className = "scan-result";
      resultBox.innerHTML = `
        <strong>⚠️ ${escapeHtml(student.name)} لسه مادفعش مصاريف الشهر ده</strong>
        <div style="font-size:12.5px; color:var(--text-mid); margin:6px 0;">مواد لسه ما اتدفعتش: ${payStatus.unpaidSubjects.map((s) => escapeHtml(s.name)).join("، ")}</div>
        <div style="display:flex; gap:10px; justify-content:center; margin-top:10px;">
          <button class="btn btn-outline" id="overrideAttBtn">تسجيل الحضور رغم عدم الدفع</button>
          <button class="btn btn-primary" id="goPayBtn">الذهاب لتبويب المصروفات</button>
        </div>`;
      resultBox.classList.remove("hidden");
      document.getElementById("overrideAttBtn").addEventListener("click", () => handleAttendanceScan(code, { override: true }));
      document.getElementById("goPayBtn").addEventListener("click", () => {
        goToTab("payments");
        document.getElementById("pay_code").value = code;
        searchStudentForPayments();
      });
      return;
    }
  }

  // 2) تحقق من المعاد (لو الطالب عندو مواد بمواعيد محددة)
  const times = Object.values(student.subjects || {}).map((s) => s.time).filter(Boolean);
  if (!override && times.length && !isWithinSchedule(times, GRACE_MINUTES)) {
    resultBox.className = "scan-result";
    resultBox.innerHTML = `
      <strong>⛔ ${escapeHtml(student.name)} ليس له معاد الآن</strong>
      <div style="font-size:12.5px; color:var(--text-mid); margin:6px 0;">المواعيد المسجلة: ${times.join(" - ")}</div>
      <button class="btn btn-outline" id="overrideScheduleBtn" style="margin-top:8px;">تسجيل الحضور يدوياً رغم ذلك</button>`;
    resultBox.classList.remove("hidden");
    document.getElementById("overrideScheduleBtn").addEventListener("click", () => handleAttendanceScan(code, { override: true }));
    return;
  }

  await proceedAttendance(code, student, resultBox);
}

async function proceedAttendance(code, student, resultBox) {
  const today = todayKey();
  const attendance = student.attendance || {};
  const todaysEntries = Object.entries(attendance).filter(([, v]) => v.date === today);
  const openIn = todaysEntries.find(([, v]) => v.type === "in" && !v.checkedOut);

  const now = new Date();
  const timeStr = formatTimeArabic(now);
  const minutes = nowMinutes();

  let message, type;
  if (!openIn) {
    await db.ref("students/" + code + "/attendance").push({ date: today, type: "in", time: timeStr, timeMinutes: minutes, timestamp: now.toISOString(), checkedOut: false });
    type = "in";
    message = `مرحباً، تم تسجيل حضور الطالب ${student.name} اليوم الساعة ${timeStr} - Al Ola Center`;
    resultBox.className = "scan-result in";
  } else {
    const [key] = openIn;
    await db.ref(`students/${code}/attendance/${key}`).update({ checkedOut: true, outTime: timeStr });
    await db.ref("students/" + code + "/attendance").push({ date: today, type: "out", time: timeStr, timeMinutes: minutes, timestamp: now.toISOString() });
    type = "out";
    message = `تم تسجيل انصراف الطالب ${student.name} اليوم الساعة ${timeStr} - Al Ola Center`;
    resultBox.className = "scan-result out";
  }

  const waLink = buildWhatsAppLink(student.parentPhone, message);
  resultBox.innerHTML = `
    <strong>${type === "in" ? "✅ تم تسجيل حضور" : "👋 تم تسجيل انصراف"}</strong><br>
    ${escapeHtml(student.name)} - الساعة ${timeStr}
    ${waLink ? `<div style="margin-top:10px;"><a href="${waLink}" target="_blank" class="btn btn-teal">📱 إرسال إشعار لولي الأمر عبر واتساب</a></div>` : `<div style="margin-top:8px; font-size:12px; color:var(--text-light);">لا يوجد رقم ولي أمر مسجل</div>`}
  `;
  resultBox.classList.remove("hidden");

  loadTodayAttendance();
  loadOverview();
}

async function loadTodayAttendance() {
  const tbody = document.querySelector("#attTable tbody");
  const emptyBox = document.getElementById("attEmpty");
  const snap = await db.ref("students").get();
  if (!snap.exists()) return;

  studentsCache = snap.val();
  const today = todayKey();
  let rows = [];

  Object.entries(studentsCache).forEach(([code, s]) => {
    Object.values(s.attendance || {}).forEach((a) => {
      if (a.date === today) rows.push({ code, name: s.name, type: a.type, time: a.time });
    });
  });

  rows.sort((a, b) => (a.time < b.time ? 1 : -1));
  tbody.innerHTML = "";
  if (!rows.length) {
    emptyBox.classList.remove("hidden");
    document.getElementById("attTable").classList.add("hidden");
    return;
  }
  emptyBox.classList.add("hidden");
  document.getElementById("attTable").classList.remove("hidden");

  rows.forEach((r) => {
    const badge = r.type === "in" ? '<span class="badge success">حضور</span>' : '<span class="badge pending">انصراف</span>';
    tbody.appendChild(el(`<tr><td>${escapeHtml(r.code)}</td><td>${escapeHtml(r.name)}</td><td>${badge}</td><td>${escapeHtml(r.time)}</td></tr>`));
  });
}

// ----- فاتهم معادهم النهاردة -----
async function refreshMissedList() {
  const wrap = document.getElementById("missedList");
  const empty = document.getElementById("missedEmpty");
  const snap = await db.ref("students").get();
  if (!snap.exists()) { wrap.innerHTML = ""; empty.classList.remove("hidden"); return; }

  studentsCache = snap.val();
  const today = todayKey();
  const now = nowMinutes();
  const missed = [];

  Object.entries(studentsCache).forEach(([code, s]) => {
    const subjects = Object.values(s.subjects || {}).filter((sub) => sub.time);
    if (!subjects.length) return;

    const attendedTimes = Object.values(s.attendance || {})
      .filter((a) => a.type === "in" && a.date === today && typeof a.timeMinutes === "number")
      .map((a) => a.timeMinutes);

    const missedSubjects = subjects.filter((sub) => {
      const tm = timeToMinutes(sub.time);
      if (tm === null) return false;
      const passed = now - tm > LATE_MINUTES; // المعاد فات
      if (!passed) return false;
      const matched = attendedTimes.some((am) => Math.abs(am - tm) <= GRACE_MINUTES);
      return !matched;
    });

    if (missedSubjects.length) missed.push({ code, name: s.name, phone: s.parentPhone, subjects: missedSubjects });
  });

  if (!missed.length) { wrap.innerHTML = ""; empty.classList.remove("hidden"); return; }
  empty.classList.add("hidden");
  wrap.innerHTML = "";

  missed.forEach((m) => {
    const row = el(`
      <div class="pay-row">
        <div class="info"><b>${escapeHtml(m.name)} (${escapeHtml(m.code)})</b>فاته: ${m.subjects.map((s) => escapeHtml(s.name) + " - " + escapeHtml(s.time)).join(" / ")}</div>
        <div></div>
      </div>`);
    const btn = el('<button class="btn btn-danger">📱 إرسال تنبيه غياب</button>');
    btn.addEventListener("click", () => {
      const msg = `تنبيه: الطالب ${m.name} لم يحضر معاده اليوم (${m.subjects.map((s) => s.time).join(" - ")}) في Al Ola Center`;
      sendWhatsApp(m.phone, msg);
    });
    row.lastElementChild.appendChild(btn);
    wrap.appendChild(row);
  });
}

/* ==========================================================
   TAB: المصروفات
   ========================================================== */
let pay_currentCode = null;

document.getElementById("pay_searchBtn").addEventListener("click", searchStudentForPayments);
document.getElementById("pay_code").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); searchStudentForPayments(); } });

async function searchStudentForPayments() {
  const code = document.getElementById("pay_code").value.trim();
  if (!code) return showToast("اكتب كود الطالب أولاً", "error");
  const snap = await db.ref("students/" + code).get();
  if (!snap.exists()) return showToast("لا يوجد طالب بهذا الكود", "error");

  const student = snap.val();
  pay_currentCode = code;
  const monthKey = currentMonthKey();

  document.getElementById("pay_studentName").textContent = `${student.name} - كود ${code}`;
  document.getElementById("pay_monthLabel").textContent = monthLabel(monthKey);
  document.getElementById("pay_studentBox").classList.remove("hidden");

  const subjects = Object.entries(student.subjects || {});
  const wrap = document.getElementById("pay_subjectsWrap");
  const noSubjects = document.getElementById("pay_noSubjects");
  wrap.innerHTML = "";

  if (!subjects.length) { noSubjects.classList.remove("hidden"); return; }
  noSubjects.classList.add("hidden");

  const payments = (student.payments || {})[monthKey] || {};

  subjects.forEach(([key, s]) => {
    const isPaid = !!payments[key];
    const row = el(`
      <div class="pay-row">
        <div class="info"><b>${escapeHtml(s.name)}</b>${escapeHtml(s.fee || 0)} جنيه - ${escapeHtml(s.day || "")}</div>
        <div class="pay-toggle">
          <button type="button" class="yes ${isPaid ? "active" : ""}" data-yes>✓</button>
          <button type="button" class="no ${!isPaid ? "active" : ""}" data-no>✗</button>
        </div>
      </div>`);

    row.querySelector("[data-yes]").addEventListener("click", async () => {
      await db.ref(`students/${code}/payments/${monthKey}/${key}`).set(true);
      row.querySelector("[data-yes]").classList.add("active");
      row.querySelector("[data-no]").classList.remove("active");
      const msg = `تم تأكيد دفع مصاريف "${s.name}" لشهر ${monthLabel(monthKey)} للطالب ${student.name} - Al Ola Center. شكراً لكم.`;
      showToast("تم تسجيل الدفع", "success");
      loadOverview();
      const waLink = buildWhatsAppLink(student.parentPhone, msg);
      if (waLink) window.open(waLink, "_blank");
    });

    row.querySelector("[data-no]").addEventListener("click", async () => {
      await db.ref(`students/${code}/payments/${monthKey}/${key}`).remove();
      row.querySelector("[data-no]").classList.add("active");
      row.querySelector("[data-yes]").classList.remove("active");
      showToast("تم تعليم المادة كغير مدفوعة", "success");
      loadOverview();
    });

    wrap.appendChild(row);
  });
}

// ----- طلبات الدفع الأونلاين -----
async function loadPaymentRequests() {
  const wrap = document.getElementById("pay_requestsList");
  const empty = document.getElementById("pay_requestsEmpty");
  db.ref("paymentRequests").orderByChild("status").equalTo("pending").on("value", (snap) => {
    wrap.innerHTML = "";
    if (!snap.exists()) { empty.classList.remove("hidden"); return; }
    empty.classList.add("hidden");

    const requests = snap.val();
    Object.entries(requests).forEach(([reqId, r]) => {
      const card = el(`
        <div class="request-card">
          <div class="top">
            <b>${escapeHtml(r.name)} (${escapeHtml(r.code)})</b>
            <span style="font-size:12px; color:var(--text-mid);">${escapeHtml(r.createdAt ? formatDateArabic(r.createdAt) : "")}</span>
          </div>
          <div style="font-size:13px; color:var(--text-mid);">
            المادة: ${escapeHtml(r.subjectName || "-")} | الشهر: ${escapeHtml(monthLabel(r.month || currentMonthKey()))} | المبلغ: ${escapeHtml(r.amount || "-")} ج
          </div>
          <div style="font-size:13px; color:var(--text-mid); margin-top:4px;">رقم التحويل: ${escapeHtml(r.phone || "-")}</div>
          ${r.image ? `<img src="${r.image}" alt="إيصال">` : ""}
          <div class="actions">
            <button class="btn btn-primary" data-approve>✓ تأكيد الدفع</button>
            <button class="btn btn-danger" data-reject>✕ رفض</button>
          </div>
        </div>`);

      card.querySelector("[data-approve]").addEventListener("click", async () => {
        if (r.subjectKey) await db.ref(`students/${r.code}/payments/${r.month}/${r.subjectKey}`).set(true);
        await db.ref(`paymentRequests/${reqId}`).update({ status: "approved" });
        showToast("تم تأكيد الدفع", "success");
        const msg = `تم تأكيد دفع مصاريف "${r.subjectName || ""}" لشهر ${monthLabel(r.month || currentMonthKey())} للطالب ${r.name} - Al Ola Center. شكراً لكم.`;
        const waLink = buildWhatsAppLink(r.phone, msg);
        if (waLink) window.open(waLink, "_blank");
        loadOverview();
      });
      card.querySelector("[data-reject]").addEventListener("click", async () => {
        await db.ref(`paymentRequests/${reqId}`).update({ status: "rejected" });
        showToast("تم رفض الطلب", "success");
        loadOverview();
      });

      wrap.appendChild(card);
    });
  });
}

/* ==========================================================
   TAB: ملاحظات
   ========================================================== */
let n_currentCode = null;

document.getElementById("n_searchBtn").addEventListener("click", searchStudentForNotes);
document.getElementById("n_code").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); searchStudentForNotes(); } });

async function searchStudentForNotes() {
  const code = document.getElementById("n_code").value.trim();
  if (!code) return showToast("اكتب كود الطالب أولاً", "error");
  const snap = await db.ref("students/" + code).get();
  if (!snap.exists()) return showToast("لا يوجد طالب بهذا الكود", "error");

  const student = snap.val();
  n_currentCode = code;
  document.getElementById("n_studentName").textContent = `${student.name} - كود ${code}`;
  document.getElementById("n_studentBox").classList.remove("hidden");
  renderNotesList(student.notes || {});
}

document.getElementById("n_sendBtn").addEventListener("click", async () => {
  if (!n_currentCode) return;
  const text = document.getElementById("n_text").value.trim();
  if (!text) return showToast("اكتب نص الملاحظة أولاً", "error");

  const snap = await db.ref("students/" + n_currentCode).get();
  const student = snap.val();

  await db.ref("students/" + n_currentCode + "/notes").push({ text, createdAt: new Date().toISOString() });
  document.getElementById("n_text").value = "";
  showToast("تم حفظ الملاحظة", "success");

  const waLink = buildWhatsAppLink(student.parentPhone, `ملاحظة من Al Ola Center بخصوص الطالب ${student.name}:\n${text}`);
  if (waLink) window.open(waLink, "_blank");

  const newSnap = await db.ref("students/" + n_currentCode + "/notes").get();
  renderNotesList(newSnap.val() || {});
});

function renderNotesList(notes) {
  const wrap = document.getElementById("n_list");
  const empty = document.getElementById("n_empty");
  const entries = Object.values(notes || {}).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  if (!entries.length) { wrap.innerHTML = ""; empty.classList.remove("hidden"); return; }
  empty.classList.add("hidden");
  wrap.innerHTML = entries.map((n) => `<div class="note-card"><div class="txt">${escapeHtml(n.text)}</div><div class="meta">${escapeHtml(formatDateArabic(n.createdAt))}</div></div>`).join("");
}
