/**
 * image.js – Xử lý ảnh chụp màn hình cho AntiScam
 *
 * Ba cách đưa ảnh vào:
 *   1. Chọn file qua nút #file-input
 *   2. Kéo thả vào #drop-zone
 *   3. Dán ảnh từ clipboard (Ctrl+V / Cmd+V)
 *
 * Sau khi nhận ảnh → gửi FormData tới /analyze-image
 * → gọi window.AntiScam.renderResult(extracted_text, data)
 *
 * Phụ thuộc: window.AntiScam.renderResult và window.AntiScam.API_BASE
 * phải được khai báo trước (trong index.html hoặc check.js).
 */

(function () {
  "use strict";

  // ── Giới hạn ──────────────────────────────────────────────────────────────
  const MAX_BYTES = 4 * 1024 * 1024; // 4 MB
  const ALLOWED_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

  // ── Lấy element theo id (trả null nếu chưa có, không throw) ───────────────
  const $ = (id) => document.getElementById(id);

  // ── Trạng thái loading ────────────────────────────────────────────────────
  function setImageStatus(msg, isError = false) {
    const el = $("image-status");
    if (!el) return;
    el.textContent = msg;
    el.className = isError ? "err meta" : "meta";
  }

  function setDropZoneActive(active) {
    const dz = $("drop-zone");
    if (!dz) return;
    dz.classList.toggle("dragover", active);
  }

  // ── Kiểm tra file trước khi gửi ──────────────────────────────────────────
  function validateFile(file) {
    if (!file) return "Không tìm thấy file ảnh.";
    if (!ALLOWED_TYPES.has(file.type)) {
      return `Định dạng không hỗ trợ (${file.type || "không rõ"}). Chỉ nhận PNG, JPEG, WebP.`;
    }
    if (file.size > MAX_BYTES) {
      return `Ảnh quá lớn (${Math.round(file.size / 1024)} KB). Tối đa 4 MB.`;
    }
    if (file.size === 0) return "File ảnh rỗng.";
    return null; // OK
  }

  // ── Gọi /analyze-image ────────────────────────────────────────────────────
  async function analyzeImage(file) {
    const apiBase = (
      window.AntiScam?.API_BASE ||
      new URLSearchParams(location.search).get("api") ||
      (location.hostname.endsWith(".run.app") || location.port === "8080"
        ? location.origin
        : "http://localhost:8080")
    ).replace(/\/$/, "");

    // Chế độ mock: trả kết quả giả để Người 3 dựng giao diện
    if (
      window.AntiScam?.MOCK ||
      new URLSearchParams(location.search).get("mock") === "1"
    ) {
      return new Promise((resolve) =>
        setTimeout(
          () =>
            resolve({
              risk_level: "danger",
              scam_type: "fake_job_deposit",
              stage: "action_request",
              tactics: ["reward", "urgency"],
              evidence: ["đặt cọc 500k", "Chốt trong 30 phút"],
              extracted_text:
                "Bên mình tuyển cộng tác viên online lương 500k-1tr/ngày. Để nhận việc bạn đặt cọc 500k, hoàn lại sau ca đầu. Chốt trong 30 phút nữa nhé, hết suất.",
              entities: {
                phones: [],
                urls: [],
                accounts: [],
                organizations: [],
              },
              next_likely_step: "Yêu cầu chuyển thêm phí.",
              user_advice:
                "Dừng lại, không chuyển tiền. Công ty thật không thu cọc để nhận việc.",
              ask_trusted_circle: true,
              follow_up_question: "",
              rule_reasons: [],
              decided_by: "ai",
              degraded: false,
            }),
          800
        )
      );
    }

    const form = new FormData();
    form.append("file", file, file.name || "screenshot.png");

    const res = await fetch(apiBase + "/analyze-image", {
      method: "POST",
      body: form,
    });

    if (!res.ok) {
      let detail = "Máy chủ trả về lỗi " + res.status;
      try {
        const body = await res.json();
        if (body.detail) detail = body.detail;
      } catch (_) {}
      throw new Error(detail);
    }

    return res.json();
  }

  // ── Hiển thị preview ảnh nhỏ trước khi gửi ───────────────────────────────
  function showPreview(file) {
    const preview = $("image-preview");
    if (!preview) return;
    const url = URL.createObjectURL(file);
    preview.src = url;
    preview.classList.remove("hidden");
    // giải phóng object URL sau khi load
    preview.onload = () => URL.revokeObjectURL(url);
  }

  function hidePreview() {
    const preview = $("image-preview");
    if (preview) {
      preview.src = "";
      preview.classList.add("hidden");
    }
  }

  // ── Luồng chính: nhận file → validate → gửi → vẽ kết quả ────────────────
  async function processFile(file) {
    // Kiểm tra renderResult đã sẵn sàng chưa
    const renderFn = window.AntiScam?.renderResult;
    if (typeof renderFn !== "function") {
      setImageStatus(
        "Giao diện chưa sẵn sàng (window.AntiScam.renderResult chưa có). Thử tải lại trang.",
        true
      );
      return;
    }

    const err = validateFile(file);
    if (err) {
      setImageStatus(err, true);
      return;
    }

    showPreview(file);
    setImageStatus("Đang đọc ảnh và phân tích…");

    // Vô hiệu hóa drop-zone trong khi chờ
    const dz = $("drop-zone");
    if (dz) dz.classList.add("loading");

    try {
      const data = await analyzeImage(file);
      const displayText = data.extracted_text || "(Không đọc được chữ trong ảnh)";
      renderFn(displayText, data);
      setImageStatus(""); // xóa trạng thái sau khi vẽ xong
    } catch (e) {
      hidePreview();
      setImageStatus("Không phân tích được: " + e.message, true);
    } finally {
      if (dz) dz.classList.remove("loading");
    }
  }

  // ── Khởi tạo sự kiện sau khi DOM sẵn sàng ────────────────────────────────
  function init() {
    // 1. Chọn file qua nút
    const fileInput = $("file-input");
    if (fileInput) {
      fileInput.accept = "image/png,image/jpeg,image/webp";
      fileInput.addEventListener("change", () => {
        const file = fileInput.files?.[0];
        if (file) processFile(file);
        fileInput.value = ""; // reset để chọn lại cùng file vẫn kích hoạt
      });
    }

    // 2. Kéo thả vào #drop-zone
    const dropZone = $("drop-zone");
    if (dropZone) {
      dropZone.addEventListener("dragenter", (e) => {
        e.preventDefault();
        setDropZoneActive(true);
      });
      dropZone.addEventListener("dragover", (e) => {
        e.preventDefault(); // bắt buộc để drop hoạt động
        setDropZoneActive(true);
      });
      dropZone.addEventListener("dragleave", (e) => {
        // chỉ tắt khi rời hẳn khỏi drop-zone (không phải child element)
        if (!dropZone.contains(e.relatedTarget)) setDropZoneActive(false);
      });
      dropZone.addEventListener("drop", (e) => {
        e.preventDefault();
        setDropZoneActive(false);
        const file = e.dataTransfer?.files?.[0];
        if (file) processFile(file);
      });

      // Click vào drop-zone cũng mở hộp thoại chọn file
      dropZone.addEventListener("click", (e) => {
        if (e.target !== fileInput) fileInput?.click();
      });
    }

    // 3. Dán từ clipboard (Ctrl+V / Cmd+V) – lắng nghe trên document
    document.addEventListener("paste", (e) => {
      // Bỏ qua nếu người dùng đang focus vào textarea (họ muốn dán chữ)
      const focused = document.activeElement;
      if (
        focused &&
        (focused.tagName === "TEXTAREA" || focused.tagName === "INPUT")
      )
        return;

      const items = e.clipboardData?.items || [];
      for (const item of items) {
        if (item.kind === "file" && ALLOWED_TYPES.has(item.type)) {
          const file = item.getAsFile();
          if (file) {
            e.preventDefault();
            processFile(file);
            return;
          }
        }
      }
    });
  }

  // Khởi chạy ngay hoặc chờ DOMContentLoaded
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
