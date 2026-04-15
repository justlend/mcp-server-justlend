#!/bin/bash
#
# JustLend MCP Server — Quick Test Environment Setup
#
# Usage:
#   bash scripts/setup-mcp-test.sh            # Run inside the project directory
#   bash scripts/setup-mcp-test.sh --claude-desktop  # Also print Claude Desktop config
#

set -e

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BUILD_DIR="$PROJECT_DIR/build"

echo "====================================="
echo " JustLend MCP Server Test Setup"
echo "====================================="
echo ""

# ── 1. Check Node.js ──────────────────────

if ! command -v node &> /dev/null; then
    echo "❌ Node.js not found. Please install Node.js 20+ first."
    echo "   macOS:   brew install node"
    echo "   Other:   https://nodejs.org/"
    exit 1
fi

NODE_MAJOR=$(node -v | cut -d'.' -f1 | tr -d 'v')
if [ "$NODE_MAJOR" -lt 20 ]; then
    echo "❌ Node.js version too old ($(node -v)), v20+ required."
    exit 1
fi
echo "✅ Node.js $(node -v)"

# ── 2. Install dependencies ──────────────────────────

if [ ! -d "$PROJECT_DIR/node_modules" ]; then
    echo ""
    echo "📦 Installing dependencies..."
    cd "$PROJECT_DIR" && npm install
fi
echo "✅ Dependencies ready"

# ── 3. Build ──────────────────────────────

echo ""
echo "🔨 Building project..."
cd "$PROJECT_DIR" && npm run build
echo "✅ Build complete"

# ── 4. TRONGRID_API_KEY (optional) ───────────

echo ""
TRONGRID_KEY="${TRONGRID_API_KEY:-}"

# Try to reuse key from existing .mcp.json
if [ -z "$TRONGRID_KEY" ] && [ -f "$PROJECT_DIR/.mcp.json" ]; then
    TRONGRID_KEY=$(grep -o '"TRONGRID_API_KEY"[[:space:]]*:[[:space:]]*"[^"]*"' "$PROJECT_DIR/.mcp.json" 2>/dev/null | head -1 | sed 's/.*"TRONGRID_API_KEY"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/')
fi

if [ -n "$TRONGRID_KEY" ]; then
    MASKED="${TRONGRID_KEY:0:8}...${TRONGRID_KEY: -4}"
    echo "TRONGRID_API_KEY detected: $MASKED"
    echo "  Press Enter to keep, or enter a new key to replace, type 'none' to clear:"
    read -r NEW_KEY
    if [ "$NEW_KEY" = "none" ]; then
        TRONGRID_KEY=""
    elif [ -n "$NEW_KEY" ]; then
        TRONGRID_KEY="$NEW_KEY"
    fi
else
    echo "Enter TRONGRID_API_KEY (optional, press Enter to skip):"
    echo "  Get one for free: https://www.trongrid.io/"
    read -r TRONGRID_KEY
fi

ENV_JSON=""
if [ -n "$TRONGRID_KEY" ]; then
    ENV_JSON=",
      \"env\": {
        \"TRONGRID_API_KEY\": \"$TRONGRID_KEY\"
      }"
    echo "✅ TRONGRID_API_KEY configured"
else
    echo "⚠️  TRONGRID_API_KEY not set. Free tier may be rate-limited."
fi

# ── 5. Generate Claude Code config (.mcp.json) ─

cat > "$PROJECT_DIR/.mcp.json" << EOF
{
  "mcpServers": {
    "justlend": {
      "command": "node",
      "args": ["$BUILD_DIR/index.js"]$ENV_JSON
    }
  }
}
EOF

echo "✅ Claude Code config: $PROJECT_DIR/.mcp.json"

# ── 6. Codex command ───────────────────────

echo ""
echo "📋 Codex local MCP registration command:"
echo ""
if [ -n "$TRONGRID_KEY" ]; then
    echo "codex mcp add justlend --env TRONGRID_API_KEY=$TRONGRID_KEY -- node $BUILD_DIR/index.js"
else
    echo "codex mcp add justlend -- node $BUILD_DIR/index.js"
fi

# ── 7. Claude Desktop config (optional output) ────

if [ "$1" = "--claude-desktop" ]; then
    echo ""
    echo "📋 Claude Desktop config (copy to Settings → Developer → MCP Servers):"
    echo ""
    cat << EOF
{
  "mcpServers": {
    "justlend": {
      "command": "node",
      "args": ["$BUILD_DIR/index.js"]$ENV_JSON
    }
  }
}
EOF
    echo ""
fi

# ── Done ─────────────────────────────────

echo ""
echo "====================================="
echo " ✅ Setup complete!"
echo "====================================="
echo ""
echo "▶ Start Claude Code:"
echo "  cd $PROJECT_DIR"
echo "  claude"
echo ""
echo "▶ Start Codex:"
echo "  cd $PROJECT_DIR"
echo "  codex"
echo ""
echo "▶ Or start in HTTP mode (for other MCP clients):"
echo "  npm run start:http"
echo ""
echo "── Try these prompts ─────────────────"
echo ""
echo "  1. What markets does JustLend have? What's the USDT supply APY?"
echo "  2. Check the positions for this address: TCrDi83pUoK17GbwxN1SckM3YNXzahWvoN"
echo "  3. What's the sTRX staking APY?"
echo "  4. Connect my TronLink wallet"
echo "  5. Supply 10 TRX to JustLend"
echo ""
echo "── Wallet Modes ─────────────────────"
echo ""
echo "  browser mode: Private keys stay in TronLink extension (recommended)"
echo "  agent mode:   Encrypted storage in ~/.agent-wallet/"
echo ""
