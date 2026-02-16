import cytoscape from "cytoscape";
import "./style.css";

const API = "http://127.0.0.1:5000";

let cy;
let currentArch = "";
let editorMode = null; // null | "addLink" | "delete"
let linkSource = null; // for two-click link creation

// ==============================
// HELPERS
// ==============================

function showError(msg) {
  console.error(msg);
  const el = document.getElementById("error");
  if (el) { el.textContent = msg; el.style.display = "block"; }
}
function clearError() {
  const el = document.getElementById("error");
  if (el) el.style.display = "none";
}
function setHint(msg) {
  const el = document.getElementById("editorHint");
  if (el) el.textContent = msg;
}

function roleColor(role) {
  switch (role) {
    case "core": return "#ef4444";
    case "leaf": case "aggregation": case "edge": return "#f59e0b";
    case "access": case "switch": return "#10b981";
    case "router": return "#8b5cf6";
    case "base_station": return "#f97316";
    case "access_point": return "#06b6d4";
    case "city": return "#0d9488";
    case "host": default: return "#3b82f6";
  }
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
    const select = document.getElementById("archSelect");
    select.innerHTML = "";
    archs.forEach(a => {
      const o = document.createElement("option");
      o.value = a;
      o.textContent = a;
      select.appendChild(o);
    });

    // Build compare checkboxes
    const checksDiv = document.getElementById("compareChecks");
    checksDiv.innerHTML = "";
    archs.forEach(a => {
      const lbl = document.createElement("label");
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.value = a;
      lbl.appendChild(cb);
      lbl.appendChild(document.createTextNode(a));
      checksDiv.appendChild(lbl);
    });

    if (archs.length > 0) {
      select.value = archs[0];
      loadArchitecture(archs[0]);
    } else {
      showError("No architectures returned by backend.");
    }
  })
  .catch(err => showError(`Failed loading architectures: ${err.message}`));

// ==============================
// EVENT BINDINGS
// ==============================

document.getElementById("archSelect").onchange = e => loadArchitecture(e.target.value);

document.getElementById("failures").oninput = e =>
  document.getElementById("failCount").textContent = e.target.value;

document.getElementById("runFail").onclick = simulateFailures;
document.getElementById("runCompare").onclick = runComparison;

// Editor buttons
document.getElementById("addNodeBtn").onclick = () => {
  editorMode = null;
  linkSource = null;
  const form = document.getElementById("addNodeForm");
  form.style.display = form.style.display === "none" ? "block" : "none";
  setHint("Fill in the form and click Add.");
};

document.getElementById("addLinkBtn").onclick = () => {
  editorMode = "addLink";
  linkSource = null;
  document.getElementById("addNodeForm").style.display = "none";
  setHint("Click the SOURCE node, then click the TARGET node.");
};

document.getElementById("deleteBtn").onclick = () => {
  editorMode = "delete";
  linkSource = null;
  document.getElementById("addNodeForm").style.display = "none";
  setHint("Click a node or edge to delete it.");
};

document.getElementById("confirmAddNode").onclick = () => {
  const id = document.getElementById("newNodeId").value.trim();
  const role = document.getElementById("newNodeRole").value;
  if (!id) return;
  if (cy.getElementById(id).length > 0) {
    setHint(`Node "${id}" already exists!`);
    return;
  }
  cy.add({
    group: "nodes",
    data: { id, role },
    position: { x: 200 + Math.random() * 300, y: 200 + Math.random() * 200 }
  });
  cy.getElementById(id).style("background-color", roleColor(role));
  document.getElementById("newNodeId").value = "";
  setHint(`Node "${id}" added.`);
};

document.getElementById("recalcBtn").onclick = recalcCustomMetrics;

// ==============================
// LOAD GRAPH
// ==============================

function loadArchitecture(arch) {
  currentArch = arch;
  editorMode = null;
  linkSource = null;
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
          "font-size": 7,
          "color": "#cbd5e1",
          "text-outline-width": 1,
          "text-outline-color": "#1e293b",
          "background-color": e => roleColor(e.data("role")),
          "width": e => e.data("role") === "host" ? 8 : 14,
          "height": e => e.data("role") === "host" ? 8 : 14,
          "border-width": 1,
          "border-color": "rgba(255,255,255,0.15)"
        }
      },
      {
        selector: "edge",
        style: {
          "width": 1.2,
          "line-color": "rgba(148, 163, 184, 0.4)",
          "curve-style": "bezier"
        }
      },
      {
        selector: "node:selected",
        style: {
          "border-color": "#fbbf24",
          "border-width": 3
        }
      }
    ],
    layout: { name: "cose", animate: false, nodeRepulsion: () => 8000, idealEdgeLength: () => 50 }
  });

  // Editor interactions
  cy.on("tap", "node", evt => {
    const node = evt.target;
    if (editorMode === "addLink") {
      if (!linkSource) {
        linkSource = node.id();
        setHint(`Source: ${linkSource}. Now click the target node.`);
      } else {
        const tgt = node.id();
        if (tgt !== linkSource) {
          cy.add({ group: "edges", data: { source: linkSource, target: tgt, latency: 1 } });
          setHint(`Link ${linkSource} → ${tgt} added.`);
        }
        linkSource = null;
        editorMode = null;
      }
    } else if (editorMode === "delete") {
      cy.remove(node);
      setHint(`Node "${node.id()}" and its edges deleted.`);
      editorMode = null;
    }
  });

  cy.on("tap", "edge", evt => {
    if (editorMode === "delete") {
      cy.remove(evt.target);
      setHint("Edge deleted.");
      editorMode = null;
    }
  });
}

// ==============================
// METRICS
// ==============================

function updateMetrics(m) {
  try {
    document.getElementById("m_nodes").textContent = m.node_count ?? "-";
    document.getElementById("m_links").textContent = m.link_count ?? "-";
    document.getElementById("m_path").textContent = (m.avg_host_path ?? 0).toFixed(2);
    document.getElementById("m_latency").textContent = (m.avg_host_latency ?? 0).toFixed(2);
    document.getElementById("m_diameter").textContent = m.diameter ?? 0;
    document.getElementById("m_bc").textContent = (m.max_betweenness ?? 0).toFixed(4);
    document.getElementById("m_cc").textContent = (m.largest_cc_ratio ?? 0).toFixed(2);
    document.getElementById("m_conn").textContent = "-";
    document.getElementById("m_redundancy").textContent = m.redundancy ?? "-";
    document.getElementById("m_clustering").textContent = (m.avg_clustering ?? 0).toFixed(4);
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
  setHint("Sending graph to backend…");

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
      setHint("Metrics recalculated for edited graph.");
    })
    .catch(err => showError(`Recalculate failed: ${err.message}`));
}

// ==============================
// FAILURES
// ==============================

function simulateFailures() {
  const k = document.getElementById("failures").value;

  fetch(`${API}/fail/${currentArch}?k=${k}`)
    .then(r => r.json())
    .then(res => {
      document.getElementById("m_conn").textContent = res.host_connectivity.toFixed(2);
      highlightFailures(res.failed_nodes);
    })
    .catch(err => showError(`Failure simulation failed: ${err.message}`));
}

function highlightFailures(failed) {
  cy.nodes().style("opacity", 1);

  failed.forEach(id => {
    const n = cy.getElementById(id);
    if (n.length) {
      n.style("background-color", "#000");
      n.style("opacity", 0.3);
    }
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

// Metrics where HIGHER is better
const HIGHER_IS_BETTER = new Set(["largest_cc_ratio", "redundancy", "avg_clustering"]);
// Metrics where LOWER is better
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
  section.style.display = "block";

  const table = document.getElementById("compareTable");
  const metricKeys = Object.keys(METRIC_LABELS);

  // Header row
  let html = `<thead><tr><th>Metric</th>`;
  archs.forEach(a => { html += `<th>${a}</th>`; });
  html += `</tr></thead><tbody>`;

  // Data rows
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

    html += `<tr><td>${METRIC_LABELS[key]}</td>`;
    values.forEach((v, i) => {
      const formatted = v !== null ? (typeof v === "number" ? v.toFixed(4).replace(/\.?0+$/, '') : v) : "-";
      let cls = "";
      if (i === bestIdx) cls = "best-val";
      else if (i === worstIdx) cls = "worst-val";
      html += `<td class="${cls}">${formatted}</td>`;
    });
    html += `</tr>`;
  });

  html += `</tbody>`;
  table.innerHTML = html;

  // Scroll into view
  section.scrollIntoView({ behavior: "smooth" });
}

// Global error catches
window.addEventListener("error", e => {
  try { showError(`Uncaught error: ${e.message}`); } catch (_) {}
});
window.addEventListener("unhandledrejection", e => {
  try { showError(`Unhandled promise rejection: ${e.reason}`); } catch (_) {}
});
