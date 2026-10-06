/* ============================================================
   Omi Bhai — shared helpers (har page isko use karta hai)
   ============================================================ */
(function () {
  "use strict";

  function omiConfig() {
    var c = window.OMI_CONFIG || {};
    var url = c.SUPABASE_URL || "";
    var key = c.SUPABASE_ANON_KEY || "";
    if (!url || !key || url.indexOf("TUMHARI") !== -1 || key.indexOf("TUMHARI") !== -1) {
      throw new Error("CONFIG_MISSING");
    }
    return { url: url, key: key };
  }

  var _sb = null;
  function getSupabase() {
    if (_sb) return _sb;
    var c = omiConfig();
    _sb = window.supabase.createClient(c.url, c.key);
    return _sb;
  }

  async function getMyProfile(sb, userId) {
    var res = await sb.from("profiles").select("*").eq("id", userId).maybeSingle();
    if (res.error) throw res.error;
    return res.data;
  }

  /* Staff pages ke liye guard: login + approved hona zaroori */
  async function guardStaff() {
    var sb = getSupabase();
    var sess = await sb.auth.getSession();
    if (!sess.data.session) { window.location.href = "index.html"; return null; }
    var p = await getMyProfile(sb, sess.data.session.user.id);
    if (!p || !p.approved) { showWaiting(sb); return null; }
    return { sb: sb, session: sess.data.session, profile: p };
  }

  /* Admin page ke liye guard: admin hona zaroori */
  async function guardAdmin() {
    var g = await guardStaff();
    if (!g) return null;
    if (!g.profile.is_admin) { window.location.href = "app.html"; return null; }
    return g;
  }

  function showWaiting(sb) {
    document.body.innerHTML =
      '<div class="wrap"><header class="brand"><div class="logo">⚡</div>' +
      '<h1>OMI BHAI</h1><p class="tagline">Customer Manager</p></header>' +
      '<div class="card center"><h2>⏳ Approval ka intezaar hai</h2>' +
      '<p>Tumhari request owner ke paas chali gayi hai.<br>' +
      'Approve hote hi tumhara login kaam karega.</p>' +
      '<button class="btn btn-ghost" id="wLogout">Logout</button></div></div>' +
      '<div id="toast"></div>';
    document.getElementById("wLogout").onclick = async function () {
      await sb.auth.signOut();
      window.location.href = "index.html";
    };
  }

  function showConfigError() {
    var el = document.getElementById("cfgWarn");
    if (el) el.classList.remove("hidden");
  }

  function toast(msg, kind) {
    var t = document.getElementById("toast");
    if (!t) { alert(msg); return; }
    t.textContent = msg;
    t.className = "show " + (kind || "");
    clearTimeout(t._h);
    t._h = setTimeout(function () { t.className = ""; }, 2800);
  }

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  /* Search term se khatarnaak characters hatao (query na toote) */
  function sanitizeLike(term) {
    return String(term || "").replace(/[%_\\()"',;]/g, "").trim().slice(0, 60);
  }

  function debounce(fn, ms) {
    var h;
    return function () {
      var a = arguments, self = this;
      clearTimeout(h);
      h = setTimeout(function () { fn.apply(self, a); }, ms);
    };
  }

  function fmtDate(iso) {
    if (!iso) return "—";
    var d = new Date(iso + "T00:00:00");
    if (isNaN(d.getTime())) return esc(iso);
    var M = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    return d.getDate() + " " + M[d.getMonth()] + " " + d.getFullYear();
  }

  async function logout(sb) {
    await sb.auth.signOut();
    window.location.href = "index.html";
  }

  /* ---- CSV parser (quotes aur comma dono handle karta hai) ---- */
  function parseCSV(text) {
    var rows = [], row = [], val = "", inQ = false, i, ch;
    text = String(text || "").replace(/^\uFEFF/, "");
    for (i = 0; i < text.length; i++) {
      ch = text[i];
      if (inQ) {
        if (ch === '"') {
          if (text[i + 1] === '"') { val += '"'; i++; }
          else { inQ = false; }
        } else { val += ch; }
      } else if (ch === '"') { inQ = true; }
      else if (ch === ",") { row.push(val); val = ""; }
      else if (ch === "\n") { row.push(val); rows.push(row); row = []; val = ""; }
      else if (ch !== "\r") { val += ch; }
    }
    if (val !== "" || row.length > 0) { row.push(val); rows.push(row); }
    return rows.filter(function (r) {
      return r.some(function (c) { return String(c).trim() !== ""; });
    });
  }

  function normHeader(h) {
    return String(h || "").toLowerCase().replace(/[^a-z]/g, "");
  }

  /* CSV ki header row ko hamare fields se milao */
  function mapRow(headers, cells) {
    var obj = {};
    headers.forEach(function (h, i) { obj[h] = (cells[i] || "").trim(); });
    function pick() {
      for (var k = 0; k < arguments.length; k++) {
        if (obj[arguments[k]]) return obj[arguments[k]];
      }
      return "";
    }
    return {
      name:         pick("name", "fullname", "customername", "customer"),
      phone:        pick("phone", "phoneno", "mobile", "mobileno", "number", "contact", "contactno"),
      address:      pick("address", "pata", "location"),
      city:         pick("city", "sheher", "town"),
      cnic:         pick("cnic", "nic", "idcard", "idcardno"),
      service_date: pick("servicedate", "date", "serviced", "servicingdate") || null
    };
  }

  /* Customer cards render karo (shared) */
  function renderCustomers(el, rows, handlers) {
    handlers = handlers || {};
    if (!rows || !rows.length) {
      el.innerHTML = '<div class="empty">📭 Koi record nahi mila.<br><span>Naya customer add karo ya search badlo.</span></div>';
      el.onclick = null;
      return;
    }
    el.innerHTML = rows.map(function (c) {
      return '<article class="cust">'
        + '<div class="cust-head"><h3>' + esc(c.name) + '</h3>'
        + (c.city ? '<span class="badge">' + esc(c.city) + '</span>' : '')
        + '</div>'
        + '<a class="phone" href="tel:' + esc(c.phone) + '">📞 ' + esc(c.phone) + '</a>'
        + (c.address ? '<p class="muted">📍 ' + esc(c.address) + '</p>' : '')
        + '<div class="meta">'
        + (c.cnic ? '<span>🪪 ' + esc(c.cnic) + '</span>' : '')
        + (c.service_date ? '<span>🛠️ ' + fmtDate(c.service_date) + '</span>' : '')
        + '</div>'
        + '<div class="cust-actions">'
        + (handlers.onEdit ? '<button class="btn btn-small btn-ghost" data-act="edit" data-id="' + c.id + '">✏️ Edit</button>' : '')
        + (handlers.onDelete ? '<button class="btn btn-small btn-danger" data-act="del" data-id="' + c.id + '">🗑 Delete</button>' : '')
        + '</div></article>';
    }).join("");
    el.onclick = function (e) {
      var b = e.target.closest ? e.target.closest("[data-act]") : null;
      if (!b) return;
      var id = b.getAttribute("data-id");
      var rec = null;
      for (var i = 0; i < rows.length; i++) { if (rows[i].id === id) { rec = rows[i]; break; } }
      if (!rec) return;
      if (b.getAttribute("data-act") === "edit" && handlers.onEdit) handlers.onEdit(rec);
      if (b.getAttribute("data-act") === "del" && handlers.onDelete) handlers.onDelete(rec);
    };
  }

  window.OmiApp = {
    getSupabase: getSupabase,
    getMyProfile: getMyProfile,
    guardStaff: guardStaff,
    guardAdmin: guardAdmin,
    showConfigError: showConfigError,
    toast: toast,
    esc: esc,
    sanitizeLike: sanitizeLike,
    debounce: debounce,
    fmtDate: fmtDate,
    logout: logout,
    parseCSV: parseCSV,
    normHeader: normHeader,
    mapRow: mapRow,
    renderCustomers: renderCustomers
  };
})();
