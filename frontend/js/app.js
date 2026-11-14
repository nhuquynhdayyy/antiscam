/**
 * AntiScam - Điều khiển chuyển tab và quản lý lịch sử kiểm tra
 * (Lưu ý: Không gắn sự kiện cho #drop-zone và #file-input vì thuộc trách nhiệm của image.js)
 */

(function () {
  window.AntiScam = window.AntiScam || {};

  // Lưu lịch sử kiểm tra trong bộ nhớ trang (RAM), tối đa 5 mục gần nhất
  const historyList = [];

  const RISK_TEXT_MAP = {
    danger: "Nguy hiểm",
    suspicious: "Đáng ngờ",
    safe: "An toàn"
  };

  /**
   * Cập nhật danh sách hiển thị lịch sử ở cột phụ (dùng textContent thuần DOM)
   */
  function renderHistory() {
    const container = document.getElementById("history-list");
    if (!container) return;

    container.replaceChildren();

    if (historyList.length === 0) {
      const emptyP = document.createElement("p");
      emptyP.className = "history-empty";
      emptyP.textContent = "Chưa có lượt kiểm tra nào trong phiên làm việc này.";
      container.append(emptyP);
      return;
    }

    const ul = document.createElement("ul");
    ul.className = "history-list";

    historyList.forEach(function (item) {
      const li = document.createElement("li");
      li.className = "history-item";
      li.tabIndex = 0;
      li.setAttribute("role", "button");
      li.setAttribute("aria-label", "Kiểm tra lại nội dung: " + item.text.slice(0, 40));

      const textSpan = document.createElement("span");
      textSpan.className = "history-text";
      textSpan.textContent = item.text;

      const badgeSpan = document.createElement("span");
      const risk = item.risk_level || "suspicious";
      badgeSpan.className = "history-badge " + risk;
      badgeSpan.textContent = RISK_TEXT_MAP[risk] || "Đáng ngờ";

      li.append(textSpan, badgeSpan);

      // Khi bấm vào một mục: điền lại ô nhập và chạy kiểm tra lại
      function triggerRecheck() {
        const input = document.getElementById("input");
        if (input) {
          input.value = item.text;
          input.focus();
        }
        if (typeof window.AntiScam.runCheck === "function") {
          window.AntiScam.runCheck(item.text);
        } else {
          const btn = document.getElementById("btn");
          if (btn) btn.click();
        }
      }

      li.addEventListener("click", triggerRecheck);
      li.addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          triggerRecheck();
        }
      });

      ul.append(li);
    });

    container.append(ul);
  }

  /**
   * Thêm một lượt kiểm tra vào lịch sử (không trùng lặp, đưa lên đầu, tối đa 5 mục)
   */
  window.AntiScam.addHistory = function (text, risk_level) {
    if (!text || !text.trim()) return;
    const cleanText = text.trim();

    // Loại bỏ mục cũ nếu có cùng nội dung
    const existingIndex = historyList.findIndex(function (h) {
      return h.text === cleanText;
    });
    if (existingIndex !== -1) {
      historyList.splice(existingIndex, 1);
    }

    // Đưa lên đầu danh sách
    historyList.unshift({
      text: cleanText,
      risk_level: risk_level || "suspicious"
    });

    // Giữ tối đa 5 mục
    if (historyList.length > 5) {
      historyList.length = 5;
    }

    renderHistory();
  };

  // Khởi tạo chuyển tab và lịch sử ban đầu khi DOM sẵn sàng
  document.addEventListener("DOMContentLoaded", function () {
    const tabButtons = document.querySelectorAll(".tab-btn");
    const tabPanels = document.querySelectorAll(".tab-panel");

    // Xử lý chuyển đổi Tab
    tabButtons.forEach(function (btn) {
      btn.addEventListener("click", function () {
        const targetId = btn.getAttribute("aria-controls");

        tabButtons.forEach(function (b) {
          b.classList.remove("active");
          b.setAttribute("aria-selected", "false");
        });

        btn.classList.add("active");
        btn.setAttribute("aria-selected", "true");

        tabPanels.forEach(function (panel) {
          if (panel.id === targetId) {
            panel.classList.remove("hidden");
          } else {
            panel.classList.add("hidden");
          }
        });
      });
    });

    // Vẽ danh sách lịch sử ban đầu
    renderHistory();
  });
})();
