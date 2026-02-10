import cytoscape from "cytoscape";
import "./style.css";

const API = "http://127.0.0.1:5000";

let cy;
let currentArch = "leaf-spine";

// -------------------------------
// INIT
// -------------------------------

fetch(`${API}/architectures`)
  .then(r => r.json())
  .then(archs => {
    const select = document.getElementById("archSelect");
    archs.forEach(a => {
      const o = document.createElement("option");
      o.value = a;
      o.textContent = a;
      select.appendChild(o);
    });
    loadArchitecture(select.value);
  });

document.getElementById("archSelect").onchange = e =>
  loadArchitecture(e.target.value);

document.getElementById("failures").oninput = e =>
  document.getElementById("failCount").textContent = e.target.value;

document.getElementById("runFail").onclick = simulateFailures;

// -------------------------------
// LOAD GRAPH
// -------------------------------

function loadArchitecture(arch) {
  currentArch = arch;

  fetch(`${API}/graph/${arch}`)
    .then(r => r.json())
    .then(drawGraph);

  fetch(`${API}/metrics/${arch}`)
    .then(r => r.json())
    .then(updateMetrics);
}

// -------------------------------
// CYTOSCAPE
// -------------------------------

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
          "background-color": e => {
            const r = e.data("role");
            if (r === "core") return "#ef4444";
            if (r === "leaf" || r === "aggregation") return "#f59e0b";
            if (r === "access") return "#10b981";
            return "#3b82f6";
          },
          "width": 10,
          "height": 10
        }
      },
      {
        selector: "edge",
        style: {
          "width": 1,
          "line-color": "#9ca3af"
        }
      }
    ],
    layout: { name: "cose", animate: false }
  });
}

// -------------------------------
// METRICS
// -------------------------------

function updateMetrics(m) {
  document.getElementById("m_path").textContent = m.avg_host_path.toFixed(2);
  document.getElementById("m_latency").textContent = m.avg_host_latency.toFixed(2);
  document.getElementById("m_diameter").textContent = m.diameter;
  document.getElementById("m_bc").textContent = m.max_betweenness.toFixed(4);
  document.getElementById("m_cc").textContent = m.largest_cc_ratio.toFixed(2);
}

// -------------------------------
// FAILURES
// -------------------------------

function simulateFailures() {
  const k = document.getElementById("failures").value;

  fetch(`${API}/fail/${currentArch}?k=${k}`)
    .then(r => r.json())
    .then(res => {
      document.getElementById("m_conn").textContent =
        res.host_connectivity.toFixed(2);
      highlightFailures(res.failed_nodes);
    });
}

function highlightFailures(failed) {
  cy.nodes().style("opacity", 1);

  failed.forEach(id => {
    const n = cy.getElementById(id);
    if (n) {
      n.style("background-color", "#000");
      n.style("opacity", 0.3);
    }
  });
}
