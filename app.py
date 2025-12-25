from flask import Flask, render_template, request, jsonify
import osmnx as ox
import networkx as nx

app = Flask(__name__)

# --- CẤU HÌNH ---
LOCATION = "Phường Hạ Đình, Hà Nội"
CENTER_POINT = (20.9875, 105.8123)
DISTANCE = 3000
NETWORK_TYPE = "drive"

print(f"Đang tải bản đồ khu vực {LOCATION}...")
try:
    # Tải đồ thị ban đầu
    G = ox.graph_from_point(CENTER_POINT, dist=DISTANCE, network_type=NETWORK_TYPE, simplify=True)
    # Lưu một bản đồ hệ GPS để lấy tọa độ trả về cho FE
    G_gps = G.copy() 
    # Project G để tính toán khoảng cách mét chính xác
    G = ox.project_graph(G) 
    print("Tải bản đồ thành công!")
except Exception as e:
    print(f"Lỗi tải bản đồ: {e}")

blocked_edges = set()

def get_nearest_node(lat, lng):
    """Tìm ID node gần nhất (dùng graph gốc WGS84 để khớp tọa độ lat/lng)."""
    return ox.nearest_nodes(G_gps, X=lng, Y=lat)

@app.route("/")
def index():
    return render_template("index.html")

@app.route("/api/load", methods=["POST"])
def load_map():
    nodes_data = []
    # Dùng G_gps để gửi tọa độ (lat, lng) chuẩn cho Leaflet
    for node_id, data in G_gps.nodes(data=True):
        nodes_data.append({
            "id": node_id,
            "lat": data['y'],
            "lng": data['x']
        })
    return jsonify({"nodes": nodes_data, "location": LOCATION})

@app.route("/api/add_blocked", methods=["POST"])
def add_blocked():
    data = request.json
    p1, p2 = data.get("start"), data.get("end")
    u = get_nearest_node(p1[0], p1[1])
    v = get_nearest_node(p2[0], p2[1])
    if u == v:
        return jsonify({"status": "error"}), 400

    # Tìm đường ngắn nhất giữa u, v để chặn toàn bộ đoạn đường người dùng bôi đỏ
    try:
        path = nx.shortest_path(G, u, v, weight="length")
        for a, b in zip(path[:-1], path[1:]):
            blocked_edges.add((a, b))
            blocked_edges.add((b, a))
    except Exception:
        # fallback: chỉ chặn cặp nút trực tiếp
        blocked_edges.add((u, v))
        blocked_edges.add((v, u))

    return jsonify({"status": "success"})

@app.route("/api/path", methods=["POST"])
def find_path():
    data = request.json
    start_lat, start_lng = data.get("start")
    goal_lat, goal_lng = data.get("goal")
    algo = (data.get("algorithm") or "astar").lower()

    if None in (start_lat, start_lng, goal_lat, goal_lng):
        return jsonify({"error": "Thiếu tọa độ xuất phát/đích."}), 400

    G_temp = G.copy()
    # Apply flood penalty or remove edges depending on algorithm choice
    if algo == "bfs":
        for u, v in blocked_edges:
            if G_temp.has_edge(u, v):
                for key in list(G_temp[u][v].keys()):
                    G_temp.remove_edge(u, v, key=key)
            if G_temp.has_edge(v, u):
                for key in list(G_temp[v][u].keys()):
                    G_temp.remove_edge(v, u, key=key)
    else:
        for u, v in blocked_edges:
            if G_temp.has_edge(u, v):
                for key in G_temp[u][v]:
                    G_temp[u][v][key]['length'] *= 100
            if G_temp.has_edge(v, u):
                for key in G_temp[v][u]:
                    G_temp[v][u][key]['length'] *= 100

    start_node = get_nearest_node(start_lat, start_lng)
    goal_node = get_nearest_node(goal_lat, goal_lng)
    print(f"Path request algo={algo} start={start_node} goal={goal_node} blocked_edges={len(blocked_edges)}")

    path = None
    path_graph = G_temp
    try:
        if algo == "astar":
            path = nx.astar_path(G_temp, start_node, goal_node, weight='length')
        elif algo == "dijkstra":
            path = nx.dijkstra_path(G_temp, start_node, goal_node, weight='length')
        elif algo == "bfs":
            path = nx.shortest_path(G_temp, start_node, goal_node)
        else:
            return jsonify({"error": "Unsupported algorithm"}), 400
    except nx.NetworkXNoPath:
        # Thử fallback đồ thị vô hướng để tránh bế tắc do đường một chiều
        try:
            G_undirected = G_temp.to_undirected()
            path_graph = G_undirected
            if algo == "bfs":
                path = nx.shortest_path(G_undirected, start_node, goal_node)
            else:
                path = nx.shortest_path(G_undirected, start_node, goal_node, weight="length")
        except Exception as e:
            print(f"No path even after undirected fallback: {e}")
            return jsonify({"error": "Không tìm thấy đường đi (đồ thị không kết nối)."}), 400
    except Exception as e:
        print(f"Error finding route: {e}")
        return jsonify({"error": f"Lỗi tính đường: {e}"}), 400

    if path is None:
        return jsonify({"error": "Không tìm thấy đường đi."}), 400

    route_coords = []
    for node in path:
        route_coords.append([G_gps.nodes[node]['y'], G_gps.nodes[node]['x']])

    def edge_length(graph, u, v):
        data = graph.get_edge_data(u, v)
        if data is None and graph.is_directed():
            data = graph.get_edge_data(v, u)
        if data is None:
            return 0
        # MultiGraph returns dict of key -> attr; Graph returns attr dict
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

    return jsonify({
        "path": route_coords,
        "total_length_m": total_length,
        "status": "success"
    })
@app.route("/api/clear_blocked", methods=["POST"])
def clear_blocked():
    global blocked_edges
    blocked_edges = set()
    return jsonify({"status": "success"})

if __name__ == "__main__":
    app.run(debug=True)
