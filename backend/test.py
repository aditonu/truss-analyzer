import requests, json

data = {
    "nodes": [
        {"id": 0, "x": 0, "y": 0},
        {"id": 1, "x": 5, "y": 2},
        {"id": 2, "x": 10, "y": 0}
    ],
    "members": [
        {"id": "M1", "node1": 0, "node2": 1},
        {"id": "M2", "node1": 1, "node2": 2},
        {"id": "M3", "node1": 0, "node2": 2}
    ],
    "supports": [
        {"node_id": 0, "type": "pin"},
        {"node_id": 2, "type": "roller_y"}
    ],
    "forces": [
        {"node_id": 1, "fx": 0, "fy": -10000}
    ]
}

r = requests.post("http://localhost:5000/api/analyze", json=data)
print(json.dumps(r.json(), indent=2))