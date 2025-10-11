console.log("Leaflet started");

// Khởi tạo bản đồ
const map = L.map("map").setView([21.0278, 105.8342], 12);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: "© OpenStreetMap contributors",
}).addTo(map);

let markers = [];
let routeLine = null;
let blockedLines = [];
let mode = "user";

// DOM Elements
const modeSelect = document.getElementById("modeSelect");
const clearBtn = document.getElementById("clearBtn");
const blockedList = document.getElementById("blockedList");

// Thay đổi chế độ
modeSelect.onchange = () => {
  mode = modeSelect.value;
};

// Xóa marker
clearBtn.onclick = () => {
  markers.forEach((m) => map.removeLayer(m));
  markers = [];
  if (routeLine) map.removeLayer(routeLine);
};

// Click bản đồ
map.on("click", async (e) => {
  const { lat, lng } = e.latlng;
  const marker = L.marker([lat, lng]).addTo(map);
  markers.push(marker);

  if (mode === "admin") {
    if (markers.length === 2) {
      const start = markers[0].getLatLng();
      const end = markers[1].getLatLng();
      await addBlockedRoute(start, end);
      drawBlockedLine(start, end);
      updateBlockedList();
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
async function addBlockedRoute(start, end) {
  const res = await fetch("/add_blocked", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ start, end }),
  });
  const data = await res.json();
  alert(data.message);
}

// Lấy danh sách tuyến ngập
async function updateBlockedList() {
  const res = await fetch("/blocked_list");
  const data = await res.json();
  const routes = data.blocked_routes;

  blockedList.innerHTML = "";

  if (!routes.length) {
    blockedList.innerHTML = "Chưa có tuyến nào.";
    return;
  }

  routes.forEach((r, i) => {
    const item = document.createElement("li");
    item.textContent = `Tuyến ${i + 1}: (${r.start.lat.toFixed(
      4
    )}, ${r.start.lng.toFixed(4)}) → (${r.end.lat.toFixed(
      4
    )}, ${r.end.lng.toFixed(4)})`;
    blockedList.appendChild(item);
  });
}

// Vẽ tuyến bị ngập màu đỏ
function drawBlockedLine(start, end) {
  const line = L.polyline(
    [
      [start.lat, start.lng],
      [end.lat, end.lng],
    ],
    { color: "red", weight: 5, dashArray: "8 8" }
  ).addTo(map);
  blockedLines.push(line);
}

// Tìm đường
async function findRoute() {
  const start = markers[0].getLatLng();
  const end = markers[1].getLatLng();

  const res = await fetch("/route", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ start, end }),
  });
  const data = await res.json();

  if (routeLine) map.removeLayer(routeLine);
  blockedLines.forEach((l) => map.removeLayer(l));

  if (data.geometry) {
    const coords = data.geometry.coordinates.map((c) => [c[1], c[0]]);
    routeLine = L.polyline(coords, { color: "blue", weight: 5 }).addTo(map);
    map.fitBounds(routeLine.getBounds());

    if (data.blocked_routes) {
      data.blocked_routes.forEach((r) => drawBlockedLine(r.start, r.end));
      updateBlockedList();
    }
  } else {
    alert("Không tìm được đường đi!");
  }

  clearMarkers();
}

// Load danh sách ngập khi mở web
updateBlockedList();
