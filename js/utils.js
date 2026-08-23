/* أدوات مشتركة بين كل الصفحات */

function showToast(message, type = "default") {
  let toast = document.getElementById("app-toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "app-toast";
    toast.className = "toast";
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.className = "toast show " + (type === "error" ? "error" : type === "success" ? "success" : "");
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => toast.classList.remove("show"), 3200);
}

// توليد كود طالب فريد من 4 أرقام (يتأكد إنه مش مستخدم قبل كده)
async function generateUniqueStudentId() {
  let tries = 0;
  while (tries < 30) {
    const code = String(Math.floor(1000 + Math.random() * 9000));
    const snap = await db.ref("students/" + code).get();
    if (!snap.exists()) return code;
    tries++;
  }
  // fallback: استخدام timestamp لو حصل تصادم كتير (نادر جداً)
  return String(Date.now()).slice(-4);
}

function formatDateArabic(d) {
  const date = d instanceof Date ? d : new Date(d);
  return date.toLocaleDateString("ar-EG", { year: "numeric", month: "2-digit", day: "2-digit" });
}

function formatTimeArabic(d) {
  const date = d instanceof Date ? d : new Date(d);
  return date.toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit" });
}

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function monthKeyArabic(date = new Date()) {
  const months = ["يناير","فبراير","مارس","أبريل","مايو","يونيو","يوليو","أغسطس","سبتمبر","أكتوبر","نوفمبر","ديسمبر"];
  return months[date.getMonth()];
}

function el(html) {
  const t = document.createElement("template");
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/* ---------- شهر الدفع الحالي بصيغة 2026-08 ---------- */
function currentMonthKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(monthKey) {
  const [y, m] = monthKey.split("-");
  const months = ["يناير","فبراير","مارس","أبريل","مايو","يونيو","يوليو","أغسطس","سبتمبر","أكتوبر","نوفمبر","ديسمبر"];
  return `${months[Number(m) - 1]} ${y}`;
}

/* ---------- رابط واتساب مباشر برسالة جاهزة ----------
   ملحوظة مهمة: من متصفح عادي (بدون سيرفر / WhatsApp Business API مدفوع)
   مينفعش نبعت رسالة واتساب تلقائي 100% من غير تدخل بشري.
   الطريقة العملية المتاحة: نفتح واتساب للأدمن ومعبّى فيه رقم ولي الأمر
   والرسالة جاهزة، وهو بس يضغط "إرسال". ده أقصى حاجة ممكنة client-side. */
function buildWhatsAppLink(phone, message) {
  if (!phone) return null;
  let clean = String(phone).replace(/[^\d+]/g, "");
  if (clean.startsWith("0")) clean = "2" + clean; // مصر: تحويل 01xxxxxxxxx إلى 201xxxxxxxxx
  if (clean.startsWith("+")) clean = clean.slice(1);
  return `https://wa.me/${clean}?text=${encodeURIComponent(message)}`;
}

function sendWhatsApp(phone, message) {
  const link = buildWhatsAppLink(phone, message);
  if (!link) {
    showToast("لا يوجد رقم ولي أمر مسجل لهذا الطالب", "error");
    return;
  }
  window.open(link, "_blank");
}

/* ---------- تحويل الوقت الحالي لدقائق منذ منتصف الليل ---------- */
function nowMinutes() {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
}

function timeToMinutes(hhmm) {
  if (!hhmm) return null;
  const [h, m] = hhmm.split(":").map(Number);
  if (isNaN(h) || isNaN(m)) return null;
  return h * 60 + m;
}

/* هل الوقت الحالي جوه معاد أحد مواعيد مادة معينة (بسماحية دقايق قبل/بعد)؟ */
function isWithinSchedule(times, graceMinutes = 20) {
  if (!times || !times.length) return true; // لو مفيش مواعيد محددة، منمنعش الحضور
  const now = nowMinutes();
  return times.some((t) => {
    const tm = timeToMinutes(t);
    if (tm === null) return false;
    return Math.abs(now - tm) <= graceMinutes;
  });
}

/* ---------- عداد "متصل الآن" باستخدام Firebase Presence ---------- */
function trackPresence(pageName) {
  try {
    const connectedRef = db.ref(".info/connected");
    connectedRef.on("value", (snap) => {
      if (snap.val() === true) {
        const myRef = db.ref("presence/" + Date.now() + "_" + Math.random().toString(36).slice(2));
        myRef.set({ page: pageName, at: Date.now() });
        myRef.onDisconnect().remove();
      }
    });
  } catch (e) { /* تجاهل لو مفيش صلاحية */ }
}

/* عداد "عدد مرات الفتح" - تزويد رقم بسيط لكل تحميل صفحة */
function trackPageView() {
  try {
    db.ref("stats/pageViews").transaction((v) => (v || 0) + 1);
  } catch (e) {}
}

/* تحويل صورة مرفوعة إلى Base64 (بديل بسيط لو مش عايز تستخدم Firebase Storage) */
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
