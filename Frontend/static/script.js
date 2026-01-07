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
const algorithmSelect = document.getElementById("algorithm-select"); // chọn thuật toán
const resultPanel = document.getElementById("result-panel"); // hiển thị kết quả lộ trình
const runBtn = document.getElementById("run-btn"); // nút chạy tìm đường
const loadMapBtn = document.getElementById("load-map-btn");
const startDisplay = document.getElementById("start-display");
const goalDisplay = document.getElementById("goal-display");
const finishFloodBtn = document.getElementById("finish-flood-btn");

// ==========================================
// 2. Khởi tạo Bản đồ và Các lớp hiển thị
// ==========================================
const map = L.map("map", { preferCanvas: true }).setView(
  INITIAL_VIEW,
  INITIAL_ZOOM
);

// Thêm lớp nền OpenStreetMap
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  attribution: "&copy; OpenStreetMap contributors",
}).addTo(map);

const pathLayer = L.polyline([], {
  color: "#1e88e5",
  weight: 6,
  opacity: 0.9,
}).addTo(map);

const nodesLayer = L.layerGroup().addTo(map); // lưu trữ các nút giao
const floodVisualLayers = L.layerGroup().addTo(map); // lưu trữ các đoạn ngập
const floodTempLayer = L.layerGroup().addTo(map);
let floodPreviewCircle = null;
let floodSubmitPromise = null;
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
      startDisplay.textContent = `${snapped.lat.toFixed(5)}, ${snapped.lng.toFixed(5)}`;
  } else if (selectionMode === "goal") {
    goalLatLng = snapped;
    updateMarker("goal", snapped);
    if (goalDisplay)
      goalDisplay.textContent = `${snapped.lat.toFixed(5)}, ${snapped.lng.toFixed(5)}`;
  } else if (selectionMode === "flood") {
    const point = [snapped.lat, snapped.lng];
    floodPointsTemp.push(point);

    L.circleMarker(snapped, {
      radius: 5,
      color: "red",
      fillColor: "red",
      fillOpacity: 1,
    }).addTo(floodTempLayer);

    updateFloodPreview();
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

  if (floodSubmitPromise) {
    await floodSubmitPromise;
  } else if (floodPointsTemp.length >= 2) {
    await finishFloodArea();
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

// Tìm nút giao gần nhất với tọa độ đã cho
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
  const timeMinutes = data.total_time_sec
    ? (data.total_time_sec / 60).toFixed(1)
    : null;
  resultPanel.innerHTML = `
        <div style="padding: 12px; background: #e3f2fd; border-left: 5px solid #1e88e5; border-radius: 4px;">
            <b>Ket qua:</b> ${(data.total_length_m / 1000).toFixed(2)} km<br>
            ${
              timeMinutes
                ? `Thoi gian (30 km/h): ${timeMinutes} phut<br>`
                : ""
            }
            Đã áp dụng các đoạn ngập trên bản đồ.
        </div>`;
}

function computeCentroid(points) {
  // Trung bình lat/lng để lấy trọng tâm.
  let sumLat = 0;
  let sumLng = 0;
  points.forEach((p) => {
    sumLat += p[0];
    sumLng += p[1];
  });
  return L.latLng(sumLat / points.length, sumLng / points.length);
}

function computeRadiusMeters(center, points) {
  // Tính bán kính lớn nhất từ tâm đến các điểm.
  let maxDist = 0;
  points.forEach((p) => {
    const dist = center.distanceTo(L.latLng(p[0], p[1]));
    if (dist > maxDist) maxDist = dist;
  });
  return maxDist;
}

function updateFloodPreview() {
  // Vẽ vòng tròn cho vùng ngập tạm thời.
  if (floodPreviewCircle) {
    floodTempLayer.removeLayer(floodPreviewCircle);
    floodPreviewCircle = null;
  }
  if (floodPointsTemp.length < 2) return;
  const center = computeCentroid(floodPointsTemp);
  const radius = computeRadiusMeters(center, floodPointsTemp);
  floodPreviewCircle = L.circle(center, {
    color: "red",
    weight: 2,
    dashArray: "6, 8",
    fillColor: "red",
    fillOpacity: 0.12,
    radius: radius,
  }).addTo(floodTempLayer);
}

async function finishFloodArea() {
  // Hoàn tất việc chọn vùng ngập và gửi lên server.
  if (floodSubmitPromise) {
    return floodSubmitPromise;
  }
  if (floodPointsTemp.length < 2) {
    alert("Vui lòng chọn ít nhất 2 điểm cho vùng ngập.");
    return;
  }
  const points = floodPointsTemp.slice();
  const center = computeCentroid(points);
  const radius = computeRadiusMeters(center, points);
  floodSubmitPromise = (async () => {
    L.circle(center, {
      color: "red",
      weight: 2,
      fillColor: "red",
      fillOpacity: 0.2,
      radius: radius,
    }).addTo(floodVisualLayers);
    points.forEach((p) => {
      L.circleMarker(p, {
        radius: 5,
        color: "red",
        fillColor: "red",
        fillOpacity: 1,
      }).addTo(floodVisualLayers);
    });
    try {
      await fetch("/api/add_blocked", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ points: points }),
      });
    } catch (err) {
      console.error("Không gửi được vùng ngập:", err);
    }
    floodPointsTemp = [];
    floodTempLayer.clearLayers();
    floodPreviewCircle = null;
    floodSubmitPromise = null;
  })();
  return floodSubmitPromise;
}

window.setSelectionMode = function (mode) {
  // Tự động hoàn tất vùng ngập nếu chuyển chế độ
  if (selectionMode === "flood" && mode !== "flood") {
    if (floodPointsTemp.length >= 2) {
      finishFloodArea();
    } else {
      floodPointsTemp = [];
      floodTempLayer.clearLayers();
      floodPreviewCircle = null;
    }
  }
  if (mode === "flood" && selectionMode !== "flood") {
    floodPointsTemp = [];
    floodTempLayer.clearLayers();
    floodPreviewCircle = null;
  }
  selectionMode = mode;
  document.querySelectorAll(".mode-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.getAttribute("data-mode") === mode);
  });
};

window.clearAllFloods = async function () {
  await fetch("/api/clear_blocked", { method: "POST" });
  blockedEdges = [];
  floodVisualLayers.clearLayers();
  floodTempLayer.clearLayers();
  floodPreviewCircle = null;
  floodPointsTemp = [];
  pathLayer.setLatLngs([]);
  resultPanel.innerHTML = "Đã xóa toàn bộ điểm ngập.";
};

// Khởi tạo dữ liệu khi tải trang
loadMapData();

if (finishFloodBtn) finishFloodBtn.onclick = finishFloodArea;
if (runBtn) runBtn.onclick = runPathfinding;
if (loadMapBtn) loadMapBtn.onclick = () => location.reload();
