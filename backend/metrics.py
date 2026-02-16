import networkx as nx
import random

# -------------------------------
# BASIC UTILS
# -------------------------------

def count_hosts(G):
    return sum(1 for _, d in G.nodes(data=True) if d.get("role") == "host")

# -------------------------------
# SIZE METRICS
# -------------------------------

def node_count(G):
    return G.number_of_nodes()


def link_count(G):
    return G.number_of_edges()


def cost_efficiency(G):
    """Links per node ratio — lower means cheaper to build."""
    n = G.number_of_nodes()
    if n == 0:
        return 0
    return round(G.number_of_edges() / n, 3)

# -------------------------------
# PATH METRICS
# -------------------------------

def sampled_host_path_length(G, samples=200):
    hosts = [n for n, d in G.nodes(data=True) if d.get("role") == "host"]
    if len(hosts) < 2:
        return 0
    total, count = 0, 0

    for _ in range(samples):
        u, v = random.sample(hosts, 2)
        try:
            total += nx.shortest_path_length(G, u, v)
            count += 1
        except nx.NetworkXNoPath:
            pass

    return total / count if count else float("inf")


def weighted_host_path(G, samples=200):
    hosts = [n for n, d in G.nodes(data=True) if d.get("role") == "host"]
    if len(hosts) < 2:
        return 0
    total, count = 0, 0

    for _ in range(samples):
        u, v = random.sample(hosts, 2)
        try:
            total += nx.shortest_path_length(G, u, v, weight="latency")
            count += 1
        except nx.NetworkXNoPath:
            pass

    return total / count if count else float("inf")


def sampled_diameter(G, samples=200):
    nodes = list(G.nodes())
    if len(nodes) < 2:
        return 0
    max_d = 0

    for _ in range(samples):
        u, v = random.sample(nodes, 2)
        try:
            max_d = max(max_d, nx.shortest_path_length(G, u, v))
        except nx.NetworkXNoPath:
            pass

    return max_d

# -------------------------------
# CONNECTIVITY METRICS
# -------------------------------

def largest_component_ratio(G):
    if G.number_of_nodes() == 0:
        return 0
    largest = max(nx.connected_components(G), key=len)
    return len(largest) / G.number_of_nodes()


def host_connectivity_ratio(G):
    hosts = [n for n, d in G.nodes(data=True) if d.get("role") == "host"]
    if not hosts:
        return 0

    largest = max(nx.connected_components(G), key=len)
    reachable = sum(1 for h in hosts if h in largest)
    return reachable / len(hosts)


def redundancy(G):
    """Edge connectivity: minimum number of edges to remove to disconnect the graph."""
    if G.number_of_nodes() < 2:
        return 0
    try:
        return nx.edge_connectivity(G)
    except Exception:
        return 0

# -------------------------------
# CENTRALITY METRICS
# -------------------------------

def max_betweenness(G, k=50):
    # Use k-node sampling for approximation if graph is large
    # This prevents the UI from freezing on large topologies
    if G.number_of_nodes() == 0:
        return 0
    if len(G) > k:
        bc = nx.betweenness_centrality(G, k=k)
    else:
        bc = nx.betweenness_centrality(G)
    return max(bc.values()) if bc else 0


def avg_clustering(G):
    """Average clustering coefficient — measures local density of connections."""
    try:
        return nx.average_clustering(G)
    except Exception:
        return 0

# -------------------------------
# FAILURE MODEL
# -------------------------------

def targeted_core_failures(G, k):
    # Find nodes with role "core", or if none, use highest betweenness nodes
    core_nodes = [n for n, d in G.nodes(data=True) if d.get("role") == "core"]

    if not core_nodes:
        # Fallback: target highest-betweenness non-host nodes
        non_hosts = [n for n, d in G.nodes(data=True) if d.get("role") != "host"]
        if not non_hosts:
            return []
        centrality = nx.betweenness_centrality(G)
        core_nodes = sorted(non_hosts, key=lambda n: centrality.get(n, 0), reverse=True)
    else:
        centrality = nx.betweenness_centrality(G)
        core_nodes = sorted(
            core_nodes,
            key=lambda n: centrality.get(n, 0),
            reverse=True
        )

    failed = core_nodes[:k]
    G.remove_nodes_from(failed)
    return failed
