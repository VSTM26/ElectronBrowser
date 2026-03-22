#!/usr/bin/env bash
set -euo pipefail

# ──────────────────────────────────────────────────────────────
# Ollama Browser Control — One-command setup
# Works on macOS and Linux. Installs Ollama, pulls the default
# model, configures CORS for Chrome extensions, and starts the
# Ollama server.
# ──────────────────────────────────────────────────────────────

DEFAULT_MODEL="qwen3:latest"
OLLAMA_URL="http://127.0.0.1:11434"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
NC='\033[0m' # No Color
BOLD='\033[1m'

print_header() {
  echo ""
  echo -e "${PURPLE}${BOLD}╔══════════════════════════════════════════╗${NC}"
  echo -e "${PURPLE}${BOLD}║   Ollama Browser Control — Setup         ║${NC}"
  echo -e "${PURPLE}${BOLD}╚══════════════════════════════════════════╝${NC}"
  echo ""
}

step() {
  echo -e "\n${BLUE}${BOLD}[$1]${NC} $2"
}

success() {
  echo -e "  ${GREEN}✓${NC} $1"
}

warn() {
  echo -e "  ${YELLOW}⚠${NC} $1"
}

fail() {
  echo -e "  ${RED}✕${NC} $1"
  exit 1
}

info() {
  echo -e "  ${NC}$1"
}

# ── Detect OS ──────────────────────────────────────────────────
detect_os() {
  case "$(uname -s)" in
    Darwin*) OS="macos" ;;
    Linux*)  OS="linux" ;;
    *)       fail "Unsupported operating system: $(uname -s). This script supports macOS and Linux." ;;
  esac
}

# ── Install Ollama ─────────────────────────────────────────────
install_ollama() {
  step "1/5" "Checking for Ollama..."

  if command -v ollama &>/dev/null; then
    OLLAMA_VERSION=$(ollama --version 2>/dev/null || echo "unknown")
    success "Ollama is already installed (${OLLAMA_VERSION})"
    return 0
  fi

  warn "Ollama is not installed. Installing now..."

  if [[ "$OS" == "macos" ]]; then
    if command -v brew &>/dev/null; then
      info "Installing via Homebrew..."
      brew install ollama
    else
      info "Installing via official installer..."
      curl -fsSL https://ollama.com/install.sh | sh
    fi
  else
    info "Installing via official installer..."
    curl -fsSL https://ollama.com/install.sh | sh
  fi

  if command -v ollama &>/dev/null; then
    success "Ollama installed successfully."
  else
    fail "Ollama installation failed. Please install manually from https://ollama.com/download"
  fi
}

# ── Configure CORS ─────────────────────────────────────────────
configure_cors() {
  step "2/5" "Configuring CORS for Chrome extensions..."

  if [[ "$OS" == "macos" ]]; then
    # Set for current session via launchctl (picked up by new processes)
    launchctl setenv OLLAMA_ORIGINS "*" 2>/dev/null || true

    # Add to shell profile for persistence across terminal sessions
    SHELL_RC=""
    if [[ -f "$HOME/.zshrc" ]]; then
      SHELL_RC="$HOME/.zshrc"
    elif [[ -f "$HOME/.bashrc" ]]; then
      SHELL_RC="$HOME/.bashrc"
    elif [[ -f "$HOME/.bash_profile" ]]; then
      SHELL_RC="$HOME/.bash_profile"
    fi

    if [[ -n "$SHELL_RC" ]]; then
      if ! grep -q 'OLLAMA_ORIGINS' "$SHELL_RC" 2>/dev/null; then
        echo '' >> "$SHELL_RC"
        echo '# Ollama Browser Control — allow Chrome extension CORS' >> "$SHELL_RC"
        echo 'export OLLAMA_ORIGINS="*"' >> "$SHELL_RC"
        success "Added OLLAMA_ORIGINS to ${SHELL_RC}"
      else
        success "OLLAMA_ORIGINS already configured in ${SHELL_RC}"
      fi
    fi

    # Also create/update the Ollama plist environment for the macOS app
    PLIST_DIR="$HOME/.ollama"
    mkdir -p "$PLIST_DIR"
    ENV_FILE="$PLIST_DIR/environment"
    if [[ -f "$ENV_FILE" ]] && grep -q 'OLLAMA_ORIGINS' "$ENV_FILE" 2>/dev/null; then
      success "OLLAMA_ORIGINS already set in Ollama environment file."
    else
      echo 'OLLAMA_ORIGINS=*' >> "$ENV_FILE"
      success "Set OLLAMA_ORIGINS=* in $ENV_FILE"
    fi

  else
    # Linux: edit systemd override or shell profile
    if systemctl list-units --type=service 2>/dev/null | grep -q ollama; then
      OVERRIDE_DIR="/etc/systemd/system/ollama.service.d"
      OVERRIDE_FILE="$OVERRIDE_DIR/cors.conf"
      if [[ -f "$OVERRIDE_FILE" ]] && grep -q 'OLLAMA_ORIGINS' "$OVERRIDE_FILE" 2>/dev/null; then
        success "OLLAMA_ORIGINS already configured in systemd."
      else
        sudo mkdir -p "$OVERRIDE_DIR"
        echo '[Service]' | sudo tee "$OVERRIDE_FILE" > /dev/null
        echo 'Environment="OLLAMA_ORIGINS=*"' | sudo tee -a "$OVERRIDE_FILE" > /dev/null
        sudo systemctl daemon-reload
        success "Set OLLAMA_ORIGINS=* in systemd override."
      fi
    fi

    # Also add to shell profile
    SHELL_RC=""
    if [[ -f "$HOME/.bashrc" ]]; then
      SHELL_RC="$HOME/.bashrc"
    elif [[ -f "$HOME/.zshrc" ]]; then
      SHELL_RC="$HOME/.zshrc"
    fi

    if [[ -n "$SHELL_RC" ]]; then
      if ! grep -q 'OLLAMA_ORIGINS' "$SHELL_RC" 2>/dev/null; then
        echo '' >> "$SHELL_RC"
        echo '# Ollama Browser Control — allow Chrome extension CORS' >> "$SHELL_RC"
        echo 'export OLLAMA_ORIGINS="*"' >> "$SHELL_RC"
        success "Added OLLAMA_ORIGINS to ${SHELL_RC}"
      else
        success "OLLAMA_ORIGINS already configured in ${SHELL_RC}"
      fi
    fi
  fi

  # Export for the current script process
  export OLLAMA_ORIGINS="*"
}

# ── Start Ollama server ────────────────────────────────────────
start_ollama() {
  step "3/5" "Starting Ollama server..."

  # Check if already running
  if curl -s -o /dev/null -w "%{http_code}" "$OLLAMA_URL/api/tags" 2>/dev/null | grep -q "200"; then
    # Check if CORS is working
    CORS_STATUS=$(curl -s -o /dev/null -w "%{http_code}" -H "Origin: chrome-extension://test" "$OLLAMA_URL/api/tags" 2>/dev/null)
    if [[ "$CORS_STATUS" == "200" ]]; then
      success "Ollama is already running with correct CORS settings."
      return 0
    else
      warn "Ollama is running but CORS is blocking Chrome extensions. Restarting..."
      pkill -f "ollama serve" 2>/dev/null || true
      if [[ "$OS" == "macos" ]]; then
        pkill -f "Ollama" 2>/dev/null || true
      fi
      sleep 2
    fi
  fi

  # Start server
  OLLAMA_ORIGINS="*" nohup ollama serve > /dev/null 2>&1 &
  SERVE_PID=$!

  # Wait for it to come up
  info "Waiting for Ollama to start..."
  for i in $(seq 1 30); do
    if curl -s -o /dev/null "$OLLAMA_URL" 2>/dev/null; then
      success "Ollama server is running (PID: $SERVE_PID)"
      return 0
    fi
    sleep 1
  done

  fail "Ollama server did not start within 30 seconds. Try running 'OLLAMA_ORIGINS=\"*\" ollama serve' manually."
}

# ── Pull default model ─────────────────────────────────────────
pull_model() {
  step "4/5" "Checking for default model (${DEFAULT_MODEL})..."

  if ollama list 2>/dev/null | grep -q "${DEFAULT_MODEL%%:*}"; then
    success "${DEFAULT_MODEL} is already downloaded."
    return 0
  fi

  warn "${DEFAULT_MODEL} not found. Downloading now..."
  info "This may take a few minutes depending on your connection."
  echo ""

  if ollama pull "$DEFAULT_MODEL"; then
    success "${DEFAULT_MODEL} downloaded successfully."
  else
    warn "Failed to pull ${DEFAULT_MODEL}. You can do this later with: ollama pull ${DEFAULT_MODEL}"
  fi
}

# ── Final instructions ─────────────────────────────────────────
print_done() {
  step "5/5" "Setup complete!"

  EXT_DIR="$(cd "$(dirname "$0")" && pwd)"

  echo ""
  echo -e "${GREEN}${BOLD}══════════════════════════════════════════════${NC}"
  echo -e "${GREEN}${BOLD}  ✓ Everything is ready!${NC}"
  echo -e "${GREEN}${BOLD}══════════════════════════════════════════════${NC}"
  echo ""
  echo -e "  ${BOLD}Load the extension in Chrome:${NC}"
  echo ""
  echo -e "  1. Open ${BOLD}chrome://extensions${NC}"
  echo -e "  2. Enable ${BOLD}Developer mode${NC} (toggle in top right)"
  echo -e "  3. Click ${BOLD}Load unpacked${NC}"
  echo -e "  4. Select this folder:"
  echo -e "     ${BLUE}${EXT_DIR}${NC}"
  echo -e "  5. Open any website → click the extension icon"
  echo -e "     → the agent opens in a side panel"
  echo ""
  echo -e "  ${BOLD}Models available:${NC}"
  ollama list 2>/dev/null | head -10 || echo "  (Could not list models)"
  echo ""
  echo -e "  ${YELLOW}Tip:${NC} If you reboot, run ${BOLD}./setup.sh${NC} again or start"
  echo -e "  Ollama with: ${BOLD}OLLAMA_ORIGINS=\"*\" ollama serve${NC}"
  echo ""
}

# ── Main ───────────────────────────────────────────────────────
main() {
  print_header
  detect_os
  install_ollama
  configure_cors
  start_ollama
  pull_model
  print_done
}

main "$@"
