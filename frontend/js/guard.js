/**
 * guard.js – Transaction Guard UI (vanilla JS, IIFE, no globals)
 * Thao tác duy nhất trong: #guard-form, #guard-questions, #guard-result
 * KHÔNG sửa CSS hay HTML của người khác.
 *
 * ID/name input giả định (đối chiếu với index.html):
 *   Form        : id="guard-form"
 *   Input STK   : id="guard-account"  hoặc name="account"
 *   Input tiền  : id="guard-amount"   hoặc name="amount"
 *   Input lý do : id="guard-reason"   hoặc name="reason"   (input hoặc textarea)
 *   Nút submit  : id="guard-submit"   hoặc type="submit" trong #guard-form
 *   Vùng hỏi    : id="guard-questions"
 *   Vùng kết quả: id="guard-result"
 */
(function guardModule() {
  "use strict";

  /* ------------------------------------------------------------------ */
  /* 1. Inject style riêng (tiền tố guard-) – không đụng CSS gốc        */
  /* ------------------------------------------------------------------ */
  const STYLE = `
    .guard-hidden   { display: none !important; }
    .guard-field    { margin-bottom: 14px; }
    .guard-label    { display: block; font-size: .9rem; font-weight: 600;
                      margin-bottom: 6px; color: inherit; }
    .guard-input    { width: 100%; box-sizing: border-box; font: inherit;
                      padding: 10px 12px; border-radius: var(--radius-btn, 10px);
                      border: 1px solid var(--border, #e2e6ec);
                      background: var(--card, #fff); color: inherit; }
    .guard-input:focus { outline: none; border-color: var(--accent, #2557d6); }
    .guard-submit   { font: inherit; font-weight: 600; cursor: pointer;
                      border: none; border-radius: var(--radius-btn, 10px);
                      padding: 10px 20px; background: var(--accent, #2557d6);
                      color: #fff; }
    .guard-submit:disabled { opacity: .6; cursor: not-allowed; }
    .guard-badge    { display:inline-block; padding:5px 16px; border-radius:999px;
                      font-weight:700; font-size:1.1rem; margin-bottom:12px; }
    .guard-safe     { background:var(--safe-bg,#e6f5ec);   color:var(--safe,#1a7f4b); }
    .guard-suspicious { background:var(--warn-bg,#fff3dc); color:var(--warn,#b26a00); }
    .guard-danger   { background:var(--danger-bg,#fde8e9); color:var(--danger,#c0262d); }
    .guard-advice   { border-left:4px solid var(--accent,#2557d6); padding:8px 12px;
                      margin:12px 0; background:var(--bg,#f6f7f9); border-radius:6px; }
    .guard-warn-box { border-left:4px solid var(--danger,#c0262d); padding:8px 12px;
                      margin:12px 0; background:var(--danger-bg,#fde8e9); border-radius:6px; }
    .guard-ok-box   { border-left:4px solid var(--safe,#1a7f4b); padding:8px 12px;
                      margin:12px 0; background:var(--safe-bg,#e6f5ec); border-radius:6px; }
    .guard-finding  { font-size:.88rem; color:var(--danger,#c0262d);
                      margin-bottom:4px; padding:3px 0; }
    .guard-q-block  { margin:14px 0; }
    .guard-q-text   { margin-bottom:6px; font-weight:500; }
    .guard-q-btns   { display:flex; gap:8px; }
    .guard-q-btn    { font:inherit; cursor:pointer; border-radius:10px;
                      border:1px solid var(--border,#e2e6ec);
                      background:transparent; color:inherit; padding:7px 20px; }
    .guard-q-btn:disabled { opacity:.6; cursor:not-allowed; }
    .guard-q-btn.selected { background:var(--accent,#2557d6);
                            border-color:var(--accent,#2557d6); color:#fff; }
    .guard-status   { color:var(--muted,#667085); font-size:.88rem; margin-top:8px; }
    .guard-err      { color:var(--danger,#c0262d); font-size:.88rem; margin-top:8px; }
    .guard-reasons-title { margin:10px 0 4px; font-weight:600; }
    .guard-reasons  { margin:8px 0 8px 18px; padding:0; }
    .guard-reasons li { margin-bottom:2px; }
    .guard-actions  { display:flex; gap:10px; flex-wrap:wrap; margin-top:14px; }
    .guard-btn-stop { font:inherit; cursor:pointer; border-radius:10px; padding:8px 18px;
                      background:var(--safe,#1a7f4b); border:1px solid var(--safe,#1a7f4b);
                      color:#fff; font-weight:600; }
    .guard-btn-cont { font:inherit; cursor:pointer; border-radius:10px; padding:8px 18px;
                      background:transparent; border:1px solid var(--border,#e2e6ec);
                      color:var(--danger,#c0262d); }
    .guard-reset    { font:inherit; cursor:pointer; border-radius:10px; padding:7px 16px;
                      background:transparent; border:1px solid var(--border,#e2e6ec);
                      color:inherit; margin-top:14px; font-size:.9rem; }
  `;
  (function injectStyle() {
    const s = document.createElement("style");
    s.textContent = STYLE;
    document.head.appendChild(s);
  })();

  /* ------------------------------------------------------------------ */
  /* 2. Hằng số                                                          */
  /* ------------------------------------------------------------------ */
  const RISK_LABEL = { safe: "An toàn", suspicious: "Đáng ngờ", danger: "Nguy hiểm" };
  const RISK_CLASS = { safe: "guard-safe", suspicious: "guard-suspicious", danger: "guard-danger" };
  const SUBMIT_LABEL = "Kiểm tra giao dịch";
  const MOCK = new URLSearchParams(location.search).get("mock") === "1";

  /* ------------------------------------------------------------------ */
  /* 3. Helpers DOM – chỉ dùng textContent, không dùng innerHTML        */
  /* ------------------------------------------------------------------ */
  function el(tag, props, ...children) {
    const n = document.createElement(tag);
    if (props) Object.assign(n, props);
    for (const c of children) {
      if (c == null) continue;
      n.append(typeof c === "string" ? document.createTextNode(c) : c);
    }
    return n;
  }

  function hide(node) { if (node) node.classList.add("guard-hidden"); }
  function show(node) { if (node) node.classList.remove("guard-hidden"); }
  function clear(node) { if (node) node.replaceChildren(); }

  /* ------------------------------------------------------------------ */
  /* 4. Tìm phần tử trong form (theo id hoặc name)                      */
  /* ------------------------------------------------------------------ */
  function findInput(form, idOrName) {
    return (
      form.querySelector("#" + idOrName) ||
      form.querySelector("[name='" + idOrName + "']") ||
      document.getElementById(idOrName)
    );
  }

  function getFormControls(form) {
    return {
      accEl: findInput(form, "guard-account") || findInput(form, "account"),
      amountEl: findInput(form, "guard-amount") || findInput(form, "amount"),
      reasonEl: findInput(form, "guard-reason") || findInput(form, "reason"),
      submitBtn: form.querySelector("#guard-submit, [type='submit']"),
    };
  }

  function ensureFormFields(form) {
    const existing = getFormControls(form);
    if (existing.accEl && existing.amountEl && existing.reasonEl && existing.submitBtn) {
      return;
    }

    clear(form);

    const accInput = el("input", {
      id: "guard-account",
      name: "account",
      type: "text",
      className: "guard-input",
      placeholder: "Ví dụ: 0123456789",
      autocomplete: "off",
    });
    const amountInput = el("input", {
      id: "guard-amount",
      name: "amount",
      type: "number",
      min: "0",
      step: "1000",
      className: "guard-input",
      placeholder: "Ví dụ: 5000000",
    });
    const reasonInput = el("textarea", {
      id: "guard-reason",
      name: "reason",
      rows: 3,
      className: "guard-input",
      placeholder: "Ví dụ: Đặt cọc nhận việc, chuyển cho công an xác minh...",
    });
    const submitBtn = el("button", {
      id: "guard-submit",
      type: "submit",
      className: "guard-submit",
      textContent: SUBMIT_LABEL,
    });

    form.append(
      el("div", { className: "guard-field" },
        el("label", { htmlFor: "guard-account", className: "guard-label" }, "Số tài khoản người nhận"),
        accInput
      ),
      el("div", { className: "guard-field" },
        el("label", { htmlFor: "guard-amount", className: "guard-label" }, "Số tiền chuyển (VNĐ)"),
        amountInput
      ),
      el("div", { className: "guard-field" },
        el("label", { htmlFor: "guard-reason", className: "guard-label" }, "Lý do chuyển khoản"),
        reasonInput
      ),
      submitBtn
    );
  }

  /* ------------------------------------------------------------------ */
  /* 5. Mock data (khi ?mock=1)                                          */
  /* ------------------------------------------------------------------ */
  function mockStep1(account, amount) {
    const preFindings = [];
    if (account.replace(/\D/g, "") === "0123456789") {
      preFindings.push("Số tài khoản nằm trong danh sách bị tố cáo (dữ liệu demo)");
    }
    if (amount >= 5000000) preFindings.push("Số tiền lớn");
    return new Promise((res) => setTimeout(() => res({
      step: "questions",
      questions: [
        { id: "q1", text: "Bạn đã gặp trực tiếp người này chưa?" },
        { id: "q2", text: "Họ có yêu cầu giữ bí mật hoặc chuyển tiền gấp không?" },
      ],
      pre_findings: preFindings,
    }), 350));
  }

  function mockStep2(payload) {
    const answers = payload.answers || {};
    let score = 0;
    const reasons = [];

    if ((payload.account || "").replace(/\D/g, "") === "0123456789") {
      score += 3;
      reasons.push("Số tài khoản nằm trong danh sách bị tố cáo (dữ liệu demo)");
    }
    if (answers.q1 === false) {
      score += 1;
      reasons.push("Chưa gặp mặt hoặc xác minh được danh tính người nhận");
    }
    if (answers.q2 === true) {
      score += 1;
      reasons.push("Bị yêu cầu giữ bí mật hoặc chuyển tiền gấp");
    }
    if (payload.amount >= 5000000) {
      score += 1;
      reasons.push("Số tiền chuyển lớn (từ 5 triệu đồng trở lên)");
    }

    const level = score >= 2 ? "danger" : score === 1 ? "suspicious" : "safe";
    return new Promise((res) => setTimeout(() => res({
      step: "result",
      risk_level: level,
      reasons: level === "safe"
        ? ["Chưa thấy dấu hiệu bất thường, nhưng hãy tự kiểm tra lại người nhận."]
        : reasons,
      advice: level === "danger"
        ? "Dừng lại, không chuyển tiền. Đây là dấu hiệu lừa đảo."
        : level === "suspicious"
          ? "Hãy xác minh kỹ danh tính người nhận trước khi chuyển."
          : "Chưa thấy dấu hiệu bất thường, nhưng hãy tự kiểm tra lại người nhận trước khi chuyển.",
      requires_confirmation: level !== "safe",
    }), 350));
  }

  /* ------------------------------------------------------------------ */
  /* 6. Gọi API thật                                                     */
  /* ------------------------------------------------------------------ */
  async function apiCall(payload) {
    const apiParam = new URLSearchParams(location.search).get("api");
    const fallback = location.port === "5500" ? "http://localhost:8080" : "";
    const base = (window.API_BASE || apiParam || fallback).replace(/\/$/, "");
    let res;
    try {
      res = await fetch(base + "/guard/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    } catch (_) {
      throw new Error("Không thể kết nối đến máy chủ. Vui lòng kiểm tra mạng và thử lại.");
    }

    if (!res.ok) {
      let msg = "Máy chủ đang gặp sự cố. Vui lòng thử lại sau.";
      if (res.status === 400) {
        msg = "Thông tin giao dịch chưa hợp lệ. Vui lòng kiểm tra lại.";
        try {
          const d = await res.json();
          if (typeof d.detail === "string" && d.detail.trim()) msg = d.detail;
        } catch (_) { }
      }
      throw new Error(msg);
    }
    return res.json();
  }

  async function callGuard(payload) {
    if (MOCK) {
      if (!payload.answers) return mockStep1(payload.account, payload.amount);
      return mockStep2(payload);
    }
    return apiCall(payload);
  }

  /* ------------------------------------------------------------------ */
  /* 7. State (nội bộ IIFE, không leak ra global)                       */
  /* ------------------------------------------------------------------ */
  let _payload = null;       // { account, amount, reason }
  let _answers = {};         // { q1: bool, q2: bool, ... }
  let _questions = [];       // array câu hỏi từ step 1
  let _inFlight = false;
  let _submitText = SUBMIT_LABEL;

  /* ------------------------------------------------------------------ */
  /* 8. Render bước 1 – câu hỏi                                         */
  /* ------------------------------------------------------------------ */
  function setQuestionButtonsDisabled(qSection, disabled) {
    qSection.querySelectorAll(".guard-q-btn").forEach((b) => { b.disabled = disabled; });
  }

  function renderQuestions(qSection, data) {
    clear(qSection);
    show(qSection);
    _answers = {};
    _questions = data.questions || [];

    if (data.pre_findings && data.pre_findings.length) {
      qSection.append(el("p", { className: "guard-finding" }, "⚠️ Phát hiện sơ bộ:"));
      for (const f of data.pre_findings) {
        qSection.append(el("p", { className: "guard-finding" }, "• " + f));
      }
    }

    qSection.append(el("p", { className: "guard-status" }, "Vui lòng trả lời các câu hỏi dưới đây:"));

    for (const q of _questions) {
      const qBlock = el("div", { className: "guard-q-block" });
      qBlock.append(el("p", { className: "guard-q-text" }, q.text));

      const btnYes = el("button", { type: "button", className: "guard-q-btn", textContent: "Có" });
      const btnNo = el("button", { type: "button", className: "guard-q-btn", textContent: "Không" });

      function pick(value, activeBtn, otherBtn) {
        if (_inFlight) return;
        _answers[q.id] = value;
        activeBtn.classList.add("selected");
        otherBtn.classList.remove("selected");
        checkAllAnswered(qSection);
      }

      btnYes.addEventListener("click", () => pick(true, btnYes, btnNo));
      btnNo.addEventListener("click", () => pick(false, btnNo, btnYes));

      qBlock.append(el("div", { className: "guard-q-btns" }, btnYes, btnNo));
      qSection.append(qBlock);
    }
  }

  /* ------------------------------------------------------------------ */
  /* 9. Tự động gọi bước 2 khi đủ câu trả lời                          */
  /* ------------------------------------------------------------------ */
  async function checkAllAnswered(qSection) {
    if (_inFlight || Object.keys(_answers).length < _questions.length) return;

    const statusEl = qSection.querySelector(".guard-status");
    const rSection = document.getElementById("guard-result");

    _inFlight = true;
    setQuestionButtonsDisabled(qSection, true);
    if (statusEl) statusEl.textContent = "Đang phân tích…";

    try {
      const data = await callGuard({ ..._payload, answers: _answers });
      hide(qSection);
      renderResult(rSection, data);
    } catch (err) {
      if (statusEl) statusEl.textContent = "Vui lòng trả lời các câu hỏi dưới đây:";
      setQuestionButtonsDisabled(qSection, false);
      renderError(rSection, err.message, () => checkAllAnswered(qSection));
    } finally {
      _inFlight = false;
    }
  }

  /* ------------------------------------------------------------------ */
  /* 10. Render bước 2 – kết quả                                        */
  /* ------------------------------------------------------------------ */
  function renderResult(rSection, data) {
    clear(rSection);
    show(rSection);

    const level = data.risk_level || "suspicious";

    rSection.append(el("span", { className: "guard-badge " + (RISK_CLASS[level] || "") },
      RISK_LABEL[level] || level
    ));

    if (data.reasons && data.reasons.length) {
      rSection.append(el("p", { className: "guard-reasons-title" }, "Lý do:"));
      const ul = el("ul", { className: "guard-reasons" });
      for (const r of data.reasons) ul.append(el("li", {}, r));
      rSection.append(ul);
    }

    if (data.advice) {
      rSection.append(el("div", { className: "guard-advice" }, data.advice));
    }

    if (data.requires_confirmation) {
      renderConfirmation(rSection);
    }

    rSection.append(resetButton());
  }

  /* ------------------------------------------------------------------ */
  /* 11. Nút xác nhận rủi ro                                            */
  /* ------------------------------------------------------------------ */
  function renderConfirmation(rSection) {
    const actRow = el("div", { className: "guard-actions" });

    const btnStop = el("button", { type: "button", className: "guard-btn-stop", textContent: "Dừng lại" });
    const btnCont = el("button", {
      type: "button",
      className: "guard-btn-cont",
      textContent: "Tôi hiểu rủi ro, vẫn tiếp tục",
    });

    btnStop.addEventListener("click", () => {
      actRow.replaceWith(
        el("div", { className: "guard-ok-box" },
          "✅ Quyết định đúng đắn. Bạn vừa tự bảo vệ bản thân. Hãy báo cáo giao dịch này nếu bạn nghi ngờ lừa đảo.")
      );
    });

    btnCont.addEventListener("click", () => {
      // CHỈ hiện cảnh báo cuối – KHÔNG gọi API, KHÔNG thực hiện giao dịch
      actRow.replaceWith(
        el("div", { className: "guard-warn-box" },
          "⚠️ Bạn đang tự chịu rủi ro. Hãy hỏi người thân trước khi chuyển.")
      );
    });

    actRow.append(btnStop, btnCont);
    rSection.append(actRow);
  }

  /* ------------------------------------------------------------------ */
  /* 12. Hiển thị lỗi                                                   */
  /* ------------------------------------------------------------------ */
  function renderError(rSection, msg, onRetry) {
    clear(rSection);
    show(rSection);
    const friendly = typeof msg === "string" && msg.length < 300
      ? msg
      : "Có lỗi xảy ra. Vui lòng thử lại sau.";
    rSection.append(el("p", { className: "guard-err" }, "❌ " + friendly));

    if (typeof onRetry === "function") {
      const retryBtn = el("button", {
        type: "button",
        className: "guard-reset",
        textContent: "Thử lại",
      });
      retryBtn.addEventListener("click", onRetry);
      rSection.append(retryBtn, " ");
    }
    rSection.append(resetButton());
  }

  /* ------------------------------------------------------------------ */
  /* 13. Nút reset – quay về form ban đầu                               */
  /* ------------------------------------------------------------------ */
  function resetButton() {
    const btn = el("button", {
      type: "button",
      className: "guard-reset",
      textContent: "🔄 Kiểm tra giao dịch khác",
    });
    btn.addEventListener("click", resetAll);
    return btn;
  }

  function resetAll() {
    _payload = null;
    _answers = {};
    _questions = [];
    _inFlight = false;

    const form = document.getElementById("guard-form");
    const qSec = document.getElementById("guard-questions");
    const rSec = document.getElementById("guard-result");

    if (form) {
      form.reset();
      show(form);
      const { submitBtn } = getFormControls(form);
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = _submitText;
      }
      const statusEl = form.querySelector(".guard-status, .guard-err");
      if (statusEl) statusEl.textContent = "";
    }
    hide(qSec);
    hide(rSec);
    clear(qSec);
    clear(rSec);
  }

  /* ------------------------------------------------------------------ */
  /* 14. Submit handler bước 1                                          */
  /* ------------------------------------------------------------------ */
  async function handleSubmit(e) {
    e.preventDefault();
    if (_inFlight) return;

    const form = document.getElementById("guard-form");
    const qSection = document.getElementById("guard-questions");
    const rSection = document.getElementById("guard-result");
    const { accEl, amountEl, reasonEl, submitBtn } = getFormControls(form);

    const account = accEl ? accEl.value.trim() : "";
    const rawAmount = amountEl ? amountEl.value.trim() : "";
    const reason = reasonEl ? reasonEl.value.trim() : "";

    let errMsg = "";
    let parsedAmount = 0;
    if (!account) {
      errMsg = "Vui lòng nhập số tài khoản người nhận.";
    } else if (!rawAmount) {
      errMsg = "Vui lòng nhập số tiền chuyển.";
    } else if (!/^\d+$/.test(rawAmount)) {
      errMsg = "Số tiền không hợp lệ. Vui lòng chỉ nhập số nguyên không âm.";
    } else {
      parsedAmount = Number(rawAmount);
      if (!Number.isSafeInteger(parsedAmount) || parsedAmount < 0) {
        errMsg = "Số tiền không hợp lệ.";
      } else if (!reason) {
        errMsg = "Vui lòng nhập lý do chuyển khoản.";
      }
    }

    let formStatus = form.querySelector(".guard-status, .guard-err");
    if (!formStatus) {
      formStatus = el("p", { className: "guard-status" });
      form.append(formStatus);
    }

    if (errMsg) {
      formStatus.className = "guard-err";
      formStatus.textContent = errMsg;
      return;
    }

    _inFlight = true;
    formStatus.className = "guard-status";
    formStatus.textContent = "Đang kiểm tra…";
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = "Đang kiểm tra...";
    }

    _payload = { account, amount: parsedAmount, reason };
    hide(qSection);
    hide(rSection);
    clear(qSection);
    clear(rSection);

    try {
      const data = await callGuard(_payload);
      formStatus.textContent = "";
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = _submitText;
      }

      if (data.step === "questions") {
        hide(form);
        renderQuestions(qSection, data);
      } else {
        hide(form);
        renderResult(rSection, data);
      }
    } catch (err) {
      formStatus.className = "guard-err";
      formStatus.textContent = typeof err.message === "string" && err.message.length < 200
        ? err.message
        : "Không thể kết nối đến máy chủ. Vui lòng thử lại sau.";
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = _submitText;
      }
    } finally {
      _inFlight = false;
    }
  }

  /* ------------------------------------------------------------------ */
  /* 15. Mount – gắn sự kiện khi DOM sẵn sàng                          */
  /* ------------------------------------------------------------------ */
  function mount() {
    const form = document.getElementById("guard-form");
    const qSection = document.getElementById("guard-questions");
    const rSection = document.getElementById("guard-result");

    if (!form) return;

    ensureFormFields(form);
    const { submitBtn } = getFormControls(form);
    if (submitBtn && submitBtn.textContent.trim()) {
      _submitText = submitBtn.textContent.trim();
    }

    if (qSection) qSection.classList.add("guard-hidden");
    if (rSection) rSection.classList.add("guard-hidden");

    form.addEventListener("submit", handleSubmit);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount);
  } else {
    mount();
  }
})();
