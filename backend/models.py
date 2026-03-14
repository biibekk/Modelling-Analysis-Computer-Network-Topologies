import networkx as nx
import random

LATENCY_RANGE = (1, 10)
random.seed(42)

def add_latency(G, low=1, high=10):
    for u, v in G.edges():
        G[u][v]["latency"] = random.randint(low, high)

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

def star_topology(n=20):
    """1 central hub connected to n hosts."""
    G = nx.Graph()
    G.add_node("Hub", role="core")
    for i in range(n):
        h = f"H{i}"
        G.add_node(h, role="host")
        G.add_edge("Hub", h)
    add_latency(G)
    return G


def ring_topology(n=15):
    """n switches connected in a ring, each with 1 host."""
    G = nx.Graph()
    switches = [f"SW{i}" for i in range(n)]
    for s in switches:
        G.add_node(s, role="switch")
    for i in range(n):
        G.add_edge(switches[i], switches[(i + 1) % n])
    for i, s in enumerate(switches):
        h = f"H{i}"
        G.add_node(h, role="host")
        G.add_edge(s, h)
    add_latency(G)
    return G


def mesh_topology(n=10):
    """Full mesh: every node connected to every other. All nodes are switches with 1 host each."""
    G = nx.Graph()
    switches = [f"SW{i}" for i in range(n)]
    for s in switches:
        G.add_node(s, role="switch")

    for i in range(n):
        for j in range(i + 1, n):
            G.add_edge(switches[i], switches[j])

    for i, s in enumerate(switches):
        h = f"H{i}"
        G.add_node(h, role="host")
        G.add_edge(s, h)
    add_latency(G)
    return G


def grid_topology(rows=5, cols=5):
    """2D grid of switches, each with 1 host."""
    G = nx.Graph()
    switches = {}
    for r in range(rows):
        for c in range(cols):
            name = f"SW_{r}_{c}"
            switches[(r, c)] = name
            G.add_node(name, role="switch")

    # horizontal edges
    for r in range(rows):
        for c in range(cols - 1):
            G.add_edge(switches[(r, c)], switches[(r, c + 1)])
    # vertical edges
    for r in range(rows - 1):
        for c in range(cols):
            G.add_edge(switches[(r, c)], switches[(r + 1, c)])

    # one host per switch
    hid = 0
    for (r, c), s in switches.items():
        h = f"H{hid}"
        G.add_node(h, role="host")
        G.add_edge(s, h)
        hid += 1
    add_latency(G)
    return G

def campus_network():
    """University campus: Core Router -> Building Routers -> Floor Switches -> Hosts."""
    G = nx.Graph()

    G.add_node("Core_Router", role="core")
    G.add_node("Core_Router_Backup", role="core")
    G.add_edge("Core_Router", "Core_Router_Backup", bandwidth="100 Gbps", capacity=100, latency=0.1)

    buildings = ["Library", "Admin", "CS_Dept", "Engineering", "Dorms"]

    hid = 0
    for bldg in buildings:
        br = f"{bldg}_Router"
        G.add_node(br, role="router")
        G.add_edge("Core_Router", br, bandwidth="40 Gbps", capacity=40, latency=0.3)
        G.add_edge("Core_Router_Backup", br, bandwidth="40 Gbps", capacity=40, latency=0.3)

        for floor in range(1, 3):
            sw = f"{bldg}_Floor{floor}_SW"
            G.add_node(sw, role="switch")
            G.add_edge(br, sw, bandwidth="10 Gbps", capacity=10, latency=0.8)

            for _ in range(3):
                h = f"H{hid}"
                G.add_node(h, role="host")
                G.add_edge(sw, h, bandwidth="1 Gbps", capacity=1, latency=1.5)
                hid += 1

    return G


def wan_network():
    """Simplified WAN: cities connected with high-latency links."""
    G = nx.Graph()

    cities = {
        "NewYork": "city",
        "London": "city",
        "Tokyo": "city",
        "Mumbai": "city",
        "Sydney": "city",
        "Berlin": "city",
        "SaoPaulo": "city",
        "Singapore": "city",
    }

    for city, role in cities.items():
        G.add_node(city, role=role)

    links = [
        ("NewYork", "London", 70),
        ("NewYork", "SaoPaulo", 120),
        ("London", "Berlin", 15),
        ("London", "Mumbai", 100),
        ("Berlin", "Mumbai", 90),
        ("Mumbai", "Singapore", 45),
        ("Mumbai", "Tokyo", 85),
        ("Singapore", "Tokyo", 55),
        ("Singapore", "Sydney", 90),
        ("Tokyo", "Sydney", 100),
        ("NewYork", "Tokyo", 150),
        ("London", "Singapore", 160),
    ]

    for src, tgt, lat in links:
        G.add_edge(src, tgt, latency=lat)

    for i, city in enumerate(cities):
        h = f"Host_{city}"
        G.add_node(h, role="host")
        G.add_edge(city, h, latency=1)

    return G


def wireless_city():
    """City-wide wireless: Base Stations -> Access Points -> Mobile Devices."""
    G = nx.Graph()

    G.add_node("City_Controller", role="core")

    zones = ["Downtown", "Suburb_N", "Suburb_S", "Industrial", "University"]

    mid = 0
    for zone in zones:

        bs = f"{zone}_BS"
        G.add_node(bs, role="base_station")
        G.add_edge("City_Controller", bs, latency=random.randint(5, 15))

        for ap_i in range(2):
            ap = f"{zone}_AP{ap_i}"
            G.add_node(ap, role="access_point")
            G.add_edge(bs, ap, latency=random.randint(2, 8))

            for _ in range(3):
                m = f"Mobile_{mid}"
                G.add_node(m, role="host")
                G.add_edge(ap, m, latency=random.randint(1, 5))
                mid += 1

    zone_names = [f"{z}_BS" for z in zones]
    for i in range(len(zone_names) - 1):
        G.add_edge(zone_names[i], zone_names[i + 1], latency=random.randint(10, 25))

    return G


def campus_2tier_collapsed():
    """Collapsed Core: Core/Distribution merged. Floor switches connect directly to redundant Core Switches."""
    G = nx.Graph()

    G.add_node("Core_SW1", role="core")
    G.add_node("Core_SW2", role="core")
    G.add_edge("Core_SW1", "Core_SW2", latency=0.1, capacity=100, bandwidth="100 Gbps")

    buildings = ["Library", "Admin", "CS_Dept", "Engineering", "Dorms"]
    hid = 0
    for bldg in buildings:
        for floor in range(1, 3):
            sw = f"{bldg}_Floor{floor}_SW"
            G.add_node(sw, role="switch")
            G.add_edge("Core_SW1", sw, latency=0.3, capacity=40, bandwidth="40 Gbps")
            G.add_edge("Core_SW2", sw, latency=0.3, capacity=40, bandwidth="40 Gbps")

            for _ in range(3):
                h = f"H{hid}"
                G.add_node(h, role="host")
                G.add_edge(sw, h, latency=1.5, capacity=1, bandwidth="1 Gbps")
                hid += 1
    return G


def campus_leaf_spine():
    """Modern Campus Fabric: Every access leaf connects to every spine core."""
    G = nx.Graph()

    spines = ["Spine_1", "Spine_2"]
    for s in spines:
        G.add_node(s, role="core")
    G.add_edge("Spine_1", "Spine_2", latency=0.1, capacity=100, bandwidth="100 Gbps")

    buildings = ["Library", "Admin", "CS_Dept", "Engineering", "Dorms"]
    hid = 0
    for bldg in buildings:

        leaf = f"{bldg}_Leaf"
        G.add_node(leaf, role="switch")

        for s in spines:
            G.add_edge(s, leaf, latency=0.3, capacity=40, bandwidth="40 Gbps")

        for _ in range(6):
            h = f"H{hid}"
            G.add_node(h, role="host")
            G.add_edge(leaf, h, latency=1.5, capacity=1, bandwidth="1 Gbps")
            hid += 1
    return G


def campus_partial_mesh():
    """Survivable Hybrid: 3-Tier model + Inter-building links (Partial Mesh) for high availability."""
    G = campus_network() 

    mesh_links = [
        ("Library_Router", "Admin_Router"),
        ("Admin_Router", "CS_Dept_Router"),
        ("CS_Dept_Router", "Engineering_Router"),
        ("Engineering_Router", "Dorms_Router"),
        ("Dorms_Router", "Library_Router")
    ]
    
    for u, v in mesh_links:
        if G.has_node(u) and G.has_node(v):
            G.add_edge(u, v, latency=0.8, capacity=10, bandwidth="10 Gbps", type="mesh_link")
            
    return G
