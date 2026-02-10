from flask import Flask, jsonify, request
from flask_cors import CORS

import models
import metrics

app = Flask(__name__)
CORS(app)


# -------------------------------
# BUILD TOPOLOGIES ONCE
# -------------------------------

ARCHITECTURES = {
    "leaf-spine": models.scalable_leaf_spine(8, 40, 20),
    "fat-tree": models.fat_tree(16),
    "three-tier": models.three_tier(4, 16, 40, 20)
}

# -------------------------------
# ROUTES
# -------------------------------

@app.route("/architectures")
def list_architectures():
    return jsonify(list(ARCHITECTURES.keys()))


@app.route("/graph/<arch>")
def graph(arch):
    G = ARCHITECTURES[arch]

    nodes = [
        {"data": {
            "id": n,
            "role": d["role"]
        }}
        for n, d in G.nodes(data=True)
    ]

    edges = [
        {"data": {
            "source": u,
            "target": v,
            "latency": d["latency"]
        }}
        for u, v, d in G.edges(data=True)
    ]

    return jsonify({"nodes": nodes, "edges": edges})


@app.route("/metrics/<arch>")
def graph_metrics(arch):
    G = ARCHITECTURES[arch]

    return jsonify({
        "avg_host_path": metrics.sampled_host_path_length(G),
        "avg_host_latency": metrics.weighted_host_path(G),
        "diameter": metrics.sampled_diameter(G),
        "max_betweenness": metrics.max_betweenness(G),
        "largest_cc_ratio": metrics.largest_component_ratio(G)
    })


@app.route("/fail/<arch>")
def fail(arch):
    k = int(request.args.get("k", 5))
    G = ARCHITECTURES[arch].copy()

    failed = metrics.targeted_core_failures(G, k)

    return jsonify({
        "failed_nodes": failed,
        "host_connectivity": metrics.host_connectivity_ratio(G)
    })


if __name__ == "__main__":
    app.run(debug=True)
