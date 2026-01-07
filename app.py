from pathlib import Path
import heapq
import math

from flask import Flask, jsonify, render_template, request
import networkx as nx
import osmnx as ox


BASE_DIR = Path(__file__).resolve().parent                # Lấy đường dẫn thư mục hiện tại của file code
PROJECT_ROOT = BASE_DIR if (BASE_DIR / "Frontend").exists() else BASE_DIR.parent     # Xác định thư mục gốc dự án
TEMPLATE_DIR = PROJECT_ROOT / "Frontend" / "templates"         # Đường dẫn chứa các file HTML
STATIC_DIR = PROJECT_ROOT / "Frontend" / "static"           # Đường dẫn chứa các file tĩnh (CSS, JS, hình ảnh)

app = Flask(
    __name__,
    template_folder=str(TEMPLATE_DIR),
    static_folder=str(STATIC_DIR),
)

# Map configuration
LOCATION = "Ha Dinh, Thanh Xuan, Ha Noi"
CENTER_POINT = (20.9875, 105.8123)
DISTANCE = 3000
NETWORK_TYPE = "drive"

G = None                   # Đồ thị chuyển đổi hệ tọa độ phẳng (m)   
G_gps = None               # Đồ thị gốc với tọa độ GPS (lat/lng)
blocked_edges = set()      # Tập hợp các cạnh bị chặn
graph_ready = False        # trạng thái đồ thị
graph_load_error = None    # Lỗi tải đồ thị
BLOCKED_PENALTY = 10000    # Hệ số phạt cho cạnh bị chặn
SPEED_KMH = 30              # Tốc độ di chuyển mặc định (km/h)

print(f"Tải lại đồ thị tại {LOCATION}...")
try:

    # Tải đồ thị từ OSMNx quanh Hạ Đình bán kính 3000m
    G = ox.graph_from_point(
        CENTER_POINT,
        dist=DISTANCE,
        network_type=NETWORK_TYPE,
        simplify=True,                 # Loại bỏ các nút thừa để đơn giản hóa đồ thị
    )
    G_gps = G.copy()

    # Chuyển tọa độ (lat/lng) sang hệ phẳng
    G = ox.project_graph(G)
    graph_ready = True
    print("Đồ thị đã được tải thành công.")

except Exception as e:
    graph_load_error = str(e)
    print(f"Đồ thị tải thất bại: {graph_load_error}")


def ensure_graph_available():
    # Báo lỗi nếu đồ thị cơ sở chưa sẵn sàng.
    if graph_ready and G is not None and G_gps is not None:
        return None
    message = "Đồ thị chưa sẵn sàng."
    if graph_load_error:
        message = f"{message} {graph_load_error}"
    return jsonify({"error": message}), 503


def get_nearest_node(lat, lng):
    # Trả về node gần nhất cho tọa độ lat/lng đã cho.
    return ox.nearest_nodes(G_gps, X=lng, Y=lat)


def normalize_points(points):
    # Chuẩn hóa danh sách điểm thành các tuple (lat, lng).
    normalized = []
    for item in points:
        if not isinstance(item, (list, tuple)) or len(item) != 2:
            continue
        try:
            lat = float(item[0])
            lng = float(item[1])
        except (TypeError, ValueError):
            continue
        normalized.append((lat, lng))
    return normalized


def haversine_m(lat1, lng1, lat2, lng2):
    # Tính khoảng cách haversine giữa hai điểm (m).
    radius = 6371000.0
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lng2 - lng1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    return 2 * radius * math.asin(math.sqrt(a))


def compute_circle_from_points(points):
    # Tính bán kính bao phủ tối thiểu từ tập hợp điểm.
    count = len(points)
    lat = sum(p[0] for p in points) / count
    lng = sum(p[1] for p in points) / count
    radius = 0.0
    for p in points:
        radius = max(radius, haversine_m(lat, lng, p[0], p[1]))
    return lat, lng, radius


def project_relative(center_lat, center_lng, lat, lng):
    # Chuyển tọa độ địa lý sang hệ tọa độ phẳng tương đối với tâm
    meters_per_deg_lat = 111132.92
    meters_per_deg_lng = 111412.84 * math.cos(math.radians(center_lat))
    x = (lng - center_lng) * meters_per_deg_lng     
    y = (lat - center_lat) * meters_per_deg_lat
    return x, y


def segment_intersects_circle(center_lat, center_lng, radius_m, lat1, lng1, lat2, lng2):
    # Kiểm tra nếu đoạn thẳng giao với hình tròn.
    x1, y1 = project_relative(center_lat, center_lng, lat1, lng1)
    x2, y2 = project_relative(center_lat, center_lng, lat2, lng2)
    dx = x2 - x1
    dy = y2 - y1
    if dx == 0 and dy == 0:
        return (x1 * x1 + y1 * y1) <= radius_m * radius_m
    t = -(x1 * dx + y1 * dy) / (dx * dx + dy * dy)          # t = - OA · AB / |AB|^2
    if t < 0:
        t = 0
    elif t > 1:
        t = 1
    nx = x1 + t * dx
    ny = y1 + t * dy
    return (nx * nx + ny * ny) <= radius_m * radius_m


def edge_in_circle(center_lat, center_lng, radius_m, u, v, data):
    # Kiểm tra nếu cạnh giao với hình tròn.
    node_u = G_gps.nodes[u]    
    node_v = G_gps.nodes[v]
    points = [(node_u["y"], node_u["x"]), (node_v["y"], node_v["x"])]
    geom = data.get("geometry")      
    if geom is not None:        # nếu cạnh có hình học, sử dụng nó để kiểm tra chính xác hơn
        try:
            points = [(y, x) for x, y in geom.coords]       
        except Exception:
            points = [(node_u["y"], node_u["x"]), (node_v["y"], node_v["x"])]       
    for (lat1, lng1), (lat2, lng2) in zip(points[:-1], points[1:]):        # Chia đoạn cạnh thành các đoạn thẳng nhỏ
        if segment_intersects_circle(center_lat, center_lng, radius_m, lat1, lng1, lat2, lng2):
            return True
    return False


# trả về trang chính
@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/load", methods=["POST"])
def load_map():
    error_response = ensure_graph_available()
    if error_response:
        return error_response

    nodes_data = []
    for node_id, data in G_gps.nodes(data=True):
        nodes_data.append(
            {
                "id": node_id,
                "lat": data["y"],
                "lng": data["x"],
            }
        )
    return jsonify({"nodes": nodes_data, "location": LOCATION})      # trả về nút để vẽ bản đồ

@app.route("/api/add_blocked", methods=["POST"])
def add_blocked():
    error_response = ensure_graph_available()
    if error_response:
        return error_response

    data = request.json or {}
    points = data.get("points")
    if points:
        normalized = normalize_points(points)
        if len(normalized) < 2:
            return jsonify({"error": "At least 2 points are required."}), 400

        center_lat, center_lng, radius_m = compute_circle_from_points(normalized)
        if radius_m <= 0:
            radius_m = 1.0

        edges_blocked = 0
        for u, v, _key, data in G_gps.edges(keys=True, data=True):
            if edge_in_circle(center_lat, center_lng, radius_m, u, v, data):
                if (u, v) not in blocked_edges:
                    edges_blocked += 1
                blocked_edges.add((u, v))
                blocked_edges.add((v, u))

        return jsonify(
            {
                "status": "success",
                "center": [center_lat, center_lng],
                "radius_m": radius_m,
                "edges": edges_blocked,
            }
        )

@app.route("/api/path", methods=["POST"])
def find_path():
    error_response = ensure_graph_available()
    if error_response:
        return error_response

    data = request.json or {}
    start = data.get("start")
    goal = data.get("goal")
    algo = (data.get("algorithm") or "astar").lower()   # Chọn thuật toán tìm đường mặc định là A*

    if not start or not goal or len(start) != 2 or len(goal) != 2:
        return jsonify({"error": "Missing start or goal coordinates."}), 400

    start_lat, start_lng = start
    goal_lat, goal_lng = goal

    # Remove flooded edges for all algorithms to avoid conflicts
    G_temp = G.copy()
    apply_blocked_edges(G_temp)

    start_node = get_nearest_node(start_lat, start_lng)
    goal_node = get_nearest_node(goal_lat, goal_lng)
    print(
        f"Path request algo={algo} start={start_node} goal={goal_node} blocked_edges={len(blocked_edges)}"
    )

    path = None
    path_graph = G_temp
    try:
        if algo == "astar":
            path = astar_path(G_temp, start_node, goal_node)
        elif algo == "dijkstra":
            path = dijkstra_path(G_temp, start_node, goal_node)
        elif algo == "bfs":
            path = bfs_path(G_temp, start_node, goal_node)
        else:
            return jsonify({"error": "Unsupported algorithm"}), 400
    except ValueError:
        # Thử lại với đồ thị vô hướng nếu không tìm thấy đường đi
        G_undirected = G_temp.to_undirected()
        path_graph = G_undirected
        try:
            if algo == "astar":
                path = astar_path(G_undirected, start_node, goal_node)
            elif algo == "dijkstra":
                path = dijkstra_path(G_undirected, start_node, goal_node)
            else:
                path = bfs_path(G_undirected, start_node, goal_node)
        except Exception as err:
            print(f"No path even after undirected fallback: {err}")
            return jsonify({"error": "No path found."}), 400
    except Exception as e:
        print(f"Error finding route: {e}")
        return jsonify({"error": f"Failed to compute route: {e}"}), 400

    if path is None:
        return jsonify({"error": "No path found."}), 400

    route_coords = []
    for node in path:
        route_coords.append([G_gps.nodes[node]["y"], G_gps.nodes[node]["x"]])

    def edge_length(graph, u, v):
        data = graph.get_edge_data(u, v)
        if data is None and graph.is_directed():
            data = graph.get_edge_data(v, u)
        if data is None:
            return 0
        # Xử lý đa cạnh giữa hai nút
        if isinstance(data, dict) and any(isinstance(val, dict) for val in data.values()):
            for attr in data.values():
                if isinstance(attr, dict) and "length" in attr:
                    return attr["length"]
        if isinstance(data, dict) and "length" in data:
            return data["length"]
        return 0

    total_length = 0
    for u, v in zip(path[:-1], path[1:]):
        total_length += edge_length(path_graph, u, v)

    speed_mps = (SPEED_KMH * 1000) / 3600
    total_time_sec = total_length / speed_mps if speed_mps > 0 else 0

    return jsonify(
        {
            "path": route_coords,
            "total_length_m": total_length,
            "total_time_sec": total_time_sec,
            "speed_kmh": SPEED_KMH,
            "status": "success",
        }
    )

# Trả về độ dài cạnh nhỏ nhất giữa u và v.
def min_edge_length(graph, u, v):
   
    data = graph.get_edge_data(u, v)
    if not data:
        return None
    if isinstance(data, dict) and any(isinstance(val, dict) for val in data.values()):
        best = None
        for attr in data.values():
            if isinstance(attr, dict) and "length" in attr:
                length = attr["length"]
                if best is None or length < best:
                    best = length
        return best
    if isinstance(data, dict):
        return data.get("length")
    return None

# Tính heuristic Euclidean giữa hai nút.
def heuristic(graph, node, target):
    try:
        n1 = graph.nodes[node]
        n2 = graph.nodes[target]
        if "x" in n1 and "y" in n1 and "x" in n2 and "y" in n2:
            return math.hypot(n1["x"] - n2["x"], n1["y"] - n2["y"])
    except Exception:
        pass
    return 0.0

# Xây dựng lại đường đi từ bản đồ trước đó.
def reconstruct_path(prev, target):
    path = []
    current = target
    while current is not None:
        path.append(current)
        current = prev.get(current)
    return list(reversed(path))

# Lấy các nút láng giềng của một nút.
def iter_neighbors(graph, node):
    if hasattr(graph, "successors"):
        return graph.successors(node)
    return graph.neighbors(node)

# Thuật toán tìm đường BFS.
def bfs_path(graph, source, target):

    visited = {source}
    prev = {source: None}
    queue = [source]
    while queue:
        node = queue.pop(0)
        if node == target:
            return reconstruct_path(prev, target)
        for neighbor in iter_neighbors(graph, node):
            if neighbor in visited:
                continue
            visited.add(neighbor)
            prev[neighbor] = node
            queue.append(neighbor)
    raise ValueError("No path found.")

# Thuật toán tìm đường Dijkstra.
def dijkstra_path(graph, source, target):
    dist = {source: 0.0}
    prev = {source: None}
    heap = [(0.0, source)]
    visited = set()

    while heap:
        current_dist, node = heapq.heappop(heap)
        if node in visited:
            continue
        visited.add(node)

        if node == target:
            return reconstruct_path(prev, target)

        for neighbor in iter_neighbors(graph, node):
            if neighbor in visited:
                continue
            edge_cost = min_edge_length(graph, node, neighbor) or 1.0
            new_dist = current_dist + edge_cost
            if new_dist < dist.get(neighbor, float("inf")):
                dist[neighbor] = new_dist
                prev[neighbor] = node
                heapq.heappush(heap, (new_dist, neighbor))

    raise ValueError("No path found.")

# Thuật toán tìm đường A*.
def astar_path(graph, source, target):
    g_score = {source: 0.0}
    f_score = {source: heuristic(graph, source, target)}
    prev = {source: None}
    heap = [(f_score[source], source)]
    visited = set()

    while heap:
        _, node = heapq.heappop(heap)
        if node in visited:
            continue
        if node == target:
            return reconstruct_path(prev, target)
        visited.add(node)

        for neighbor in iter_neighbors(graph, node):
            if neighbor in visited:
                continue
            tentative_g = g_score[node] + (min_edge_length(graph, node, neighbor) or 1.0)
            if tentative_g < g_score.get(neighbor, float("inf")):
                g_score[neighbor] = tentative_g
                f_score[neighbor] = tentative_g + heuristic(graph, neighbor, target)
                prev[neighbor] = node
                heapq.heappush(heap, (f_score[neighbor], neighbor))

    raise ValueError("No path found.")

# Áp dụng các cạnh bị chặn lên đồ thị.
def apply_blocked_edges(graph, mode="penalize"):
    for u, v in blocked_edges:
        if not graph.has_edge(u, v) and not graph.has_edge(v, u):
            continue
        # if mode == "remove":
        #     if graph.has_edge(u, v):
        #         for key in list(graph[u][v].keys()):
        #             graph.remove_edge(u, v, key=key)
        #     if graph.has_edge(v, u):
        #         for key in list(graph[v][u].keys()):
        #             graph.remove_edge(v, u, key=key)
        else:  # penalize
            if graph.has_edge(u, v):
                for key in graph[u][v]:
                    graph[u][v][key]["length"] *= BLOCKED_PENALTY
            if graph.has_edge(v, u):
                for key in graph[v][u]:
                    graph[v][u][key]["length"] *= BLOCKED_PENALTY


# Xóa các cạnh bị chặn khỏi đồ thị.
@app.route("/api/clear_blocked", methods=["POST"])
def clear_blocked():
    error_response = ensure_graph_available()
    if error_response:
        return error_response

    blocked_edges.clear()
    return jsonify({"status": "success"})


if __name__ == "__main__":
    app.run(debug=True)
