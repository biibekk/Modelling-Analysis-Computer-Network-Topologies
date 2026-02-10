import networkx as nx
import random

LATENCY_RANGE = (1, 10)
random.seed(42)

# -------------------------------
# UTILS
# -------------------------------

def add_latency(G):
    for u, v in G.edges():
        G[u][v]["latency"] = random.randint(*LATENCY_RANGE)

# -------------------------------
# TOPOLOGIES
# -------------------------------

def scalable_leaf_spine(num_spine, num_leaf, hosts_per_leaf):
    G = nx.Graph()

    spine = [f"S{i}" for i in range(num_spine)]
    leaf = [f"L{i}" for i in range(num_leaf)]

    for s in spine:
        G.add_node(s, role="core")
    for l in leaf:
        G.add_node(l, role="leaf")

    for s in spine:
        for l in leaf:
            G.add_edge(s, l)

    hid = 0
    for l in leaf:
        for _ in range(hosts_per_leaf):
            h = f"H{hid}"
            G.add_node(h, role="host")
            G.add_edge(l, h)
            hid += 1

    add_latency(G)
    return G


def fat_tree(k):
    G = nx.Graph()
    pods = k

    core = [f"C{i}" for i in range((k // 2) ** 2)]
    for c in core:
        G.add_node(c, role="core")

    for p in range(pods):
        agg = [f"A{p}_{i}" for i in range(k // 2)]
        edge = [f"E{p}_{i}" for i in range(k // 2)]

        for a in agg:
            G.add_node(a, role="aggregation")
        for e in edge:
            G.add_node(e, role="edge")

        for e in edge:
            for a in agg:
                G.add_edge(e, a)

        for e in edge:
            for h in range(k // 2):
                host = f"H{p}_{e}_{h}"
                G.add_node(host, role="host")
                G.add_edge(e, host)

    for i, c in enumerate(core):
        for p in range(pods):
            G.add_edge(c, f"A{p}_{i % (k // 2)}")

    add_latency(G)
    return G


def three_tier(core_n, agg_n, access_n, hosts_per_access):
    G = nx.Graph()

    core = [f"C{i}" for i in range(core_n)]
    agg = [f"A{i}" for i in range(agg_n)]
    access = [f"AC{i}" for i in range(access_n)]

    for c in core:
        G.add_node(c, role="core")
    for a in agg:
        G.add_node(a, role="aggregation")
    for ac in access:
        G.add_node(ac, role="access")

    for c in core:
        for a in agg:
            G.add_edge(c, a)

    for a in agg:
        for ac in access:
            G.add_edge(a, ac)

    hid = 0
    for ac in access:
        for _ in range(hosts_per_access):
            h = f"H{hid}"
            G.add_node(h, role="host")
            G.add_edge(ac, h)
            hid += 1

    add_latency(G)
    return G
