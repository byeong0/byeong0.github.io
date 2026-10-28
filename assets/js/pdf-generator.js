function print() {
  const printWindow = window.open("/print", "_blank");
  printWindow.onload = function () {
    printWindow.print();
    // Close the print window after a delay
    setTimeout(() => printWindow.close(), 500);
  };
}

// 쪽 경계에서 잘리면 안 되는 요소: 경계에 걸치면 통째로 다음 쪽으로 넘김
// - 이미지 링크, 이미지, 기술 태그, 표 행, 목록 항목, 문단, 제목/기간/회사 묶음, 프로젝트 Stack 줄, 섹션 제목
const PDF_AVOID_BREAK = [
  ".summary-image a",
  "img",
  ".skillset-tag",
  "tr",
  "li",
  "p",
  "h3",
  ".meta",
  ".skills",
  ".section-title",
];

// 쪽 끝에서 이 거리(px) 안에 끝나는 요소도 다음 쪽으로 넘김
// - 캔버스 렌더링이 실제 배치와 몇 px 어긋나도 요소가 잘리지 않도록 두는 여유
const PDF_BREAK_TOLERANCE_PX = 24;

// 쪽 크기와 여백(pt). 본문 영역이 522×783pt(= 696×1044px, 비율 1.5)가 되도록 잡음
// - html2pdf 는 쪽 나눔 위치를 px 로 계산하고, 캔버스는 "너비 × 비율"로 자름
//   두 값이 정수로 딱 맞아떨어지지 않으면 쪽마다 1~2px 씩 어긋나 뒤쪽 쪽에서 요소가 잘림
// - 595×842pt 는 A4(595.28×841.89pt)와 0.3pt 차이
const PDF_PAGE_FORMAT = [595, 842];
const PDF_PAGE_MARGIN = [29.5, 36.5, 29.5, 36.5]; // 위, 왼쪽, 아래, 오른쪽

// 이미지 크기를 쪽 나눔 계산 전에 알 수 있도록 모든 이미지를 먼저 읽어 width/height 속성으로 고정
function preloadImages(container) {
  const images = Array.from(container.querySelectorAll("img"));
  return Promise.all(
    images.map(
      (img) =>
        new Promise((resolve) => {
          const probe = new Image();
          probe.onload = () => {
            img.setAttribute("width", probe.naturalWidth);
            img.setAttribute("height", probe.naturalHeight);
            img.style.height = "auto"; // width 는 CSS(max-width: 100%)를 따르고 비율은 속성으로 유지
            resolve();
          };
          probe.onerror = () => resolve();
          probe.src = img.src;
        })
    )
  ).then(() => container);
}

// 쪽 나눔: 경계에 걸치거나 쪽 끝 여유 구간에 닿는 요소 앞에 빈 블록을 넣어 다음 쪽 첫머리로 밀어냄
// - html2pdf 의 pagebreak.avoid 와 같은 방식이지만 여유(PDF_BREAK_TOLERANCE_PX)를 둘 수 있음
// - 문서 순서대로 처리하고 위치를 매번 다시 읽으므로 앞에서 넣은 빈 블록이 뒤 요소에 반영됨
function paginateContainer(root, pageHeightPx) {
  const rootTop = root.getBoundingClientRect().top;
  root.querySelectorAll(PDF_AVOID_BREAK.join(", ")).forEach((el) => {
    const rect = el.getBoundingClientRect();
    const top = rect.top - rootTop;
    const bottom = rect.bottom - rootTop;
    const height = bottom - top;
    if (height <= 0 || height > pageHeightPx) return; // 쪽보다 큰 요소는 나눌 수밖에 없음
    const startPage = Math.floor(top / pageHeightPx);
    const endPage = Math.floor((bottom + PDF_BREAK_TOLERANCE_PX) / pageHeightPx);
    if (startPage === endPage) return;
    const pad = document.createElement("div");
    pad.className = "pdf-page-pad";
    pad.style.display = "block";
    pad.style.height = `${pageHeightPx - (top % pageHeightPx)}px`;
    el.parentNode.insertBefore(pad, el);
  });
}

// html2pdf 가 렌더용 컨테이너를 만든 직후(크기가 확정된 뒤)에 위 쪽 나눔을 적용
function installPaginationHook() {
  if (!window.html2pdf || !html2pdf.Worker || html2pdf.Worker.prototype.__paginationHooked) return;
  const original = html2pdf.Worker.prototype.toContainer;
  html2pdf.Worker.prototype.toContainer = function () {
    return original.call(this).then(function () {
      paginateContainer(this.prop.container, this.prop.pageSize.inner.px.height);
    });
  };
  html2pdf.Worker.prototype.__paginationHooked = true;
}

function generatePDF() {
  // Get the print layout URL
  const printURL = new URL("print", window.location.href).href;
  const button = document.getElementById("pdfButton");
  if (button) button.disabled = true;

  // Fetch the print layout content
  fetch(printURL)
    .then((response) => response.text())
    .then((html) => {
      // Create a temporary container
      const container = document.createElement("div");
      container.innerHTML = html;
      return preloadImages(container);
    })
    .then((container) => {
      // Get name from the DOM (as defined in data.yml)
      const name = document.querySelector(".name").textContent;
      // Format filename: replace spaces with underscores and append _resume.pdf
      const filename = `${name.replace(/\s+/g, "_")}_Resume.pdf`;

      // Configure pdf options
      const opt = {
        margin: PDF_PAGE_MARGIN,
        filename: filename,
        image: {
          type: "jpeg",
          quality: 0.8,
        },
        html2canvas: {
          scale: 2,
          useCORS: true,
          letterRendering: true,
          scrollY: 0,
          logging: false, // Disable logging for better performance
          removeContainer: true, // Clean up after rendering
        },
        jsPDF: {
          unit: "pt",
          format: PDF_PAGE_FORMAT,
          orientation: "portrait",
          compress: true, // Enable PDF compression
        },
        // 쪽 나눔은 paginateContainer 가 맡음(html2pdf 의 avoid 목록은 비움)
        pagebreak: {
          mode: ["css", "legacy"],
          avoid: [],
        },
      };

      installPaginationHook();

      // Generate PDF
      return html2pdf().set(opt).from(container).save();
    })
    .catch((err) => console.error("Error generating PDF:", err))
    .finally(() => {
      if (button) button.disabled = false;
    });
}
