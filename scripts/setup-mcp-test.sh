#!/bin/bash
#
# JustLend MCP Server — 快速搭建测试环境
#
# 用法:
#   bash scripts/setup-mcp-test.sh            # 在项目目录内运行
#   bash scripts/setup-mcp-test.sh --claude-desktop  # 同时输出 Claude Desktop 配置
#

set -e

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BUILD_DIR="$PROJECT_DIR/build"

echo "====================================="
echo " JustLend MCP Server 测试环境搭建"
echo "====================================="
echo ""

# ── 1. 检查 Node.js ──────────────────────

if ! command -v node &> /dev/null; then
    echo "❌ 未检测到 Node.js，请先安装 Node.js 20+"
    echo "   macOS:   brew install node"
    echo "   其他:    https://nodejs.org/"
    exit 1
fi

NODE_MAJOR=$(node -v | cut -d'.' -f1 | tr -d 'v')
if [ "$NODE_MAJOR" -lt 20 ]; then
    echo "❌ Node.js 版本过低 ($(node -v))，需要 v20+"
    exit 1
fi
echo "✅ Node.js $(node -v)"

# ── 2. 安装依赖 ──────────────────────────

if [ ! -d "$PROJECT_DIR/node_modules" ]; then
    echo ""
    echo "📦 安装依赖..."
    cd "$PROJECT_DIR" && npm install
fi
echo "✅ 依赖已就绪"

# ── 3. 构建 ──────────────────────────────

echo ""
echo "🔨 构建项目..."
cd "$PROJECT_DIR" && npm run build
echo "✅ 构建完成"

# ── 4. TRONGRID_API_KEY (可选) ───────────

echo ""
TRONGRID_KEY="${TRONGRID_API_KEY:-}"
if [ -z "$TRONGRID_KEY" ]; then
    echo "请输入 TRONGRID_API_KEY (可选，直接回车跳过):"
    echo "  免费申请: https://www.trongrid.io/"
    read -r TRONGRID_KEY
fi

ENV_JSON=""
if [ -n "$TRONGRID_KEY" ]; then
    ENV_JSON=",
      \"env\": {
        \"TRONGRID_API_KEY\": \"$TRONGRID_KEY\"
      }"
    echo "✅ TRONGRID_API_KEY 已配置"
else
    echo "⚠️  未设置 TRONGRID_API_KEY，免费额度可能遇到限流"
fi

# ── 5. 生成 Claude Code 配置 (.mcp.json) ─

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

echo "✅ Claude Code 配置: $PROJECT_DIR/.mcp.json"

# ── 6. Claude Desktop 配置 (可选输出) ────

if [ "$1" = "--claude-desktop" ]; then
    echo ""
    echo "📋 Claude Desktop 配置 (复制到 Settings → Developer → MCP Servers):"
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

# ── 完成 ─────────────────────────────────

echo ""
echo "====================================="
echo " ✅ 搭建完成！"
echo "====================================="
echo ""
echo "▶ 启动 Claude Code:"
echo "  cd $PROJECT_DIR"
echo "  claude"
echo ""
echo "▶ 或启动 HTTP 模式 (供其他 MCP 客户端接入):"
echo "  npm run start:http"
echo ""
echo "── 试试这些对话 ──────────────────────"
echo ""
echo "  1. JustLend 有哪些市场？USDT 存款年化多少？"
echo "  2. 帮我查这个地址的仓位: TCrDi83pUoK17GbwxN1SckM3YNXzahWvoN"
echo "  3. sTRX 质押年化收益是多少？"
echo "  4. 连接我的 TronLink 钱包"
echo "  5. 帮我存 10 TRX 到 JustLend"
echo ""
echo "── 钱包模式 ──────────────────────────"
echo ""
echo "  browser 模式: 私钥留在 TronLink 插件内 (推荐)"
echo "  agent 模式:   加密存储在 ~/.agent-wallet/"
echo ""
