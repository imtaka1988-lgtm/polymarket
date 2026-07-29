# 零基础搭建与验收手册

本手册假设你使用 Windows 10/11，且不懂编程。不要跳步，每一步通过后再继续。

## 0. 五个基础词

- 仓库：项目所有代码和文档，GitHub保存远程副本。
- PowerShell：输入命令的窗口。
- 依赖：项目使用的现成软件包。
- 数据库：保存用户、市场、预测、积分和结算。
- 环境变量：本机配置和秘密，不放进代码。

## 1. 安装 Git

安装 Git for Windows，保持默认选项。验证：

```powershell
git --version
```

成功标志：显示 `git version ...`。找不到命令时先重启PowerShell，仍失败则重装并确认PATH。

## 2. 安装 Node.js 24 LTS

```powershell
node -v
```

必须以 `v24.` 开头。不要使用 Current 版。

## 3. 启用 pnpm

```powershell
corepack enable
corepack prepare pnpm@11.4.0 --activate
pnpm -v
```

成功标志：11.x。

## 4. 安装 Docker Desktop

启动后执行：

```powershell
docker --version
docker compose version
```

## 5. 下载项目

```powershell
cd D:\
mkdir Projects
cd Projects
git clone https://github.com/imtaka1988-lgtm/polymarket.git
cd polymarket
Get-Location
Get-ChildItem
```

必须看到 `package.json`、`apps`、`packages`、`docs`。

## 6. 创建本地配置

```powershell
Copy-Item .env.example .env
```

把 `SESSION_SECRET` 改成至少32位随机字符串。不要把 `.env` 发给任何人，不要提交GitHub。

## 7. 安装依赖

```powershell
pnpm install
```

成功标志：无红色错误结束，出现 `node_modules` 和 `pnpm-lock.yaml`。

错误顺序：检查网络→检查Node版本→重新启用Corepack。不要删除随机源码文件。

## 8. 启动数据库和Redis

```powershell
docker compose up -d
docker compose ps
```

`postgres`和`redis`必须running/healthy。

停止：`docker compose stop`。删除容器但保留数据：`docker compose down`。`docker compose down -v`会删除本地数据，只在明确重置时使用。

## 9. 环境自检

```powershell
pnpm doctor
```

它检查Node、pnpm、Docker、`.env`、PostgreSQL、Redis和Polymarket公开API。失败时先修复，不继续开发核心功能。

## 10. 启动项目

```powershell
pnpm dev
```

浏览器打开：

- http://localhost:3000
- http://localhost:4000/api/v1/health

成功标志：Web显示基线页；API返回`status: ok`；Worker定期输出`provider_sync_completed`。

## 11. 健康检查

另开PowerShell并进入项目目录：

```powershell
pnpm health
```

## 12. 修改前

```powershell
git status
git pull
git switch -c feature/short-description
```

禁止在main直接写大量改动。

## 13. 发布前

```powershell
pnpm verify
```

只有全部通过才创建Pull Request。

## 14. 未知Bug

1. 记录时间和操作；
2. 截图；
3. 保存完整错误文字；
4. 运行doctor和health；
5. 运行support-bundle；
6. 阅读排错文档；
7. 把脱敏材料交给AI或外部工程师。

## 15. 验收表

- [ ] Git可用
- [ ] Node 24.x
- [ ] pnpm 11.x
- [ ] Docker正常
- [ ] 仓库下载完成
- [ ] `.env`已创建且未提交
- [ ] 依赖安装完成
- [ ] PostgreSQL healthy
- [ ] Redis healthy
- [ ] doctor通过
- [ ] Web可打开
- [ ] API health正常
- [ ] Worker能获取公开事件
- [ ] verify通过
