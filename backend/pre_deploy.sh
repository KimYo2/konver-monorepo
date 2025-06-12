#!/bin/bash

# Ensure the destination directories exist within the backend service's root
mkdir -p templates
mkdir -p static

# Copy contents of frontend/templates to backend/templates
# Assuming the monorepo root is the parent directory (../)
cp -R ../frontend/templates/* templates/

# Copy contents of frontend/static to backend/static
cp -R ../frontend/static/* static/

echo "Frontend assets copied to backend service directory." 