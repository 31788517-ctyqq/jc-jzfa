#!/bin/bash
# ============================================================
#  Node.js v16.20.2 源码编译升级脚本
#  适用环境: CentOS 6 + glibc 2.12
#  目标: 从 Node v10 升级到 Node v16 (无需升级 OS)
#  预计耗时: 30-60 分钟（取决于 CPU 核心数）
# ============================================================
set -e
set -o pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

NODE_VERSION="16.20.2"
INSTALL_PREFIX="/usr/local/node16"
NODE_SRC_DIR="/usr/local/src/node-v${NODE_VERSION}"
LOG_FILE="/tmp/upgrade_node16_$(date +%Y%m%d_%H%M%S).log"

log()  { echo -e "${GREEN}[$(date '+%H:%M:%S')]${NC} $*" | tee -a "$LOG_FILE"; }
warn() { echo -e "${YELLOW}[警告]${NC} $*" | tee -a "$LOG_FILE"; }
err()  { echo -e "${RED}[错误]${NC} $*" | tee -a "$LOG_FILE"; }
step() { echo -e "\n${BLUE}━━━ 步骤 $1 ━━━${NC}" | tee -a "$LOG_FILE"; }

# ============================================================
# 回滚函数
# ============================================================
rollback() {
    echo ""
    err "编译失败，开始回滚..."
    echo ""
    # 恢复旧 Node
    if [ -f /usr/local/bin/node.old ]; then
        mv /usr/local/bin/node.old /usr/local/bin/node 2>/dev/null
        mv /usr/local/bin/npm.old /usr/local/bin/npm 2>/dev/null
        mv /usr/local/bin/npx.old /usr/local/bin/npx 2>/dev/null
        log "已恢复旧 Node.js 二进制"
    fi
    # 恢复 PM2
    pm2 restart all --update-env 2>/dev/null || true
    pm2 save 2>/dev/null || true
    log "回滚完成，服务已恢复旧版本"
    echo ""
    warn "完整日志保存在: $LOG_FILE"
    exit 1
}
trap rollback ERR

# ============================================================
# 步骤 0: 前置检查
# ============================================================
step "0/9: 前置检查"

log "当前系统信息:"
cat /etc/redhat-release 2>/dev/null | tee -a "$LOG_FILE" || warn "无法获取系统版本"
uname -a | tee -a "$LOG_FILE"

log "当前 Node.js 版本:"
node -v 2>/dev/null | tee -a "$LOG_FILE" || warn "未检测到 Node.js"

log "磁盘空间:"
df -h / | tail -1 | tee -a "$LOG_FILE"

log "内存:"
free -m 2>/dev/null | head -2 | tee -a "$LOG_FILE" || free | head -2 | tee -a "$LOG_FILE"

# 检查磁盘空间（至少 2GB）
AVAIL_KB=$(df / | tail -1 | awk '{print $4}')
if [ "$AVAIL_KB" -lt 2097152 ]; then
    err "磁盘可用空间不足 2GB（当前: $((AVAIL_KB/1024)) MB），编译需要约 1.5GB"
    exit 1
fi

log "磁盘空间充足 ✓"

# ============================================================
# 步骤 1: 备份当前 Node.js
# ============================================================
step "1/9: 备份当前 Node.js"

CUR_NODE=$(which node 2>/dev/null || echo "")
if [ -n "$CUR_NODE" ]; then
    cp "$CUR_NODE" /usr/local/bin/node.old
    log "已备份 node → /usr/local/bin/node.old"
fi
CUR_NPM=$(which npm 2>/dev/null || echo "")
if [ -n "$CUR_NPM" ]; then
    cp "$CUR_NPM" /usr/local/bin/npm.old
    log "已备份 npm → /usr/local/bin/npm.old"
fi
CUR_NPX=$(which npx 2>/dev/null || echo "")
if [ -n "$CUR_NPX" ] && [ "$CUR_NPX" != "$CUR_NPM" ]; then
    cp "$CUR_NPX" /usr/local/bin/npx.old
    log "已备份 npx → /usr/local/bin/npx.old"
fi

# ============================================================
# 步骤 2: 备份项目数据
# ============================================================
step "2/9: 备份项目数据"

BACKUP_FILE="/tmp/jc-zjfa-pre-upgrade-$(date +%Y%m%d_%H%M%S).tar.gz"
if [ -d /root/server ]; then
    tar -czf "$BACKUP_FILE" \
        --exclude='node_modules' \
        --exclude='logs' \
        /root/server/data.json \
        /root/server/trends.json \
        /root/server/live_scores.json \
        /root/server/midou_data.db* \
        /root/server/stats_bank.json \
        /root/server/ai_cache.json \
        /root/server/.env \
        /root/server/odds_history/ \
        /root/server/shuju_data/ \
        /root/server/package.json \
        /root/server/*.js \
        2>/dev/null || true
    log "数据已备份到: $BACKUP_FILE ($(du -sh $BACKUP_FILE 2>/dev/null | cut -f1 || echo '未知大小'))"
else
    warn "/root/server 不存在，跳过数据备份"
fi

# ============================================================
# 步骤 3: 修复 CentOS 6 yum 源
# ============================================================
step "3/9: 配置 yum 源"

log "CentOS 6 已 EOL，配置 Vault 镜像源..."

# 3a. 基础仓库（os/updates/extras）
cat > /etc/yum.repos.d/CentOS-Base.repo << 'YUMEOF'
[base]
name=CentOS-6 - Base
baseurl=https://vault.centos.org/centos/6/os/$basearch/
        https://mirrors.aliyun.com/centos-vault/6.10/os/$basearch/
gpgcheck=0
enabled=1

[updates]
name=CentOS-6 - Updates
baseurl=https://vault.centos.org/centos/6/updates/$basearch/
        https://mirrors.aliyun.com/centos-vault/6.10/updates/$basearch/
gpgcheck=0
enabled=1

[extras]
name=CentOS-6 - Extras
baseurl=https://vault.centos.org/centos/6/extras/$basearch/
        https://mirrors.aliyun.com/centos-vault/6.10/extras/$basearch/
gpgcheck=0
enabled=1
YUMEOF

# 3b. SCL 仓库（devtoolset-8 所在仓库）
cat > /etc/yum.repos.d/CentOS-SCLo.repo << 'SCLEOF'
[sclo-rh]
name=CentOS-6 - SCLo rh
baseurl=https://vault.centos.org/centos/6/sclo/$basearch/rh/
        https://mirrors.aliyun.com/centos-vault/6.10/sclo/$basearch/rh/
gpgcheck=0
enabled=1

[sclo-sclo]
name=CentOS-6 - SCLo sclo
baseurl=https://vault.centos.org/centos/6/sclo/$basearch/sclo/
        https://mirrors.aliyun.com/centos-vault/6.10/sclo/$basearch/sclo/
gpgcheck=0
enabled=1
SCLEOF

# 清除旧的 SCL repo 文件（centos-release-scl 可能留下带死链接的旧文件）
rm -f /etc/yum.repos.d/CentOS-SCLo-*.repo 2>/dev/null || true
# 禁用非必需源（epel/第三方源可能已失效，避免干扰）
for f in CentOS-fasttrack.repo CentOS-Debuginfo.repo CentOS-Vault.repo \
         epel.repo epel-testing.repo metasploit-framework.repo \
         mongodb-3.4.repo nodesource-el6.repo; do
    if [ -f "/etc/yum.repos.d/$f" ]; then
        sed -i 's/enabled=1/enabled=0/g' "/etc/yum.repos.d/$f" 2>/dev/null || true
    fi
done
yum clean all 2>&1 | tee -a "$LOG_FILE"

log "测试 yum 源连通性..."
if yum makecache 2>&1 | tee -a "$LOG_FILE"; then
    YUM_FIXED=true
    log "yum 源配置成功 ✓"
else
    warn "yum 源部分不可用（网络限制），仅保留 Vault 主源重试..."
    # 移除镜像源，仅保留主 Vault 源
    sed -i '/mirrors.aliyun.com/d' /etc/yum.repos.d/CentOS-Base.repo
    sed -i '/mirrors.aliyun.com/d' /etc/yum.repos.d/CentOS-SCLo.repo
    yum clean all 2>&1 | tee -a "$LOG_FILE"
    yum makecache 2>&1 | tee -a "$LOG_FILE" || {
        warn "Vault 源仍不可用，将尝试使用已有编译工具"
        YUM_FIXED=false
    }
fi

# ============================================================
# 步骤 4: 安装编译工具链
# ============================================================
step "4/9: 安装编译工具链 (GCC 8.3)"

if [ "$YUM_FIXED" = true ]; then
    # 安装 devtoolset-8（GCC 8.3.1 + 配套 binutils）
    log "安装 devtoolset-8 (GCC 8.3.1)..."
    yum install -y devtoolset-8-gcc devtoolset-8-gcc-c++ devtoolset-8-binutils \
        2>&1 | tee -a "$LOG_FILE" || {
        err "devtoolset-8 安装失败"
        err "检查: yum repolist | grep sclo"
        exit 1
    }

    # 安装其他编译依赖
    log "安装编译依赖..."
    yum install -y make openssl-devel zlib-devel rh-python36-python rh-python36-python-devel \
        2>&1 | tee -a "$LOG_FILE" || warn "部分依赖安装失败，将继续尝试"

    log "GCC 8.3 安装完成"
else
    # yum 完全不可用，检查是否已有可用的 GCC
    if [ -f /opt/rh/devtoolset-8/enable ]; then
        log "检测到已安装 devtoolset-8"
    elif [ -f /opt/rh/devtoolset-6/enable ]; then
        warn "仅有 devtoolset-6 (GCC 6.x)，将尝试编译（可能有兼容性问题）"
    elif command -v gcc &>/dev/null; then
        GCC_VER=$(gcc --version 2>/dev/null | head -1 || echo "unknown")
        log "使用系统自带 GCC: $GCC_VER"
        warn "Node 16 需要 GCC >= 6.3，当前版本可能不够"
    else
        err "GCC 未安装且 yum 不可用，无法继续"
        exit 1
    fi
fi

# ============================================================
# 步骤 5: 下载 Node.js 源码
# ============================================================
step "5/9: 下载 Node.js v${NODE_VERSION} 源码"

cd /usr/local/src

# 检查是否已有编译产物可复用（不删除已编译的对象文件）
if [ -d "$NODE_SRC_DIR" ] && [ -d "$NODE_SRC_DIR/out/Release/obj.target" ]; then
    log "检测到已有编译产物，复用（跳过清理）..."
    RESUME_BUILD=true
elif [ -d "$NODE_SRC_DIR" ]; then
    rm -rf "$NODE_SRC_DIR"
    RESUME_BUILD=false
else
    RESUME_BUILD=false
fi

if [ "$RESUME_BUILD" = false ]; then
    NODE_TARBALL="node-v${NODE_VERSION}.tar.gz"

    if [ ! -f "$NODE_TARBALL" ]; then
        log "从 Node.js 官方下载..."
        curl -fsSL -o "$NODE_TARBALL" \
            "https://nodejs.org/dist/v${NODE_VERSION}/${NODE_TARBALL}" || {
            warn "官方下载失败，尝试使用镜像..."
            curl -fsSL -o "$NODE_TARBALL" \
                "https://npmmirror.com/mirrors/node/v${NODE_VERSION}/${NODE_TARBALL}" || {
                err "Node.js 源码下载失败"
                exit 1
            }
        }
    else
        log "源码包已存在，跳过下载"
        # 验证完整性
        if ! tar -tzf "$NODE_TARBALL" >/dev/null 2>&1; then
            warn "源码包损坏，重新下载..."
            rm -f "$NODE_TARBALL"
            curl -fsSL -o "$NODE_TARBALL" \
                "https://nodejs.org/dist/v${NODE_VERSION}/${NODE_TARBALL}" || {
                curl -fsSL -o "$NODE_TARBALL" \
                    "https://npmmirror.com/mirrors/node/v${NODE_VERSION}/${NODE_TARBALL}"
            }
        fi
    fi

    log "解压源码..."
    tar -xzf "$NODE_TARBALL"
fi
cd "$NODE_SRC_DIR"

log "Node.js v${NODE_VERSION} 源码准备完成 ✓"

# ============================================================
# 步骤 5b: 修补 CentOS 6 缺失的头文件
# ============================================================
step "5b/9: 修补 sys/auxv.h (CentOS 6 glibc 2.12 缺失)"

AUXV_STUB="/usr/include/sys/auxv.h"
if [ ! -f "$AUXV_STUB" ]; then
    log "创建 sys/auxv.h 桩头文件..."
    mkdir -p /usr/include/sys
    cat > "$AUXV_STUB" << 'AUXVEOF'
/* Stub for CentOS 6 (glibc 2.12) — Node.js v16 编译兼容 */
#ifndef _SYS_AUXV_H
#define _SYS_AUXV_H 1

#include <features.h>
#include <elf.h>

__BEGIN_DECLS

/* 硬件能力位 */
#define AT_HWCAP  16
#define AT_HWCAP2 26

/* 桩函数：CentOS 6 内核无 getauxval，返回 0 表示无可检测特性 */
static inline unsigned long int getauxval(unsigned long int __type) {
    (void)__type;
    return 0UL;
}

__END_DECLS
#endif
AUXVEOF
    log "sys/auxv.h 桩已创建 ✓"
else
    log "sys/auxv.h 已存在，跳过"
fi

# ============================================================
# 步骤 6: 编译 Node.js
# ============================================================
step "6/9: 编译 Node.js v${NODE_VERSION}"

# 激活 devtoolset-8 (GCC 8.3) + rh-python36 (Python 3.6)
if [ -f /opt/rh/devtoolset-8/enable ]; then
    source /opt/rh/devtoolset-8/enable
    log "已激活 devtoolset-8 (GCC 8.3)"
elif [ -f /opt/rh/devtoolset-6/enable ]; then
    source /opt/rh/devtoolset-6/enable
    warn "使用 devtoolset-6 (GCC 6.x)，可能遇到兼容性问题"
else
    warn "未找到 devtoolset，使用系统 GCC"
fi

if [ -f /opt/rh/rh-python36/enable ]; then
    source /opt/rh/rh-python36/enable
    log "已激活 rh-python36 ($(python3 --version 2>&1))"
else
    warn "未找到 rh-python36，使用系统 Python"
fi

gcc --version | head -1 | tee -a "$LOG_FILE"

# 验证 GCC 版本（Node 16 需要 >= 6.3）
GCC_MAJOR=$(gcc -dumpversion | cut -d. -f1)
if [ "$GCC_MAJOR" -lt 6 ]; then
    err "GCC 版本过低（$(gcc -dumpversion)），Node 16 需要 >= 6.3"
    err "请确保 yum 源可用后重新运行: bash /root/upgrade_node16.sh"
    exit 1
fi
log "GCC 版本满足要求 ($(gcc -dumpversion))"

CPU_COUNT=$(nproc 2>/dev/null || echo 1)
log "CPU 核心数: $CPU_COUNT"

# 配置编译选项（CentOS 6 需显式链接 librt，clock_gettime 不在 libc 中）
log "配置编译参数..."
export PYTHON=python3
export LDFLAGS="-lrt"
./configure \
    --prefix="$INSTALL_PREFIX" \
    --without-inspector \
    --without-etw \
    --without-dtrace \
    2>&1 | tee -a "$LOG_FILE"
log "configure 成功 ✓"

# 编译（CentOS 6 glibc 2.12 不支持 aligned_alloc，修补 cctest 源文件）
log "开始编译（使用 $CPU_COUNT 核心）..."
log "修补 aligned_alloc 兼容性..."

CCTEST_FILE="test/cctest/test_crypto_clienthello.cc"
if [ -f "$CCTEST_FILE" ] && ! grep -q 'ALIGNED_ALLOC_COMPAT' "$CCTEST_FILE" 2>/dev/null; then
    # 在文件开头插入 aligned_alloc 兼容实现并替换调用
    cat > /tmp/cctest_patch.c << 'CCTESTEOF'
// ALIGNED_ALLOC_COMPAT: glibc < 2.16 fix for CentOS 6
#include <stdlib.h>
#include <errno.h>
static inline void* aligned_alloc_compat(size_t alignment, size_t size) {
    void* ptr = NULL;
    posix_memalign(&ptr, alignment, size);
    return ptr;
}
CCTESTEOF
    # 将兼容函数插入文件开头，并替换 aligned_alloc 调用
    cat /tmp/cctest_patch.c "$CCTEST_FILE" > /tmp/cctest_patched.cc
    sed -i 's/aligned_alloc(/aligned_alloc_compat(/' /tmp/cctest_patched.cc
    mv /tmp/cctest_patched.cc "$CCTEST_FILE"
    log "cctest 已修补"
fi

make -j$CPU_COUNT 2>&1 | tee -a "$LOG_FILE"
log "编译完成"

# 安装（手动安装——跳过 cctest，CentOS 6 glibc 2.12 不支持 aligned_alloc）
log "安装到 $INSTALL_PREFIX ..."
mkdir -p "$INSTALL_PREFIX/bin" "$INSTALL_PREFIX/lib/node_modules"
cp out/Release/node "$INSTALL_PREFIX/bin/"
chmod +x "$INSTALL_PREFIX/bin/node"

# 安装 npm（从源码中复制 + 兼容包装）
log "设置 npm..."
if [ -d "deps/npm" ]; then
    cp -r deps/npm "$INSTALL_PREFIX/lib/node_modules/npm"
    # 创建 npm/npx 启动器
    cat > "$INSTALL_PREFIX/bin/npm" << 'NPMEOF'
#!/bin/sh
exec /usr/local/node16/bin/node /usr/local/node16/lib/node_modules/npm/bin/npm-cli.js "$@"
NPMEOF
    cat > "$INSTALL_PREFIX/bin/npx" << 'NPXEOF'
#!/bin/sh
exec /usr/local/node16/bin/node /usr/local/node16/lib/node_modules/npm/bin/npx-cli.js "$@"
NPXEOF
    chmod +x "$INSTALL_PREFIX/bin/npm" "$INSTALL_PREFIX/bin/npx"
else
    warn "npm 源码目录不存在，安装后 npm 可能不可用"
fi
log "安装完成"

# ============================================================
# 步骤 7: 切换 Node.js 版本
# ============================================================
step "7/9: 切换 Node.js 全局版本"

# 创建软链接
ln -sf "${INSTALL_PREFIX}/bin/node" /usr/local/bin/node
ln -sf "${INSTALL_PREFIX}/bin/npm" /usr/local/bin/npm
ln -sf "${INSTALL_PREFIX}/bin/npx" /usr/local/bin/npx

# 添加到 PATH（确保所有 shell 都能找到）
if ! grep -q "${INSTALL_PREFIX}/bin" /etc/profile.d/node.sh 2>/dev/null; then
    echo "export PATH=${INSTALL_PREFIX}/bin:\$PATH" > /etc/profile.d/node.sh
    chmod +x /etc/profile.d/node.sh
fi
export PATH="${INSTALL_PREFIX}/bin:$PATH"

# 验证
log "验证新版本:"
NEW_NODE_VER=$(node -v 2>&1)
log "  Node.js: $NEW_NODE_VER"
log "  npm: $(npm -v 2>&1)"

if [[ "$NEW_NODE_VER" != v16.* ]]; then
    err "Node.js 版本验证失败，期望 v16.x，实际: $NEW_NODE_VER"
    exit 1
fi

log "Node.js v16 切换成功 ✓"

# ============================================================
# 步骤 8: 重编译项目原生模块
# ============================================================
step "8/9: 重编译项目依赖"

# 配置 npm 镜像加速
npm config set registry https://registry.npmmirror.com 2>/dev/null || true

PROJECT_DIRS=("/root/server" "/var/www/zj.100qiu.com/server")

for PROJ_DIR in "${PROJECT_DIRS[@]}"; do
    if [ ! -d "$PROJ_DIR" ]; then
        warn "$PROJ_DIR 不存在，跳过"
        continue
    fi

    log "处理: $PROJ_DIR"

    cd "$PROJ_DIR"

    # 确保核心依赖已安装
    log "  安装/更新核心依赖..."
    npm install --production --no-optional 2>&1 | tail -5 | tee -a "$LOG_FILE" || warn "部分依赖安装失败"

    # 关键：重编译 better-sqlite3
    if [ -d "node_modules/better-sqlite3" ]; then
        log "  重编译 better-sqlite3..."
        # 先尝试直接 rebuild
        if npm rebuild better-sqlite3 --build-from-source 2>&1 | tail -10 | tee -a "$LOG_FILE"; then
            log "  better-sqlite3 重编译成功 ✓"
        else
            warn "  better-sqlite3 rebuild 失败，尝试升级版本..."
            # Node 16 兼容 better-sqlite3 v7.x - v9.x
            npm install better-sqlite3@9.6.0 --build-from-source 2>&1 | tail -5 | tee -a "$LOG_FILE" || {
                warn "  better-sqlite3 升级也失败了，回退到内存模式"
                warn "  (database_fallback.js 会自动兜底)"
            }
        fi

        # 验证
        if node -e "
            try {
                const db = require('better-sqlite3')('/tmp/_upgrade_test.db');
                const info = db.pragma('journal_mode');
                db.close();
                require('fs').unlinkSync('/tmp/_upgrade_test.db');
                console.log('OK');
            } catch(e) {
                console.log('FAIL: ' + e.message);
                process.exit(1);
            }
        " 2>&1; then
            log "  better-sqlite3 验证通过 ✓"
        else
            warn "  better-sqlite3 验证失败（database_fallback.js 将提供兜底）"
        fi
    else
        warn "  better-sqlite3 未安装，跳过（database_fallback.js 提供内存兜底）"
    fi
done

# ============================================================
# 步骤 9: 重启服务
# ============================================================
step "9/9: 重启 PM2 服务"

log "停止现有服务..."
pm2 stop all 2>/dev/null || true

log "使用新 Node.js 启动服务..."
# 确保 PM2 使用新的 Node.js
pm2 start /root/ecosystem.config.json --update-env 2>/dev/null || {
    # 如果 ecosystem.config.json 不在 /root，尝试 /var/www
    if [ -f /var/www/zj.100qiu.com/ecosystem.config.json ]; then
        pm2 start /var/www/zj.100qiu.com/ecosystem.config.json --update-env
    else
        warn "未找到 ecosystem.config.json，尝试手动启动"
        cd /root/server 2>/dev/null || cd /var/www/zj.100qiu.com/server
        BEHIND_PROXY=1 pm2 start index.js --name jc-zjfa --node-args="--max-old-space-size=256"
        pm2 start data_sync.js --name jc-sync --node-args="--max-old-space-size=256"
    fi
}

pm2 save

log "PM2 状态:"
pm2 status 2>&1 | tee -a "$LOG_FILE"

# 等待服务启动
sleep 3

log "健康检查:"
for i in 1 2 3; do
    HEALTH=$(curl -s http://localhost:3000/health 2>/dev/null || echo "")
    if [ -n "$HEALTH" ]; then
        log "  健康检查通过: $HEALTH"
        break
    else
        if [ $i -lt 3 ]; then
            warn "  (${i}/3) 服务尚未就绪，等待 3 秒..."
            sleep 3
        else
            warn "  健康检查无响应，请手动检查: pm2 logs jc-zjfa"
        fi
    fi
done

# ============================================================
# 完成
# ============================================================
echo ""
echo "============================================"
echo -e "${GREEN}  Node.js 升级完成！${NC}"
echo "============================================"
echo ""
echo "  旧版本: $(cat /usr/local/bin/node.old 2>/dev/null && /usr/local/bin/node.old -v 2>/dev/null || echo 'v10.x')"
echo -e "  新版本: ${GREEN}$(node -v)${NC}"
echo "  npm:     $(npm -v)"
echo "  PM2:     $(pm2 -v 2>/dev/null || echo 'unknown')"
echo ""
echo "  数据备份: $BACKUP_FILE"
echo "  编译日志: $LOG_FILE"
echo ""
echo "  后续操作:"
echo "    pm2 status          - 查看服务状态"
echo "    pm2 logs jc-zjfa    - 查看 API 日志"
echo "    pm2 logs jc-sync    - 查看同步日志"
echo "    curl localhost:3000/health - 健康检查"
echo ""
echo -e "  ${YELLOW}如需回滚:${NC}"
echo "    mv /usr/local/bin/node.old /usr/local/bin/node"
echo "    mv /usr/local/bin/npm.old /usr/local/bin/npm"
echo "    pm2 restart all --update-env"
echo ""
echo "============================================"
