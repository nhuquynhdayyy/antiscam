/**
 * AntiScam - Xử lý tính năng chia sẻ cảnh báo (#share-btn)
 */

(function () {
  window.AntiScam = window.AntiScam || {};

  function showToast(message) {
    const toast = document.getElementById("toast");
    if (!toast) return;
    toast.textContent = message;
    toast.classList.remove("hidden");
    clearTimeout(window._antiScamToastTimer);
    window._antiScamToastTimer = setTimeout(function () {
      toast.classList.add("hidden");
    }, 2500);
  }

  function copyFallback(text) {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.top = "-9999px";
    textarea.style.left = "-9999px";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    try {
      document.execCommand("copy");
    } catch (e) {
      // Bỏ qua lỗi fallback
    }
    document.body.removeChild(textarea);
  }

  /**
   * Tạo chuỗi tóm tắt chia sẻ tối đa khoảng 500 ký tự
   */
  function buildShareSummary(text, data) {
    data = data || {};
    const riskMap = {
      danger: "NGUY HIỂM",
      suspicious: "ĐÁNG NGỜ",
      safe: "AN TOÀN"
    };

    const riskLevelStr = riskMap[data.risk_level] || "CẦN LƯU Ý";
    let reasonStr = "";

    if (Array.isArray(data.evidence) && data.evidence.length > 0) {
      reasonStr = data.evidence.filter(Boolean).join("; ");
    } else if (data.user_advice) {
      reasonStr = data.user_advice;
    } else if (data.risk_level === "safe") {
      reasonStr = "không phát hiện dấu hiệu lừa đảo phổ biến";
    } else {
      reasonStr = "nhiều dấu hiệu thao túng tâm lý đáng ngờ";
    }

    let summary = `Mình nhận được tin này, AntiScam báo ${riskLevelStr} vì: ${reasonStr}`;

    // Giới hạn độ dài tối đa khoảng 500 ký tự
    if (summary.length > 500) {
      summary = summary.slice(0, 497) + "…";
    }

    return summary;
  }

  /**
   * Thực hiện hành vi chia sẻ
   */
  async function performShare(text, data) {
    const summary = buildShareSummary(text, data);

    try {
      if (navigator.share) {
        await navigator.share({
          title: "AntiScam - Cảnh báo rủi ro",
          text: summary
        });
        return;
      }
    } catch (err) {
      // Người dùng bấm hủy chia sẻ trong hộp thoại hệ thống: im lặng
      if (err && err.name === "AbortError") {
        return;
      }
      // Lỗi khác: tiếp tục fallback sang clipboard
    }

    // Sao chép vào clipboard
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(summary);
        showToast("Đã sao chép");
      } else {
        copyFallback(summary);
        showToast("Đã sao chép");
      }
    } catch (err) {
      copyFallback(summary);
      showToast("Đã sao chép");
    }
  }

  // Lắng nghe sự kiện click trên toàn trang bằng event delegation
  document.addEventListener("click", function (event) {
    const btn = event.target.closest("#share-btn");
    if (!btn) return;
    event.preventDefault();

    const analysis = window.AntiScam.currentAnalysis || {};
    performShare(analysis.text, analysis.data);
  });

  window.AntiScam.showToast = showToast;
  window.AntiScam.performShare = performShare;
  window.AntiScam.buildShareSummary = buildShareSummary;
})();
