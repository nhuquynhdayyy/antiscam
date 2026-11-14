/**
 * AntiScam - Chế độ Gia đình (End-to-End & Mock cục bộ)
 * Lưu ý bảo mật: chỉ dùng createElement/textContent/createTextNode,
 * chỉ giữ token trong biến JS, không ghi PIN/token ra console.
 */
(function () {
  window.AntiScam = window.AntiScam || {};

  const params = new URLSearchParams(location.search);
  const IS_MOCK = params.get("mock") === "1";

  const SCAM_LABELS = {
    none: "Không xác định",
    fake_job_deposit: "Việc làm đặt cọc",
    fake_police_bank: "Giả danh công an / ngân hàng",
    fake_authority: "Giả danh cơ quan chức năng",
    investment_crypto: "Đầu tư tiền ảo",
    romance: "Lừa tình cảm",
    online_shopping: "Mua bán online",
    fake_receipt: "Biên lai giả",
    phishing_link: "Đường link giả mạo",
    fake_booking: "Đặt phòng/tour giả",
    prompt_injection: "Tin chèn lệnh",
    other: "Dấu hiệu lừa đảo"
  };

  const SIMULATE_OPTIONS = [
    { id: "danger_deposit", label: "Việc làm đặt cọc (Nguy hiểm)" },
    { id: "danger_injection", label: "Giả mạo mở khóa STK (Nguy hiểm)" },
    { id: "suspicious_booking", label: "Đặt phòng giá rẻ (Đáng ngờ)" },
    { id: "safe_meal", label: "Tin nhắn gia đình (An toàn)" }
  ];

  // Trạng thái phiên trong bộ nhớ JS (tải lại trang phải đăng nhập lại)
  let authToken = null;
  let currentUser = null;
  let meProfile = null;
  let familyAvailable = true;
  let lastErrorMsg = "";
  let retryAction = null;

  // Trạng thái Máy Con
  let alertsList = [];
  let maxAlertId = 0;
  let alertsPollTimer = null;
  let alertsBackoffMs = 3000;
  let alertsPollReqId = 0;

  // Trạng thái lớp phủ showStop
  let activeIncident = null;
  let stopCountdownTimer = null;
  let incidentsPollTimer = null;
  let incidentsPollReqId = 0;

  // Kênh giả lập cục bộ cho ?mock=1
  const mockChannel =
    IS_MOCK && typeof BroadcastChannel !== "undefined"
      ? new BroadcastChannel("antiscam_family_mock")
      : null;
  let mockConsent = false;
  let mockIncidentSeq = 1;
  let mockDeliverySeq = 1;
  let mockLocalTimer = null;

  function $(id) {
    return document.getElementById(id);
  }

  function showToast(msg) {
    if (window.AntiScam && typeof window.AntiScam.showToast === "function") {
      window.AntiScam.showToast(msg);
    }
  }

  function formatScamType(code) {
    return SCAM_LABELS[code] || "Cảnh báo lừa đảo";
  }

  function formatTime(isoStr) {
    if (!isoStr) return "";
    try {
      const d = new Date(isoStr);
      if (isNaN(d.getTime())) return "";
      return d.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    } catch (e) {
      return "";
    }
  }

  /**
   * Tô sáng evidence bằng indexOf trên summary gốc, gộp khoảng chồng rồi bọc <mark>
   */
  function appendHighlightedText(container, summary, evidenceList) {
    const text = String(summary || "");
    if (!text) return;

    const list = Array.isArray(evidenceList) ? evidenceList : [];
    const intervals = [];

    list.forEach(function (ev) {
      const needle = String(ev || "");
      if (!needle) return;
      let start = 0;
      while (start < text.length) {
        const idx = text.indexOf(needle, start);
        if (idx === -1) break;
        intervals.push([idx, idx + needle.length]);
        start = idx + needle.length;
      }
    });

    if (intervals.length === 0) {
      container.appendChild(document.createTextNode(text));
      return;
    }

    intervals.sort(function (a, b) {
      return a[0] - b[0] || a[1] - b[1];
    });

    const merged = [intervals[0]];
    for (let i = 1; i < intervals.length; i++) {
      const prev = merged[merged.length - 1];
      const curr = intervals[i];
      if (curr[0] <= prev[1]) {
        prev[1] = Math.max(prev[1], curr[1]);
      } else {
        merged.push(curr);
      }
    }

    let cursor = 0;
    merged.forEach(function (range) {
      if (range[0] > cursor) {
        container.appendChild(document.createTextNode(text.slice(cursor, range[0])));
      }
      const mark = document.createElement("mark");
      mark.textContent = text.slice(range[0], range[1]);
      container.appendChild(mark);
      cursor = range[1];
    });

    if (cursor < text.length) {
      container.appendChild(document.createTextNode(text.slice(cursor)));
    }
  }

  function FriendlyError(message, status) {
    this.name = "FriendlyError";
    this.message = message;
    this.status = status || 0;
  }

  async function apiRequest(path, options) {
    options = options || {};
    const controller = new AbortController();
    const externalSignal = options.signal;
    if (externalSignal) {
      if (externalSignal.aborted) controller.abort();
      else externalSignal.addEventListener("abort", function () { controller.abort(); }, { once: true });
    }

    const timer = setTimeout(function () {
      controller.abort();
    }, 10000);

    const headers = { "Content-Type": "application/json" };
    if (authToken) {
      headers["Authorization"] = "Bearer " + authToken;
    }

    let res;
    try {
      res = await fetch(path, {
        method: options.method || "GET",
        headers: headers,
        body: options.body ? JSON.stringify(options.body) : undefined,
        signal: controller.signal
      });
    } catch (err) {
      clearTimeout(timer);
      if (err && err.name === "AbortError") {
        throw err;
      }
      throw new FriendlyError("Không thể kết nối máy chủ. Vui lòng kiểm tra mạng và thử lại.", 0);
    }
    clearTimeout(timer);

    if (res.status === 404) {
      throw new FriendlyError("Chế độ gia đình chưa sẵn sàng.", 404);
    }
    if (res.status === 401) {
      if (!options.isLogin) {
        logout("Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.");
      }
      throw new FriendlyError("Thông tin đăng nhập không đúng hoặc phiên đã hết hạn.", 401);
    }
    if (res.status === 403) {
      throw new FriendlyError("Tài khoản hiện tại không có quyền thực hiện thao tác này.", 403);
    }
    if (res.status === 429) {
      throw new FriendlyError("Bạn thao tác quá nhanh. Vui lòng đợi một lát rồi thử lại.", 429);
    }
    if (!res.ok) {
      throw new FriendlyError("Hệ thống đang bận. Vui lòng thử lại sau.", res.status);
    }

    return res.json();
  }

  function stopAllTimers() {
    if (alertsPollTimer) {
      clearTimeout(alertsPollTimer);
      alertsPollTimer = null;
    }
    if (incidentsPollTimer) {
      clearTimeout(incidentsPollTimer);
      incidentsPollTimer = null;
    }
    if (stopCountdownTimer) {
      clearInterval(stopCountdownTimer);
      stopCountdownTimer = null;
    }
    if (mockLocalTimer) {
      clearTimeout(mockLocalTimer);
      mockLocalTimer = null;
    }
  }

  function closeStopOverlay() {
    const overlay = $("stop-overlay");
    if (overlay) {
      overlay.classList.add("hidden");
      overlay.replaceChildren();
    }
    activeIncident = null;
    if (stopCountdownTimer) {
      clearInterval(stopCountdownTimer);
      stopCountdownTimer = null;
    }
    if (incidentsPollTimer) {
      clearTimeout(incidentsPollTimer);
      incidentsPollTimer = null;
    }
  }

  function logout(reasonMsg) {
    stopAllTimers();
    closeStopOverlay();
    authToken = null;
    currentUser = null;
    meProfile = null;
    alertsList = [];
    maxAlertId = 0;
    lastErrorMsg = reasonMsg || "";
    retryAction = null;
    toggleRoleLayout();
    renderFamilyPanel();
  }

  function toggleRoleLayout() {
    const tabsNav = document.querySelector(".tabs-nav");
    const tabCheck = $("tab-check");
    const tabGuard = $("tab-guard");
    const resultBox = $("result");
    const isGuardian = Boolean(currentUser && currentUser.role === "guardian");

    if (tabsNav) tabsNav.classList.toggle("hidden", isGuardian);
    if (tabCheck) tabCheck.classList.toggle("hidden", isGuardian);
    if (tabGuard && isGuardian) tabGuard.classList.add("hidden");
    if (resultBox && isGuardian) resultBox.classList.add("hidden");
  }

  function updateGuardianNotification(newAlerts) {
    if (!Array.isArray(newAlerts) || newAlerts.length === 0) return;
    try {
      if (typeof Notification !== "undefined" && Notification.permission === "granted") {
        const latest = newAlerts[newAlerts.length - 1];
        new Notification("⛔ Mẹ vừa nhận tin nguy hiểm", {
          body: formatScamType(latest.scam_type)
        });
      }
    } catch (e) {
      // Bỏ qua nếu trình duyệt không hỗ trợ Notification
    }
  }

  async function handleCancelDelivery(incidentId, guardianId, btn) {
    if (IS_MOCK) {
      if (!activeIncident || activeIncident.id !== incidentId) return;
      activeIncident.deliveries.forEach(function (d) {
        if (d.guardian_id === guardianId && d.status === "pending") {
          d.status = "cancelled";
        }
      });
      renderStopOverlay();
      return;
    }

    if (btn) btn.disabled = true;
    try {
      const res = await apiRequest("/family/incidents/" + incidentId + "/cancel", {
        method: "POST",
        body: { guardian: guardianId }
      });
      if (res && res.incident) {
        activeIncident = res.incident;
        renderStopOverlay();
      }
    } catch (err) {
      showToast((err && err.message) || "Không thể hủy cảnh báo lúc này.");
      if (btn) btn.disabled = false;
    }
  }

  async function handleSendNowDelivery(incidentId, guardianId, btn) {
    if (IS_MOCK) {
      if (!activeIncident || activeIncident.id !== incidentId) return;
      activeIncident.deliveries.forEach(function (d) {
        if (d.guardian_id === guardianId && (d.status === "not_sent" || d.status === "pending")) {
          d.status = "sent";
          if (mockChannel) {
            mockChannel.postMessage({ type: "mock_alert", delivery: d, incident: activeIncident });
          }
        }
      });
      renderStopOverlay();
      return;
    }

    if (btn) btn.disabled = true;
    try {
      const res = await apiRequest("/family/incidents/" + incidentId + "/send", {
        method: "POST",
        body: { guardian: guardianId }
      });
      if (res && res.incident) {
        activeIncident = res.incident;
        renderStopOverlay();
      }
    } catch (err) {
      showToast((err && err.message) || "Không thể gửi cảnh báo lúc này.");
      if (btn) btn.disabled = false;
    }
  }

  function renderStopOverlay() {
    const overlay = $("stop-overlay");
    if (!overlay || !activeIncident) return;

    overlay.classList.remove("hidden");
    overlay.replaceChildren();

    const modal = document.createElement("div");
    modal.className = "stop-modal";

    const header = document.createElement("div");
    header.className = "stop-header";

    const title = document.createElement("h2");
    title.className = "stop-title";
    title.textContent = "DỪNG LẠI! Dấu hiệu lừa đảo";

    const sub = document.createElement("p");
    sub.className = "stop-sub";
    sub.textContent = "Kịch bản: " + formatScamType(activeIncident.scam_type);

    header.append(title, sub);

    const summaryBox = document.createElement("div");
    summaryBox.className = "stop-summary";
    appendHighlightedText(summaryBox, activeIncident.summary, activeIncident.evidence);

    const listTitle = document.createElement("h3");
    listTitle.className = "stop-list-title";
    listTitle.textContent = "Trạng thái báo cho người thân";

    const list = document.createElement("div");
    list.className = "stop-delivery-list";

    const deliveries = Array.isArray(activeIncident.deliveries) ? activeIncident.deliveries : [];
    const nowMs = Date.now();

    deliveries.forEach(function (d) {
      const row = document.createElement("div");
      row.className = "stop-delivery-row";

      const info = document.createElement("div");
      info.className = "stop-delivery-info";

      const nameEl = document.createElement("strong");
      nameEl.textContent = d.guardian_name || d.guardian_id;

      const statusEl = document.createElement("span");
      statusEl.className = "stop-status-tag status-" + d.status;

      const actions = document.createElement("div");
      actions.className = "stop-delivery-actions";

      if (d.status === "pending" && d.send_at) {
        const remainSec = Math.max(0, Math.ceil((new Date(d.send_at).getTime() - nowMs) / 1000));
        if (remainSec > 0) {
          statusEl.textContent = "Tự động báo sau " + remainSec + " giây";
          const cancelBtn = document.createElement("button");
          cancelBtn.type = "button";
          cancelBtn.className = "btn stop-btn-cancel";
          cancelBtn.textContent = "Hủy";
          cancelBtn.onclick = function () {
            handleCancelDelivery(activeIncident.id, d.guardian_id, cancelBtn);
          };
          actions.appendChild(cancelBtn);
        } else {
          statusEl.textContent = "Đang gửi...";
        }
      } else if (d.status === "not_sent") {
        statusEl.textContent = "Chưa gửi";
        const sendBtn = document.createElement("button");
        sendBtn.type = "button";
        sendBtn.className = "btn primary stop-btn-send";
        sendBtn.textContent = "Báo";
        sendBtn.onclick = function () {
          handleSendNowDelivery(activeIncident.id, d.guardian_id, sendBtn);
        };
        actions.appendChild(sendBtn);
      } else if (d.status === "sent") {
        statusEl.textContent = "Đã báo";
      } else if (d.status === "acked") {
        statusEl.textContent = "Đã liên hệ";
      } else if (d.status === "cancelled") {
        statusEl.textContent = "Đã hủy";
      } else {
        statusEl.textContent = d.status || "";
      }

      info.append(nameEl, statusEl);
      row.append(info, actions);
      list.appendChild(row);
    });

    const footer = document.createElement("div");
    footer.className = "stop-footer";

    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "btn primary";
    closeBtn.textContent = "Xem phân tích scam ở chỗ nào";
    closeBtn.onclick = function () {
      closeStopOverlay();
      const resultBox = $("result");
      if (resultBox && !resultBox.classList.contains("hidden")) {
        resultBox.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    };
    footer.appendChild(closeBtn);

    modal.append(header, summaryBox, listTitle, list, footer);
    overlay.appendChild(modal);
  }

  async function pollIncidentsWhileOpen() {
    if (!activeIncident || !authToken || IS_MOCK) return;
    const reqId = ++incidentsPollReqId;
    try {
      const data = await apiRequest("/family/incidents", { method: "GET" });
      if (reqId !== incidentsPollReqId || !activeIncident) return;
      const list = Array.isArray(data.incidents) ? data.incidents : [];
      const updated = list.find(function (inc) {
        return inc.id === activeIncident.id;
      });
      if (updated) {
        activeIncident = updated;
        renderStopOverlay();
      }
    } catch (err) {
      // Bỏ qua lỗi poll tạm thời khi đang mở lớp phủ
    }
    if (activeIncident && authToken && !IS_MOCK) {
      incidentsPollTimer = setTimeout(pollIncidentsWhileOpen, 3000);
    }
  }

  function showStop(incident) {
    if (!incident) return;
    activeIncident = incident;
    renderStopOverlay();

    if (stopCountdownTimer) clearInterval(stopCountdownTimer);
    stopCountdownTimer = setInterval(function () {
      if (!activeIncident) {
        clearInterval(stopCountdownTimer);
        stopCountdownTimer = null;
        return;
      }
      renderStopOverlay();
    }, 1000);

    if (!IS_MOCK && authToken) {
      if (incidentsPollTimer) clearTimeout(incidentsPollTimer);
      incidentsPollTimer = setTimeout(pollIncidentsWhileOpen, 3000);
    }
  }

  function scheduleAlertsPoll() {
    if (!authToken || !currentUser || currentUser.role !== "guardian" || IS_MOCK) return;
    if (alertsPollTimer) clearTimeout(alertsPollTimer);
    const delay = document.hidden ? Math.max(10000, alertsBackoffMs) : alertsBackoffMs;
    alertsPollTimer = setTimeout(pollGuardianAlerts, delay);
  }

  async function pollGuardianAlerts() {
    if (!authToken || !currentUser || currentUser.role !== "guardian" || IS_MOCK) return;
    const reqId = ++alertsPollReqId;
    try {
      const data = await apiRequest("/family/alerts?after=" + maxAlertId, { method: "GET" });
      if (reqId !== alertsPollReqId) return;
      alertsBackoffMs = 3000;
      lastErrorMsg = "";
      retryAction = null;

      const incoming = Array.isArray(data.alerts) ? data.alerts : [];
      if (incoming.length > 0) {
        incoming.forEach(function (a) {
          const existingIdx = alertsList.findIndex(function (x) { return x.id === a.id; });
          if (existingIdx !== -1) {
            alertsList[existingIdx] = a;
          } else {
            alertsList.push(a);
          }
          if (a.id > maxAlertId) maxAlertId = a.id;
        });
        updateGuardianNotification(incoming);
      }
      renderFamilyPanel();
    } catch (err) {
      if (reqId !== alertsPollReqId) return;
      if (err && err.status === 401) return;
      alertsBackoffMs = Math.min(30000, alertsBackoffMs * 2);
      lastErrorMsg = (err && err.message) || "Không thể tải cảnh báo mới.";
      retryAction = function () {
        alertsBackoffMs = 3000;
        pollGuardianAlerts();
      };
      renderFamilyPanel();
    }
    scheduleAlertsPoll();
  }

  async function handleAckAlert(alertId, btn) {
    if (IS_MOCK) {
      alertsList.forEach(function (a) {
        if (a.id === alertId) a.status = "acked";
      });
      if (mockChannel) {
        mockChannel.postMessage({ type: "mock_ack", deliveryId: alertId });
      }
      renderFamilyPanel();
      return;
    }

    if (btn) btn.disabled = true;
    try {
      await apiRequest("/family/alerts/" + alertId + "/ack", {
        method: "POST",
        body: { status: "contacted" }
      });
      alertsList.forEach(function (a) {
        if (a.id === alertId) a.status = "acked";
      });
      renderFamilyPanel();
      showToast("Đã xác nhận liên hệ với Mẹ");
    } catch (err) {
      showToast((err && err.message) || "Không thể cập nhật trạng thái.");
      if (btn) btn.disabled = false;
    }
  }

  function renderErrorBanner(parent) {
    if (!lastErrorMsg) return;
    const errBox = document.createElement("div");
    errBox.className = "family-error-banner";

    const msg = document.createElement("span");
    msg.textContent = lastErrorMsg;
    errBox.appendChild(msg);

    if (typeof retryAction === "function") {
      const retryBtn = document.createElement("button");
      retryBtn.type = "button";
      retryBtn.className = "btn";
      retryBtn.textContent = "Thử lại";
      retryBtn.onclick = retryAction;
      errBox.appendChild(retryBtn);
    }
    parent.appendChild(errBox);
  }

  function renderLoginView(panel) {
    const header = document.createElement("div");
    header.className = "family-header";

    const title = document.createElement("h2");
    title.className = "family-title";
    title.textContent = "Đăng nhập demo";

    const note = document.createElement("p");
    note.className = "meta";
    note.textContent = "Tài khoản demo, dữ liệu giả.";

    header.append(title, note);
    panel.appendChild(header);
    renderErrorBanner(panel);

    const accounts = [
      { id: "me", label: "Mẹ Hoa" },
      { id: "lan", label: "Con gái Lan" },
      { id: "hung", label: "Chú Hùng" }
    ];

    let selectedUser = "me";

    const btnGroup = document.createElement("div");
    btnGroup.className = "family-account-btns";

    accounts.forEach(function (acc) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "btn" + (acc.id === selectedUser ? " primary" : "");
      b.textContent = acc.label;
      b.onclick = function () {
        selectedUser = acc.id;
        Array.from(btnGroup.children).forEach(function (child) {
          child.classList.remove("primary");
        });
        b.classList.add("primary");
      };
      btnGroup.appendChild(b);
    });

    const formRow = document.createElement("form");
    formRow.className = "family-login-form";

    const pinInput = document.createElement("input");
    pinInput.type = "password";
    pinInput.className = "family-pin-input";
    pinInput.placeholder = "Nhập mã PIN demo";
    pinInput.autocomplete = "off";

    const submitBtn = document.createElement("button");
    submitBtn.type = "submit";
    submitBtn.className = "btn primary";
    submitBtn.textContent = "Vào chế độ gia đình";

    formRow.onsubmit = async function (e) {
      e.preventDefault();
      const pin = pinInput.value.trim();
      if (!pin) {
        lastErrorMsg = "Vui lòng nhập mã PIN.";
        renderFamilyPanel();
        return;
      }

      if (IS_MOCK) {
        const mockUsers = {
          me: { id: "me", name: "Mẹ Hoa", role: "protected" },
          lan: { id: "lan", name: "Con gái Lan", role: "guardian" },
          hung: { id: "hung", name: "Chú Hùng", role: "guardian" }
        };
        currentUser = mockUsers[selectedUser];
        authToken = "mock-token";
        lastErrorMsg = "";
        toggleRoleLayout();
        renderFamilyPanel();
        return;
      }

      submitBtn.disabled = true;
      lastErrorMsg = "";
      retryAction = null;
      try {
        const data = await apiRequest("/family/login", {
          method: "POST",
          isLogin: true,
          body: { user: selectedUser, pin: pin }
        });
        pinInput.value = "";
        authToken = data.token;
        currentUser = data.user;
        toggleRoleLayout();

        if (currentUser.role === "protected") {
          meProfile = await apiRequest("/family/me", { method: "GET" });
        } else {
          alertsList = [];
          maxAlertId = 0;
          alertsBackoffMs = 3000;
          pollGuardianAlerts();
        }
        renderFamilyPanel();
      } catch (err) {
        pinInput.value = "";
        lastErrorMsg = (err && err.message) || "Đăng nhập không thành công.";
        renderFamilyPanel();
      } finally {
        submitBtn.disabled = false;
      }
    };

    formRow.append(pinInput, submitBtn);
    panel.append(btnGroup, formRow);
  }

  function renderProtectedView(panel) {
    const header = document.createElement("div");
    header.className = "family-header-row";

    const title = document.createElement("h2");
    title.className = "family-title";
    title.textContent = "Chế độ Gia đình — " + currentUser.name;

    const logoutBtn = document.createElement("button");
    logoutBtn.type = "button";
    logoutBtn.className = "btn";
    logoutBtn.textContent = "Đăng xuất";
    logoutBtn.onclick = function () {
      logout("");
    };

    header.append(title, logoutBtn);
    panel.appendChild(header);
    renderErrorBanner(panel);

    const consentVal = IS_MOCK ? mockConsent : Boolean(meProfile && meProfile.consent);

    const consentRow = document.createElement("label");
    consentRow.className = "family-consent-row";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = consentVal;
    checkbox.onchange = async function () {
      const nextVal = checkbox.checked;
      if (IS_MOCK) {
        mockConsent = nextVal;
        return;
      }
      checkbox.disabled = true;
      try {
        const res = await apiRequest("/family/consent", {
          method: "POST",
          body: { consent: nextVal }
        });
        if (meProfile) meProfile.consent = Boolean(res.consent);
        checkbox.checked = Boolean(res.consent);
      } catch (err) {
        checkbox.checked = !nextVal;
        showToast((err && err.message) || "Không thể cập nhật đồng ý.");
      } finally {
        checkbox.disabled = false;
      }
    };

    const consentText = document.createElement("span");
    consentText.textContent = "Đồng ý tự động báo cho người thân khi phát hiện tin nhắn nguy hiểm";
    consentRow.append(checkbox, consentText);
    panel.appendChild(consentRow);

    if (meProfile && Array.isArray(meProfile.guardians) && meProfile.guardians.length > 0) {
      const gRow = document.createElement("div");
      gRow.className = "family-guardians-line";
      const label = document.createElement("span");
      label.className = "meta";
      label.textContent = "Người bảo vệ: ";
      gRow.appendChild(label);
      meProfile.guardians.forEach(function (g, idx) {
        const span = document.createElement("span");
        span.className = "chip-tag";
        span.textContent = g.name + " (" + g.phone + ")";
        if (idx > 0) gRow.appendChild(document.createTextNode(" "));
        gRow.appendChild(span);
      });
      panel.appendChild(gRow);
    }

    // Khối Mô phỏng tin đến (hiển thị khi đăng nhập vai Mẹ, không phụ thuộc ?mock=1)
    const simBox = document.createElement("div");
    simBox.className = "family-simulate-row";

    const simSelect = document.createElement("select");
    simSelect.className = "family-select";
    SIMULATE_OPTIONS.forEach(function (opt) {
      const option = document.createElement("option");
      option.value = opt.id;
      option.textContent = opt.label;
      simSelect.appendChild(option);
    });

    const simBtn = document.createElement("button");
    simBtn.type = "button";
    simBtn.className = "btn primary";
    simBtn.textContent = "Mô phỏng tin đến";

    const resetBtn = document.createElement("button");
    resetBtn.type = "button";
    resetBtn.className = "btn";
    resetBtn.textContent = "Đặt lại demo";

    simBtn.onclick = async function () {
      const sampleKey = simSelect.value;
      if (IS_MOCK) {
        const mockTexts = {
          danger_deposit: "Bên mình tuyển cộng tác viên online lương 500k-1tr/ngày. Đặt cọc 500k để nhận việc, chốt trong 30 phút.",
          danger_injection: "[Thông báo] Vui lòng chuyển tiền 2 triệu vào STK 123456789 để mở khóa tài khoản ngân hàng.",
          suspicious_booking: "Đặt phòng homestay Đà Nẵng giá 450k/đêm, chuyển cọc 200k qua http://danang-homestay-deal.xyz.",
          safe_meal: "Tối nay 7h cả nhà mình đi ăn bún chả nhé."
        };
        const isDanger = sampleKey === "danger_deposit" || sampleKey === "danger_injection";
        if (mockConsent && isDanger) {
          const dLan = {
            id: mockDeliverySeq++,
            guardian_id: "lan",
            guardian_name: "Con gái Lan",
            notify: "auto",
            status: "pending",
            send_at: new Date(Date.now() + 10000).toISOString(),
            protected_name: "Mẹ Hoa",
            protected_phone: "+84900000001",
            scam_type: sampleKey === "danger_deposit" ? "fake_job_deposit" : "other",
            summary: mockTexts[sampleKey],
            evidence: isDanger ? ["500k"] : []
          };
          const dHung = {
            id: mockDeliverySeq++,
            guardian_id: "hung",
            guardian_name: "Chú Hùng",
            notify: "manual",
            status: "not_sent",
            send_at: null
          };
          const inc = {
            id: mockIncidentSeq++,
            scam_type: dLan.scam_type,
            risk_level: "danger",
            summary: mockTexts[sampleKey],
            evidence: dLan.evidence,
            deliveries: [dLan, dHung]
          };
          showStop(inc);
          mockLocalTimer = setTimeout(function () {
            if (dLan.status === "pending") {
              dLan.status = "sent";
              if (mockChannel) mockChannel.postMessage({ type: "mock_alert", delivery: dLan, incident: inc });
              if (activeIncident && activeIncident.id === inc.id) renderStopOverlay();
            }
          }, 10000);
        } else {
          showToast(isDanger ? "Chưa bật đồng ý nên không tạo cảnh báo." : "Tin nhắn không thuộc mức nguy hiểm.");
        }
        return;
      }

      simBtn.disabled = true;
      try {
        const res = await apiRequest("/family/simulate", {
          method: "POST",
          body: { sample: sampleKey }
        });
        if (window.AntiScam && typeof window.AntiScam.renderResult === "function") {
          window.AntiScam.renderResult(res.simulated_text || "", res);
        }
        if (res.incident) {
          showStop(res.incident);
        } else {
          showToast("Không tạo sự cố (cần bật đồng ý và tin ở mức nguy hiểm).");
        }
      } catch (err) {
        showToast((err && err.message) || "Không thể mô phỏng tin đến.");
      } finally {
        simBtn.disabled = false;
      }
    };

    resetBtn.onclick = async function () {
      if (IS_MOCK) {
        mockConsent = false;
        closeStopOverlay();
        renderFamilyPanel();
        showToast("Đã đặt lại dữ liệu giả");
        return;
      }
      resetBtn.disabled = true;
      try {
        await apiRequest("/family/reset", { method: "POST" });
        if (meProfile) meProfile.consent = false;
        closeStopOverlay();
        renderFamilyPanel();
        showToast("Đã đặt lại trạng thái demo");
      } catch (err) {
        showToast((err && err.message) || "Không thể đặt lại.");
      } finally {
        resetBtn.disabled = false;
      }
    };

    simBox.append(simSelect, simBtn, resetBtn);
    panel.appendChild(simBox);
  }

  function renderGuardianView(panel) {
    const header = document.createElement("div");
    header.className = "family-header-row";

    const title = document.createElement("h2");
    title.className = "family-title";
    title.textContent = "Máy Con — " + currentUser.name;

    const rightBtns = document.createElement("div");
    rightBtns.className = "family-guardian-top-btns";

    const notifBtn = document.createElement("button");
    notifBtn.type = "button";
    notifBtn.className = "btn";
    notifBtn.textContent = "Bật thông báo trình duyệt";
    notifBtn.onclick = function () {
      try {
        if (typeof Notification === "undefined" || !Notification.requestPermission) {
          showToast("Trình duyệt không hỗ trợ thông báo.");
          return;
        }
        Notification.requestPermission().then(function (perm) {
          if (perm === "granted") showToast("Đã bật thông báo trình duyệt");
          else showToast("Chưa cấp quyền thông báo");
        }).catch(function () {});
      } catch (e) {
        // Bỏ qua nếu trình duyệt không hỗ trợ
      }
    };

    const logoutBtn = document.createElement("button");
    logoutBtn.type = "button";
    logoutBtn.className = "btn";
    logoutBtn.textContent = "Đăng xuất";
    logoutBtn.onclick = function () {
      logout("");
    };

    rightBtns.append(notifBtn, logoutBtn);
    header.append(title, rightBtns);
    panel.appendChild(header);
    renderErrorBanner(panel);

    if (alertsList.length === 0) {
      const empty = document.createElement("p");
      empty.className = "history-empty";
      empty.textContent = "Chưa có cảnh báo nào gửi tới bạn.";
      panel.appendChild(empty);
      return;
    }

    const listEl = document.createElement("div");
    listEl.className = "guardian-alerts-list";

    alertsList
      .slice()
      .reverse()
      .forEach(function (alertItem) {
        const bubble = document.createElement("div");
        bubble.className = "guardian-alert-bubble";

        const metaRow = document.createElement("div");
        metaRow.className = "guardian-alert-meta";

        const who = document.createElement("strong");
        who.textContent = (alertItem.protected_name || "Mẹ") + " — " + formatScamType(alertItem.scam_type);

        const timeEl = document.createElement("span");
        timeEl.className = "meta";
        timeEl.textContent = formatTime(alertItem.created_at);

        metaRow.append(who, timeEl);

        const summaryEl = document.createElement("p");
        summaryEl.className = "guardian-alert-summary";
        appendHighlightedText(summaryEl, alertItem.summary, alertItem.evidence);

        const actRow = document.createElement("div");
        actRow.className = "guardian-alert-actions";

        const rawPhone = String(alertItem.protected_phone || "");
        if (/^\+?\d{6,15}$/.test(rawPhone)) {
          const callLink = document.createElement("a");
          callLink.className = "btn primary";
          callLink.href = "tel:" + rawPhone;
          callLink.textContent = "Gọi lại Mẹ";
          actRow.appendChild(callLink);
        }

        const ackBtn = document.createElement("button");
        ackBtn.type = "button";
        ackBtn.className = "btn";
        if (alertItem.status === "acked") {
          ackBtn.textContent = "Đã liên hệ";
          ackBtn.disabled = true;
        } else {
          ackBtn.textContent = "Đã liên hệ";
          ackBtn.onclick = function () {
            handleAckAlert(alertItem.id, ackBtn);
          };
        }
        actRow.appendChild(ackBtn);

        bubble.append(metaRow, summaryEl, actRow);
        listEl.appendChild(bubble);
      });

    panel.appendChild(listEl);
  }

  function renderFamilyPanel() {
    const panel = $("family-panel");
    if (!panel) return;
    panel.classList.remove("hidden");
    panel.replaceChildren();

    if (!IS_MOCK && !familyAvailable) {
      const msg = document.createElement("p");
      msg.className = "meta";
      msg.style.margin = "0";
      msg.textContent = "Chế độ gia đình chưa sẵn sàng";
      panel.appendChild(msg);
      return;
    }

    if (!authToken || !currentUser) {
      renderLoginView(panel);
      return;
    }

    if (currentUser.role === "protected") {
      renderProtectedView(panel);
    } else {
      renderGuardianView(panel);
    }
  }

  async function initFamilyMode() {
    if (IS_MOCK) {
      if (mockChannel) {
        mockChannel.onmessage = function (ev) {
          const msg = ev.data || {};
          if (msg.type === "mock_alert" && currentUser && currentUser.id === msg.delivery.guardian_id) {
            alertsList.push(msg.delivery);
            updateGuardianNotification([msg.delivery]);
            renderFamilyPanel();
          } else if (msg.type === "mock_ack" && activeIncident) {
            activeIncident.deliveries.forEach(function (d) {
              if (d.id === msg.deliveryId) d.status = "acked";
            });
            renderStopOverlay();
          }
        };
      }
      renderFamilyPanel();
      return;
    }

    try {
      await apiRequest("/family/me", { method: "GET", isLogin: true });
      familyAvailable = true;
    } catch (err) {
      if (err && err.status === 404) {
        familyAvailable = false;
      } else {
        // 401 hoặc lỗi khác nghĩa là endpoint /family/* đã bật DEMO_FAMILY=1
        familyAvailable = true;
      }
    }
    renderFamilyPanel();
  }

  document.addEventListener("visibilitychange", function () {
    if (currentUser && currentUser.role === "guardian" && authToken && !IS_MOCK) {
      scheduleAlertsPoll();
    }
  });

  window.AntiScam.showStop = showStop;
  window.AntiScam.triggerMockIncident = function (text, data) {
    if (!IS_MOCK || !currentUser || currentUser.role !== "protected") return;
    if (!mockConsent) {
      showToast("Chưa bật đồng ý nên chưa tự động báo cho người thân.");
      return;
    }
    const dLan = {
      id: mockDeliverySeq++,
      guardian_id: "lan",
      guardian_name: "Con gái Lan",
      notify: "auto",
      status: "sent",
      send_at: new Date().toISOString(),
      protected_name: "Mẹ Hoa",
      protected_phone: "+84900000001",
      scam_type: (data && data.scam_type) || "other",
      summary: String(text || "").slice(0, 140),
      evidence: (data && Array.isArray(data.evidence)) ? data.evidence.slice(0, 5) : []
    };
    const dHung = {
      id: mockDeliverySeq++,
      guardian_id: "hung",
      guardian_name: "Chú Hùng",
      notify: "manual",
      status: "not_sent",
      send_at: null
    };
    const inc = {
      id: mockIncidentSeq++,
      scam_type: dLan.scam_type,
      risk_level: "danger",
      summary: dLan.summary,
      evidence: dLan.evidence,
      deliveries: [dLan, dHung]
    };
    if (mockChannel) {
      mockChannel.postMessage({ type: "mock_alert", delivery: dLan, incident: inc });
    }
    showStop(inc);
  };
  window.AntiScam.isProtectedLoggedIn = function () {
    return Boolean(!IS_MOCK && authToken && currentUser && currentUser.role === "protected");
  };
  window.AntiScam.familyCheck = function (text, signal) {
    return apiRequest("/family/check", {
      method: "POST",
      body: { text: text },
      signal: signal
    });
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initFamilyMode);
  } else {
    initFamilyMode();
  }
})();
