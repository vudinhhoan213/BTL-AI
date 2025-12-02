console.log("Leaflet started");

// Khởi tạo bản đồ
const map = L.map("map").setView([21.0278, 105.8342], 12);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: "© OpenStreetMap contributors",
}).addTo(map);

let markers = []; // lưu vị trí người dùng click
let routeLine = null; // lưu tuyến đường tìm được
let blockedLines = []; // lưu các tuyến bị ngập, vẽ màu đỏ
let mode = "user"; // chế độ hiện tại: user hoặc admin

// DOM Elements
const modeSelect = document.getElementById("modeSelect"); // Chọn chế độ
const clearBtn = document.getElementById("clearBtn"); // Nút xóa marker và tuyến đường
const blockedList = document.getElementById("blockedList"); // Danh sách tuyến bị ngập

const levelSelect = document.getElementById("levelSelect"); // Chọn mức độ ngập
const levelWrap = document.getElementById("levelWrap"); // Bao ngoài levelSelect

// Cập nhật giao diện khi thay đổi chế độ
modeSelect.onchange = () => {
  mode = modeSelect.value;
  updateLevelUI();
};
function updateLevelUI() {
  levelWrap.style.display = mode === "admin" ? "block" : "none";
}

// Xóa marker
clearBtn.onclick = () => {
  clearMarkers(); // xóa markers + reset mảng markers

  if (routeLine) {
    map.removeLayer(routeLine);
    routeLine = null;
  }

  /* blockedLines.forEach(line => map.removeLayer(line));
  blockedLines = []; */
};

// Click bản đồ
map.on("click", async (e) => {
  const { lat, lng } = e.latlng; // Lấy tọa độ nơi click
  const marker = L.marker([lat, lng]).addTo(map); // Tạo marker và thêm vào bản đồ
  markers.push(marker); // Lưu marker vào mảng

  if (mode === "admin") {
    if (markers.length === 2) {
      const start = markers[0].getLatLng(); // Lấy tọa độ 2 điểm
      const end = markers[1].getLatLng();
      const level = levelSelect.value; // heavy/medium/light
      await addBlockedRoute(start, end, level); // Gửi dữ liệu lên server
      drawBlockedLine(start, end, level); // Vẽ tuyến ngập trên bản đồ
      updateBlockedList(); // Cập nhật danh sách tuyến ngập
      clearMarkers();
    }
  } else {
    if (markers.length === 2) {
      await findRoute();
    } else if (markers.length > 2) {
      clearMarkers();
    }
  }
});

function clearMarkers() {
  markers.forEach((m) => map.removeLayer(m));
  markers = [];
}

// Gửi dữ liệu thêm tuyến ngập
async function addBlockedRoute(start, end, level) {
  // Gửi dữ liệu lên server
  const res = await fetch("/add_blocked", {
    method: "POST",
    headers: { "Content-Type": "application/json" }, // định dạng gửi JSON
    body: JSON.stringify({ start, end, level }), // gửi dưới dạng JSON
  });
  const data = await res.json();
  alert(data.message);
}

// Lấy danh sách tuyến ngập
async function updateBlockedList() {
  const res = await fetch("/blocked_list");
  const data = await res.json(); // dữ liệu trả về từ server
  const routes = data.blocked_routes || []; // mảng các tuyến bị ngập

  blockedList.innerHTML = "<li>Chưa có tuyến nào.</li>"; // Xóa danh sách cũ

  if (!routes.length) {
    blockedList.innerHTML = "Chưa có tuyến nào.";
    return;
  }

  const levelText = (lv) => {
    if (lv === "light") return "Nhẹ";
    if (lv === "medium") return "Vừa";
    return "Nặng";
  };

  routes.forEach((r, i) => {
    const item = document.createElement("li");
    const lv = r.level || "heavy";

    item.textContent =
      `Tuyến ${i + 1} [${levelText(lv)}]: (` +
      `${r.start.lat.toFixed(4)}, ${r.start.lng.toFixed(4)}) → (` +
      `${r.end.lat.toFixed(4)}, ${r.end.lng.toFixed(4)})`;

    blockedList.appendChild(item);
  });
}

// Vẽ tuyến ngập trên bản đồ
function drawBlockedLine(start, end, level = "heavy") {
  const styleByLevel = {
    heavy: { color: "red", weight: 5, dashArray: "8 8", opacity: 0.95 },
    medium: { color: "orange", weight: 5, dashArray: "6 6", opacity: 0.9 },
    light: { color: "#f1c40f", weight: 5, dashArray: "2 8", opacity: 0.85 }, // vàng dễ nhìn hơn "yellow"
  };

  const style = styleByLevel[level] || styleByLevel.heavy;

  const line = L.polyline(
    [
      [start.lat, start.lng],
      [end.lat, end.lng],
    ],
    style
  ).addTo(map);

  blockedLines.push(line);
}

// Tìm đường
async function findRoute() {
  const start = markers[0].getLatLng();
  const end = markers[1].getLatLng();

  // Gửi yêu cầu tìm đường đến server
  const res = await fetch("/route", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ start, end }),
  });
  const data = await res.json(); // Kết quả trả về từ server

  // Xóa tuyến đường cũ và các tuyến ngập cũ
  if (routeLine) map.removeLayer(routeLine);
  blockedLines.forEach((l) => map.removeLayer(l));
  blockedLines = [];
  if (data.geometry) {
    const coords = data.geometry.coordinates.map((c) => [c[1], c[0]]);
    routeLine = L.polyline(coords, { color: "blue", weight: 5 }).addTo(map);
    map.fitBounds(routeLine.getBounds());

    // Vẽ lại các tuyến ngập
    if (data.blocked_routes) {
      data.blocked_routes.forEach((r) =>
        drawBlockedLine(r.start, r.end, r.level)
      );
      updateBlockedList();
    }
  } else {
    alert("Không tìm được đường đi!");
  }

  clearMarkers();
}

// Load danh sách ngập khi mở web
updateBlockedList();
