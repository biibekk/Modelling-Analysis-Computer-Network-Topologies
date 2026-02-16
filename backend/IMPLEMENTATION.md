# Implementation Plan — Flexible Topology Upload, Mapping & Comparison

## Goal
Allow users to upload, visualize, configure, and compare arbitrary network topologies (not limited to predefined types). Support data-center, campus, WAN (MPLS/ISP), wireless and any custom network graphs. Provide schema-driven validation, attribute→parameter mapping, metric registry, storage and frontend UI for previewing and comparing selected parameters.

---

## High-level components
- Backend
  - Acceptance & validation of uploaded topologies (JSON/YAML in NetworkX node-link format, GraphML, or GEXF).
  - Schema(s): permissive `topology_schema.json` + `network_parameters.yaml` (already present).
  - Endpoints for upload, list, retrieve, metrics and comparison.
  - Storage: simple file-backed store under `backend/data/` and index file (JSON) recording metadata and mappings.
  - Metric registry: mapping-driven metric functions (extractors + simulators) in `backend/metrics.py`.
- Frontend
  - Upload UI (file / paste), preview (Cytoscape), attribute→parameter mapping UI, parameter selector for comparisons, and comparison visualization (table + charts).

---

## Data formats
- Recommended upload format: NetworkX node-link JSON (compatible with `networkx.readwrite.json_graph.node_link_graph`). Minimal required fields:
  - `nodes`: list of objects with `id` and optional `role`/`type` and arbitrary `attrs`.
  - `links` (or `edges`): list with `source`, `target`, and arbitrary edge attributes (e.g., `latency_ms`, `capacity_mbps`, `loss_prob`).
- Example:

```
{
  "directed": false,
  "graph": {"name":"My Campus"},
  "nodes": [
    {"id": "R1", "role": "router", "attrs": {"cpu":4}},
    {"id": "SW1", "role": "switch", "attrs": {"ports":48}},
    {"id": "H1", "role": "host"}
  ],
  "links": [
    {"source":"R1","target":"SW1","latency_ms":1,"capacity_mbps":10000},
    {"source":"SW1","target":"H1","latency_ms":1,"capacity_mbps":1000}
  ]
}
```

- Upload may include a `metadata` block where the user can provide `network_type`, `description`, and an optional `attribute_mapping` (edge/node attribute → parameter key).

---

## API endpoints (suggested)
- `POST /topologies` — upload topology (JSON or YAML). Validate and store; return `{id, name, errors?}`.
- `GET /topologies` — list saved topologies with metadata.
- `GET /topologies/<id>/graph` — return node/edge data for Cytoscape preview.
- `GET /metrics/<id>` — compute metrics using stored mapping and registry.
- `POST /compare` — accept list of topology ids + parameter keys, return comparative table (numbers + percentiles).
- `PUT /topologies/<id>/mapping` — save or update attribute→parameter mapping for the topology.
- `DELETE /topologies/<id>` — remove saved topology.

---

## Validation & mapping
- Server-side validation using `jsonschema` against a permissive `topology_schema.json` that ensures `nodes` and `links` exist, each node has `id`, and that `source`/`target` present on edges. Allow `additionalProperties: true` so arbitrary attributes pass through.
- Mapping: users provide (or accept auto-detected) mapping such as `{"edge.latency_ms": "latency", "edge.capacity_mbps": "throughput"}`.
- Auto-detection heuristics: look for common attribute names (`latency_ms`, `latency`, `delay`, `capacity_mbps`, `bandwidth`, `loss_prob`). Suggest initial mapping to user.

---

## Metric registry design
- Implement a registry (dict) in `backend/metrics.py` where each parameter key registers:
  - `name` (e.g., "latency"),
  - `required_attributes` (list of sample attribute names),
  - `compute(graph, mapping, options)` → numeric or statistical result,
  - `mode`: `direct` (extract from attributes), `derivative` (computed from graph like diameter), or `simulator` (needs flow simulation or user-provided edge capacities).
- When computing metrics for a topology, the system will:
  1. Apply mapping to locate required attributes.
  2. If attributes present, compute direct metrics (e.g., average path latency using edge `latency` values).
  3. If missing, either run a simulator (if available) or return `null` with a reason.

---

## Storage
- Create `backend/data/`.
  - Save each topology as `<id>.json` plus `metadata-<id>.json` holding name, description, mapping, and upload timestamp.
  - Maintain an index file `backend/data/index.json` listing saved topologies.
- Keep limits: max nodes (e.g., 5000), max edges, and max file size (e.g., 5 MB). Reject or request async processing for larger graphs.

---

## Frontend changes (brief)
- Add `Upload` view: file input, paste area, `name`/`description`, `network_type` suggestion.
- `Preview` view: show Cytoscape graph; allow quick edit of node/edge attributes (latency, capacity for small graphs).
- `Mapping` UI: list project parameters (from `backend/schemas/network_parameters.yaml`) and let user map edge/node attributes to those parameters. Provide auto-detect suggestions.
- `Compare` UI: allow selecting multiple saved topologies and parameters, show side-by-side table and charts (bar, radar); show percentiles.

---

## Security & operational notes
- Sanitize inputs; do not execute uploaded code. Only accept JSON/YAML text files.
- Enforce limits to avoid DoS: node/edge count, file size, and CPU time for metrics.
- For expensive metrics, schedule background jobs and return job id.

---

## Testing & QA
- Unit tests for `topology_schema` validation and parsing.
- Endpoint tests for upload/list/retrieve/delete.
- Metric function tests using sample topologies (small graphs for predictable outputs).

---

## Quick roadmap (suggested order)
1. Add `topology_schema.json` and update `backend/schemas/` (small permissive schema).
2. Implement `POST /topologies` with validation and storage (sync for small uploads).
3. Implement `GET /topologies` and `GET /topologies/<id>/graph`.
4. Build mapping storage endpoint `PUT /topologies/<id>/mapping` and auto-detection heuristics.
5. Implement metric registry for a few parameters (latency, avg_host_path, diameter, betweenness, host_connectivity) using mapping.
6. Add simple frontend upload + preview + mapping UI (minimal MVP).
7. Add compare endpoint and UI.
8. Add persistence index and housekeeping (delete/rename).
9. Add tests and sample templates.

---

## Where to add files (suggested)
- `backend/schemas/topology_schema.json` — minimal validation schema.
- `backend/data/` — storage for uploaded graphs.
- `backend/app.py` — add upload/list/retrieve endpoints.
- `backend/metrics.py` — extend with registry and mapping-aware functions.
- `frontend/src` — add `upload.js`, `mapping.js`, and UI components.

---

## Example commands for local testing

Create virtualenv and install deps (from project root):

```bash
python -m venv venv
# Windows
venv\Scripts\activate
# Unix
# source venv/bin/activate
pip install -r requirements.txt
cd backend
python app.py
```

Open frontend dev server (from `frontend/`):

```bash
cd frontend
npm install
npm run dev
```

---

## Notes
- This plan keeps the core project behavior (existing data-center topologies and metrics) and extends it to accept arbitrary graphs via a stable node-link format, plus a flexible attribute→parameter mapping system so users can map their custom node/link attributes into the standardized comparison metrics.
- I will implement items 1–3 first (schema, upload endpoint, storage) and provide example topologies and a small frontend upload MVP.


---

Created by implementation planning assistant.
