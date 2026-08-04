/* ============ 烘焙工作台 逻辑 v2 ============ */
(function () {
  "use strict";

  const STORE_KEY = "baking-workbench-v1";
  const EXPIRING_DAYS = 7; // 提前多少天提醒
  const SERVER_MODE = location.protocol.startsWith("http");
  let serverAvailable = false;

  /* ---------- 数据 ---------- */
  let state = load();

  function load() {
    const defaults = () => ({
      recipes: [], ingredients: [], bakes: [],
      memos: [], tasks: [],
      galleryItems: [], galleryCats: ["蛋糕", "慕斯", "饼干", "面包", "其他"]
    });
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) {
        const d = JSON.parse(raw);
        const base = defaults();
        return {
          recipes: d.recipes || base.recipes,
          ingredients: d.ingredients || base.ingredients,
          bakes: d.bakes || base.bakes,
          memos: (d.memos || base.memos).map(normalizeMemo),
          tasks: d.tasks || base.tasks,
          galleryItems: d.galleryItems || base.galleryItems,
          galleryCats: (d.galleryCats && d.galleryCats.length ? d.galleryCats : base.galleryCats)
        };
      }
    } catch (e) { console.warn("读取本地数据失败", e); }
    return defaults();
  }

  function save() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(state));
    } catch (e) {
      toast("⚠️ 存储空间不足,请导出备份后删除一些相册图片");
      return;
    }
    if (SERVER_MODE && serverAvailable) {
      fetch("/api/data", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(state)
      }).then((r) => { if (!r.ok) throw new Error("http " + r.status); })
        .catch(() => { serverAvailable = false; });
    }
  }

  /* ---------- 服务器数据同步 ---------- */
  function syncFromServer() {
    if (!SERVER_MODE) return;
    fetch("/api/data", { cache: "no-store" })
      .then((r) => { if (!r.ok) throw new Error("http " + r.status); return r.json(); })
      .then((data) => {
        serverAvailable = true;
        if (data && (data.recipes || data.ingredients || data.memos || data.tasks)) {
          const base = load();
          state = {
            recipes: data.recipes || base.recipes,
            ingredients: data.ingredients || base.ingredients,
            bakes: data.bakes || base.bakes,
memos: (data.memos || base.memos).map(normalizeMemo),
            tasks: data.tasks || base.tasks,
            galleryItems: data.galleryItems || base.galleryItems,
            galleryCats: (data.galleryCats && data.galleryCats.length ? data.galleryCats : base.galleryCats)
          };
          fillCategoryFilter();
          fillGalleryCatOptions();
          switchView("dashboard");
          toast("已载入共享数据");
        } else {
          save();
        }
      })
      .catch(() => { /* 纯静态托管:静默降级为本地模式 */ });
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
    })[c]);
  }

  function todayStr() {
    const d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }

  function thisMonthStr() {
    const d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
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

  const VIEW_TITLES = {
    dashboard: "首页", recipes: "配方库", inventory: "材料库存", bakes: "烘焙记录",
    memos: "备忘录", tasks: "任务清单", gallery: "款式相册"
  };

  /* ---------- 视图切换 ---------- */
  function switchView(name) {
    $$(".view").forEach((v) => v.classList.remove("active"));
    $("#view-" + name).classList.add("active");
    $$(".nav-btn").forEach((b) => b.classList.toggle("active", b.dataset.view === name));
    $("#page-title").textContent = VIEW_TITLES[name] || "";
    if (name === "dashboard") renderDashboard();
    if (name === "recipes") renderRecipes();
    if (name === "inventory") renderInventory();
    if (name === "bakes") renderBakes();
    if (name === "memos") renderMemos();
    if (name === "tasks") renderTasks();
    if (name === "gallery") renderGallery();
  }

  /* ---------- 首页 ---------- */
  function renderDashboard() {
    const ings = state.ingredients;
    const expiring = ings.filter((i) => expiryStatus(i.expiryDate).key === "expiring");
    const expired = ings.filter((i) => expiryStatus(i.expiryDate).key === "expired");
    const pendingTasks = state.tasks.filter((t) => !t.done);

    const greet = $("#welcome-greet");
    const h = new Date().getHours();
    greet.textContent = (h < 6 ? "夜深了,早点休息 🌙" : h < 11 ? "早上好呀 ☀️" : h < 14 ? "中午好 🍚" : h < 18 ? "下午好 🍵" : "晚上好 🌙") + ",今天想做点什么?";
    $("#welcome-date").textContent = new Date().toLocaleDateString("zh-CN", { year: "numeric", month: "long", day: "numeric", weekday: "long" });

    $("#stat-recipes").textContent = state.recipes.length;
    $("#stat-ingredients").textContent = ings.length;
    $("#stat-bakes").textContent = state.bakes.length;
    $("#stat-memos").textContent = state.memos.length;
    $("#stat-tasks").textContent = pendingTasks.length;
    $("#stat-gallery").textContent = state.galleryItems.length;

    // 保质期提醒
    const warnList = [...expired, ...expiring].sort((a, b) => (daysUntil(a.expiryDate) || 0) - (daysUntil(b.expiryDate) || 0));
    const dashExpiry = $("#dash-expiry");
    if (warnList.length === 0) {
      dashExpiry.innerHTML = '<div class="empty" style="padding:14px 0">🎉 所有材料都在保质期内</div>';
    } else {
      dashExpiry.innerHTML = warnList.slice(0, 6).map((i) => {
        const st = expiryStatus(i.expiryDate);
        return `<div class="row-item"><span class="row-title">${esc(i.name)}</span>
          <span><span class="tag ${st.cls}">${st.label}</span></span></div>`;
      }).join("") + (warnList.length > 6 ? `<div class="empty" style="padding:6px 0">…还有 ${warnList.length - 6} 项</div>` : "");
    }

    // 近期任务:今天+逾期+明天,未完成优先
    const soonTasks = pendingTasks
      .filter((t) => (t.type === "day" && (daysUntil(t.date) || 0) <= 1) || (t.type === "month" && t.month === thisMonthStr()))
      .sort((a, b) => {
        const da = a.type === "day" ? daysUntil(a.date) || 0 : 0;
        const db = b.type === "day" ? daysUntil(b.date) || 0 : 0;
        return da - db;
      }).slice(0, 5);
    const dashTasks = $("#dash-tasks");
    if (soonTasks.length === 0) {
      dashTasks.innerHTML = '<div class="empty" style="padding:14px 0">今天没有待办任务,轻松一下 🌸</div>';
    } else {
      dashTasks.innerHTML = soonTasks.map((t) => {
        const tag = t.type === "day"
          ? `<span class="tag ${(daysUntil(t.date) || 0) < 0 ? "tag-danger" : ""}">${esc(t.date || "")}</span>`
          : `<span class="tag">${esc(t.month || "")} 月任务</span>`;
        return `<div class="row-item"><span class="row-title">${esc(t.title)}</span>${tag}</div>`;
      }).join("");
    }

    // 最近配方
    const recent = [...state.recipes].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)).slice(0, 5);
    $("#dash-recipes").innerHTML = recent.length === 0
      ? '<div class="empty" style="padding:10px 0">还没有配方</div>'
      : recent.map((r) => `<div class="row-item"><span class="row-title">${esc(r.name)}</span>
          <span class="tag">${esc(r.category || "其他")}</span></div>`).join("");

    // 最近烘焙
    const recentBakes = [...state.bakes].sort((a, b) => (b.date || "").localeCompare(a.date || "")).slice(0, 5);
    $("#dash-bakes").innerHTML = recentBakes.length === 0
      ? '<div class="empty" style="padding:10px 0">还没有烘焙记录</div>'
      : recentBakes.map((b) => {
        const resultTag = b.result
          ? `<span class="tag ${b.result === "成功" ? "tag-ok" : b.result === "失败" ? "tag-danger" : "tag-warn"}">${esc(b.result)}</span>`
          : "";
        return `<div class="row-item"><span class="row-title">${esc(b.name)}</span>
          <span>${esc(b.date || "")} ${resultTag}</span></div>`;
      }).join("");
  }

  /* ============ 配方库 ============ */
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
      const ings = (r.ingredients || []).map((ig) => {
        const st = stockStatusFor(ig.name);
        return `<div class="ing-row"><span>${esc(ig.name)} <span class="stock ${st.cls}" title="${esc(st.tip)}">${esc(st.label)}</span></span><span>${esc(ig.amount || "")} ${esc(ig.unit || "")}</span></div>`;
      }).join("");
      return `<div class="item-card clickable" data-open-recipe="${r.id}" title="单击查看详情">
        <h3 class="item-title">${esc(r.name)} <span class="tag">${esc(r.category || "其他")}</span></h3>
        <div class="item-meta">
          ${r.servings ? `<span>份量:${esc(r.servings)}</span>` : ""}
          ${r.oven ? `<span>🔥 ${esc(r.oven)}</span>` : ""}
          ${r.time ? `<span>⏱ ${esc(r.time)}</span>` : ""}
        </div>
        ${r.desc ? `<div class="item-body">${esc(r.desc)}</div>` : ""}
        ${ings ? `<div>${ings}</div>` : ""}
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
    sel.innerHTML = '<option value="">全部分类</option>' + cats.map((c) => `<option>${esc(c)}</option>`).join("");
    sel.value = cur;
  }

  function fillIngDatalist() {
    let dl = $("#ing-datalist");
    if (!dl) {
      dl = document.createElement("datalist");
      dl.id = "ing-datalist";
      document.body.appendChild(dl);
    }
    dl.innerHTML = state.ingredients.map((i) => `<option value="${esc(i.name)}"></option>`).join("");
  }

  /* 配方材料 ↔ 库存联动 */
  function stockStatusFor(name) {
    const n = (name || "").trim();
    if (!n) return { cls: "stock-none", label: "—", tip: "" };
    const exact = state.ingredients.filter((i) => i.name.trim() === n);
    const loose = state.ingredients.filter((i) => i.name.trim() !== n && (i.name.includes(n) || n.includes(i.name)));
    const list = exact.length ? exact : loose;
    if (!list.length) return { cls: "stock-none", label: "无库存", tip: "库存中没有找到「" + n + "」,建议先去库存页添加" };
    const sorted = [...list].sort((a, b) => (daysUntil(a.expiryDate) ?? 999) - (daysUntil(b.expiryDate) ?? 999));
    const worst = sorted[0];
    const st = expiryStatus(worst.expiryDate);
    const qty = worst.qty ? `(${worst.qty})` : "";
    if (st.key === "expired") return { cls: "stock-danger", label: "⚠ 过期" + qty, tip: "「" + worst.name + "」已过期 " + -daysUntil(worst.expiryDate) + " 天,记得处理" };
    if (st.key === "expiring") return { cls: "stock-warn", label: "⚠ 临期" + qty, tip: "「" + worst.name + "」剩 " + daysUntil(worst.expiryDate) + " 天,尽快用完" };
    return { cls: "stock-ok", label: "✓ 有货" + qty, tip: "「" + worst.name + "」库存正常" };
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
    fillIngDatalist();
    renderIngRows(recipe ? recipe.ingredients : [{ name: "", amount: "", unit: "" }]);
    $("#recipe-modal").classList.remove("hidden");
    $("#r-name").focus();
  }

  /* ---------- 配方详情(联动库存) ---------- */
  function openRecipeDetail(id) {
    const r = state.recipes.find((x) => x.id === id);
    if (!r) return;
    $("#rd-title").textContent = r.name;
    $("#rd-edit").dataset.recipeId = r.id;
    $("#rd-delete").dataset.recipeId = r.id;

    const ings = (r.ingredients || []).length
      ? `<table class="detail-ing-table">
          <thead><tr><th>材料</th><th>用量</th><th>库存</th></tr></thead>
          <tbody>${(r.ingredients || []).map((ig) => {
            const st = stockStatusFor(ig.name);
            return `<tr><td>${esc(ig.name)}</td><td>${esc(ig.amount || "")} ${esc(ig.unit || "")}</td>
              <td><span class="stock ${st.cls}" title="${esc(st.tip)}">${esc(st.label)}</span></td></tr>`;
          }).join("")}</tbody>
        </table>
        <div class="hint" style="margin-top:6px">💡 材料状态与「材料库存」自动联动,库存不足或过期会标红提醒</div>`
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
        <input type="text" class="ing-name" list="ing-datalist" placeholder="材料名" value="${esc(ig.name)}">
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

  /* ============ 材料库存 ============ */
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

  /* ============ 烘焙记录 ============ */
  function fillBakeRecipeSelect() {
    const sel = $("#b-recipe");
    const cur = sel.value;
    const recipes = [...state.recipes].sort((a, b) => a.name.localeCompare(b.name));
    sel.innerHTML = '<option value="">(不关联)</option>' + recipes.map((r) => `<option value="${r.id}">${esc(r.name)}</option>`).join("");
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

  /* ============ 备忘录(结构化行:普通段落 + 可勾选任务行) ============ */
  function renderMemos() {
    const kw = ($("#memo-search").value || "").trim().toLowerCase();
    // 编辑弹窗打开时,用编辑器里的实时内容刷新预览统计(勾选后立即更新)
    let liveId = null, liveContent = null;
    if (!$("#memo-modal").classList.contains("hidden") && $("#memo-id").value) {
      liveId = $("#memo-id").value;
      liveContent = collectMemoContent();
    }
    let list = state.memos.map((m) => (m.id === liveId ? { ...m, content: liveContent } : m));
    if (kw) list = list.filter((m) => (m.title || "").toLowerCase().includes(kw) || memoText(m).toLowerCase().includes(kw));
    list = [...list].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

    const box = $("#memo-list");
    $("#memo-empty").classList.toggle("hidden", list.length > 0);
    box.innerHTML = list.map((m) => `
      <div class="memo-card" data-open-memo="${m.id}">
        <h3>${esc(m.title || "(无标题)")}</h3>
        <div class="memo-preview">${memoPreview(m)}</div>
        <div class="memo-time">${fmtTime(m.updatedAt || m.createdAt)}</div>
        <div class="memo-actions">
          <button class="btn btn-small" data-edit-memo="${m.id}">编辑</button>
          <button class="btn btn-small btn-danger" data-del-memo="${m.id}">删除</button>
        </div>
      </div>`).join("");
  }

  function memoContent(m) {
    return Array.isArray(m.content) ? m.content : [];
  }

  function memoText(m) {
    return memoContent(m).map((r) => stripHtml(r.html)).join(" ");
  }

  function memoPreview(m) {
    const rows = memoContent(m);
    const total = rows.filter((r) => r.type === "task").length;
    const done = rows.filter((r) => r.type === "task" && r.done).length;
    const text = rows.map((r) => stripHtml(r.html)).join(" ").replace(/\s+/g, " ").trim();
    let out = text.length > 80 ? text.slice(0, 80) + "…" : (text || "空内容");
    if (total > 0) out += ` <span class="tag ${done === total ? "tag-ok" : ""}">☑ ${done}/${total}</span>`;
    return out;
  }

  function stripHtml(html) {
    const div = document.createElement("div");
    div.innerHTML = html;
    return (div.textContent || "").replace(/\s+/g, " ").trim();
  }

  function fmtTime(ts) {
    if (!ts) return "";
    const d = new Date(ts);
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  /* 旧数据迁移:html 字符串 → 结构化行 */
  function normalizeMemo(m) {
    if (Array.isArray(m.content)) return m;
    const html = m.html || "";
    const div = document.createElement("div");
    div.innerHTML = html;
    const content = [];
    Array.from(div.children).forEach((block) => {
      const chk = block.querySelector(".memo-chk");
      if (chk) {
        const clone = block.cloneNode(true);
        const c = clone.querySelector(".memo-chk");
        if (c) c.remove();
        content.push({ type: "task", done: chk.dataset.checked === "1", html: clone.innerHTML.trim() });
      } else {
        content.push({ type: "text", html: block.innerHTML });
      }
    });
    if (!content.length && html.trim()) content.push({ type: "text", html });
    return { ...m, content };
  }

  /* 编辑器:渲染结构化行 */
  function renderMemoEditor(content) {
    const box = $("#m-editor");
    box.innerHTML = "";
    (content || []).forEach((row) => {
      const div = document.createElement("div");
      div.className = "memo-row" + (row.type === "task" ? " memo-task-row" : "");
      if (row.type === "task") {
        const chk = document.createElement("span");
        chk.className = "memo-chk";
        chk.dataset.checked = row.done ? "1" : "0";
        const text = document.createElement("div");
        text.className = "memo-row-text";
        text.contentEditable = "true";
        text.innerHTML = row.html || "";
        const del = document.createElement("button");
        del.type = "button";
        del.className = "memo-row-del";
        del.textContent = "×";
        del.title = "删除这一行";
        div.appendChild(chk); div.appendChild(text); div.appendChild(del);
      } else {
        const text = document.createElement("div");
        text.className = "memo-row-text";
        text.contentEditable = "true";
        text.innerHTML = row.html || "";
        div.appendChild(text);
      }
      box.appendChild(div);
    });
    if (!box.children.length) {
      const first = document.createElement("div");
      first.className = "memo-row";
      const text = document.createElement("div");
      text.className = "memo-row-text";
      text.contentEditable = "true";
      first.appendChild(text);
      box.appendChild(first);
    }
  }

  /* 收集编辑器内容为结构化行 */
  function collectMemoContent() {
    return $$("#m-editor .memo-row").map((row) => {
      const text = row.querySelector(".memo-row-text");
      const html = text ? text.innerHTML : "";
      if (row.classList.contains("memo-task-row")) {
        const chk = row.querySelector(".memo-chk");
        return { type: "task", done: chk && chk.dataset.checked === "1", html };
      }
      return { type: "text", html };
    }).filter((r) => r.html.trim() !== "" || r.type === "task");
  }

  function openMemoModal(memo) {
    $("#memo-modal-title").textContent = memo ? "编辑备忘录" : "新建备忘录";
    $("#memo-id").value = memo ? memo.id : "";
    $("#m-title").value = memo ? memo.title : "";
    renderMemoEditor(memo ? memoContent(memo) : []);
    $("#memo-modal").classList.remove("hidden");
    setTimeout(() => { (memo ? $("#m-editor .memo-row-text:last-child") : $("#m-title")).focus(); }, 60);
  }

  function saveMemo() {
    const id = $("#memo-id").value;
    const title = $("#m-title").value.trim();
    const content = collectMemoContent();
    if (!title && !content.length) { toast("写点内容再保存吧"); return; }
    const now = Date.now();
    if (id) {
      const idx = state.memos.findIndex((m) => m.id === id);
      if (idx >= 0) state.memos[idx] = { ...state.memos[idx], title, content, updatedAt: now };
      toast("备忘录已更新");
    } else {
      state.memos.push({ id: uid(), title, content, createdAt: now, updatedAt: now });
      toast("备忘录已保存");
    }
    save();
    $("#memo-modal").classList.add("hidden");
    renderMemos();
  }

  /* 编辑器当前焦点所在行(点击工具栏时 selection 会丢失,提前保存) */
  let lastActiveRow = null;
  function saveActiveRow() {
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0 && sel.anchorNode) {
      const el = sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement;
      const row = el ? el.closest(".memo-row") : null;
      if (row && $("#m-editor").contains(row)) lastActiveRow = row;
    }
  }

  function initMemoToolbar() {
    $("#memo-toolbar").addEventListener("click", (e) => {
      const btn = e.target.closest(".mt-btn, .mt-color");
      if (!btn) return;
      e.preventDefault();
      if (btn.dataset.color) {
        document.execCommand("foreColor", false, btn.dataset.color);
      } else if (btn.dataset.cmd === "chk") {
        insertTaskRow();
      } else {
        document.execCommand(btn.dataset.cmd, false, null);
      }
    });
    // 记录光标所在行
    $("#m-editor").addEventListener("keyup", saveActiveRow);
    $("#m-editor").addEventListener("mouseup", saveActiveRow);
    // 回车 = 开新行(Shift+回车 保留行内换行)
    $("#m-editor").addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        splitMemoRow();
      }
    });
    // 点击勾选框:切换勾选 + 已勾选沉底 + 实时刷新统计;点击 × 删除该行
    $("#m-editor").addEventListener("click", (e) => {
      const chk = e.target.closest(".memo-chk");
      if (chk) {
        chk.dataset.checked = chk.dataset.checked === "1" ? "0" : "1";
        reorderMemoRows();
        renderMemos();
        return;
      }
      const del = e.target.closest(".memo-row-del");
      if (del) {
        del.closest(".memo-row").remove();
        renderMemos();
      }
    });
  }

  /* 回车拆分:光标后的内容移到新行,新行类型跟随当前行(普通→普通,勾选→勾选) */
  function splitMemoRow() {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return;
    const range = sel.getRangeAt(0);
    const el = range.startContainer.nodeType === 1 ? range.startContainer : range.startContainer.parentElement;
    const row = el ? el.closest(".memo-row") : null;
    if (!row) return;
    const textDiv = row.querySelector(".memo-row-text");
    if (!textDiv) return;

    // 提取光标之后的内容
    const after = document.createRange();
    after.setStart(range.startContainer, range.startOffset);
    after.setEnd(textDiv, textDiv.childNodes.length);
    const afterContent = after.extractContents();

    const isTask = row.classList.contains("memo-task-row");
    const newRow = document.createElement("div");
    newRow.className = "memo-row" + (isTask ? " memo-task-row" : "");
    if (isTask) {
      const chk = document.createElement("span");
      chk.className = "memo-chk";
      chk.dataset.checked = "0";
      newRow.appendChild(chk);
    }
    const newText = document.createElement("div");
    newText.className = "memo-row-text";
    newText.contentEditable = "true";
    newText.appendChild(afterContent);
    newRow.appendChild(newText);
    if (isTask) {
      const del = document.createElement("button");
      del.type = "button";
      del.className = "memo-row-del";
      del.textContent = "×";
      del.title = "删除这一行";
      newRow.appendChild(del);
    }
    row.after(newRow);
    lastActiveRow = newRow;
    newText.focus();
    const caret = document.createRange();
    caret.setStart(newText, 0);
    caret.collapse(true);
    sel.removeAllRanges();
    sel.addRange(caret);
  }

  /* 点 ☑️:光标所在段落直接变成勾选行(勾选框强制在段落头);
     若光标已在勾选行,则在其后新增一行 */
  function insertTaskRow() {
    const box = $("#m-editor");
    let row = lastActiveRow;
    if (!row || !$("#m-editor").contains(row)) {
      const sel = window.getSelection();
      if (sel && sel.rangeCount > 0 && sel.anchorNode) {
        const el = sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement;
        row = el ? el.closest(".memo-row") : null;
      }
    }
    if (row && !row.classList.contains("memo-task-row")) {
      // 普通段落 → 转换为勾选行:勾选框插到段落最前面
      const chk = document.createElement("span");
      chk.className = "memo-chk";
      chk.dataset.checked = "0";
      const del = document.createElement("button");
      del.type = "button";
      del.className = "memo-row-del";
      del.textContent = "×";
      del.title = "删除这一行";
      row.classList.add("memo-task-row");
      row.insertBefore(chk, row.firstChild);
      row.appendChild(del);
      renderMemos();
      return;
    }
    // 已是勾选行(或没有活动行):在行后插入新勾选行
    const newRow = document.createElement("div");
    newRow.className = "memo-row memo-task-row";
    const chk = document.createElement("span");
    chk.className = "memo-chk";
    chk.dataset.checked = "0";
    const text = document.createElement("div");
    text.className = "memo-row-text";
    text.contentEditable = "true";
    const del = document.createElement("button");
    del.type = "button";
    del.className = "memo-row-del";
    del.textContent = "×";
    del.title = "删除这一行";
    newRow.appendChild(chk); newRow.appendChild(text); newRow.appendChild(del);
    if (row) row.after(newRow);
    else $("#m-editor").appendChild(newRow);
    lastActiveRow = newRow;
    text.focus();
  }

  /* 已勾选的任务行沉到内容末尾(未勾选保持原顺序在上方) */
  function reorderMemoRows() {
    const box = $("#m-editor");
    const rows = Array.from(box.querySelectorAll(".memo-row"));
    const todo = rows.filter((r) => !r.classList.contains("memo-task-row") || r.querySelector(".memo-chk").dataset.checked !== "1");
    const done = rows.filter((r) => r.classList.contains("memo-task-row") && r.querySelector(".memo-chk").dataset.checked === "1");
    if (!done.length) return;
    rows.forEach((r) => r.remove());
    todo.concat(done).forEach((r) => box.appendChild(r));
  }

  /* ============ 任务清单 ============ */
  let taskTab = "day";

  function renderTasks() {
    const list = [...state.tasks].sort((a, b) => {
      if (a.done !== b.done) return a.done ? 1 : -1; // 未完成在前
      return (a.createdAt || 0) - (b.createdAt || 0);
    });

    const box = $("#task-list");
    const empty = $("#task-empty");
    if (taskTab === "day") {
      const date = $("#task-date").value || todayStr();
      const today = list.filter((t) => t.type === "day" && t.date === date);
      const overdue = list.filter((t) => t.type === "day" && !t.done && (daysUntil(t.date) || 0) < 0 && t.date !== date);
      const upcoming = list.filter((t) => t.type === "day" && t.date !== date && !(t.date < todayStr() && !t.done));
      const all = (overdue.length ? [{ title: "已逾期", items: overdue }] : [])
        .concat(today.length ? [{ title: `${date} 的任务`, items: today }] : [])
        .concat(upcoming.length ? [{ title: "其他日任务", items: upcoming }] : []);
      empty.classList.toggle("hidden", all.length > 0);
      box.innerHTML = all.map((g) => `
        <div class="task-group">
          <div class="task-group-title"><span class="dot"></span>${esc(g.title)}</div>
          ${g.items.map(taskItemHtml).join("")}
        </div>`).join("");
    } else {
      const month = $("#task-month").value || thisMonthStr();
      const items = list.filter((t) => t.type === "month" && t.month === month);
      empty.classList.toggle("hidden", items.length > 0);
      box.innerHTML = `<div class="task-group">
        <div class="task-group-title"><span class="dot"></span>${esc(month)} 的月任务</div>
        ${items.map(taskItemHtml).join("")}
      </div>`;
    }
  }

  function taskItemHtml(t) {
    const overdue = t.type === "day" && !t.done && (daysUntil(t.date) || 0) < 0;
    const dateTag = t.type === "day"
      ? `<span class="task-date">📅 ${esc(t.date || "")}</span>`
      : `<span class="task-date">📆 ${esc(t.month || "")}</span>`;
    return `<div class="task-item ${t.done ? "done" : ""} ${overdue ? "overdue" : ""}">
      <input type="checkbox" class="task-chk" data-toggle-task="${t.id}" ${t.done ? "checked" : ""}>
      <span class="task-title">${esc(t.title)}</span>
      ${dateTag}
      <button class="task-del" data-del-task="${t.id}" title="删除任务">×</button>
    </div>`;
  }

  function openTaskModal(task) {
    $("#task-modal-title").textContent = task ? "编辑任务" : "新增任务";
    $("#task-id").value = task ? task.id : "";
    $("#t-title").value = task ? task.title : "";
    $("#t-type").value = task ? task.type : "day";
    const isDay = (task ? task.type : "day") === "day";
    $("#t-date-label").querySelector("input").type = isDay ? "date" : "month";
    $("#t-date-label").firstChild.textContent = isDay ? "日期" : "月份";
    $("#t-date").value = task ? (task.date || task.month || (isDay ? todayStr() : thisMonthStr())) : (isDay ? todayStr() : thisMonthStr());
    $("#task-modal").classList.remove("hidden");
    $("#t-title").focus();
  }

  function submitTask(e) {
    e.preventDefault();
    const id = $("#task-id").value;
    const type = $("#t-type").value;
    const dateVal = $("#t-date").value;
    const data = {
      title: $("#t-title").value.trim(),
      type: type,
      date: type === "day" ? dateVal : "",
      month: type === "month" ? dateVal : ""
    };
    if (!data.title) { toast("请填写任务内容"); return; }
    if (type === "day" && !data.date) { toast("请选择日期"); return; }
    if (type === "month" && !data.month) { toast("请选择月份"); return; }
    const now = Date.now();
    if (id) {
      const idx = state.tasks.findIndex((t) => t.id === id);
      if (idx >= 0) state.tasks[idx] = { ...state.tasks[idx], ...data, updatedAt: now };
      toast("任务已更新");
    } else {
      state.tasks.push({ id: uid(), ...data, done: false, createdAt: now, updatedAt: now });
      toast("任务已添加");
    }
    save();
    $("#task-modal").classList.add("hidden");
    renderTasks();
  }

  function toggleTask(id) {
    const t = state.tasks.find((x) => x.id === id);
    if (!t) return;
    t.done = !t.done;
    save();
    renderTasks();
  }

  /* ============ 款式相册 ============ */
  function fillGalleryCatOptions() {
    const cats = state.galleryCats;
    const sel = $("#gallery-cat-filter");
    const cur = sel.value;
    sel.innerHTML = '<option value="">全部分类</option>' + cats.map((c) => `<option>${esc(c)}</option>`).join("");
    sel.value = cur;
    const gcat = $("#g-cat");
    gcat.innerHTML = '<option value="">(未分类)</option>' + cats.map((c) => `<option>${esc(c)}</option>`).join("");
  }

  function renderGallery() {
    const cat = $("#gallery-cat-filter").value;
    let list = state.galleryItems;
    if (cat) list = list.filter((g) => g.category === cat);
    list = [...list].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

    const box = $("#gallery-grid");
    $("#gallery-empty").classList.toggle("hidden", list.length > 0);
    box.innerHTML = list.map((g) => `
      <div class="gallery-card" data-open-gallery="${g.id}">
        <img src="${g.image}" alt="${esc(g.title || "款式图")}" loading="lazy">
        <div class="g-info">
          <span class="g-title">${esc(g.title || "未命名款式")}</span>
          ${g.category ? `<span class="tag">${esc(g.category)}</span>` : ""}
          <button class="g-del" data-del-gallery="${g.id}" title="删除">×</button>
        </div>
      </div>`).join("");
  }

  function openGalleryModal() {
    $("#g-title").value = "";
    $("#g-cat").value = "";
    $("#g-file").value = "";
    $("#upload-preview").classList.add("hidden");
    $("#upload-text").textContent = "📷 点击选择图片";
    $("#gallery-modal").classList.remove("hidden");
  }

  function compressImage(file, maxW, quality) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        const scale = Math.min(1, maxW / img.width);
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(url);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("图片读取失败")); };
      img.src = url;
    });
  }

  function saveGallery() {
    const file = $("#g-file").files[0];
    if (!file) { toast("请先选择一张图片"); return; }
    if (!file.type.startsWith("image/")) { toast("请选择图片文件"); return; }
    const title = $("#g-title").value.trim();
    const category = $("#g-cat").value;
    compressImage(file, 900, 0.8).then((image) => {
      state.galleryItems.push({ id: uid(), title, category, image, createdAt: Date.now() });
      save();
      $("#gallery-modal").classList.add("hidden");
      renderGallery();
      toast("款式图已保存");
    }).catch(() => toast("图片处理失败,请换一张试试"));
  }

  function openGalleryView(id) {
    const g = state.galleryItems.find((x) => x.id === id);
    if (!g) return;
    $("#gv-title").textContent = (g.title || "未命名款式") + (g.category ? " · " + g.category : "");
    $("#gv-img").src = g.image;
    $("#gv-delete").dataset.galleryId = g.id;
    $("#gallery-view-modal").classList.remove("hidden");
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
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "烘焙工作台备份-" + todayStr() + ".json";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    toast("已导出备份文件");
  }

  function importData(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        if (!Array.isArray(data.recipes) || !Array.isArray(data.ingredients)) throw new Error("格式不对");
        const base = load();
        state = {
          recipes: data.recipes, ingredients: data.ingredients, bakes: data.bakes || [],
          memos: (data.memos || base.memos).map(normalizeMemo), tasks: data.tasks || base.tasks,
          galleryItems: data.galleryItems || base.galleryItems,
          galleryCats: (data.galleryCats && data.galleryCats.length ? data.galleryCats : base.galleryCats)
        };
        save();
        fillCategoryFilter();
        fillGalleryCatOptions();
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

    // 配方详情
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

    // 备忘录
    $("#btn-add-memo").addEventListener("click", () => openMemoModal(null));
    initMemoToolbar();
    $("#memo-save").addEventListener("click", saveMemo);
    $("#memo-search").addEventListener("input", renderMemos);
    $("#memo-list").addEventListener("click", (e) => {
      const edit = e.target.closest("[data-edit-memo]");
      const del = e.target.closest("[data-del-memo]");
      const open = e.target.closest("[data-open-memo]");
      if (edit) {
        e.stopPropagation();
        const m = state.memos.find((x) => x.id === edit.dataset.editMemo);
        if (m) openMemoModal(m);
        return;
      }
      if (del) {
        e.stopPropagation();
        const m = state.memos.find((x) => x.id === del.dataset.delMemo);
        if (m) askDelete(`确定删除备忘录「${m.title || "(无标题)"}」吗?`, () => {
          state.memos = state.memos.filter((x) => x.id !== m.id);
          save(); renderMemos(); toast("已删除");
        });
        return;
      }
      if (open) {
        const m = state.memos.find((x) => x.id === open.dataset.openMemo);
        if (m) openMemoModal(m);
      }
    });

    // 任务
    $("#btn-add-task").addEventListener("click", () => openTaskModal(null));
    $("#task-form").addEventListener("submit", submitTask);
    $("#task-tabs").addEventListener("click", (e) => {
      const btn = e.target.closest("[data-task-tab]");
      if (!btn) return;
      taskTab = btn.dataset.taskTab;
      $$("#task-tabs .seg-btn").forEach((b) => b.classList.toggle("active", b === btn));
      const isDay = taskTab === "day";
      $("#task-date").classList.toggle("hidden", !isDay);
      $("#task-month").classList.toggle("hidden", isDay);
      renderTasks();
    });
    $("#task-date").addEventListener("change", renderTasks);
    $("#task-month").addEventListener("change", renderTasks);
    $("#task-list").addEventListener("click", (e) => {
      const del = e.target.closest("[data-del-task]");
      if (del) {
        const t = state.tasks.find((x) => x.id === del.dataset.delTask);
        if (t) askDelete(`确定删除任务「${t.title}」吗?`, () => {
          state.tasks = state.tasks.filter((x) => x.id !== t.id);
          save(); renderTasks(); toast("已删除");
        });
      }
    });
    $("#task-list").addEventListener("change", (e) => {
      const chk = e.target.closest("[data-toggle-task]");
      if (chk) toggleTask(chk.dataset.toggleTask);
    });
    $("#t-type").addEventListener("change", () => {
      const isDay = $("#t-type").value === "day";
      $("#t-date-label").querySelector("input").type = isDay ? "date" : "month";
      $("#t-date-label").firstChild.textContent = isDay ? "日期" : "月份";
      $("#t-date").value = isDay ? todayStr() : thisMonthStr();
    });

    // 相册
    $("#btn-add-photo").addEventListener("click", openGalleryModal);
    $("#g-file").addEventListener("change", (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const preview = $("#upload-preview");
      if (file.type.startsWith("image/")) {
        const url = URL.createObjectURL(file);
        preview.src = url;
        preview.classList.remove("hidden");
        $("#upload-text").textContent = "已选择: " + file.name;
      }
    });
    $("#gallery-save").addEventListener("click", saveGallery);
    $("#btn-del-cat").addEventListener("click", () => {
      const cat = $("#gallery-cat-filter").value;
      if (!cat) { toast("请先在分类下拉框里选中要删除的分类"); return; }
      const count = state.galleryItems.filter((g) => g.category === cat).length;
      askDelete(`确定删除分类「${cat}」吗?该分类下的 ${count} 张款式图将变为「未分类」。`, () => {
        state.galleryCats = state.galleryCats.filter((c) => c !== cat);
        state.galleryItems.forEach((g) => { if (g.category === cat) g.category = ""; });
        save();
        fillGalleryCatOptions();
        renderGallery();
        toast("分类已删除");
      });
    });
    $("#gallery-new-cat").addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        const name = e.target.value.trim();
        if (!name) return;
        if (!state.galleryCats.includes(name)) {
          state.galleryCats.push(name);
          save();
          fillGalleryCatOptions();
          $("#g-cat").value = name;
          toast("分类「" + name + "」已添加");
        } else {
          toast("这个分类已经存在");
        }
        e.target.value = "";
      }
    });
    $("#gallery-cat-filter").addEventListener("change", renderGallery);
    $("#gallery-grid").addEventListener("click", (e) => {
      const del = e.target.closest("[data-del-gallery]");
      const open = e.target.closest("[data-open-gallery]");
      if (del) {
        e.stopPropagation();
        const g = state.galleryItems.find((x) => x.id === del.dataset.delGallery);
        if (g) askDelete(`确定删除款式图「${g.title || "未命名"}」吗?`, () => {
          state.galleryItems = state.galleryItems.filter((x) => x.id !== g.id);
          save(); renderGallery(); toast("已删除");
        });
        return;
      }
      if (open) openGalleryView(open.dataset.openGallery);
    });
    $("#gv-delete").addEventListener("click", () => {
      const id = $("#gv-delete").dataset.galleryId;
      const g = state.galleryItems.find((x) => x.id === id);
      if (!g) return;
      $("#gallery-view-modal").classList.add("hidden");
      askDelete(`确定删除款式图「${g.title || "未命名"}」吗?`, () => {
        state.galleryItems = state.galleryItems.filter((x) => x.id !== g.id);
        save(); renderGallery(); toast("已删除");
      });
    });

    // 删除确认
    $("#confirm-ok").addEventListener("click", () => {
      if (pendingDelete) pendingDelete();
      pendingDelete = null;
      $("#confirm-modal").classList.add("hidden");
    });

    // 导出 / 导入
    ["btn-export", "btn-export-mob"].forEach((id) => $("#" + id).addEventListener("click", exportData));
    ["btn-import", "btn-import-mob"].forEach((id) => $("#" + id).addEventListener("click", () => $("#import-file").click()));
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
    fillGalleryCatOptions();
    switchView("dashboard");
    checkExpiryReminder();
    syncFromServer();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
