from flask import Flask, render_template, request, jsonify
import requests

app = Flask(__name__)

# Lưu tạm tuyến đường bị ngập
blocked_routes = []

@app.route("/")
def index():
    return render_template("index.html")

@app.route("/route", methods=["POST"])
def route():
    data = request.get_json()
    start = data.get("start")
    end = data.get("end")

    url = f"http://router.project-osrm.org/route/v1/driving/{start['lng']},{start['lat']};{end['lng']},{end['lat']}?overview=full&geometries=geojson"
    response = requests.get(url)

    if response.status_code == 200:
        route_data = response.json()
        if route_data.get("routes"):
            geometry = route_data["routes"][0]["geometry"]
            return jsonify({"geometry": geometry, "blocked_routes": blocked_routes})

    return jsonify({"error": "Không tìm được đường đi"}), 400


@app.route("/add_blocked", methods=["POST"])
def add_blocked():
    data = request.get_json()
    start = data.get("start")
    end = data.get("end")

    if not start or not end:
        return jsonify({"error": "Thiếu thông tin tuyến"}), 400

    blocked_routes.append({"start": start, "end": end})
    return jsonify({
        "message": "Đã thêm tuyến bị ngập/tắc!",
        "blocked_routes": blocked_routes
    })


@app.route("/blocked_list")
def get_blocked_list():
    return jsonify({"blocked_routes": blocked_routes})


if __name__ == "__main__":
    app.run(debug=True)
