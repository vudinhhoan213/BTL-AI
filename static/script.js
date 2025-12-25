// ==========================================
// 1. Cấu hình khu vực: Phường Hạ Đình, Thanh Xuân
// ==========================================
const FOCUS_PLACE = "Ha Dinh, Thanh Xuan, Hanoi";
const INITIAL_VIEW = [20.9925, 105.8085];
const INITIAL_ZOOM = 15;

let selectionMode = "start"; // 'start', 'goal', 'flood'
let startLatLng = null;
let goalLatLng = null;
let blockedEdges = []; // Lưu danh sách đoạn ngập
let floodPointsTemp = []; // Lưu tạm 2 điểm click để tạo 1 đoạn ngập
let nodeFeatures = []; // Dữ liệu nút giao từ server

// DOM Elements
const algorithmSelect = document.getElementById("algorithm-select");
const resultPanel = document.getElementById("result-panel");
const runBtn = document.getElementById("run-btn");
const loadMapBtn = document.getElementById("load-map-btn");
const startDisplay = document.getElementById("start-display");
const goalDisplay = document.getElementById("goal-display");

// ==========================================
// 2. Khởi tạo Bản đồ và Các lớp hiển thị
// ==========================================
const map = L.map("map", { preferCanvas: true }).setView(
  INITIAL_VIEW,
  INITIAL_ZOOM
);

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  attribution: "&copy; OpenStreetMap contributors",
}).addTo(map);

const pathLayer = L.polyline([], {
  color: "#1e88e5",
  weight: 6,
  opacity: 0.9,
}).addTo(map);
const nodesLayer = L.layerGroup().addTo(map); // hiển thị các node nhận từ API
const floodVisualLayers = L.layerGroup().addTo(map);
let markers = { start: null, goal: null };

// ==========================================
// 3. Hàm Nạp dữ liệu Nút giao (Snapping Data)
// ==========================================
async function loadMapData() {
  try {
    const response = await fetch("/api/load", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ place: FOCUS_PLACE }),
    });
    const data = await response.json();
    if (data.nodes) {
      // Chuẩn hóa dữ liệu để findNearestNode sử dụng
      nodeFeatures = data.nodes.map((n) => ({
        geometry: { coordinates: [n.lng, n.lat] },
        properties: { id: n.id },
      }));
      nodesLayer.clearLayers();
      data.nodes.forEach((n) => {
        L.circleMarker([n.lat, n.lng], {
          radius: 2.5,
          color: "#555",
          weight: 0,
          fillColor: "#555",
          fillOpacity: 0.7,
        }).addTo(nodesLayer);
      });
      document.getElementById(
        "graph-summary"
      ).textContent = `Đã tải ${nodeFeatures.length} nút giao.`;
    }
  } catch (err) {
    console.error("Không thể tải dữ liệu đồ thị:", err);
  }
}

// ==========================================
// 4. Xử lý Sự kiện Click Bản đồ
// ==========================================
map.on("click", (e) => {
  const snapped = findNearestNode(e.latlng);
  if (!snapped) return;

  if (selectionMode === "start") {
    startLatLng = snapped;
    updateMarker("start", snapped);
    if (startDisplay)
      startDisplay.textContent = `${snapped.lat.toFixed(
        5
      )}, ${snapped.lng.toFixed(5)}`;
  } else if (selectionMode === "goal") {
    goalLatLng = snapped;
    updateMarker("goal", snapped);
    if (goalDisplay)
      goalDisplay.textContent = `${snapped.lat.toFixed(
        5
      )}, ${snapped.lng.toFixed(5)}`;
  } else if (selectionMode === "flood") {
    floodPointsTemp.push([snapped.lat, snapped.lng]);

    L.circleMarker(snapped, {
      radius: 5,
      color: "red",
      fillColor: "red",
      fillOpacity: 1,
    }).addTo(floodVisualLayers);

    if (floodPointsTemp.length === 2) {
      const newFlood = { start: floodPointsTemp[0], end: floodPointsTemp[1] };
      blockedEdges.push(newFlood);

      L.polyline(floodPointsTemp, {
        color: "red",
        weight: 8,
        dashArray: "10, 15",
        opacity: 0.7,
      })
        .addTo(floodVisualLayers)
        .bindTooltip("Đoạn đường ngập");

      // Gửi đoạn ngập lên server ngay lập tức
      fetch("/api/add_blocked", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newFlood),
      });

      floodPointsTemp = [];
    }
  }
});

// ==========================================
// 5. Hàm Tìm đường (Gửi yêu cầu né ngập)
// ==========================================
async function runPathfinding() {
  if (!startLatLng || !goalLatLng) {
    alert("Vui lòng chọn Điểm đi và Điểm đến!");
    return;
  }

  const payload = {
    start: [startLatLng.lat, startLatLng.lng],
    goal: [goalLatLng.lat, goalLatLng.lng],
    algorithm: algorithmSelect.value,
    place: FOCUS_PLACE,
  };

  try {
    const response = await fetch("/api/path", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await response.json();

    if (data.path) {
      pathLayer.setLatLngs(data.path);
      map.fitBounds(pathLayer.getBounds());
      showResult(data);
    } else {
      alert(data.error || "Không tìm được đường đi!");
    }
  } catch (err) {
    alert("Lỗi kết nối máy chủ!");
  }
}

// ==========================================
// 6. Các Hàm Hỗ trợ
// ==========================================
function findNearestNode(latlng) {
  if (!nodeFeatures || nodeFeatures.length === 0) return latlng;
  let best = null;
  let minStr = Infinity;
  for (const node of nodeFeatures) {
    const coords = node.geometry.coordinates;
    const dist =
      Math.pow(latlng.lat - coords[1], 2) + Math.pow(latlng.lng - coords[0], 2);
    if (dist < minStr) {
      minStr = dist;
      best = L.latLng(coords[1], coords[0]);
    }
  }
  return best;
}

function updateMarker(type, latlng) {
  if (markers[type]) map.removeLayer(markers[type]);
  const color = type === "start" ? "#4CAF50" : "#F44336";
  markers[type] = L.circleMarker(latlng, {
    radius: 9,
    color: "#ffffff",
    weight: 2,
    fillColor: color,
    fillOpacity: 1,
  }).addTo(map);
}

function showResult(data) {
  resultPanel.innerHTML = `
        <div style="padding: 12px; background: #e3f2fd; border-left: 5px solid #1e88e5; border-radius: 4px;">
            <b>Kết quả:</b> ${(data.total_length_m / 1000).toFixed(2)} km<br>
            Đã né các đoạn ngập trên bản đồ.
        </div>`;
}

window.setSelectionMode = function (mode) {
  selectionMode = mode;
  floodPointsTemp = [];
  document.querySelectorAll(".mode-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.getAttribute("data-mode") === mode);
  });
};

window.clearAllFloods = async function () {
  await fetch("/api/clear_blocked", { method: "POST" });
  blockedEdges = [];
  floodVisualLayers.clearLayers();
  pathLayer.setLatLngs([]);
  resultPanel.innerHTML = "Đã xóa toàn bộ điểm ngập.";
};

// Khởi tạo dữ liệu khi tải trang
loadMapData();

if (runBtn) runBtn.onclick = runPathfinding;
if (loadMapBtn) loadMapBtn.onclick = () => location.reload();
