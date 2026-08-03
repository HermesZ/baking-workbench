/* ============ 烘焙工作台 逻辑 ============ */
(function () {
  "use strict";

  const STORE_KEY = "baking-workbench-v1";
  const EXPIRING_DAYS = 7; // 提前多少天提醒
  const SERVER_MODE = location.protocol.startsWith("http"); // 通过服务器打开(http://),启用数据同步
  let syncOnline = null; // null=本地模式 / true=已同步 / false=同步失败
  let serverAvailable = false; // 后端是否可用(纯静态托管时自动降级为本地模式)

  /* ---------- 数据 ---------- */
  let state = load();

  function load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) {
        const data = JSON.parse(raw);
        return { recipes: data.recipes || [], ingredients: data.ingredients || [], bakes: data.bakes || [] };
      }
    } catch (e) { console.warn("读取本地数据失败", e); }
    return { recipes: [], ingredients: [], bakes: [] };
  }

  function save() {
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
    if (SERVER_MODE && serverAvailable) {
      fetch("/api/data", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(state)
      })
        .then((r) => { if (!r.ok) throw new Error("http " + r.status); setSyncStatus(true); })
        .catch(() => { serverAvailable = false; setSyncStatus(false); });
    }
  }

  /* ---------- 服务器数据同步 ---------- */
  function setSyncStatus(ok) {
    const dot = $("#sync-dot");
    if (!dot || !SERVER_MODE) return;
    dot.classList.remove("sync-ok", "sync-fail");
    if (ok) { // 后端可用:显示绿点
      dot.classList.remove("hidden");
      dot.classList.add("sync-ok");
      dot.title = "数据已同步到服务器";
    } else { // 后端不可用:静默降级为本地模式,不打扰
      serverAvailable = false;
      dot.classList.add("hidden");
    }
  }

  function syncFromServer() {
    if (!SERVER_MODE) return;
    fetch("/api/data", { cache: "no-store" })
      .then((r) => { if (!r.ok) throw new Error("http " + r.status); return r.json(); })
      .then((data) => {
        serverAvailable = true;
        if (data && (data.recipes || data.ingredients || data.bakes)) {
          state = {
            recipes: data.recipes || [],
            ingredients: data.ingredients || [],
            bakes: data.bakes || []
          };
          setSyncStatus(true);
          fillCategoryFilter();
          switchView("dashboard");
          toast("已载入共享数据");
        } else {
          setSyncStatus(true);
          save(); // 首次打开,把本地数据推送到服务器
        }
      })
      .catch(() => setSyncStatus(false));
  }

  function uid() {
    return (crypto.randomUUID && crypto.randomUUID()) ||
      "id-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
  }

  /* ---------- 工具 ---------- */
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
  }

  function todayStr() {
    const d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }

  function daysUntil(dateStr) {
    if (!dateStr) return null;
    const target = new Date(dateStr + "T00:00:00");
    const now = new Date(todayStr() + "T00:00:00");
    return Math.round((target - now) / 86400000);
  }

  function expiryStatus(dateStr) {
    const d = daysUntil(dateStr);
    if (d == null) return { key: "ok", label: "未设置", cls: "tag-ok" };
    if (d < 0) return { key: "expired", label: `已过期 ${-d} 天`, cls: "tag-danger" };
    if (d <= EXPIRING_DAYS) return { key: "expiring", label: `剩 ${d} 天`, cls: "tag-warn" };
    return { key: "ok", label: `剩 ${d} 天`, cls: "tag-ok" };
  }

  function toast(msg) {
    const el = $("#toast");
    el.textContent = msg;
    el.classList.remove("hidden");
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.add("hidden"), 2600);
  }

  /* ---------- 视图切换 ---------- */
  function switchView(name) {
    $$(".view").forEach((v) => v.classList.remove("active"));
    $("#view-" + name).classList.add("active");
    $$(".nav-btn").forEach((b) => b.classList.toggle("active", b.dataset.view === name));
    if (name === "dashboard") renderDashboard();
    if (name === "recipes") renderRecipes();
    if (name === "inventory") renderInventory();
    if (name === "bakes") renderBakes();
  }

  /* ---------- 首页 ---------- */
  function renderDashboard() {
    const ings = state.ingredients;
    const expiring = ings.filter((i) => expiryStatus(i.expiryDate).key === "expiring");
    const expired = ings.filter((i) => expiryStatus(i.expiryDate).key === "expired");

    $("#stat-recipes").textContent = state.recipes.length;
    $("#stat-ingredients").textContent = ings.length;
    $("#stat-bakes").textContent = state.bakes.length;
    $("#stat-expiring").textContent = expiring.length;
    $("#stat-expired").textContent = expired.length;

    // 保质期提醒列表(过期在前,按剩余天数升序)
    const warnList = [...expired, ...expiring].sort((a, b) => (daysUntil(a.expiryDate) || 0) - (daysUntil(b.expiryDate) || 0));
    const dashExpiry = $("#dash-expiry");
    if (warnList.length === 0) {
      dashExpiry.innerHTML = '<div class="empty" style="padding:16px 0">🎉 所有材料都在保质期内</div>';
    } else {
      dashExpiry.innerHTML = warnList.map((i) => {
        const st = expiryStatus(i.expiryDate);
        return `<div class="row-item">
          <span class="row-title">${esc(i.name)}</span>
          <span><span class="tag ${st.cls}">${st.label}</span> <span class="days">${esc(i.storage || "")}</span></span>
        </div>`;
      }).join("");
    }

    // 最近配方
    const recent = [...state.recipes].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)).slice(0, 5);
    const dashRecipes = $("#dash-recipes");
    if (recent.length === 0) {
      dashRecipes.innerHTML = '<div class="empty" style="padding:10px 0">还没有配方</div>';
    } else {
      dashRecipes.innerHTML = recent.map((r) =>
        `<div class="row-item">
          <span class="row-title">${esc(r.name)}</span>
          <span class="tag">${esc(r.category || "其他")}</span>
        </div>`
      ).join("");
    }

    // 最近烘焙
    const recentBakes = [...state.bakes].sort((a, b) => (b.date || "").localeCompare(a.date || "")).slice(0, 5);
    const dashBakes = $("#dash-bakes");
    if (recentBakes.length === 0) {
      dashBakes.innerHTML = '<div class="empty" style="padding:10px 0">还没有烘焙记录</div>';
    } else {
      dashBakes.innerHTML = recentBakes.map((b) => {
        const resultTag = b.result
          ? `<span class="tag ${b.result === "成功" ? "tag-ok" : b.result === "失败" ? "tag-danger" : "tag-warn"}">${esc(b.result)}</span>`
          : "";
        return `<div class="row-item">
          <span class="row-title">${esc(b.name)}</span>
          <span>${esc(b.date || "")} ${resultTag}</span>
        </div>`;
      }).join("");
    }
  }

  /* ---------- 配方库 ---------- */
  function renderRecipes() {
    const kw = ($("#recipe-search").value || "").trim().toLowerCase();
    const cat = $("#recipe-cat-filter").value;
    let list = state.recipes;
    if (cat) list = list.filter((r) => r.category === cat);
    if (kw) {
      list = list.filter((r) =>
        r.name.toLowerCase().includes(kw) ||
        (r.ingredients || []).some((ig) => ig.name.toLowerCase().includes(kw))
      );
    }
    list = [...list].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

    const box = $("#recipe-list");
    $("#recipe-empty").classList.toggle("hidden", list.length > 0);
    box.innerHTML = list.map((r) => {
      const ings = (r.ingredients || []).map((ig) =>
        `<div class="ing-row"><span>${esc(ig.name)}</span><span>${esc(ig.amount || "")} ${esc(ig.unit || "")}</span></div>`
      ).join("");
      return `<div class="item-card clickable" data-open-recipe="${r.id}" title="单击查看详情">
        <h3 class="item-title">${esc(r.name)} <span class="tag">${esc(r.category || "其他")}</span></h3>
        <div class="item-meta">
          ${r.servings ? `<span>份量:${esc(r.servings)}</span>` : ""}
          ${r.oven ? `<span>🔥 ${esc(r.oven)}</span>` : ""}
          ${r.time ? `<span>⏱ ${esc(r.time)}</span>` : ""}
        </div>
        ${r.desc ? `<div class="item-body">${esc(r.desc)}</div>` : ""}
        <div>${ings}</div>
        <div class="item-actions">
          <button class="btn btn-small" data-edit-recipe="${r.id}">编辑</button>
          <button class="btn btn-small btn-danger" data-del-recipe="${r.id}">删除</button>
        </div>
      </div>`;
    }).join("");
  }

  function fillCategoryFilter() {
    const cats = [...new Set(state.recipes.map((r) => r.category).filter(Boolean))];
    const sel = $("#recipe-cat-filter");
    const cur = sel.value;
    sel.innerHTML = '<option value="">全部分类</option>' +
      cats.map((c) => `<option>${esc(c)}</option>`).join("");
    sel.value = cur;
  }

  /* ---------- 配方表单 ---------- */
  function openRecipeModal(recipe) {
    $("#recipe-modal-title").textContent = recipe ? "编辑配方" : "新增配方";
    $("#recipe-id").value = recipe ? recipe.id : "";
    $("#r-name").value = recipe ? recipe.name : "";
    $("#r-category").value = recipe ? recipe.category : "面包";
    $("#r-servings").value = recipe ? recipe.servings : "";
    $("#r-oven").value = recipe ? recipe.oven : "";
    $("#r-time").value = recipe ? recipe.time : "";
    $("#r-desc").value = recipe ? recipe.desc : "";
    $("#r-steps").value = recipe ? recipe.steps : "";
    $("#r-notes").value = recipe ? recipe.notes : "";
    renderIngRows(recipe ? recipe.ingredients : [{ name: "", amount: "", unit: "" }]);
    $("#recipe-modal").classList.remove("hidden");
    $("#r-name").focus();
  }

  /* ---------- 配方详情 ---------- */
  function openRecipeDetail(id) {
    const r = state.recipes.find((x) => x.id === id);
    if (!r) return;
    $("#rd-title").textContent = r.name;
    $("#rd-edit").dataset.recipeId = r.id;
    $("#rd-delete").dataset.recipeId = r.id;

    const ings = (r.ingredients || []).length
      ? `<table class="detail-ing-table">
          <thead><tr><th>材料</th><th>用量</th></tr></thead>
          <tbody>${(r.ingredients || []).map((ig) =>
            `<tr><td>${esc(ig.name)}</td><td>${esc(ig.amount || "")} ${esc(ig.unit || "")}</td></tr>`
          ).join("")}</tbody>
        </table>`
      : '<div class="detail-empty">未填写材料清单</div>';

    const steps = (r.steps || "").split("\n").map((s) => s.trim()).filter(Boolean);
    const stepsHtml = steps.length
      ? `<ol class="detail-steps">${steps.map((s) => `<li>${esc(s)}</li>`).join("")}</ol>`
      : '<div class="detail-empty">未填写制作步骤</div>';

    $("#rd-body").innerHTML = `
      <div class="detail-meta">
        <span class="meta-chip">分类:${esc(r.category || "其他")}</span>
        ${r.servings ? `<span class="meta-chip">份量:${esc(r.servings)}</span>` : ""}
        ${r.oven ? `<span class="meta-chip">🔥 ${esc(r.oven)}</span>` : ""}
        ${r.time ? `<span class="meta-chip">⏱ ${esc(r.time)}</span>` : ""}
      </div>
      ${r.desc ? `<div class="detail-section"><h3>描述</h3><div class="detail-desc">${esc(r.desc)}</div></div>` : ""}
      <div class="detail-section"><h3>材料清单</h3>${ings}</div>
      <div class="detail-section"><h3>制作步骤</h3>${stepsHtml}</div>
      ${r.notes ? `<div class="detail-section"><h3>备注</h3><div class="detail-notes">${esc(r.notes)}</div></div>` : ""}
    `;
    $("#recipe-detail-modal").classList.remove("hidden");
  }

  function renderIngRows(rows) {
    const box = $("#recipe-ingredients");
    box.innerHTML = rows.map((ig, idx) => `
      <div class="ing-input-row">
        <input type="text" class="ing-name" placeholder="材料名" value="${esc(ig.name)}">
        <input type="text" class="amount" placeholder="用量" value="${esc(ig.amount)}">
        <input type="text" class="unit" placeholder="单位" value="${esc(ig.unit)}">
        <button type="button" class="ing-del" data-idx="${idx}" title="删除此行">×</button>
      </div>`).join("");
  }

  function collectIngRows() {
    return $$("#recipe-ingredients .ing-input-row").map((row) => ({
      name: row.querySelector(".ing-name").value.trim(),
      amount: row.querySelector(".amount").value.trim(),
      unit: row.querySelector(".unit").value.trim()
    })).filter((ig) => ig.name);
  }

  function submitRecipe(e) {
    e.preventDefault();
    const id = $("#recipe-id").value;
    const data = {
      name: $("#r-name").value.trim(),
      category: $("#r-category").value,
      servings: $("#r-servings").value.trim(),
      oven: $("#r-oven").value.trim(),
      time: $("#r-time").value.trim(),
      desc: $("#r-desc").value.trim(),
      steps: $("#r-steps").value.trim(),
      notes: $("#r-notes").value.trim(),
      ingredients: collectIngRows()
    };
    if (!data.name) { toast("请填写配方名称"); return; }
    const now = Date.now();
    if (id) {
      const idx = state.recipes.findIndex((r) => r.id === id);
      if (idx >= 0) state.recipes[idx] = { ...state.recipes[idx], ...data, updatedAt: now };
      toast("配方已更新");
    } else {
      state.recipes.push({ id: uid(), ...data, createdAt: now, updatedAt: now });
      toast("配方已保存");
    }
    save();
    $("#recipe-modal").classList.add("hidden");
    fillCategoryFilter();
    renderRecipes();
  }

  /* ---------- 材料库存 ---------- */
  function renderInventory() {
    const kw = ($("#ing-search").value || "").trim().toLowerCase();
    const st = $("#ing-status-filter").value;
    let list = state.ingredients;
    if (st) list = list.filter((i) => expiryStatus(i.expiryDate).key === st);
    if (kw) list = list.filter((i) => i.name.toLowerCase().includes(kw));
    list = [...list].sort((a, b) => (daysUntil(a.expiryDate) || 0) - (daysUntil(b.expiryDate) || 0));

    const box = $("#ing-list");
    $("#ing-empty").classList.toggle("hidden", list.length > 0);
    box.innerHTML = list.map((i) => {
      const stt = expiryStatus(i.expiryDate);
      return `<div class="item-card">
        <h3 class="item-title">${esc(i.name)} <span class="tag ${stt.cls}">${stt.label}</span></h3>
        <div class="item-meta">
          ${i.qty ? `<span>数量:${esc(i.qty)}</span>` : ""}
          <span>存储:${esc(i.storage || "常温")}</span>
          ${i.bought ? `<span>购买:${esc(i.bought)}</span>` : ""}
          <span>保质期至:${esc(i.expiryDate || "未设置")}</span>
        </div>
        ${i.notes ? `<div class="item-body">${esc(i.notes)}</div>` : ""}
        <div class="item-actions">
          <button class="btn btn-small" data-edit-ing="${i.id}">编辑</button>
          <button class="btn btn-small btn-danger" data-del-ing="${i.id}">删除</button>
        </div>
      </div>`;
    }).join("");
  }

  function openIngModal(ing) {
    $("#ing-modal-title").textContent = ing ? "编辑材料" : "新增材料";
    $("#ing-id").value = ing ? ing.id : "";
    $("#i-name").value = ing ? ing.name : "";
    $("#i-category").value = ing ? ing.category : "其他";
    $("#i-qty").value = ing ? ing.qty : "";
    $("#i-storage").value = ing ? ing.storage : "常温";
    $("#i-bought").value = ing ? ing.bought : todayStr();
    $("#i-expiry").value = ing ? ing.expiryDate : "";
    $("#i-notes").value = ing ? ing.notes : "";
    $("#ing-modal").classList.remove("hidden");
    $("#i-name").focus();
  }

  function submitIng(e) {
    e.preventDefault();
    const id = $("#ing-id").value;
    const data = {
      name: $("#i-name").value.trim(),
      category: $("#i-category").value,
      qty: $("#i-qty").value.trim(),
      storage: $("#i-storage").value,
      bought: $("#i-bought").value,
      expiryDate: $("#i-expiry").value,
      notes: $("#i-notes").value.trim()
    };
    if (!data.name) { toast("请填写材料名称"); return; }
    if (!data.expiryDate) { toast("请填写保质期至日期"); return; }
    const now = Date.now();
    if (id) {
      const idx = state.ingredients.findIndex((i) => i.id === id);
      if (idx >= 0) state.ingredients[idx] = { ...state.ingredients[idx], ...data, updatedAt: now };
      toast("材料已更新");
    } else {
      state.ingredients.push({ id: uid(), ...data, createdAt: now, updatedAt: now });
      toast("材料已保存");
    }
    save();
    $("#ing-modal").classList.add("hidden");
    renderInventory();
  }

  /* ---------- 烘焙记录 ---------- */
  function fillBakeRecipeSelect() {
    const sel = $("#b-recipe");
    const cur = sel.value;
    const recipes = [...state.recipes].sort((a, b) => a.name.localeCompare(b.name));
    sel.innerHTML = '<option value="">(不关联)</option>' +
      recipes.map((r) => `<option value="${r.id}">${esc(r.name)}</option>`).join("");
    sel.value = cur;
  }

  function renderBakes() {
    const kw = ($("#bake-search").value || "").trim().toLowerCase();
    const result = $("#bake-result-filter").value;
    let list = state.bakes;
    if (result) list = list.filter((b) => b.result === result);
    if (kw) list = list.filter((b) => b.name.toLowerCase().includes(kw));
    list = [...list].sort((a, b) => (b.date || "").localeCompare(a.date || ""));

    const box = $("#bake-list");
    $("#bake-empty").classList.toggle("hidden", list.length > 0);
    box.innerHTML = list.map((b) => {
      const recipe = state.recipes.find((r) => r.id === b.recipeId);
      const resultTag = b.result
        ? `<span class="tag ${b.result === "成功" ? "tag-ok" : b.result === "失败" ? "tag-danger" : "tag-warn"}">${esc(b.result)}</span>`
        : "";
      return `<div class="item-card">
        <h3 class="item-title">${esc(b.name)} ${resultTag}</h3>
        <div class="item-meta">
          <span>📅 ${esc(b.date || "未填写日期")}</span>
          ${recipe ? `<span>📖 配方:${esc(recipe.name)}</span>` : ""}
        </div>
        ${b.notes ? `<div class="item-body">${esc(b.notes)}</div>` : ""}
        <div class="item-actions">
          <button class="btn btn-small" data-edit-bake="${b.id}">编辑</button>
          <button class="btn btn-small btn-danger" data-del-bake="${b.id}">删除</button>
        </div>
      </div>`;
    }).join("");
  }

  function openBakeModal(bake) {
    fillBakeRecipeSelect();
    $("#bake-modal-title").textContent = bake ? "编辑烘焙记录" : "新增烘焙记录";
    $("#bake-id").value = bake ? bake.id : "";
    $("#b-name").value = bake ? bake.name : "";
    $("#b-date").value = bake ? bake.date : todayStr();
    $("#b-recipe").value = bake && bake.recipeId ? bake.recipeId : "";
    $("#b-result").value = bake ? bake.result : "";
    $("#b-notes").value = bake ? bake.notes : "";
    $("#bake-modal").classList.remove("hidden");
    $("#b-name").focus();
  }

  function submitBake(e) {
    e.preventDefault();
    const id = $("#bake-id").value;
    const data = {
      name: $("#b-name").value.trim(),
      date: $("#b-date").value,
      recipeId: $("#b-recipe").value,
      result: $("#b-result").value,
      notes: $("#b-notes").value.trim()
    };
    if (!data.name) { toast("请填写烘焙名称"); return; }
    if (!data.date) { toast("请填写制作日期"); return; }
    const now = Date.now();
    if (id) {
      const idx = state.bakes.findIndex((b) => b.id === id);
      if (idx >= 0) state.bakes[idx] = { ...state.bakes[idx], ...data, updatedAt: now };
      toast("记录已更新");
    } else {
      state.bakes.push({ id: uid(), ...data, createdAt: now, updatedAt: now });
      toast("记录已保存");
    }
    save();
    $("#bake-modal").classList.add("hidden");
    renderBakes();
  }

  /* ---------- 删除确认 ---------- */
  let pendingDelete = null;
  function askDelete(text, fn) {
    pendingDelete = fn;
    $("#confirm-text").textContent = text;
    $("#confirm-modal").classList.remove("hidden");
  }

  /* ---------- 保质期提醒 ---------- */
  function checkExpiryReminder() {
    const ings = state.ingredients;
    const expiring = ings.filter((i) => expiryStatus(i.expiryDate).key === "expiring");
    const expired = ings.filter((i) => expiryStatus(i.expiryDate).key === "expired");
    if (expired.length === 0 && expiring.length === 0) return;

    const lines = [];
    expired.slice(0, 3).forEach((i) => lines.push(`已过期:${i.name}`));
    expiring.slice(0, 3).forEach((i) => lines.push(`即将过期:${i.name}`));
    if (expired.length + expiring.length > 6) lines.push(`…共 ${expired.length + expiring.length} 项`);

    toast("⚠️ " + lines.join(" / "));
    if ("Notification" in window && Notification.permission === "granted") {
      try {
        new Notification("烘焙工作台 · 保质期提醒", { body: lines.join("\n") });
      } catch (e) { /* 忽略 */ }
    }
  }

  /* ---------- 导出 / 导入 ---------- */
  function exportData() {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "烘焙工作台备份-" + todayStr() + ".json";
    a.click();
    URL.revokeObjectURL(a.href);
    toast("已导出备份文件");
  }

  function importData(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        if (!Array.isArray(data.recipes) || !Array.isArray(data.ingredients)) throw new Error("格式不对");
        state = { recipes: data.recipes, ingredients: data.ingredients, bakes: data.bakes || [] };
        save();
        fillCategoryFilter();
        switchView("dashboard");
        toast("导入成功");
      } catch (e) {
        toast("导入失败:文件格式不正确");
      }
    };
    reader.readAsText(file);
  }

  /* ---------- 事件绑定 ---------- */
  function bindEvents() {
    // 导航
    $$(".nav-btn").forEach((b) => b.addEventListener("click", () => switchView(b.dataset.view)));
    $$("[data-goto]").forEach((b) => b.addEventListener("click", () => switchView(b.dataset.goto)));

    // 弹窗关闭
    $$("[data-close]").forEach((b) => b.addEventListener("click", () => $("#" + b.dataset.close).classList.add("hidden")));
    $$(".modal-mask").forEach((m) => m.addEventListener("click", (e) => {
      if (e.target === m) m.classList.add("hidden");
    }));

    // 配方
    $("#btn-add-recipe").addEventListener("click", () => openRecipeModal(null));
    $("#recipe-form").addEventListener("submit", submitRecipe);
    $("#btn-add-ing-row").addEventListener("click", () => {
      const rows = collectIngRows();
      rows.push({ name: "", amount: "", unit: "" });
      renderIngRows(rows);
    });
    $("#recipe-ingredients").addEventListener("click", (e) => {
      if (e.target.classList.contains("ing-del")) {
        const rows = collectIngRows();
        rows.splice(+e.target.dataset.idx, 1);
        renderIngRows(rows.length ? rows : [{ name: "", amount: "", unit: "" }]);
      }
    });
    $("#recipe-search").addEventListener("input", renderRecipes);
    $("#recipe-cat-filter").addEventListener("change", renderRecipes);
    $("#recipe-list").addEventListener("click", (e) => {
      const edit = e.target.closest("[data-edit-recipe]");
      const del = e.target.closest("[data-del-recipe]");
      const open = e.target.closest("[data-open-recipe]");
      if (edit) {
        e.stopPropagation();
        const r = state.recipes.find((x) => x.id === edit.dataset.editRecipe);
        if (r) openRecipeModal(r);
        return;
      }
      if (del) {
        e.stopPropagation();
        const r = state.recipes.find((x) => x.id === del.dataset.delRecipe);
        if (r) askDelete(`确定删除配方「${r.name}」吗?此操作不可恢复。`, () => {
          state.recipes = state.recipes.filter((x) => x.id !== r.id);
          save(); fillCategoryFilter(); renderRecipes(); toast("已删除");
        });
        return;
      }
      if (open) openRecipeDetail(open.dataset.openRecipe);
    });

    // 配方详情弹窗操作
    $("#rd-edit").addEventListener("click", () => {
      const id = $("#rd-edit").dataset.recipeId;
      $("#recipe-detail-modal").classList.add("hidden");
      const r = state.recipes.find((x) => x.id === id);
      if (r) openRecipeModal(r);
    });
    $("#rd-delete").addEventListener("click", () => {
      const id = $("#rd-delete").dataset.recipeId;
      const r = state.recipes.find((x) => x.id === id);
      if (!r) return;
      $("#recipe-detail-modal").classList.add("hidden");
      askDelete(`确定删除配方「${r.name}」吗?此操作不可恢复。`, () => {
        state.recipes = state.recipes.filter((x) => x.id !== r.id);
        save(); fillCategoryFilter(); renderRecipes(); toast("已删除");
      });
    });

    // 材料
    $("#btn-add-ing").addEventListener("click", () => openIngModal(null));
    $("#ing-form").addEventListener("submit", submitIng);
    $("#ing-search").addEventListener("input", renderInventory);
    $("#ing-status-filter").addEventListener("change", renderInventory);
    $("#ing-list").addEventListener("click", (e) => {
      const edit = e.target.closest("[data-edit-ing]");
      const del = e.target.closest("[data-del-ing]");
      if (edit) {
        const i = state.ingredients.find((x) => x.id === edit.dataset.editIng);
        if (i) openIngModal(i);
      }
      if (del) {
        const i = state.ingredients.find((x) => x.id === del.dataset.delIng);
        if (i) askDelete(`确定删除材料「${i.name}」吗?此操作不可恢复。`, () => {
          state.ingredients = state.ingredients.filter((x) => x.id !== i.id);
          save(); renderInventory(); toast("已删除");
        });
      }
    });

    // 烘焙记录
    $("#btn-add-bake").addEventListener("click", () => openBakeModal(null));
    $("#bake-form").addEventListener("submit", submitBake);
    $("#bake-search").addEventListener("input", renderBakes);
    $("#bake-result-filter").addEventListener("change", renderBakes);
    $("#bake-list").addEventListener("click", (e) => {
      const edit = e.target.closest("[data-edit-bake]");
      const del = e.target.closest("[data-del-bake]");
      if (edit) {
        const b = state.bakes.find((x) => x.id === edit.dataset.editBake);
        if (b) openBakeModal(b);
      }
      if (del) {
        const b = state.bakes.find((x) => x.id === del.dataset.delBake);
        if (b) askDelete(`确定删除烘焙记录「${b.name}」吗?此操作不可恢复。`, () => {
          state.bakes = state.bakes.filter((x) => x.id !== b.id);
          save(); renderBakes(); toast("已删除");
        });
      }
    });

    // 删除确认
    $("#confirm-ok").addEventListener("click", () => {
      if (pendingDelete) pendingDelete();
      pendingDelete = null;
      $("#confirm-modal").classList.add("hidden");
    });

    // 导出 / 导入
    $("#btn-export").addEventListener("click", exportData);
    $("#btn-import").addEventListener("click", () => $("#import-file").click());
    $("#import-file").addEventListener("change", (e) => {
      if (e.target.files[0]) importData(e.target.files[0]);
      e.target.value = "";
    });

    // 请求通知权限
    if ("Notification" in window && Notification.permission === "default") {
      Notification.requestPermission();
    }
  }

  /* ---------- 启动 ---------- */
  function init() {
    bindEvents();
    fillCategoryFilter();
    switchView("dashboard");
    checkExpiryReminder();
    syncFromServer();
  }

  document.addEventListener("DOMContentLoaded", init);
})();