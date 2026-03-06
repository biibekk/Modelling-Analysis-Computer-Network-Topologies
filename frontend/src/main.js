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
  "three-tier": { "core": "Core", "aggregation": "Aggregation", "access": "Access", "host": "Host" }
};

const INFERENCES = {
  avg_host_path: {
    title: "Path Efficiency",
    desc: "The average number of hops between any two hosts. Lower values mean faster propagation and fewer switch traversals.",
    impact: (v) => v < 4 ? "Excellent: Very flat architecture." : "Average: Standard multi-tier overhead."
  },
  avg_host_latency: {
    title: "Propagation Latency",
    desc: "The time data takes to travel across the wires and through switches. This is the baseline speed of your network.",
    impact: (v) => v < 15 ? "High Speed: Optimized for low-latency tasks." : "Standard: Suitable for general data processing."
  },
  intra_pod_hops: {
    title: "Locality Performance",
    desc: "Hop count for nodes in the same pod. Critical for database clusters where nodes talk to each other frequently.",
    impact: (v) => v <= 2 ? "Local-First: High efficiency for intra-rack traffic." : "Distributed: High overhead for local traffic."
  },
  jitter: {
    title: "Latency Jitter",
    desc: "The variance in path latency. High jitter causes packet reordering, which forces TCP to slow down.",
    impact: (v) => v < 3 ? "Stable: Ideal for real-time streaming/gaming." : "Noisy: Risk of packet reordering under load."
  },
  path_diversity: {
    title: "ECMP Path Diversity",
    desc: "The number of equal-cost shortest paths between hosts. In Leaf-Spine, this should equal the number of Spine switches.",
    impact: (v, m) => {
      if (currentArch === 'leaf-spine' && m.num_spines > 0) {
        return v >= m.num_spines ? `Ideal: Full ECMP utilization (${v} paths).` : `Suboptimal: Only ${v}/${m.num_spines} paths available. Possible wiring flaw.`;
      }
      return v > 1 ? `Resilient: Multiple ECMP paths (${v.toFixed(1)}) available.` : "Limited: Single path bottlenecks.";
    }
  },
  bisection_bw: {
    title: "Bisection Bandwidth",
    desc: "The minimum capacity between two equal halves of the network. Measures if the core can handle simultaneous host traffic.",
    impact: (v, m) => {
      const ratio = m.oversubscription;
      if (ratio && ratio <= 1.1) return "Non-blocking: Theoretical max throughput for all hosts.";
      return `Throughput Capacity: ${v.toFixed(0)} units. Measures the core's ability to handle global host traffic.`;
    }
  },
  diameter: {
    title: "Worst-Case Distance",
    desc: "The longest possible path in the network. Sets the upper bound on latency for any two nodes.",
    impact: (v) => v <= 4 ? "Tight: Predictable worst-case performance." : "Wide: High variance in maximum delay."
  },
  max_betweenness: {
    title: "Criticality (Choke Points)",
    desc: "Identifies the switch with the highest traffic load. High values indicate a single point of failure.",
    impact: (v, m) => {
      return v < 0.2 ? "Distributed: Low dependency on single nodes." : "Concentrated: High reliance on specific nodes.";
    }
  },
  node_count: {
    title: "Node Count",
    desc: "The total number of devices (switches, routers, hosts) in the network topology.",
    impact: (v) => v > 100 ? "Large Scale: Requires efficient management and optimization." : "Manageable: Standard size for analysis."
  },
  link_count: {
    title: "Link Count",
    desc: "The total number of physical connections (cables) between devices in the network.",
    impact: (v) => "Infrastructure Load: Direct indicator of cabling cost and complexity."
  },
  largest_cc_ratio: {
    title: "Largest Connected Component",
    desc: "The percentage of the network that remains connected in a single chunk. 1.0 means fully connected.",
    impact: (v) => v === 1 ? "Fully Connected: All nodes can reach each other." : `Fragmented: ${(1 - v).toFixed(2) * 100}% of the network is isolated.`
  },
  redundancy: {
    title: "Link Redundancy",
    desc: "The ratio of links to nodes (Edges / Nodes). Higher values indicate more alternative paths and resilience.",
    impact: (v) => v > 1.5 ? "High Redundancy: Good fault tolerance." : "Low Redundancy: Susceptible to link failures."
  },
  avg_clustering: {
    title: "Average Clustering Coefficient",
    desc: "A measure of how localized the connectivity is. High clustering means neighbors of a node are also neighbors of each other.",
    impact: (v) => v < 0.1 ? "Sparse: Typical for hierarchical trees like Leaf-Spine." : "Clustered: High local interconnectivity."
  },
  cost_efficiency: {
    title: "Cost Efficiency",
    desc: "A composite metric balancing performance (throughput/latency) against infrastructure cost (nodes + links).",
    impact: (v) => "Balanced: Higher values indicate better performance per unit of cost."
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

    function updateArchOptions() {
      const type = simTypeSelect.value;
      archSelect.innerHTML = "";
      const checksDiv = document.getElementById("compareChecks");
      checksDiv.innerHTML = "";

      const filtered = allArchs.filter(a => {
        if (type === "data_center") return dcArchs.has(a);
        return !dcArchs.has(a);
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
        <th>Under Failure</th>
        <th>Change</th>
      </tr>
    </thead>
    <tbody id="impact-body"></tbody>
  `;
  impactContent.appendChild(table);

  const body = table.querySelector("#impact-body");

  const metricsToCompare = [
    { key: "avg_host_path", name: "Average Path Length (Hops)", higherIsBetter: false },
    { key: "avg_host_latency", name: "Average Latency", higherIsBetter: false },
    { key: "path_diversity", name: "ECMP Path Diversity", higherIsBetter: true },
    { key: "bisection_bw", name: "Bisection Capacity", higherIsBetter: true },
    { key: "host_connectivity", name: "Host Connectivity (%)", higherIsBetter: true, transform: v => (v * 100).toFixed(1) + "%" },
    { key: "max_betweenness", name: "Max Choke Point Load", higherIsBetter: false }
  ];

  metricsToCompare.forEach(m => {
    const baseVal = baselineMetrics[m.key] || 0;
    const failVal = latestFailureMetrics[m.key] || 0;
    const diff = failVal - baseVal;

    let trendClass = "";
    if (Math.abs(diff) > 0.0001) {
      const isBetter = m.higherIsBetter ? diff > 0 : diff < 0;
      trendClass = isBetter ? "trend-good" : "trend-bad";
    }

    const row = document.createElement("tr");
    row.innerHTML = `
      <td class="metric-name">${m.name}</td>
      <td class="value-old">${m.transform ? m.transform(baseVal) : baseVal.toFixed(2)}</td>
      <td class="value-new">${m.transform ? m.transform(failVal) : failVal.toFixed(2)}</td>
      <td class="${trendClass}">${diff > 0 ? '+' : ''}${m.transform ? m.transform(diff) : diff.toFixed(2)}</td>
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
  redundancy: "Redundancy",
  avg_clustering: "Avg Clustering",
  cost_efficiency: "Cost Efficiency"
};

const HIGHER_IS_BETTER = new Set(["largest_cc_ratio", "redundancy", "avg_clustering"]);
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
  section.classList.remove("hidden");

  const table = document.getElementById("compareTable");
  const metricKeys = Object.keys(METRIC_LABELS);

  let html = `<thead><tr><th>Metric</th>`;
  archs.forEach(a => { html += `<th>${a}</th>`; });
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
}

// ==============================
// INFERENCE OVERLAY
// ==============================

const overlay = document.getElementById("analysisOverlay");
const closeBtn = document.getElementById("closeOverlay");
const infContent = document.getElementById("inferenceContent");

document.getElementById("viewInference").onclick = () => {
  if (overlay) overlay.querySelector('h3').textContent = "Architectural Inference";
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
    "Resilience & Survival": ["max_betweenness", "graceful_degradation", "blast_radius", "largest_cc_ratio", "redundancy"],
    "Scalability & Cost": ["cabling_complexity", "edge_to_node_ratio", "expansion_impact", "node_count", "link_count", "cost_efficiency"]
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
        <div class="inf-title">${data.title}</div>
        <div class="inf-desc">${data.desc}</div>
        <div class="inf-impact"><b>Baseline State:</b> ${data.impact(val, baselineMetrics)}</div>
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
