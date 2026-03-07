from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS

import models
import metrics

import json
from networkx.readwrite import json_graph

app = Flask(__name__, static_folder='static', static_url_path='')
CORS(app)


# -------------------------------
# BUILD PREDEFINED TOPOLOGIES
# -------------------------------

ARCHITECTURES = {
    # Data Center
    "leaf-spine": models.scalable_leaf_spine(4, 8, 3),
    "fat-tree": models.fat_tree(4),
    "three-tier": models.three_tier(2, 4, 8, 3),
    # Basic / Textbook
    "star": models.star_topology(15),
    "ring": models.ring_topology(12),
    "mesh": models.mesh_topology(8),
    "grid": models.grid_topology(4, 4),
    # Real-World
    "campus": models.campus_network(),
    "wan": models.wan_network(),
    "wireless-city": models.wireless_city(),
}


def compute_all_metrics(G):
    """Compute all 13 metrics for a graph."""
    return {
        "node_count": metrics.node_count(G),
        "link_count": metrics.link_count(G),
        "avg_host_path": metrics.sampled_host_path_length(G),
        "avg_host_latency": metrics.weighted_host_path(G),
        "diameter": metrics.sampled_diameter(G),
        "max_betweenness": metrics.max_betweenness(G),
        "largest_cc_ratio": metrics.largest_component_ratio(G),
        "redundancy": metrics.redundancy(G),
        "avg_clustering": metrics.avg_clustering(G),
        "cost_efficiency": metrics.cost_efficiency(G),
        # Advanced metrics for comparison consistency
        "path_diversity": metrics.host_path_diversity(G),
        "bisection_bw": metrics.estimate_bisection_bandwidth(G),
        "host_connectivity": metrics.host_connectivity_ratio(G)
    }


# -------------------------------
# ROUTES
# -------------------------------

@app.route('/')
def serve():
    return send_from_directory(app.static_folder, 'index.html')


@app.route("/architectures")
def list_architectures():
    return jsonify(list(ARCHITECTURES.keys()))


@app.route("/graph/<arch>")
def graph(arch):
    if arch not in ARCHITECTURES:
        return jsonify({"error": "unknown architecture"}), 404

    G = ARCHITECTURES[arch]

    nodes = [
        {"data": {"id": n, "role": d.get("role")}}
        for n, d in G.nodes(data=True)
    ]

    edges = [
        {
            "data": {
                "source": u,
                "target": v,
                "latency": d.get("latency"),
                "bandwidth": d.get("bandwidth")
            }
        }
        for u, v, d in G.edges(data=True)
    ]

    return jsonify({"nodes": nodes, "edges": edges})


@app.route("/metrics/<arch>")
def graph_metrics(arch):
    if arch not in ARCHITECTURES:
        return jsonify({"error": "unknown architecture"}), 404
    G = ARCHITECTURES[arch]
    return jsonify(compute_all_metrics(G))


@app.route("/fail/<arch>", methods=["POST"])
def fail(arch):
    # Support both role-based counts (JSON) and simple k-value (query param)
    if request.is_json:
        counts = request.json.get("counts", {})
    else:
        k = int(request.args.get("k", 0))
        counts = {"core": k} # Default to core if only k provided

    if arch not in ARCHITECTURES:
        return jsonify({"error": "unknown architecture"}), 404
    G = ARCHITECTURES[arch].copy()

    if "core" in counts and len(counts) == 1 and not request.is_json:
        failed = metrics.targeted_core_failures(G, counts["core"])
    else:
        failed = metrics.specific_node_failures(G, counts)

    # Metrics for impact analysis
    return jsonify({
        "failed_nodes": failed,
        "metrics": {
            "host_connectivity": metrics.host_connectivity_ratio(G),
            "avg_host_path": metrics.sampled_host_path_length(G),
            "avg_host_latency": metrics.weighted_host_path(G),
            "path_diversity": metrics.host_path_diversity(G),
            "bisection_bw": metrics.estimate_bisection_bandwidth(G),
            "max_betweenness": metrics.max_betweenness(G)
        }
    })


# -------------------------------
# COMPARE endpoint
# -------------------------------

@app.route("/compare")
def compare():
    """Compare metrics across multiple architectures.
    Usage: GET /compare?archs=star,ring,mesh
    """
    archs_param = request.args.get("archs", "")
    arch_list = [a.strip() for a in archs_param.split(",") if a.strip()]

    if not arch_list:
        return jsonify({"error": "provide ?archs=arch1,arch2,..."}), 400

    results = {}
    for arch in arch_list:
        if arch in ARCHITECTURES:
            G = ARCHITECTURES[arch]
            results[arch] = compute_all_metrics(G)
        else:
            results[arch] = {"error": "unknown architecture"}

    return jsonify(results)


# -------------------------------
# CAMPUS NETWORK SPECIFIC ANALYSIS
# -------------------------------

@app.route("/campus-analysis")
def campus_analysis():
    """
    Specific high-level bandwidth analyses for the Campus Network.
    1. Max flow between departments
    2. Bottleneck link detection
    3. Congestion simulation
    4. Bandwidth-aware routing samples
    """
    G = ARCHITECTURES.get("campus")
    if not G:
        return jsonify({"error": "campus architecture not found"}), 404
        
    return jsonify({
        "max_flow": metrics.max_flow_between_departments(G),
        "bottlenecks": metrics.detect_bottlenecks(G),
        "congestion_simulation": metrics.simulate_congestion(G, load_factor=1.2),
        "routing_samples": metrics.bandwidth_aware_routing_sample(G)
    })


# -------------------------------
# CUSTOM GRAPH endpoint (for editor)
# -------------------------------

@app.route("/graph/custom", methods=["POST"])
def custom_graph_metrics():
    """Accept edited graph JSON (Cytoscape format) and return metrics.
    Expects JSON body: { "nodes": [...], "edges": [...] }
    """
    if not request.is_json:
        return jsonify({"error": "JSON body required"}), 400

    data = request.get_json()
    nodes = data.get("nodes", [])
    edges = data.get("edges", [])

    import networkx as nx
    G = nx.Graph()

    for n in nodes:
        d = n.get("data", n)
        nid = str(d.get("id"))
        role = d.get("role", "host")
        G.add_node(nid, role=role)

    for e in edges:
        d = e.get("data", e)
        src = str(d.get("source"))
        tgt = str(d.get("target"))
        lat = d.get("latency")
        G.add_edge(src, tgt, latency=lat if lat else 1)

    return jsonify(compute_all_metrics(G))


if __name__ == "__main__":
    app.run(debug=True)
