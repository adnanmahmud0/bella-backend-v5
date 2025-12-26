#!/bin/bash

# Script to fix all ID type issues in route files
# This script adds parseInt() for all req.params.id usages

echo "🔧 Fixing ID type mismatches..."

# Find all route files and add parseInt for req.params.id
find src/routes -name "*.ts" -type f -exec sed -i '' \
  -e 's/const { id } = req\.params;/const id = parseInt(req.params.id);\n    if (isNaN(id)) return res.status(400).json({ success: false, error: "Invalid ID" });/g' \
  -e 's/const \([a-zA-Z]*\)Id = req\.params\.id;/const \1Id = parseInt(req.params.id);\n    if (isNaN(\1Id)) return res.status(400).json({ success: false, error: "Invalid ID" });/g' \
  {} \;

echo "✅ ID fixes applied!"
echo "⚠️  Please review changes and run: npm run build"
