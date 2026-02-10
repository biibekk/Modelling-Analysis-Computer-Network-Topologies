import networkx as nx
import random

# -------------------------------
# BASIC UTILS
# -------------------------------

def count_hosts(G):
    return sum(1 for _, d in G.nodes(data=True) if d["role"] == "host")

# -------------------------------
# METRICS
# -------------------------------

def sampled_host_path_length(G, samples=200):
    hosts = [n for n, d in G.nodes(data=True) if d["role"] == "host"]
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
    hosts = [n for n, d in G.nodes(data=True) if d["role"] == "host"]
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
    max_d = 0

    for _ in range(samples):
        u, v = random.sample(nodes, 2)
        try:
            max_d = max(max_d, nx.shortest_path_length(G, u, v))
        except nx.NetworkXNoPath:
            pass

    return max_d


def largest_component_ratio(G):
    if G.number_of_nodes() == 0:
        return 0
    largest = max(nx.connected_components(G), key=len)
    return len(largest) / G.number_of_nodes()


def host_connectivity_ratio(G):
    hosts = [n for n, d in G.nodes(data=True) if d["role"] == "host"]
    if not hosts:
        return 0

    largest = max(nx.connected_components(G), key=len)
    reachable = sum(1 for h in hosts if h in largest)
    return reachable / len(hosts)


def max_betweenness(G):
    bc = nx.betweenness_centrality(G)
    return max(bc.values())

# -------------------------------
# FAILURE MODEL
# -------------------------------

def targeted_core_failures(G, k):
    core_nodes = [n for n, d in G.nodes(data=True) if d["role"] == "core"]
    centrality = nx.betweenness_centrality(G)

    core_nodes = sorted(
        core_nodes,
        key=lambda n: centrality.get(n, 0),
        reverse=True
    )

    failed = core_nodes[:k]
    G.remove_nodes_from(failed)
    return failed
