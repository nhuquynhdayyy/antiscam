/**
 * AntiScam - Điều khiển chuyển tab và tương tác giao diện chung
 */

document.addEventListener("DOMContentLoaded", function () {
  const tabButtons = document.querySelectorAll(".tab-btn");
  const tabPanels = document.querySelectorAll(".tab-panel");

  tabButtons.forEach(function (btn) {
    btn.addEventListener("click", function () {
      const targetId = btn.getAttribute("aria-controls");

      // Cập nhật trạng thái nút tab
      tabButtons.forEach(function (b) {
        b.classList.remove("active");
        b.setAttribute("aria-selected", "false");
      });

      btn.classList.add("active");
      btn.setAttribute("aria-selected", "true");

      // Cập nhật hiển thị panel nội dung
      tabPanels.forEach(function (panel) {
        if (panel.id === targetId) {
          panel.classList.remove("hidden");
        } else {
          panel.classList.add("hidden");
        }
      });
    });
  });

  // Hỗ trợ click vào drop-zone để mở hộp thoại chọn tệp
  const dropZone = document.getElementById("drop-zone");
  const fileInput = document.getElementById("file-input");

  if (dropZone && fileInput) {
    dropZone.addEventListener("click", function () {
      fileInput.click();
    });

    dropZone.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        fileInput.click();
      }
    });

    ["dragenter", "dragover"].forEach(function (evtName) {
      dropZone.addEventListener(evtName, function (e) {
        e.preventDefault();
        dropZone.classList.add("dragover");
      });
    });

    ["dragleave", "drop"].forEach(function (evtName) {
      dropZone.addEventListener(evtName, function (e) {
        e.preventDefault();
        dropZone.classList.remove("dragover");
      });
    });
  }
});
