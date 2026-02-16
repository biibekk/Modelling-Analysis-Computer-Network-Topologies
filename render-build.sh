#!/usr/bin/env bash
# exit on error
set -o errexit

# Install frontend dependencies and build
npm install --prefix frontend
npm run build --prefix frontend

# Install backend dependencies
pip install -r requirements.txt
