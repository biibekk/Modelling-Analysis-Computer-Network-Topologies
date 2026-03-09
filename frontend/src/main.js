import cytoscape from "cytoscape";
import "./style.css";

const API = import.meta.env.PROD ? "" : "http://127.0.0.1:5000";

const COLORS = {
  core: "#ef4444",
  leaf: "#f59e0b",
  aggregation: "#d946ef",
  access: "#10b981",
  host: "#3b82f6",
  router: "#8b5cf6",
  base_station: "#f97316",
  access_point: "#06b6d4",
  city: "#14b8a6",
  failed: "#000000",
  edge_line: "rgba(148, 163, 184, 0.2)"
};

let cy;
let currentArch = "";
let editorMode = null; // null | "addLink" | "delete"
let linkSource = null; // for two-click link creation
let isClusterLayout = true; // default to cluster layout
let baselineMetrics = {};     // Stores metrics of original network.
let latestFailureMetrics = {};     // Stores metrics after failure simulation.  

const ROLE_MAP = {
  "leaf-spine": { "core": "Spine", "leaf": "Leaf", "host": "Host" },
  "fat-tree": { "core": "Core", "aggregation": "Aggregation", "edge": "Edge", "host": "Host" },
  "three-tier": { "core": "Core", "aggregation": "Aggregation", "access": "Access", "host": "Host" },
  "3-tier": { "core": "Core", "router": "Bldg Router", "switch": "Floor SW", "host": "Host" }
};

const INFERENCES = {
  avg_host_path: {
    title: "Path Efficiency",
    impact: (v) => v < 4 ? `Excellent efficiency: The current average of ${v.toFixed(2)} hops indicates a very flat architecture, minimizing switch traversals and reducing overall packet delay.` : `Standard efficiency: An average of ${v.toFixed(2)} hops is typical for multi-tier networks, representing balanced routing depth.`
  },
  avg_host_latency: {
    title: "Propagation Latency",
    impact: (v) => v < 15 ? `High Speed: With an average latency of ${v.toFixed(2)}ms, the network is optimized for real-time applications and low-latency data center workloads.` : `Standard Latency: An average of ${v.toFixed(2)}ms is suitable for general-purpose workloads and standard office/campus traffic.`
  },
  intra_pod_hops: {
    title: "Locality Performance",
    impact: (v) => v <= 2 ? `Local-First: High efficiency for intra-pod traffic (current: ${v.toFixed(1)} hops), allowing for high-performance localized clustering.` : `Distributed: High overhead for local traffic (current: ${v.toFixed(1)} hops), potentially impacting performance of localized services.`
  },
  jitter: {
    title: "Latency Jitter",
    impact: (v) => v < 3 ? `Stable Pathing: Low variance (${v.toFixed(2)}ms jitter) provides a predictable stream, ideal for voice and video traffic.` : `Varied Pathing: Higher jitter (${v.toFixed(2)}ms) may cause packet reordering, requiring larger buffers for real-time streams.`
  },
  path_diversity: {
    title: "ECMP Path Diversity",
    impact: (v, m) => {
      const paths = (v || 0).toFixed(1);
      if (currentArch === 'leaf-spine' && m.num_spines > 0) {
        return v >= m.num_spines ? `Optimal: Full ECMP utilization with ${paths} paths, maximizing load balancing across the spine.` : `Suboptimal: Only ${paths}/${m.num_spines} paths available. This indicates a potential wiring bottleneck.`;
      }
      return v > 1 ? `Resilient: Multiple ECMP paths (${paths}) provide strong redundancy against single link failures.` : `Limited: A single path bottleneck (current: ${paths}) makes the network susceptible to link-level congestion.`;
    }
  },
  bisection_bw: {
    title: "Bisection Bandwidth",
    impact: (v, m) => {
      const bw = (v || 0).toFixed(0);
      const ratio = m.oversubscription;
      if (ratio && ratio <= 1.1) return `Non-blocking: Full bisection capacity (${bw}Gbps) allows all hosts to communicate at line rate simultaneously.`;
      return `Throughput Capacity: The current ${bw}Gbps bisection limit determines how much traffic can move between the two halves of the network simultaneously.`;
    }
  },
  diameter: {
    title: "Max Network Span",
    impact: (v) => v <= 4 ? `Tight Span: A maximum distance of ${v} hops ensures predictable worst-case latency across the entire topology.` : `Wide Span: A maximum distance of ${v} hops creates high variance in delay between distant parts of the network.`
  },
  max_betweenness: {
    title: "Choke Point Analysis",
    impact: (v) => v < 0.2 ? `Distributed Load: No single node carries more than ${(v * 100).toFixed(1)}% of all shortest paths, indicating a well-balanced, resilient core.` : `Concentrated Load: A single node handles ${(v * 100).toFixed(1)}% of all paths, creating a significant theoretical bottleneck.`
  },
  node_count: {
    title: "Device Inventory",
    impact: (v) => v > 100 ? `Large Scale: Managing ${v} devices requires high automation and robust configuration management.` : `Compact: The scale of ${v} devices is easily managed with standard network administrative tools.`
  },
  link_count: {
    title: "Cabling Complexity",
    impact: (v) => v > 200 ? `High Density: With ${v} physical links, this topology represents a highly interconnected and complex wiring infrastructure.` : `Moderate Density: The ${v} physical links represent a standard cabling requirement for this network size.`
  },
  largest_cc_ratio: {
    title: "Network Cohesion",
    impact: (v) => v === 1 ? "Fully Cohesive: 100% of the network is connected, ensuring any node can reach any other node." : `Fragmented: Only ${(v * 100).toFixed(1)}% of the network is currently cohesive, meaning some subnets are isolated.`
  },
  redundancy: {
    title: "Link Redundancy",
    impact: (v) => v > 1.2 ? `High Redundancy: A ratio of ${v.toFixed(2)} links per node indicates excellent fault tolerance and multiple bypass options.` : `Low Redundancy: A ratio of ${v.toFixed(2)} links per node makes the network more vulnerable to individual link failures.`
  },
  avg_clustering: {
    title: "Local Clustering",
    impact: (v) => v < 0.1 ? `Sparse Layout: Typical for hierarchical trees, focusing on vertical traffic flow rather than local mesh.` : `Clustered Connectivity: High local interconnection (coeff: ${v.toFixed(2)}) suggests a mesh-like structure within specific pods.`
  },
  cost_efficiency: {
    title: "Infrastructure ROI",
    impact: (v) => `Balanced Performance: A score of ${v.toFixed(2)} represents the performance efficiency relative to the hardware investment cost.`
  }
};

// ==============================
// HELPERS
// ==============================

function showError(msg) {
  console.error(msg);
  const el = document.getElementById("error");
  if (el) {
    el.textContent = msg;
    el.classList.remove("hidden");
  }
}
function clearError() {
  const el = document.getElementById("error");
  if (el) el.classList.add("hidden");
}

function roleColor(role) {
  return COLORS[role] || COLORS.host;
}

// ==============================
// INIT — load architecture list
// ==============================

fetch(`${API}/architectures`)
  .then(r => {
    if (!r.ok) throw new Error(`architectures request failed: ${r.status}`);
    return r.json();
  })
  .then(archs => {
    clearError();
    const allArchs = archs;
    const simTypeSelect = document.getElementById("simType");
    const archSelect = document.getElementById("archSelect");

    // Categorize architectures
    const dcArchs = new Set(["leaf-spine", "fat-tree", "three-tier"]);
    const campusArchs = new Set(["3-tier", "2-tier", "campus-leaf-spine", "partial-mesh"]);

    function updateArchOptions() {
      const type = simTypeSelect.value;
      archSelect.innerHTML = "";
      const checksDiv = document.getElementById("compareChecks");
      checksDiv.innerHTML = "";

      const filtered = allArchs.filter(a => {
        if (type === "data_center") return dcArchs.has(a);
        if (type === "campus_sim") return campusArchs.has(a);
        return !dcArchs.has(a) && !campusArchs.has(a);
      });

      filtered.forEach(a => {
        // Dropdown options
        const o = document.createElement("option");
        o.value = a;
        const displayName = a.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
        o.textContent = displayName;
        archSelect.appendChild(o);

        // Compare checkboxes
        const lbl = document.createElement("label");
        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.value = a;
        lbl.appendChild(cb);
        lbl.appendChild(document.createTextNode(displayName));
        checksDiv.appendChild(lbl);
      });

      if (filtered.length > 0) {
        archSelect.value = filtered[0];
        loadArchitecture(filtered[0]);
      }
    }

    simTypeSelect.onchange = updateArchOptions;
    simTypeSelect.value = "campus_sim";
    updateArchOptions(); // Initial load

    if (allArchs.length === 0) {
      showError("No architectures returned by backend.");
    }
  })
  .catch(err => showError(`Failed loading architectures: ${err.message}`));

// ==============================
// EVENT BINDINGS
// ==============================

document.getElementById("archSelect").onchange = e => loadArchitecture(e.target.value);

document.getElementById("runFail").onclick = simulateFailures;
document.getElementById("resetSim").onclick = () => {
  document.getElementById("viewImpact").classList.add("hidden");
  document.getElementById("resetSim").classList.add("hidden");
  loadArchitecture(currentArch);
};
if (document.getElementById("viewImpact")) {
  document.getElementById("viewImpact").onclick = () => {
    generateFailureImpact();
    overlay.classList.remove("hidden");
  };
}

document.getElementById("runCompare").onclick = runComparison;
document.getElementById("clearCompare").onclick = () => {
  document.querySelectorAll("#compareChecks input:checked").forEach(c => c.checked = false);
};

document.getElementById("viewCampusAnalysis").onclick = () => {
  if (overlay) overlay.querySelector('h3').textContent = "Campus Network Bandwidth Analysis";
  overlay.classList.remove("hidden");
  fetchCampusAnalysis();
};

function fetchCampusAnalysis() {
  infContent.innerHTML = "<p>Analyzing flow and congestion... please wait.</p>";
  fetch(`${API}/campus-analysis/${currentArch}`)
    .then(r => r.json())
    .then(renderCampusAnalysis)
    .catch(err => showError(`Campus analysis failed: ${err.message}`));
}

function renderCampusAnalysis(data) {
  infContent.innerHTML = "";

  // 1. Max Flow
  const fSection = document.createElement("div");
  fSection.className = "inf-section-header";
  fSection.textContent = "1. Maximum Flow Between Departments (Gbps)";
  infContent.appendChild(fSection);

  const fTable = document.createElement("table");
  fTable.className = "comparison-table";
  fTable.innerHTML = `<thead><tr><th>Source</th><th>Target</th><th>Max Bandwidth</th></tr></thead><tbody></tbody>`;
  const fBody = fTable.querySelector("tbody");
  data.max_flow.forEach(f => {
    const row = document.createElement("tr");
    row.innerHTML = `<td>${f.source}</td><td>${f.target}</td><td><b>${f.flow} Gbps</b></td>`;
    fBody.appendChild(row);
  });
  infContent.appendChild(fTable);

  // 2. Bottlenecks
  const bSection = document.createElement("div");
  bSection.className = "inf-section-header";
  bSection.textContent = "2. Critical Bottleneck Links";
  infContent.appendChild(bSection);

  const bGrid = document.createElement("div");
  bGrid.className = "inf-grid";
  data.bottlenecks.slice(0, 4).forEach(b => {
    const card = document.createElement("div");
    card.className = "inf-card";
    card.innerHTML = `
      <div class="inf-title" style="color: #ef4444">High Probability Bottleneck</div>
      <div class="inf-desc">Link: ${b.edge}</div>
      <div class="inf-impact">This link appeared in <b>${b.frequency}</b> minimum cuts between department pairs.</div>
    `;
    bGrid.appendChild(card);
  });
  infContent.appendChild(bGrid);

  // 3. Congestion
  const cSection = document.createElement("div");
  cSection.className = "inf-section-header";
  cSection.textContent = "3. Link Congestion Simulation (load factor 1.2)";
  infContent.appendChild(cSection);

  if (data.congestion_simulation.length === 0) {
    const p = document.createElement("p");
    p.textContent = "No links exceeded 70% utilization in this simulation.";
    infContent.appendChild(p);
  } else {
    const cTable = document.createElement("table");
    cTable.className = "comparison-table";
    cTable.innerHTML = `<thead><tr><th>Link</th><th>Current Load</th><th>Utilization</th></tr></thead><tbody></tbody>`;
    const cBody = cTable.querySelector("tbody");
    data.congestion_simulation.forEach(c => {
      const row = document.createElement("tr");
      const utilClass = c.utilization > 100 ? "trend-bad" : "";
      row.innerHTML = `<td>${c.edge}</td><td>${c.load} / ${c.capacity} Gbps</td><td class="${utilClass}"><b>${c.utilization}%</b></td>`;
      cBody.appendChild(row);
    });
    infContent.appendChild(cTable);
  }

  // 4. Bandwidth-Aware Routing
  const rSection = document.createElement("div");
  rSection.className = "inf-section-header";
  rSection.textContent = "4. Bandwidth-Aware vs. Shortest Path Routing";
  infContent.appendChild(rSection);

  const rGrid = document.createElement("div");
  rGrid.className = "inf-grid";
  data.routing_samples.forEach(s => {
    const card = document.createElement("div");
    card.className = "inf-card";
    const status = s.same ? "Same Path" : "Optimized Path Found";
    const statusColor = s.same ? "#10b981" : "#8b5cf6";
    card.innerHTML = `
      <div class="inf-title" style="color: ${statusColor}">${status}</div>
      <div class="inf-desc">${s.from} → ${s.to}</div>
      <div class="inf-impact">
        ${s.same ? "Standard hop-count shortest path already uses the widest links." : "Bandwidth-aware routing found a wider (though potentially longer) path to avoid congestion."}
      </div>
    `;
    rGrid.appendChild(card);
  });
  infContent.appendChild(rGrid);
}

// Viewport controls
document.getElementById("resetView").onclick = () => {
  if (cy) cy.fit();
};
document.getElementById("toggleLayout").onclick = () => {
  if (!cy) return;
  isClusterLayout = !isClusterLayout;
  const layoutConfig = isClusterLayout
    ? { name: 'cose', animate: true, nodeRepulsion: 8000, idealEdgeLength: 50, componentSpacing: 60, padding: 20 }
    : { name: 'breadthfirst', directed: true, padding: 30, spacingFactor: 1.2, animate: true, circle: false, grid: false };

  cy.layout(layoutConfig).run();
};

// Editor buttons
document.getElementById("addNodeBtn").onclick = () => {
  editorMode = null;
  linkSource = null;
  const form = document.getElementById("addNodeForm");
  const isHidden = form.style.display === "none";
  form.style.display = isHidden ? "block" : "none";
  document.getElementById("addNodeBtn").classList.toggle("active", isHidden);
};

document.getElementById("addLinkBtn").onclick = () => {
  if (editorMode === "addLink") {
    editorMode = null;
    document.getElementById("addLinkBtn").classList.remove("active");
  } else {
    editorMode = "addLink";
    linkSource = null;
    document.getElementById("addNodeForm").style.display = "none";
    document.getElementById("addNodeBtn").classList.remove("active");
    document.getElementById("deleteBtn").classList.remove("active");
    document.getElementById("addLinkBtn").classList.add("active");
  }
};

document.getElementById("deleteBtn").onclick = () => {
  if (editorMode === "delete") {
    editorMode = null;
    document.getElementById("deleteBtn").classList.remove("active");
  } else {
    editorMode = "delete";
    linkSource = null;
    document.getElementById("addNodeForm").style.display = "none";
    document.getElementById("addNodeBtn").classList.remove("active");
    document.getElementById("addLinkBtn").classList.remove("active");
    document.getElementById("deleteBtn").classList.add("active");
  }
};

document.getElementById("confirmAddNode").onclick = () => {
  const id = document.getElementById("newNodeId").value.trim();
  const role = document.getElementById("newNodeRole").value;
  if (!id) return;
  if (cy.getElementById(id).length > 0) {
    alert(`Node "${id}" already exists!`);
    return;
  }
  cy.add({
    group: "nodes",
    data: { id, role },
    position: { x: 200 + Math.random() * 300, y: 200 + Math.random() * 200 }
  });
  cy.getElementById(id).style("background-color", roleColor(role));
  document.getElementById("newNodeId").value = "";
  document.getElementById("addNodeForm").style.display = "none";
  document.getElementById("addNodeBtn").classList.remove("active");
  document.getElementById("resetGraphBtn").classList.remove("hidden");
};

document.getElementById("recalcBtn").onclick = recalcCustomMetrics;
document.getElementById("resetGraphBtn").onclick = () => loadArchitecture(currentArch);

// ==============================
// LOAD GRAPH
// ==============================

function loadArchitecture(arch) {
  currentArch = arch;
  editorMode = null;
  linkSource = null;
  isClusterLayout = true;
  if (document.getElementById("resetGraphBtn")) document.getElementById("resetGraphBtn").classList.add("hidden");  // below graph editor
  if (document.getElementById("resetSim")) document.getElementById("resetSim").classList.add("hidden");
  if (document.getElementById("viewImpact")) document.getElementById("viewImpact").classList.add("hidden");

  const campusBtn = document.getElementById("viewCampusAnalysis");
  if (campusBtn) {
    if (arch === "3-tier" || arch === "2-tier" || arch === "campus-leaf-spine" || arch === "partial-mesh") campusBtn.classList.remove("hidden");
    else campusBtn.classList.add("hidden");
  }

  clearError();

  fetch(`${API}/graph/${arch}`)
    .then(r => {
      if (!r.ok) throw new Error(`graph request failed: ${r.status}`);
      return r.json();
    })
    .then(drawGraph)
    .catch(err => showError(`Failed loading graph: ${err.message}`));

  fetch(`${API}/metrics/${arch}`)
    .then(r => {
      if (!r.ok) throw new Error(`metrics request failed: ${r.status}`);
      return r.json();
    })
    .then(updateMetrics)
    .catch(err => showError(`Failed loading metrics: ${err.message}`));
}

// ==============================
// CYTOSCAPE GRAPH
// ==============================

function drawGraph(data) {
  if (cy) cy.destroy();

  cy = cytoscape({
    container: document.getElementById("cy"),
    elements: [...data.nodes, ...data.edges],
    style: [
      {
        selector: "node",
        style: {
          "label": "data(id)",
          "font-size": 8,
          "color": "#f8fafc",
          "text-outline-width": 0,
          "background-color": e => roleColor(e.data("role")),
          "width": e => e.data("role") === "host" ? 8 : 14,
          "height": e => e.data("role") === "host" ? 8 : 14,
          "border-width": 1.5,
          "border-color": "#000",
          "transition-property": "opacity, background-color, border-color, width, height",
          "transition-duration": "0.3s"
        }
      },
      {
        selector: "node.neighbor",
        style: {
          "border-width": 3,
          "border-color": "#000",
          "opacity": 1,
          "z-index": 10
        }
      },
      {
        selector: "node.faded",
        style: {
          "opacity": 0.2,
          "text-opacity": 0
        }
      },
      {
        selector: "edge",
        style: {
          "width": 1.5,
          "line-color": COLORS.edge_line,
          "curve-style": "bezier",
          "target-arrow-shape": "none",
          "opacity": 0.4,
          "transition-property": "line-color, width, opacity",
          "transition-duration": "0.3s"
        }
      },
      {
        selector: "edge.highlighted",
        style: {
          "width": 3,
          "line-color": "#38bdf8",
          "opacity": 1,
          "z-index": 5
        }
      },
      {
        selector: "edge.faded",
        style: {
          "opacity": 0.05
        }
      },
      {
        selector: "node.failed",
        style: {
          "background-color": "#000",
          "opacity": 0.2,
          "border-color": "#ff0000",
          "border-width": 2
        }
      },
      {
        selector: "node:selected",
        style: {
          "border-color": "#fbbf24",
          "border-width": 3,
          "box-shadow": "0 0 10px #fbbf24"
        }
      }
    ],
    layout: { name: "cose", animate: false, nodeRepulsion: () => 8000, idealEdgeLength: () => 50 }
  });

  // Update Legend & Hierarchy
  updateLegend(data);
  updateHierarchy(data);

  // Interactivity for highlighting
  cy.on('mouseover', 'node', function (e) {
    if (editorMode) return;
    const sel = e.target;
    cy.elements().addClass('faded');
    sel.removeClass('faded');
    sel.neighborhood().removeClass('faded').addClass('neighbor');
    sel.connectedEdges().removeClass('faded').addClass('highlighted');
  });

  cy.on('mouseout', 'node', function () {
    if (editorMode) return;
    cy.elements().removeClass('faded highlighted neighbor');
  });

  // Editor interactions
  cy.on("tap", "node", evt => {
    const node = evt.target;
    if (editorMode === "addLink") {
      if (!linkSource) {
        linkSource = node.id();
        node.select();
      } else {
        const tgt = node.id();
        if (tgt !== linkSource) {
          cy.add({ group: "edges", data: { source: linkSource, target: tgt, latency: 1 } });
        }
        linkSource = null;
        editorMode = null;
        document.getElementById("addLinkBtn").classList.remove("active");
        cy.elements().unselect();
        document.getElementById("resetGraphBtn").classList.remove("hidden");
      }
    } else if (editorMode === "delete") {
      cy.remove(node);
      editorMode = null;
      document.getElementById("deleteBtn").classList.remove("active");
      document.getElementById("resetGraphBtn").classList.remove("hidden");
    }
  });

  cy.on("tap", "edge", evt => {
    if (editorMode === "delete") {
      cy.remove(evt.target);
      editorMode = null;
      document.getElementById("deleteBtn").classList.remove("active");
      document.getElementById("resetGraphBtn").classList.remove("hidden");
    }
  });
}

function updateLegend(data) {
  const roles = new Set();
  data.nodes.forEach(n => {
    const role = n.data ? n.data.role : n.role;
    if (role) roles.add(role);
  });

  const tooltip = document.getElementById("legendTooltip");
  if (!tooltip) return;

  tooltip.innerHTML = "<h4>Architecture Legend</h4>";
  const list = document.createElement("div");
  list.style.display = "flex";
  list.style.flexDirection = "column";
  list.style.gap = "8px";
  list.style.marginTop = "8px";

  Array.from(roles).sort().forEach(role => {
    const item = document.createElement("div");
    item.style.display = "flex";
    item.style.alignItems = "center";
    item.style.gap = "8px";
    item.style.fontSize = "0.8rem";

    const dot = document.createElement("span");
    dot.style.width = "10px";
    dot.style.height = "10px";
    dot.style.borderRadius = "50%";
    dot.style.backgroundColor = roleColor(role);
    dot.style.border = "1px solid rgba(255,255,255,0.2)";

    item.appendChild(dot);
    const label = role.replace(/_/g, ' ');
    item.appendChild(document.createTextNode(label.charAt(0).toUpperCase() + label.slice(1)));
    list.appendChild(item);
  });
  tooltip.appendChild(list);
}

function updateHierarchy(data) {
  const nodes = data.nodes;
  const counts = {};
  const rolesFound = [];

  nodes.forEach(n => {
    const role = n.data.role;
    if (!counts[role]) {
      counts[role] = 0;
      rolesFound.push(role);
    }
    counts[role]++;
  });

  const roleOrder = ["core", "aggregation", "leaf", "edge", "access", "router", "host"];
  rolesFound.sort((a, b) => roleOrder.indexOf(a) - roleOrder.indexOf(b));

  // Update Failure Inputs
  const fContainer = document.getElementById("failure-inputs");
  if (!fContainer) return;
  fContainer.innerHTML = "";
  rolesFound.forEach(role => {
    if (role === "host") return;
    const name = (ROLE_MAP[currentArch] && ROLE_MAP[currentArch][role]) || role.charAt(0).toUpperCase() + role.slice(1);

    const div = document.createElement("div");
    div.style.display = "flex";
    div.style.justifyContent = "space-between";
    div.style.alignItems = "center";
    div.style.marginBottom = "8px";
    div.innerHTML = `
      <label style="margin: 0; font-size: 0.8rem;">${name}</label>
      <input type="number" id="fail_${role}" min="0" max="${counts[role]}" value="0" style="width: 60px; padding: 4px 8px; background: rgba(15, 23, 42, 0.6); border: 1px solid var(--glass-border); border-radius: 4px; color: var(--text-main); font-size: 0.8rem;">
    `;
    fContainer.appendChild(div);
  });
}

// ==============================
// METRICS
// ==============================

function updateMetrics(m, isTemporary = false) {
  if (!isTemporary) baselineMetrics = m;
  try {
    document.getElementById("m_nodes").textContent = m.node_count ?? "-";
    document.getElementById("m_links").textContent = m.link_count ?? "-";
    document.getElementById("m_path").textContent = (m.avg_host_path ?? 0).toFixed(2);
    document.getElementById("m_latency").textContent = (m.avg_host_latency ?? 0).toFixed(2);
    document.getElementById("m_diameter").textContent = m.diameter ?? 0;
    document.getElementById("m_bc").textContent = (m.max_betweenness ?? 0).toFixed(4);
    document.getElementById("m_cc").textContent = (m.largest_cc_ratio ?? 0).toFixed(2);

    const connectivity = m.host_connectivity ?? 1.0;
    document.getElementById("m_conn").textContent = (connectivity * 100).toFixed(1) + "%";

    document.getElementById("m_redundancy").textContent = m.redundancy ?? "-";
    document.getElementById("m_clustering").textContent = (m.avg_clustering ?? 0).toFixed(4);
    document.getElementById("m_diversity").textContent = (m.path_diversity ?? 0).toFixed(2);
    document.getElementById("m_bisection").textContent = (m.bisection_bw ?? 0).toFixed(0) + " Gbps";
    document.getElementById("m_cost").textContent = m.cost_efficiency ?? "-";
  } catch (e) {
    showError(`Error updating metrics: ${e.message}`);
  }
}

// ==============================
// RECALCULATE (custom edited graph)
// ==============================

function recalcCustomMetrics() {
  if (!cy) return;

  const nodes = cy.nodes().map(n => ({ data: { id: n.id(), role: n.data("role") } }));
  const edges = cy.edges().map(e => ({
    data: { source: e.data("source"), target: e.data("target"), latency: e.data("latency") || 1 }
  }));

  fetch(`${API}/graph/custom`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nodes, edges })
  })
    .then(r => r.json())
    .then(m => {
      updateMetrics(m);
    })
    .catch(err => showError(`Recalculate failed: ${err.message}`));
}

// ==============================
// FAILURES
// ==============================

function simulateFailures() {
  const counts = {};
  const inputs = document.querySelectorAll("#failure-inputs input");
  inputs.forEach(inp => {
    const role = inp.id.replace("fail_", "");
    counts[role] = parseInt(inp.value) || 0;
  });

  fetch(`${API}/fail/${currentArch}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ counts })
  })
    .then(r => r.json())
    .then(res => {
      latestFailureMetrics = {
        ...baselineMetrics,
        ...res.metrics
      };
      // Update sidebar metrics to show impact
      updateMetrics(latestFailureMetrics, true);

      if (document.getElementById("viewImpact")) document.getElementById("viewImpact").classList.remove("hidden");
      if (document.getElementById("resetSim")) document.getElementById("resetSim").classList.remove("hidden");
      highlightFailures(res.failed_nodes);
    })
    .catch(err => showError(`Failure simulation failed: ${err.message}`));
}

function highlightFailures(failed) {
  // Reset all nodes first
  cy.nodes().removeClass('failed');

  failed.forEach(id => {
    const n = cy.getElementById(id);
    if (n.length) {
      n.addClass('failed');
    }
  });
}

function generateFailureImpact() {
  const impactContent = document.getElementById("inferenceContent");
  if (!impactContent || !overlay) return;

  impactContent.innerHTML = "";
  overlay.querySelector('h3').textContent = "Failure Impact Analysis";

  const table = document.createElement("table");
  table.className = "comparison-table";
  table.innerHTML = `
    <thead>
      <tr>
        <th>Metric Parameter</th>
        <th>Baseline</th>
        <th>Post-Failure</th>
        <th>Net Change</th>
      </tr>
    </thead>
    <tbody id="impact-body"></tbody>
  `;
  impactContent.appendChild(table);

  const body = table.querySelector("#impact-body");

  const metricsToCompare = [
    { key: "host_connectivity", name: "Host Connectivity", higherIsBetter: true, transform: v => (v * 100).toFixed(1) + "%" },
    { key: "avg_host_path", name: "Avg Path Length (Hops)", higherIsBetter: false },
    { key: "avg_host_latency", name: "Average Latency", higherIsBetter: false, unit: "ms" },
    { key: "path_diversity", name: "ECMP Path Diversity", higherIsBetter: true },
    { key: "bisection_bw", name: "Bisection Capacity", higherIsBetter: true, unit: " Gbps" },
    { key: "largest_cc_ratio", name: "Network Cohesion", higherIsBetter: true, transform: v => (v * 100).toFixed(1) + "%" },
    { key: "max_betweenness", name: "Choke Point Stress", higherIsBetter: false },
    { key: "redundancy", name: "Link Redundancy", higherIsBetter: true },
    { key: "avg_clustering", name: "Local Clustering", higherIsBetter: true },
    { key: "diameter", name: "Diameter", higherIsBetter: false },
    { key: "node_count", name: "Alive Nodes", higherIsBetter: true },
    { key: "link_count", name: "Active Links", higherIsBetter: true }
  ];

  metricsToCompare.forEach(m => {
    const baseVal = baselineMetrics[m.key] ?? 0;
    const failVal = latestFailureMetrics[m.key] ?? 0;
    const diff = failVal - baseVal;

    let trendClass = "";

    if (Math.abs(diff) > 0.000001) {
      const isBetter = m.higherIsBetter ? diff > 0 : diff < 0;
      trendClass = isBetter ? "trend-good" : "trend-bad";
    }

    const pctChange = baseVal !== 0 ? ((diff / baseVal) * 100).toFixed(1) : "0.0";
    const sign = diff > 0 ? "+" : "";

    const row = document.createElement("tr");
    row.innerHTML = `
      <td class="metric-name">${m.name}</td>
      <td class="value-old">${m.transform ? m.transform(baseVal) : baseVal.toFixed(2)}${m.unit || ""}</td>
      <td class="value-new">${m.transform ? m.transform(failVal) : failVal.toFixed(2)}${m.unit || ""}</td>
      <td class="${trendClass}">${sign}${m.transform ? m.transform(diff) : diff.toFixed(2)} (${sign}${pctChange}%)</td>
    `;
    body.appendChild(row);
  });
}

// ==============================
// COMPARISON
// ==============================

const METRIC_LABELS = {
  node_count: "Node Count",
  link_count: "Link Count",
  avg_host_path: "Avg Host Path",
  avg_host_latency: "Avg Host Latency",
  diameter: "Diameter",
  max_betweenness: "Max Betweenness",
  largest_cc_ratio: "Largest CC Ratio",
  host_connectivity: "Host Connectivity",
  redundancy: "Redundancy",
  path_diversity: "Path Diversity",
  bisection_bw: "Bisection BW",
  avg_clustering: "Avg Clustering",
  cost_efficiency: "Cost Efficiency"
};

const HIGHER_IS_BETTER = new Set(["largest_cc_ratio", "redundancy", "avg_clustering", "path_diversity", "bisection_bw", "host_connectivity"]);
const LOWER_IS_BETTER = new Set(["avg_host_path", "avg_host_latency", "diameter", "cost_efficiency", "max_betweenness"]);

function runComparison() {
  const checks = document.querySelectorAll("#compareChecks input:checked");
  const selected = Array.from(checks).map(c => c.value);

  if (selected.length < 2) {
    showError("Select at least 2 topologies to compare.");
    return;
  }
  clearError();

  fetch(`${API}/compare?archs=${selected.join(",")}`)
    .then(r => r.json())
    .then(data => renderComparisonTable(data, selected))
    .catch(err => showError(`Comparison failed: ${err.message}`));
}

function renderComparisonTable(data, archs) {
  const section = document.getElementById("compareSection");
  if (!section) return;
  section.classList.remove("hidden");

  const table = document.getElementById("compareTable");
  const metricKeys = Object.keys(METRIC_LABELS);

  // Track "wins" for architectural optimality
  const winCounts = archs.map(() => 0);
  const winReasons = archs.map(() => []);

  let html = `<thead><tr><th>Metric</th>`;
  archs.forEach(a => { html += `<th>${a.replace(/-/g, ' ').toUpperCase()}</th>`; });
  html += `</tr></thead><tbody>`;

  metricKeys.forEach(key => {
    const values = archs.map(a => data[a]?.[key] ?? null);
    const numericVals = values.filter(v => v !== null && typeof v === "number");

    let bestIdx = -1, worstIdx = -1;
    if (numericVals.length > 1) {
      if (HIGHER_IS_BETTER.has(key)) {
        const mv = Math.max(...numericVals);
        const wv = Math.min(...numericVals);
        bestIdx = values.indexOf(mv);
        worstIdx = values.indexOf(wv);
      } else if (LOWER_IS_BETTER.has(key)) {
        const mv = Math.min(...numericVals);
        const wv = Math.max(...numericVals);
        bestIdx = values.indexOf(mv);
        worstIdx = values.indexOf(wv);
      }
    }

    if (bestIdx !== -1) {
      winCounts[bestIdx]++;
      winReasons[bestIdx].push(METRIC_LABELS[key]);
    }

    html += `<tr><td><span class="metric-name">${METRIC_LABELS[key]}</span></td>`;
    values.forEach((v, i) => {
      const formatted = v !== null ? (typeof v === "number" ? v.toFixed(3).replace(/\.?0+$/, '') : v) : "-";
      let cls = "";
      if (i === bestIdx) cls = "best-val";
      else if (i === worstIdx) cls = "worst-val";
      html += `<td class="${cls}">${formatted}</td>`;
    });
    html += `</tr>`;
  });

  html += `</tbody>`;
  table.innerHTML = html;

  // Add Optimal Summary
  const maxWins = Math.max(...winCounts);
  const bestArchIdx = winCounts.indexOf(maxWins);
  const bestArch = archs[bestArchIdx];
  const reasons = winReasons[bestArchIdx].slice(0, 4); // Top 4 reasons

  // Remove existing summary if any
  const oldSummary = section.querySelector(".optimal-summary");
  if (oldSummary) oldSummary.remove();

  const summary = document.createElement("div");
  summary.className = "optimal-summary inf-card";
  summary.style.marginTop = "2rem";
  summary.style.borderLeft = "4px solid var(--success)";

  summary.innerHTML = `
    <div class="inf-title" style="color: var(--success)">Recommended Optimal Topology: ${bestArch.replace(/-/g, ' ').toUpperCase()}</div>
    <div class="inf-desc">
      Based on the comparative analysis, <b>${bestArch}</b> is the optimal selection for this configuration. 
      It achieved the best performance score in <b>${maxWins}</b> key metrics.
    </div>
    <div class="inf-impact" style="color: var(--text-main); background: rgba(16, 185, 129, 0.1); border-color: var(--success)">
      <b>Core Strengths:</b> ${reasons.join(", ")}. 
      This combination suggests a highly efficient balance between propagation speed and structural resilience.
    </div>
  `;

  table.parentElement.appendChild(summary);
}

// ==============================
// INFERENCE OVERLAY
// ==============================

const overlay = document.getElementById("analysisOverlay");
const closeBtn = document.getElementById("closeOverlay");
const infContent = document.getElementById("inferenceContent");

document.getElementById("viewInference").onclick = () => {
  if (overlay) overlay.querySelector('h3').textContent = "Performance Analysis";
  overlay.classList.remove("hidden");
  generateInferences();
};

if (closeBtn) {
  closeBtn.onclick = () => {
    overlay.classList.add("hidden");
  };
}

const closeCompareBtn = document.getElementById("closeCompare");
if (closeCompareBtn) {
  closeCompareBtn.onclick = () => {
    document.getElementById("compareSection").classList.add("hidden");
  };
}

function generateInferences() {
  infContent.innerHTML = "";

  const sections = {
    "Performance & Speed": ["avg_host_path", "avg_host_latency", "intra_pod_hops", "jitter", "diameter"],
    "Throughput & Diversity": ["path_diversity", "bisection_bw", "avg_clustering"],
    "Resilience & Survival": ["max_betweenness", "largest_cc_ratio", "redundancy"],
    "Scalability & Cost": ["node_count", "link_count", "cost_efficiency"]
  };

  Object.entries(sections).forEach(([sectionTitle, keys]) => {
    const sectionHeader = document.createElement("div");
    sectionHeader.className = "inf-section-header";
    sectionHeader.textContent = sectionTitle;
    infContent.appendChild(sectionHeader);

    const sectionGrid = document.createElement("div");
    sectionGrid.className = "inf-grid";
    infContent.appendChild(sectionGrid);

    keys.forEach(key => {
      const data = INFERENCES[key];
      const val = baselineMetrics[key];
      if (val === undefined || !data) return;

      const card = document.createElement("div");
      card.className = "inf-card";
      card.innerHTML = `
        <div class="inf-title" style="margin-bottom: 0.5rem; text-transform: uppercase; font-size: 0.8rem; letter-spacing: 0.05em; color: var(--accent-primary);">${data.title}</div>
        <div class="inf-impact" style="font-size: 0.95rem; line-height: 1.5; color: var(--text-main); border: none; background: transparent; padding: 0; border-left: 2px solid var(--accent-secondary); padding-left: 12px;">
          ${data.impact(val, baselineMetrics)}
        </div>
      `;
      sectionGrid.appendChild(card);
    });
  });
}

// Global error catches
window.addEventListener("error", e => {
  try { showError(`Uncaught error: ${e.message}`); } catch (_) { }
});
window.addEventListener("unhandledrejection", e => {
  try { showError(`Unhandled promise rejection: ${e.reason}`); } catch (_) { }
});
