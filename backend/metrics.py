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
    # Create a subgraph without hosts
    core_nodes = [n for n, d in G.nodes(data=True) if d.get("role") != "host"]
    if len(core_nodes) < 2:
        return 0
    G_core = G.subgraph(core_nodes)
    try:
        return nx.edge_connectivity(G_core)
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
# ADVANCED ANALYSIS & FAILURE MODEL
# -------------------------------

def host_path_diversity(G, samples=50):
    hosts = [n for n, d in G.nodes(data=True) if d.get("role") == "host"]
    if len(hosts) < 2:
        return 0
    total_paths = 0
    count = 0
    # Use actual host count if smaller than samples
    sample_size = min(samples, len(hosts) * (len(hosts) - 1) // 2)
    for _ in range(sample_size):
        u, v = random.sample(hosts, 2)
        try:
            # Shortest paths between hosts
            paths = list(nx.all_shortest_paths(G, u, v))
            total_paths += len(paths)
            count += 1
        except (nx.NetworkXNoPath, nx.NodeNotFound):
            pass
    return total_paths / count if count > 0 else 1.0


def estimate_bisection_bandwidth(G, samples=5):
    hosts = [n for n, d in G.nodes(data=True) if d.get("role") == "host"]
    if len(hosts) < 2:
        return 0
    min_bisection = float("inf")
    for _ in range(samples):
        random.shuffle(hosts)
        mid = len(hosts) // 2
        group_a = hosts[:mid]
        group_b = hosts[mid:]
        G_temp = G.copy()
        G_temp.add_node("super_source")
        G_temp.add_node("super_sink")
        for h in group_a: G_temp.add_edge("super_source", h, capacity=float("inf"))
        for h in group_b: G_temp.add_edge("super_sink", h, capacity=float("inf"))
        for u, v in G.edges():
            if "capacity" not in G_temp[u][v]: G_temp[u][v]["capacity"] = 1
        try:
            cut_value, _ = nx.minimum_cut(G_temp, "super_source", "super_sink")
            min_bisection = min(min_bisection, cut_value)
        except:
            pass
    return min_bisection if min_bisection != float("inf") else 0


def specific_node_failures(G, failure_counts):
    """
    Simulate failures for specific roles.
    failure_counts: dict { 'core': 2, 'leaf': 1 }
    """
    failed_nodes = []
    # Calculate centrality once for all roles to be efficient
    centrality = nx.betweenness_centrality(G)
    
    for role, count in failure_counts.items():
        if count <= 0:
            continue
        nodes_of_role = [n for n, d in G.nodes(data=True) if d.get("role") == role]
        # Sort by importance (centrality)
        nodes_of_role.sort(key=lambda n: centrality.get(n, 0), reverse=True)
        to_fail = nodes_of_role[:count]
        failed_nodes.extend(to_fail)
        
    G.remove_nodes_from(failed_nodes)
    return failed_nodes


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
