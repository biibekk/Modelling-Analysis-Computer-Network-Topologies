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


# -------------------------------
# BANDWIDTH-BASED ANALYSES
# -------------------------------

def max_flow_between_departments(G):
    """Calculate maximum flow between all unique pairs of department routers."""
    departments = [n for n, d in G.nodes(data=True) if d.get("role") == "router"]
    if len(departments) < 2:
        return []
    
    results = []
    # Use capacity attribute for flow
    # Ensure all edges have capacity, default to 1 if missing
    G_temp = G.copy()
    for u, v, d in G_temp.edges(data=True):
        if "capacity" not in d:
            G_temp[u][v]["capacity"] = 1

    for i in range(len(departments)):
        for j in range(i + 1, len(departments)):
            u, v = departments[i], departments[j]
            try:
                flow_value, _ = nx.maximum_flow(G_temp, u, v, capacity="capacity")
                results.append({
                    "source": u,
                    "target": v,
                    "flow": flow_value
                })
            except Exception:
                pass
    return results


def detect_bottlenecks(G):
    """
    Identify links that frequently appear in the minimum cut 
    between different departments.
    """
    departments = [n for n, d in G.nodes(data=True) if d.get("role") == "router"]
    if len(departments) < 2:
        return []
    
    G_temp = G.copy()
    for u, v, d in G_temp.edges(data=True):
        if "capacity" not in d:
            G_temp[u][v]["capacity"] = 1

    bottleneck_counts = {}
    
    # Analyze min-cuts for all department pairs
    for i in range(len(departments)):
        for j in range(i + 1, len(departments)):
            u, v = departments[i], departments[j]
            try:
                cut_value, partition = nx.minimum_cut(G_temp, u, v, capacity="capacity")
                reachable, non_reachable = partition
                # Edges spanning the partition are the min-cut edges
                for edge in G_temp.edges():
                    u_edge, v_edge = edge
                    if (u_edge in reachable and v_edge in non_reachable) or \
                       (u_edge in non_reachable and v_edge in reachable):
                        edge_key = tuple(sorted(edge))
                        bottleneck_counts[edge_key] = bottleneck_counts.get(edge_key, 0) + 1
            except Exception:
                pass
    
    # Format and sort results
    results = []
    for edge, count in bottleneck_counts.items():
        results.append({
            "edge": f"{edge[0]} <-> {edge[1]}",
            "frequency": count
        })
    
    results.sort(key=lambda x: x["frequency"], reverse=True)
    return results[:10]  # Return top 10 bottlenecks


def simulate_congestion(G, load_factor=1.2):
    """
    Simulate traffic demand between random hosts and identify 
    congested links where demand exceeds capacity.
    """
    hosts = [n for n, d in G.nodes(data=True) if d.get("role") == "host"]
    if not hosts:
        return []
    
    # Initialize link loads
    link_loads = {tuple(sorted(e)): 0.0 for e in G.edges()}
    
    # Simulate high-traffic scenario: many random host-to-host flows
    num_flows = len(hosts) * 3
    for _ in range(num_flows):
        u, v = random.sample(hosts, 2)
        try:
            # Bandwidth-aware routing (prefer higher capacity links)
            path = nx.shortest_path(G, u, v, weight=lambda u, v, d: 1.0 / d.get("capacity", 0.1))
            # Random demand between 0.5 and 2.0 Gbps
            demand = random.uniform(0.5, 2.0) * load_factor
            
            for i in range(len(path) - 1):
                edge = tuple(sorted((path[i], path[i+1])))
                if edge in link_loads:
                    link_loads[edge] += demand
        except nx.NetworkXNoPath:
            pass
            
    congested_links = []
    for edge, load in link_loads.items():
        capacity = G[edge[0]][edge[1]].get("capacity", 1.0)
        utilization = (load / capacity) * 100
        if utilization > 70:  # Report links over 70% utilization
            congested_links.append({
                "edge": f"{edge[0]} <-> {edge[1]}",
                "load": round(load, 2),
                "capacity": capacity,
                "utilization": round(utilization, 2)
            })
            
    congested_links.sort(key=lambda x: x["utilization"], reverse=True)
    return congested_links


def bandwidth_aware_routing_sample(G):
    """Compare normal shortest path vs bandwidth-aware path for a few sample pairs."""
    hosts = [n for n, d in G.nodes(data=True) if d.get("role") == "host"]
    if len(hosts) < 2:
        return []
    
    samples = []
    for _ in range(3):
        u, v = random.sample(hosts, 2)
        try:
            # 1. Hop-count shortest path
            hop_path = nx.shortest_path(G, u, v)
            
            # 2. Bandwidth-aware (weights = 1/capacity)
            bw_weight = lambda u, v, d: 1.0 / d.get("capacity", 0.1)
            bw_path = nx.shortest_path(G, u, v, weight=bw_weight)
            
            samples.append({
                "from": u,
                "to": v,
                "standard_path": hop_path,
                "bw_aware_path": bw_path,
                "same": hop_path == bw_path
            })
        except nx.NetworkXNoPath:
            pass
            
    return samples
