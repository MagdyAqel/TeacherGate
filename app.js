import { firebaseConfig } from "./firebase-config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.3/firebase-app.js";
import { getDatabase, ref, onValue, set, update, remove, push, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.3/firebase-database.js";

const PATH = "teacherPortal";
const SESSION_KEY = "teacherGateSession";
const LOCAL_APPS_KEY = "teacherGateLocalApps";
const LOCAL_SETTINGS_KEY = "teacherGateSettings";
const COLORS = ["#2f69d9", "#0f9f6e", "#f4b740", "#8b5cf6", "#ef476f", "#06a7b6"];

let db = null;
let storageMode = "local";
let activeRole = null;
let selectedRole = "teacher";
let apps = [];
let filteredApps = [];
let settings = null;
let pendingDelete = null;
let toastTimer = null;

const $ = (id) => document.getElementById(id);
const el = {
  loginScreen: $("login-screen"), appView: $("app-view"), loginForm: $("login-form"), loginPassword: $("login-password"),
  loginSubmit: $("login-submit"), loginStatus: $("login-status"), roleButtons: document.querySelectorAll(".role-button"),
  connectionPill: $("connection-pill"), connectionLabel: $("connection-label"), settingsButton: $("settings-button"), logoutButton: $("logout-button"),
  roleTitle: $("role-title"), roleSubtitle: $("role-subtitle"), userAvatar: $("user-avatar"), heroTitle: $("hero-title"), heroDescription: $("hero-description"),
  heroCount: $("hero-count"), resultCount: $("result-count"), appsGrid: $("apps-grid"), emptyState: $("empty-state"), emptyTitle: $("empty-title"),
  emptyDescription: $("empty-description"), emptyAddButton: $("empty-add-button"), addAppButton: $("add-app-button"), searchInput: $("search-input"),
  appModal: $("app-modal"), appForm: $("app-form"), appId: $("app-id"), appName: $("app-name"), appUrl: $("app-url"), appDescription: $("app-description"),
  descriptionCount: $("description-count"), appModalTitle: $("app-modal-title"), saveAppButton: $("save-app-button"), appFormStatus: $("app-form-status"),
  settingsModal: $("settings-modal"), adminPasswordForm: $("admin-password-form"), teacherPasswordForm: $("teacher-password-form"),
  currentAdminPassword: $("current-admin-password"), newAdminPassword: $("new-admin-password"), confirmAdminPassword: $("confirm-admin-password"),
  newTeacherPassword: $("new-teacher-password"), confirmTeacherPassword: $("confirm-teacher-password"), adminPasswordStatus: $("admin-password-status"), teacherPasswordStatus: $("teacher-password-status"),
  deleteDialog: $("delete-dialog"), deleteAppName: $("delete-app-name"), confirmDeleteButton: $("confirm-delete-button"), toast: $("toast"), toastMessage: $("toast-message")
};

init();

async function init() {
  settings = defaultSettings();
  bindEvents();
  setStatus("جاري الاتصال بقاعدة البيانات...");
  try {
    const app = initializeApp(firebaseConfig);
    db = getDatabase(app);
    storageMode = "firebase";
    listenToFirebase();
    setConnection(true);
  } catch (error) {
    console.warn(error);
    storageMode = "local";
    loadLocalData();
    setConnection(false);
    setStatus("تعذر الاتصال بـ Firebase. سيتم استخدام التخزين المحلي مؤقتًا.", "error");
  }
  const savedRole = sessionStorage.getItem(SESSION_KEY);
  if (savedRole) showApp(savedRole);
}

function bindEvents() {
  el.roleButtons.forEach((button) => button.addEventListener("click", () => selectRole(button.dataset.role)));
  el.loginPassword.addEventListener("input", () => { el.loginSubmit.disabled = !el.loginPassword.value.trim(); });
  el.loginForm.addEventListener("submit", login);
  el.logoutButton.addEventListener("click", logout);
  el.settingsButton.addEventListener("click", openSettings);
  el.addAppButton.addEventListener("click", () => openAppModal());
  el.emptyAddButton.addEventListener("click", () => openAppModal());
  el.searchInput.addEventListener("input", renderApps);
  el.appForm.addEventListener("submit", saveApp);
  el.appDescription.addEventListener("input", () => { el.descriptionCount.textContent = el.appDescription.value.length; });
  el.appsGrid.addEventListener("click", handleCardAction);
  el.adminPasswordForm.addEventListener("submit", changeAdminPassword);
  el.teacherPasswordForm.addEventListener("submit", changeTeacherPassword);
  el.confirmDeleteButton.addEventListener("click", deleteApp);
  document.querySelectorAll("[data-close-modal]").forEach((button) => button.addEventListener("click", () => closeModal($(button.dataset.closeModal))));
  document.querySelectorAll("[data-toggle-password]").forEach((button) => button.addEventListener("click", () => togglePassword(button)));
}

function listenToFirebase() {
  onValue(ref(db, `${PATH}/settings`), async (snapshot) => {
    if (snapshot.exists()) settings = { ...defaultSettings(), ...snapshot.val() };
    else await set(ref(db, `${PATH}/settings`), defaultSettings(true));
    setStatus("جاهز للدخول");
  }, (error) => fallback(error));

  onValue(ref(db, `${PATH}/apps`), (snapshot) => {
    const value = snapshot.val() || {};
    apps = Object.entries(value).map(([id, app]) => ({ id, ...app })).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    renderApps();
  }, (error) => fallback(error));
}

function fallback(error) {
  console.warn(error);
  storageMode = "local";
  loadLocalData();
  setConnection(false);
  setStatus("تعذر الوصول إلى Firebase. تعمل البوابة محليًا الآن.", "error");
}

function loadLocalData() {
  settings = { ...defaultSettings(), ...JSON.parse(localStorage.getItem(LOCAL_SETTINGS_KEY) || "{}") };
  apps = JSON.parse(localStorage.getItem(LOCAL_APPS_KEY) || "[]");
  renderApps();
}

function selectRole(role) {
  selectedRole = role;
  el.roleButtons.forEach((button) => button.classList.toggle("active", button.dataset.role === role));
  el.loginPassword.value = "";
  el.loginSubmit.disabled = true;
  setStatus(role === "admin" ? "أدخل كلمة مرور الإدارة." : "أدخل كلمة مرور المعلمين.");
}

async function login(event) {
  event.preventDefault();
  const entered = await hashPassword(el.loginPassword.value);
  const expected = selectedRole === "admin" ? settings.adminPasswordHash : settings.teacherPasswordHash;
  if (entered !== expected) return setStatus("كلمة المرور غير صحيحة.", "error");
  showApp(selectedRole);
}

function showApp(role) {
  activeRole = role;
  sessionStorage.setItem(SESSION_KEY, role);
  el.loginScreen.hidden = true;
  el.appView.hidden = false;
  const isAdmin = role === "admin";
  el.settingsButton.hidden = !isAdmin;
  el.addAppButton.hidden = !isAdmin;
  el.emptyAddButton.hidden = !isAdmin;
  el.userAvatar.textContent = isAdmin ? "إ" : "م";
  el.roleTitle.textContent = isAdmin ? "حساب الإدارة" : "حساب المعلم";
  el.roleSubtitle.textContent = isAdmin ? "إضافة وتعديل التطبيقات" : "عرض التطبيقات";
  el.heroTitle.textContent = isAdmin ? "أدر تطبيقاتك من مكان واحد" : "أهلًا بك في بوابة المعلم";
  el.heroDescription.textContent = isAdmin ? "أضف التطبيقات التعليمية وحدّث روابطها ووصفها بسهولة." : "استكشف الأدوات والتطبيقات التي تساعدك في جعل الدرس أكثر تفاعلًا ومتعة.";
  el.searchInput.value = "";
  renderApps();
}

function logout() {
  activeRole = null;
  sessionStorage.removeItem(SESSION_KEY);
  el.appView.hidden = true;
  el.loginScreen.hidden = false;
  el.loginPassword.value = "";
  selectRole("teacher");
}

function renderApps() {
  if (!el.appsGrid) return;
  const query = normalizeText(el.searchInput.value);
  filteredApps = apps.filter((app) => normalizeText(`${app.name || ""} ${app.description || ""} ${app.url || ""}`).includes(query));
  el.heroCount.textContent = apps.length;
  el.resultCount.textContent = filteredApps.length;
  el.appsGrid.innerHTML = filteredApps.map(cardHtml).join("");
  const empty = filteredApps.length === 0;
  el.emptyState.hidden = !empty;
  el.appsGrid.hidden = empty;
  el.emptyTitle.textContent = query ? "لا توجد نتائج مطابقة" : "لا توجد تطبيقات بعد";
  el.emptyDescription.textContent = query ? "جرّب البحث بكلمة مختلفة." : (activeRole === "admin" ? "ابدأ بإضافة أول تطبيق إلى البوابة." : "ستظهر التطبيقات التعليمية هنا فور إضافتها من الإدارة.");
  el.emptyAddButton.hidden = activeRole !== "admin" || !!query;
}

function cardHtml(app, index) {
  const color = COLORS[hashString(app.name || index) % COLORS.length];
  const first = Array.from((app.name || "ت").trim())[0] || "ت";
  const admin = activeRole === "admin" ? `<div class="card-menu"><button class="icon-button" data-action="edit" data-id="${esc(app.id)}" title="تعديل">✎</button><button class="icon-button" data-action="delete" data-id="${esc(app.id)}" title="حذف">🗑</button></div>` : "";
  return `<article class="app-card" style="--card-color:${color}"><div class="card-top"><span class="app-icon">${esc(first)}</span>${admin}</div><h3>${esc(app.name || "تطبيق بدون اسم")}</h3><span class="app-host">${esc(host(app.url))}</span><p class="app-description">${esc(app.description || "")}</p><div class="card-footer"><a class="open-app" href="${esc(app.url)}" target="_blank" rel="noopener noreferrer">فتح التطبيق <svg viewBox="0 0 24 24"><path d="M14 5h5v5M19 5l-9 9"></path><path d="M19 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h4"></path></svg></a><span class="card-date">${formatDate(app.updatedAt || app.createdAt)}</span></div></article>`;
}

function handleCardAction(event) {
  const button = event.target.closest("[data-action]");
  if (!button || activeRole !== "admin") return;
  const app = apps.find((item) => item.id === button.dataset.id);
  if (!app) return;
  if (button.dataset.action === "edit") openAppModal(app);
  if (button.dataset.action === "delete") openDeleteDialog(app);
}

function openAppModal(app = null) {
  if (activeRole !== "admin") return;
  el.appForm.reset();
  setFormStatus(el.appFormStatus, "");
  el.appId.value = app?.id || "";
  el.appName.value = app?.name || "";
  el.appUrl.value = app?.url || "";
  el.appDescription.value = app?.description || "";
  el.descriptionCount.textContent = el.appDescription.value.length;
  el.appModalTitle.textContent = app ? "تعديل التطبيق" : "إضافة تطبيق جديد";
  openModal(el.appModal);
  el.appName.focus();
}

async function saveApp(event) {
  event.preventDefault();
  if (activeRole !== "admin") return;
  const id = el.appId.value;
  const name = el.appName.value.trim();
  const url = normalizeUrl(el.appUrl.value);
  const description = el.appDescription.value.trim();
  if (!name || !url || !description) return setFormStatus(el.appFormStatus, "يرجى تعبئة الحقول بشكل صحيح.", "error");
  el.saveAppButton.disabled = true;
  try {
    const existing = apps.find((item) => item.id === id);
    const now = Date.now();
    const payload = { name, url, description, createdAt: existing?.createdAt || now, updatedAt: now };
    if (storageMode === "firebase") {
      const appId = id || push(ref(db, `${PATH}/apps`)).key;
      await set(ref(db, `${PATH}/apps/${appId}`), { ...payload, updatedAt: serverTimestamp() });
    } else {
      const appId = id || createId();
      apps = [{ id: appId, ...payload }, ...apps.filter((item) => item.id !== appId)];
      persistLocal(); renderApps();
    }
    closeModal(el.appModal); showToast(id ? "تم تحديث التطبيق." : "تمت إضافة التطبيق.");
  } catch (error) { setFormStatus(el.appFormStatus, `تعذر الحفظ: ${friendlyError(error)}`, "error"); }
  finally { el.saveAppButton.disabled = false; }
}

function openDeleteDialog(app) {
  pendingDelete = app;
  el.deleteAppName.textContent = app.name;
  openModal(el.deleteDialog);
}

async function deleteApp() {
  if (!pendingDelete) return;
  el.confirmDeleteButton.disabled = true;
  try {
    if (storageMode === "firebase") await remove(ref(db, `${PATH}/apps/${pendingDelete.id}`));
    else { apps = apps.filter((item) => item.id !== pendingDelete.id); persistLocal(); renderApps(); }
    closeModal(el.deleteDialog); showToast("تم حذف التطبيق."); pendingDelete = null;
  } catch (error) { showToast(`تعذر الحذف: ${friendlyError(error)}`, "error"); }
  finally { el.confirmDeleteButton.disabled = false; }
}

function openSettings() {
  if (activeRole !== "admin") return;
  el.adminPasswordForm.reset(); el.teacherPasswordForm.reset();
  setFormStatus(el.adminPasswordStatus, ""); setFormStatus(el.teacherPasswordStatus, "");
  openModal(el.settingsModal);
}

async function changeAdminPassword(event) {
  event.preventDefault();
  if (await hashPassword(el.currentAdminPassword.value) !== settings.adminPasswordHash) return setFormStatus(el.adminPasswordStatus, "كلمة المرور الحالية غير صحيحة.", "error");
  if (el.newAdminPassword.value !== el.confirmAdminPassword.value) return setFormStatus(el.adminPasswordStatus, "كلمتا المرور غير متطابقتين.", "error");
  await updatePasswords({ adminPasswordHash: await hashPassword(el.newAdminPassword.value) }, el.adminPasswordStatus, "تم تحديث كلمة مرور الإدارة.");
  el.adminPasswordForm.reset();
}

async function changeTeacherPassword(event) {
  event.preventDefault();
  if (el.newTeacherPassword.value !== el.confirmTeacherPassword.value) return setFormStatus(el.teacherPasswordStatus, "كلمتا المرور غير متطابقتين.", "error");
  await updatePasswords({ teacherPasswordHash: await hashPassword(el.newTeacherPassword.value) }, el.teacherPasswordStatus, "تم تحديث كلمة مرور المعلمين.");
  el.teacherPasswordForm.reset();
}

async function updatePasswords(change, statusElement, message) {
  setFormStatus(statusElement, "جاري التحديث...");
  try {
    settings = { ...settings, ...change };
    if (storageMode === "firebase") await update(ref(db, `${PATH}/settings`), { ...change, updatedAt: serverTimestamp() });
    else localStorage.setItem(LOCAL_SETTINGS_KEY, JSON.stringify(settings));
    setFormStatus(statusElement, message, "success"); showToast(message);
  } catch (error) { setFormStatus(statusElement, `تعذر التحديث: ${friendlyError(error)}`, "error"); }
}

async function defaultSettings(forFirebase = false) {
  const base = { adminPasswordHash: awaitHash("tech"), teacherPasswordHash: awaitHash("STD"), updatedAt: Date.now() };
  return forFirebase ? { ...base, updatedAt: serverTimestamp() } : base;
}
function awaitHash(text){ return null; }

(async () => {
  const admin = await hashPassword("tech");
  const teacher = await hashPassword("STD");
  defaultSettings = function(forFirebase = false) { return { adminPasswordHash: admin, teacherPasswordHash: teacher, updatedAt: forFirebase ? serverTimestamp() : Date.now() }; };
  if (!settings || !settings.adminPasswordHash) settings = defaultSettings();
})();

function persistLocal() { localStorage.setItem(LOCAL_APPS_KEY, JSON.stringify(apps)); }
function setConnection(ok) { el.connectionPill.classList.toggle("offline", !ok); el.connectionLabel.textContent = ok ? "متصل" : "محلي"; }
function setStatus(message, type = "") { setFormStatus(el.loginStatus, message, type); }
function setFormStatus(node, message, type = "") { node.textContent = message; node.className = `form-status${type ? ` ${type}` : ""}`; }
function openModal(dialog) { if (!dialog.open) dialog.showModal(); document.body.classList.add("modal-open"); }
function closeModal(dialog) { if (dialog?.open) dialog.close(); if (![el.appModal, el.settingsModal, el.deleteDialog].some((d) => d.open)) document.body.classList.remove("modal-open"); }
function togglePassword(button) { const input = $(button.dataset.togglePassword); input.type = input.type === "password" ? "text" : "password"; }
function showToast(message, type = "success") { clearTimeout(toastTimer); el.toastMessage.textContent = message; el.toast.classList.toggle("error", type === "error"); el.toast.classList.add("visible"); toastTimer = setTimeout(() => el.toast.classList.remove("visible"), 3000); }
async function hashPassword(value) { const bytes = new TextEncoder().encode(value); const digest = await crypto.subtle.digest("SHA-256", bytes); return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join(""); }
function normalizeUrl(value) { try { const input = value.trim(); const url = new URL(/^https?:\/\//i.test(input) ? input : `https://${input}`); return ["http:", "https:"].includes(url.protocol) ? url.href : ""; } catch { return ""; } }
function host(value) { try { return new URL(value).hostname.replace(/^www\./, ""); } catch { return "رابط التطبيق"; } }
function normalizeText(value) { return String(value).trim().toLowerCase().normalize("NFKD").replace(/[\u064B-\u065F\u0670]/g, "").replace(/[أإآ]/g, "ا").replace(/ة/g, "ه"); }
function esc(value) { return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;"); }
function formatDate(value) { if (!value) return ""; try { return new Intl.DateTimeFormat("ar", { year: "numeric", month: "short", day: "numeric" }).format(new Date(value)); } catch { return ""; } }
function hashString(value) { return Array.from(String(value)).reduce((hash, char) => Math.abs(((hash << 5) - hash + char.charCodeAt(0)) | 0), 0); }
function createId() { return crypto.randomUUID?.() || `app_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`; }
function friendlyError(error) { return String(error?.message || error || "حدث خطأ غير متوقع").includes("PERMISSION_DENIED") ? "قواعد Firebase لا تسمح بالعملية." : (error?.message || "حدث خطأ غير متوقع."); }
