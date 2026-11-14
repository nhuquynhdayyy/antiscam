/**
 * mic.js – Nhập giọng nói tiếng Việt qua Web Speech API
 * Điều khiển qua #mic, ghi chữ vào #input, trạng thái vào #mic-status.
 * Không sửa index.html hay CSS của file khác.
 */
(function () {
  "use strict";

  const STYLE = `
    .mic-recording {
      border-color: var(--danger, #c0262d) !important;
      color: var(--danger, #c0262d) !important;
      background: var(--danger-bg, #fde8e9) !important;
    }
    .mic-hint {
      margin: 6px 0 0;
      font-size: 0.82rem;
      color: var(--muted, #667085);
    }
  `;

  function injectStyle() {
    const s = document.createElement("style");
    s.textContent = STYLE;
    document.head.appendChild(s);
  }

  function ensureStatusEl(micBtn) {
    let statusEl = document.getElementById("mic-status");
    if (!statusEl) {
      statusEl = document.createElement("span");
      statusEl.id = "mic-status";
      statusEl.className = "meta";
      statusEl.setAttribute("aria-live", "polite");
      micBtn.insertAdjacentElement("afterend", statusEl);
    }
    return statusEl;
  }

  function ensureHintEl(micBtn) {
    if (document.getElementById("mic-hint")) return;
    const hint = document.createElement("p");
    hint.id = "mic-hint";
    hint.className = "mic-hint";
    hint.textContent = "Có thể bật loa ngoài để thu cả hai bên cuộc gọi";
    const row = micBtn.closest(".action-row");
    if (row) {
      row.insertAdjacentElement("afterend", hint);
    } else {
      micBtn.insertAdjacentElement("afterend", hint);
    }
  }

  function appendTranscript(inputEl, text) {
    const clean = text.trim();
    if (!clean) return;
    const current = inputEl.value;
    if (!current) {
      inputEl.value = clean;
    } else if (/\s$/.test(current)) {
      inputEl.value = current + clean;
    } else {
      inputEl.value = current + " " + clean;
    }
  }

  function init() {
    const micBtn = document.getElementById("mic");
    const inputEl = document.getElementById("input");
    if (!micBtn || !inputEl) return;

    injectStyle();
    const statusEl = ensureStatusEl(micBtn);
    ensureHintEl(micBtn);

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      micBtn.style.display = "none";
      statusEl.textContent = "Trình duyệt không hỗ trợ, hãy gõ hoặc dán chữ";
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = "vi-VN";
    recognition.continuous = true;
    recognition.interimResults = true;

    let dangGhi = false;
    let restartTimer = null;
    let emptyRestarts = 0;
    let gotTextThisSession = false;
    let keepStatusMessage = false;
    const MAX_EMPTY_RESTARTS = 5;

    function setRecordingUI(active) {
      micBtn.setAttribute("aria-pressed", active ? "true" : "false");
      if (active) {
        micBtn.classList.add("mic-recording");
      } else {
        micBtn.classList.remove("mic-recording");
      }
    }

    setRecordingUI(false);

    function stopRecording(statusText) {
      dangGhi = false;
      if (restartTimer) {
        clearTimeout(restartTimer);
        restartTimer = null;
      }
      setRecordingUI(false);
      if (statusText) {
        keepStatusMessage = true;
        statusEl.textContent = statusText;
      }
      try {
        recognition.stop();
      } catch (_) {}
    }

    recognition.onstart = function () {
      gotTextThisSession = false;
      keepStatusMessage = false;
      if (dangGhi) {
        statusEl.textContent = "Đang nghe…";
      }
    };

    recognition.onresult = function (event) {
      let finalText = "";
      let interimText = "";

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const res = event.results[i];
        const transcript = res[0] ? res[0].transcript : "";
        if (res.isFinal) {
          finalText += transcript + " ";
        } else {
          interimText += transcript;
        }
      }

      if (finalText.trim() || interimText.trim()) {
        gotTextThisSession = true;
        emptyRestarts = 0;
      }

      if (finalText.trim()) {
        appendTranscript(inputEl, finalText);
      }

      if (dangGhi) {
        statusEl.textContent = interimText.trim()
          ? "Đang nghe… " + interimText.trim()
          : "Đang nghe…";
      }
    };

    recognition.onerror = function (event) {
      const err = event && event.error;
      if (err === "no-speech") {
        // Không tính là lỗi dừng hẳn
        keepStatusMessage = true;
        statusEl.textContent = "Không nghe thấy gì, thử nói gần micro hơn";
        return;
      }

      if (err === "not-allowed" || err === "service-not-allowed") {
        stopRecording("Bạn chưa cho phép micro. Hãy bật quyền micro cho trang này");
        return;
      }

      if (err === "aborted" && !dangGhi) {
        return;
      }

      stopRecording("Có lỗi khi thu âm. Vui lòng thử lại hoặc gõ chữ");
    };

    recognition.onend = function () {
      if (!dangGhi) {
        setRecordingUI(false);
        if (!keepStatusMessage) {
          statusEl.textContent = "Đã dừng";
        }
        return;
      }

      if (!gotTextThisSession) {
        emptyRestarts += 1;
      } else {
        emptyRestarts = 0;
      }

      if (emptyRestarts >= MAX_EMPTY_RESTARTS) {
        dangGhi = false;
        setRecordingUI(false);
        statusEl.textContent = "Đã dừng";
        return;
      }

      restartTimer = setTimeout(function () {
        restartTimer = null;
        if (!dangGhi) return;
        try {
          recognition.start();
        } catch (_) {
          dangGhi = false;
          setRecordingUI(false);
          statusEl.textContent = "Đã dừng";
        }
      }, 300);
    };

    micBtn.addEventListener("click", function () {
      if (dangGhi) {
        stopRecording("Đã dừng");
        return;
      }

      dangGhi = true;
      emptyRestarts = 0;
      keepStatusMessage = false;
      setRecordingUI(true);
      statusEl.textContent = "Đang nghe…";

      try {
        recognition.start();
      } catch (_) {
        dangGhi = false;
        setRecordingUI(false);
        statusEl.textContent = "Có lỗi khi thu âm. Vui lòng thử lại hoặc gõ chữ";
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
