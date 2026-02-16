# Network Topology Analysis & Simulation Dashboard

## Overview
An interactive web dashboard for **visualizing**, **editing**, **comparing**, and **simulating failures** across 10 different network topologies — from simple textbook examples to real-world scenarios.

---

## Topologies

### Data Center
| Topology | Description |
|----------|-------------|
| **Leaf-Spine** | Spine switches fully connected to leaf switches; hosts on leaves. |
| **Fat-Tree** | k-port fat-tree with core, aggregation, and edge layers. |
| **Three-Tier** | Classic Core → Aggregation → Access → Host hierarchy. |

### Basic / Textbook
| Topology | Description |
|----------|-------------|
| **Star** | 1 central hub connected to all hosts. Demonstrates single point of failure. |
| **Ring** | Switches in a circular loop with 1 host each. Shows redundancy tradeoffs. |
| **Mesh** | Full mesh between switches. Maximum redundancy, high cost. |
| **Grid** | 2D grid of switches. Balanced cost and performance. |

### Real-World
| Topology | Description |
|----------|-------------|
| **Campus** | University campus: Core Routers → Building Routers → Floor Switches → Hosts. |
| **WAN** | Simplified inter-city network with high-latency links (20-150ms). |
| **Wireless City** | City Controller → Base Stations → Access Points → Mobile Devices. |

---

## Comparison Parameters (10 Metrics)

| # | Metric | What it measures |
|---|--------|-----------------|
| 1 | **Node Count** | Total devices in the network |
| 2 | **Link Count** | Total cables/connections (cost indicator) |
| 3 | **Avg Host Path** | Average hops between hosts |
| 4 | **Avg Host Latency** | Average weighted delay between hosts |
| 5 | **Diameter** | Worst-case number of hops |
| 6 | **Max Betweenness** | Severity of the biggest bottleneck node |
| 7 | **Largest CC Ratio** | Network connectivity (1.0 = fully connected) |
| 8 | **Redundancy** | Min edges to cut to disconnect the network |
| 9 | **Avg Clustering** | How tightly connected local neighborhoods are |
| 10 | **Cost Efficiency** | Links-per-node ratio (lower = cheaper) |

---

## Features

### 🌐 Interactive Visualization
- Graphs rendered with Cytoscape.js using force-directed (CoSE) layout.
- Nodes color-coded by role (Core=Red, Switch=Green, Host=Blue, Router=Purple, City=Teal, etc.).

### ✏️ Graph Editor
- **Add Node**: Specify ID and role, node appears on graph.
- **Add Link**: Click source → click target to create a connection.
- **Delete**: Click any node or edge to remove it.
- **Recalculate**: Send the modified graph to the backend for updated metrics.

### 📊 Comparison View
- Select 2+ topologies via checkboxes.
- View all 10 metrics side-by-side in a table.
- **Best** values highlighted in green, **worst** in red.

### ⚡ Failure Simulation
- Simulate targeted removal of critical core nodes.
- See how **Host Connectivity** degrades as nodes fail.

---

## Tech Stack
- **Backend**: Python (Flask, NetworkX, flask-cors)
- **Frontend**: Vanilla JS, Vite, Cytoscape.js
- **Styling**: Custom CSS (dark mode)

---

## How to Run

### 1. Backend
```bash
cd backend
pip install -r requirements.txt
python app.py
```
Server: `http://127.0.0.1:5000`

### 2. Frontend
```bash
cd frontend
npm install
npm run dev
```
Dashboard: `http://localhost:5173`
