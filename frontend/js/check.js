/**
 * AntiScam - Module kiểm tra tin nhắn và kết xuất kết quả
 */

(function () {
  const params = new URLSearchParams(location.search);
  const API_BASE = (params.get("api") || "http://localhost:8080").replace(/\/$/, "");
  const MOCK = params.get("mock") === "1";

  const RISK_LABEL = {
    safe: "An toàn",
    suspicious: "Đáng ngờ",
    danger: "Nguy hiểm"
  };

  const STAGE_LABEL = {
    none: "Chưa rõ",
    approach: "Tiếp cận",
    threat: "Đe dọa",
    isolation: "Cô lập",
    urgency: "Khẩn cấp",
    action_request: "Yêu cầu hành động"
  };

  const TACTIC_LABEL = {
    authority: "Giả danh quyền lực",
    fear: "Gây sợ hãi",
    urgency: "Tạo khẩn cấp",
    secrecy: "Yêu cầu giữ bí mật",
    reward: "Hứa thưởng",
    trust_building: "Tạo lòng tin",
    scarcity: "Khan hiếm"
  };

  const SAMPLES = {
    "Việc làm đặt cọc": "Bên mình tuyển cộng tác viên online lương 500k-1tr/ngày. Để nhận việc bạn đặt cọc 500k, hoàn lại sau ca đầu. Chốt trong 30 phút nữa nhé, hết suất.",
    "Link giả ngân hàng": "[Vietcombank] Tài khoản của quý khách bị khóa do chưa cập nhật sinh trắc học. Vui lòng xác thực tại http://vcb-xacthuc.top/login trước 18h hôm nay.",
    "Tin an toàn": "Tối nay 7h đi ăn mì Quảng ở Hải Châu nhé, mình đặt bàn rồi."
  };

  const $ = (id) => document.getElementById(id);

  function el(tag, props = {}, ...children) {
    const node = document.createElement(tag);
    Object.assign(node, props);
    for (const child of children) {
      if (child) node.append(child);
    }
    return node;
  }

  function createSvgIcon(pathD, circleProps) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("width", "18");
    svg.setAttribute("height", "18");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "2");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    if (circleProps) {
      for (const cp of circleProps) {
        const c = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        c.setAttribute("cx", cp.cx);
        c.setAttribute("cy", cp.cy);
        c.setAttribute("r", cp.r);
        svg.appendChild(c);
      }
    }
    if (pathD) {
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", pathD);
      svg.appendChild(path);
    }
    return svg;
  }

  // Tô sáng bằng chứng qua DOM để tránh chèn mã độc
  function highlight(text, evidence) {
    const ranges = [];
    for (const ev of evidence || []) {
      if (!ev) continue;
      const i = text.indexOf(ev);
      if (i >= 0) ranges.push([i, i + ev.length]);
    }
    ranges.sort((a, b) => a[0] - b[0]);
    const merged = [];
    for (const r of ranges) {
      const last = merged[merged.length - 1];
      if (last && r[0] <= last[1]) {
        last[1] = Math.max(last[1], r[1]);
      } else {
        merged.push([...r]);
      }
    }
    const box = el("div", { className: "quote" });
    let pos = 0;
    for (const [s, e] of merged) {
      box.append(text.slice(pos, s), el("mark", { textContent: text.slice(s, e) }));
      pos = e;
    }
    box.append(text.slice(pos));
    return box;
  }

  function listSection(title, items) {
    if (!items || !items.length) return null;
    return el(
      "div",
      {},
      el("h3", { textContent: title, style: "margin: 16px 0 8px; font-size: 1rem;" }),
      el("ul", { style: "margin: 4px 0; padding-left: 20px;" }, ...items.map((x) => el("li", { textContent: x })))
    );
  }

  // Khởi tạo namespace dùng chung theo hợp đồng
  window.AntiScam = window.AntiScam || {};

  /**
   * Render kết quả phân tích
   * @param {string} text - Nội dung gửi phân tích
   * @param {object} data - Dữ liệu trả về từ máy chủ hoặc mock
   */
  window.AntiScam.renderResult = function (text, data) {
    const box = $("result");
    if (!box) return;

    box.replaceChildren();
    box.classList.remove("hidden");

    // Nếu không có dữ liệu đối tượng hoặc không có trường quen thuộc, in JSON dự phòng
    if (!data || typeof data !== "object") {
      box.append(el("pre", { className: "quote", textContent: String(data) }));
      appendShareButton(box, text, "Chi tiết phân tích AntiScam");
      return;
    }

    // Trường hợp stub chưa có analyst đầy đủ
    if (data.stub) {
      const ent = data.entities || {};
      data = {
        risk_level: ent.rule_level === "none" ? "safe" : ent.rule_level,
        stage: "none",
        tactics: [],
        evidence: [],
        entities: ent,
        user_advice: "(Bản khung) Mới có kết quả từ luật kiểm tra, chưa có phân tích trí tuệ nhân tạo.",
        rule_reasons: ent.rule_reasons || [],
        follow_up_question: ""
      };
    }

    // Nếu không có bất kỳ thông tin nào để vẽ, in JSON
    const hasVisualData = data.risk_level || data.user_advice || (data.evidence && data.evidence.length) || data.rule_reasons;
    if (!hasVisualData) {
      box.append(el("pre", { className: "quote", textContent: JSON.stringify(data, null, 2) }));
      appendShareButton(box, text, "Kết quả kiểm tra AntiScam");
      return;
    }

    const header = el("div", { className: "result-header" });
    const risk = data.risk_level || "suspicious";
    header.append(el("span", { className: "badge " + risk, textContent: RISK_LABEL[risk] || risk }));

    if (data.stage && data.stage !== "none") {
      header.append(el("span", { className: "meta", textContent: "Giai đoạn: " + (STAGE_LABEL[data.stage] || data.stage) }));
    }
    box.append(header);

    if (data.user_advice) {
      box.append(el("div", { className: "advice", textContent: data.user_advice }));
    }

    if (text) {
      box.append(
        el("h3", { textContent: "Nội dung bạn gửi (cụm đáng ngờ được tô sáng)", style: "margin: 16px 0 8px; font-size: 1rem;" }),
        highlight(text, data.evidence)
      );
    }

    if (data.tactics && data.tactics.length) {
      const chips = el(
        "div",
        { className: "chips" },
        ...data.tactics.map((t) => el("span", { className: "chip-tag", textContent: TACTIC_LABEL[t] || t }))
      );
      box.append(el("h3", { textContent: "Chiêu thao túng phát hiện được", style: "margin: 16px 0 8px; font-size: 1rem;" }), chips);
    }

    const rs = listSection("Lý do từ luật kiểm tra", data.rule_reasons);
    if (rs) box.append(rs);

    const e = data.entities || {};
    const ents = [].concat(
      (e.urls || []).map((x) => "Đường link: " + x),
      (e.phones || []).map((x) => "Số điện thoại: " + x),
      (e.accounts || []).map((x) => "Số tài khoản: " + x),
      (e.organizations || []).map((x) => "Tổ chức mạo danh: " + x)
    );
    const es = listSection("Thông tin trích xuất", ents);
    if (es) box.append(es);

    if (data.next_likely_step) {
      box.append(el("p", { className: "meta", textContent: "Bước tiếp theo đối tượng có thể làm: " + data.next_likely_step }));
    }
    if (data.follow_up_question) {
      box.append(el("p", { style: "font-weight: 500; margin: 10px 0;", textContent: "Câu hỏi làm rõ: " + data.follow_up_question }));
    }
    if (data.ask_trusted_circle) {
      box.append(
        el("p", {
          style: "color: var(--wn); font-weight: 600; margin: 10px 0;",
          textContent: "Lời khuyên: Nên trao đổi với một người thân đáng tin cậy trước khi thực hiện bất kỳ giao dịch nào."
        })
      );
    }

    // Sinh nút #share-btn theo đúng hợp đồng id
    appendShareButton(box, text, data.user_advice || "Cảnh báo lừa đảo");
  };

  function appendShareButton(container, text, summary) {
    const shareBtn = el(
      "button",
      {
        id: "share-btn",
        className: "btn",
        type: "button",
        onclick: function () {
          if (navigator.share) {
            navigator
              .share({
                title: "AntiScam - Cảnh báo rủi ro",
                text: summary,
                url: window.location.href
              })
              .catch(() => {});
          } else if (navigator.clipboard) {
            navigator.clipboard.writeText(window.location.href);
            alert("Đã sao chép liên kết cảnh báo vào bộ nhớ tạm.");
          } else {
            alert("Trình duyệt không hỗ trợ chia sẻ trực tiếp.");
          }
        }
      },
      createSvgIcon("M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8m-4-6-4-4-4 4m4-4v13"),
      document.createTextNode("Chia sẻ cảnh báo")
    );

    const shareRow = el("div", { className: "share-action-row" }, shareBtn);
    container.append(shareRow);
  }

  // Gọi API phân tích
  async function analyze(text) {
    if (MOCK) return mockResult(text);
    const res = await fetch(API_BASE + "/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text })
    });
    if (!res.ok) throw new Error("Máy chủ trả về mã lỗi: " + res.status);
    return res.json();
  }

  function mockResult(text) {
    const evidence = ["đặt cọc 500k", "Chốt trong 30 phút", "sinh trắc học", "http://vcb-xacthuc.top/login"].filter((e) =>
      text.includes(e)
    );
    return new Promise((resolve) =>
      setTimeout(
        () =>
          resolve({
            risk_level: evidence.length ? "danger" : "safe",
            scam_type: "fake_job_deposit",
            stage: "action_request",
            tactics: ["reward", "urgency"],
            evidence: evidence,
            entities: { phones: [], urls: [], accounts: [], organizations: [] },
            next_likely_step: "Yêu cầu chuyển thêm phí để hoàn tiền",
            user_advice:
              evidence.length > 0
                ? "Dừng lại, tuyệt đối không chuyển tiền. Các công ty và ngân hàng chính quy không thu cọc hoặc bắt đăng nhập qua link lạ."
                : "Nội dung chưa thấy dấu hiệu lừa đảo phổ biến. Tuy nhiên luôn cẩn trọng bảo mật thông tin cá nhân.",
            ask_trusted_circle: evidence.length > 0,
            follow_up_question: "",
            rule_reasons: evidence.length ? ["Phát hiện từ khóa yêu cầu nạp tiền", "Tạo áp lực thời gian gấp"] : [],
            decided_by: "ai"
          }),
        600
      )
    );
  }

  // Khởi chạy khi tài liệu sẵn sàng
  async function run() {
    const input = $("input");
    const status = $("status");
    const btn = $("btn");
    if (!input || !btn) return;

    const text = input.value.trim();
    if (!text) {
      if (status) status.textContent = "Vui lòng nhập hoặc dán nội dung cần kiểm tra.";
      return;
    }

    btn.disabled = true;
    if (status) {
      status.textContent = "Đang phân tích dữ liệu…";
      status.className = "meta";
    }

    try {
      const data = await analyze(text);
      window.AntiScam.renderResult(text, data);
      if (status) status.textContent = "";
    } catch (err) {
      if (status) {
        status.textContent = "Không thể kết nối đến máy chủ: " + err.message + ". Vui lòng thử lại sau.";
        status.className = "err";
      }
    } finally {
      btn.disabled = false;
    }
  }

  document.addEventListener("DOMContentLoaded", function () {
    const btn = $("btn");
    const input = $("input");
    const samples = $("samples");

    if (btn) btn.addEventListener("click", run);
    if (input) {
      input.addEventListener("keydown", function (e) {
        if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
          run();
        }
      });
    }

    if (samples) {
      for (const [name, txt] of Object.entries(SAMPLES)) {
        const chip = el("button", {
          className: "sample-chip",
          type: "button",
          textContent: name,
          onclick: function () {
            if (input) input.value = txt;
          }
        });
        samples.append(chip);
      }
    }
  });
})();
