#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
NATIVE_DIR="$PROJECT_ROOT/src/native"

echo "Building AVCapture dylib..."

swiftc \
  -emit-library \
  -O \
  -whole-module-optimization \
  -framework AVFoundation \
  -framework CoreVideo \
  -framework CoreMedia \
  -framework Accelerate \
  -framework Foundation \
  "$NATIVE_DIR/AVCapture.swift" \
  -o "$NATIVE_DIR/libAVCapture.dylib"

echo "Built: $NATIVE_DIR/libAVCapture.dylib"
