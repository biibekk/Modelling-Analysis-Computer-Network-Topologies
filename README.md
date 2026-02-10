# Network Topology Analysis Dashboard

An interactive web-based dashboard designed to visualize, analyze, and simulate failures in common data center network topologies. This project allows users to explore the characteristics of **Leaf-Spine**, **Fat-Tree**, and **Three-Tier** architectures.

## 🚀 Features

- **Interactive Visualization**: Real-time graph rendering using [Cytoscape.js](https://js.cytoscape.org/).
- **Architecture Modeling**: 
  - **Leaf-Spine**: Fully connected spine and leaf layers.
  - **Fat-Tree**: k-port fat-tree implementation.
  - **Three-Tier**: Classic Core-Aggregation-Access hierarchy.
- **Metric Analysis**:
  - Average Host Path Length & Latency.
  - Network Diameter.
  - Max Betweenness Centrality.
  - Connected Component Ratios.
- **Failure Simulation**: Targeted "core failure" simulations to evaluate network resilience and host connectivity.

## 🛠️ Tech Stack

- **Backend**: Python 3.x, [Flask](https://flask.palletsprojects.com/), [NetworkX](https://networkx.org/)
- **Frontend**: [Vite](https://vitejs.dev/), [Cytoscape.js](https://js.cytoscape.org/), Vanilla CSS

---

## ⚙️ Installation & Setup

### 1. Backend Setup
Navigate to the root directory and set up the Python environment:

```bash
# Create and activate a virtual environment
python3 -m venv venv
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Run the Flask server
cd backend
python app.py
```
*The backend will start at `http://127.0.0.1:5000`.*

### 2. Frontend Setup
In a new terminal, navigate to the `frontend` directory:

```bash
cd frontend

# Install dependencies
npm install

# Start the development server
npm run dev
```
*The frontend will typically run at `http://localhost:5173`.*

---

## 📂 Project Structure

```text
graph_theory/
├── backend/
│   ├── app.py           # Flask API endpoints
│   ├── models.py        # Topology generation logic
│   └── metrics.py       # Graph analysis algorithms
├── frontend/
│   ├── src/
│   │   ├── main.js      # Frontend logic & Cytoscape init
│   │   └── style.css    # Layout & styling
│   └── index.html       # Main entry point
├── requirements.txt     # Python dependencies
└── README.md            # You are here
```

## 📊 Available Metrics

- **Avg Host Path**: Average shortest path distance between host nodes.
- **Avg Host Latency**: Average weighted path length based on simulated edge latencies.
- **Diameter**: The longest shortest path in the network.
- **Max Betweenness**: Identifies the most critical bottleneck nodes.
- **Host Connectivity**: The percentage of hosts remaining connected after node failures.

## 🤝 Contributing
Feel free to fork this repository and submit pull requests for new topologies or advanced metric analysis!
