# id_x_010 Recheck 多轮检视清单(AI 执行版)

> **文档用途**:供 AI 编程助手(Cursor / Claude Code / Cline 等)对 id_x_010 代码库进行多轮系统化检视。
> **执行方式**:按 4 个 Round 顺序推进,每个 Round 内的检查项独立可执行,每项给出 `命令` + `期望` + `判定`,AI 跑完命令后对照期望得出 PASS/FAIL/INFO。
> **适用范围**:`/home/i/Desktop/codeSpace/i-Core/x_models/id_x_010/`(下文简称 `ROOT`)。
> **本期约束(必须严守)**:
> 1. 不引入 Code Agent 沙箱执行能力
> 2. General / SQL / Code 三 Agent 完全解耦,不互相联动
> 3. 不引入 Alembic 数据库迁移
> 4. 不引入 CI/CD 流水线
> 5. 不引入 Redis 缓存层
> 6. 不引入异步任务队列(arq/Celery)
> 7. 不引入 CSRF + 2FA 安全模块
> 8. 不写测试用例
> 9. 不扩展多数据源(仅 PostgreSQL)

---

## 0. 执行约定

### 0.1 状态码

| 状态 | 含义 | AI 行动 |
|------|------|---------|
| **PASS** | 符合预期 | 记录,继续下一项 |
| **FAIL** | 不符合预期 | 在报告中标红 + 引用具体代码行 + 给出修复建议 |
| **INFO** | 无法机器判定,需人工语义审查 | 记录后转 MANUAL 复核 |
| **NA** | 本期不适用 | 跳过 |

### 0.2 检查项 ID 规则

`R<Round>-<分类>-<序号>`,如 `R1-A-3` = 第 1 轮 A 分类第 3 项。

### 0.3 多轮设计

| Round | 名称 | 重点 | 检查方式 |
|-------|------|------|----------|
| **R1** | 静态扫描轮 | grep / 文件存在性 / 依赖清单 / 包结构 | 全部 AUTO |
| **R2** | 代码语义轮 | 函数实现 / 异常处理 / 类型注解 / 风格一致性 | AUTO + MANUAL 混合 |
| **R3** | 集成验证轮 | 路径连通 / Agent 解耦 / API 一致性 / 数据流 | MANUAL 为主 |
| **R4** | 排除项反向轮 | 验证 9 项排除约束未被违反 | 全部 AUTO(关键) |

### 0.4 报告模板(每轮结束输出)

```markdown
## Round N 检视报告

**执行时间**:YYYY-MM-DD HH:MM
**执行人/AI**:xxx
**总项数**:XX | PASS: XX | FAIL: XX | INFO: XX | NA: XX

### FAIL 项详情
- ID: R1-A-3
  - 检查项:xxx
  - 命令:`xxx`
  - 实际输出:`xxx`
  - 期望:`xxx`
  - 修复建议:xxx

### INFO 项(待人工复核)
- ID: R2-D-5
  - 检查项:xxx
  - 复核要点:xxx
```

---

# Round 1:静态扫描轮

> 全部为 AUTO 类检查,用 grep / find / ls / cat 等命令验证文件存在性与内容。

## R1-A 架构与依赖

### R1-A-1 PluginInterface 契约完整性

- **检查目的**:`x_plugin.py` 实现 `PluginInterface` 全部契约。
- **命令**:
  ```bash
  cd ROOT && grep -E "def (base|build_tables|set_session_maker|required_extensions|load_plugin)" x_plugin.py
  ```
- **期望**:输出包含 `base`、`build_tables`、`set_session_maker`、`required_extensions`、`load_plugin` 5 个符号定义。
- **判定**:全中 PASS,缺任意一个 FAIL。

### R1-A-2 required_extensions 启用 pgvector

- **检查目的**:TASK-001 已完成,pgvector 扩展已启用。
- **命令**:
  ```bash
  cd ROOT && grep "required_extensions" x_plugin.py
  ```
- **期望**:输出包含 `("vector",)`。
- **判定**:含 `("vector",)` PASS;`()` FAIL。

### R1-A-3 依赖版本明确

- **检查目的**:`requirements.txt` 所有依赖版本明确,无裸包名。
- **命令**:
  ```bash
  cd ROOT && grep -v "^#\|^$" requirements.txt | grep -vE "==|>=|<=|>|<|~="
  ```
- **期望**:无输出(全部依赖都带版本约束)。
- **判定**:无输出 PASS;有输出 FAIL,列出无版本依赖。

### R1-A-4 前端 audit

- **检查目的**:前端无 high/critical 漏洞。
- **命令**:
  ```bash
  cd ROOT/web && npm audit --audit-level=high 2>&1 | tail -20
  ```
- **期望**:`found 0 vulnerabilities` 或仅 low/moderate。
- **判定**:0 high/critical PASS;否则 FAIL。

### R1-A-5 包路径统一

- **检查目的**:无裸 `from src.` import(应统一为 `from x_models.id_x_010.src.`)。
- **命令**:
  ```bash
  cd ROOT && grep -rn "^from src\." src/ x_plugin.py
  ```
- **期望**:无输出。
- **判定**:无输出 PASS;有输出 FAIL。

### R1-A-6 循环 import 检测

- **检查目的**:supervisor ↔ sql_agent ↔ general_agent 之间无循环 import。
- **命令**:
  ```bash
  cd ROOT && python -c "import x_models.id_x_010.src.agents.x_langgraph_supervisor; print('OK')" 2>&1 | tail -5
  ```
- **期望**:输出 `OK`。
- **判定**:`OK` PASS;ImportError FAIL。

### R1-A-7 三 Agent 互相 import 检查(关键)

- **检查目的**:三个 Agent 之间不应互相 import(本期约束 #2)。
- **命令**:
  ```bash
  cd ROOT && \
  echo "--- general_agent imports ---" && \
  grep -E "^from x_models.*x_(sql_agent|code_agent|vl_agent)" src/agents/x_general_agent.py || echo "none" && \
  echo "--- sql_agent imports ---" && \
  grep -E "^from x_models.*x_(general_agent|code_agent|vl_agent)" src/agents/x_sql_agent.py || echo "none" && \
  echo "--- code_agent imports ---" && \
  grep -E "^from x_models.*x_(sql_agent|general_agent|vl_agent)" src/agents/x_code_agent.py 2>/dev/null || echo "none (or file not exist)"
  ```
- **期望**:三处全部输出 `none`(或 third 处 `file not exist`,Code Agent 暂为 GeneralAgent 占位)。
- **判定**:全部 none PASS;任一处出现实际 import FAIL。

### R1-A-8 LangGraph ReAct 串接检查(关键)

- **检查目的**:Supervisor 是单选路由,不应有 `Send` / `Command.PARENT` / `planned_agents` 等 ReAct 多 Agent 串接逻辑(本期约束 #2)。
- **命令**:
  ```bash
  cd ROOT && grep -nE "Send\(|Command\.PARENT|planned_agents|sub_results|_summary_agent_node|_planner_node" src/agents/x_langgraph_supervisor.py
  ```
- **期望**:无输出。
- **判定**:无输出 PASS;有输出 FAIL。

### R1-A-9 Code Agent 沙箱执行检查(关键)

- **检查目的**:本期不引入 Code Agent 沙箱,源码中不应出现 e2b/PythonREPL/jupyter_kernel 等关键字(本期约束 #1)。
- **命令**:
  ```bash
  cd ROOT && grep -rniE "e2b|PythonREPL|jupyter_kernel|jupyter_kernel_gateway" src/ requirements.txt
  ```
- **期望**:无输出。
- **判定**:无输出 PASS;有输出 FAIL。

## R1-B 安全基础

### R1-B-1 日志密钥泄漏

- **检查目的**:日志中不应出现明文 `api_key={api_key}` / `password={password}` 等格式化串。
- **命令**:
  ```bash
  cd ROOT && grep -rnE "api_key=\{api_key\}|password=\{password\}" src/
  ```
- **期望**:无输出。
- **判定**:无输出 PASS;有输出 FAIL(典型位置 `x_controllers.py:573` 已修复)。

### R1-B-2 .env 不入版本库

- **检查目的**:`.env` 必须在 `.gitignore` 中,实际仓库不追踪。
- **命令**:
  ```bash
  cd ROOT && git ls-files | grep -E "(^|/)\.env$" && echo "WARN: tracked" || echo "OK: not tracked"
  grep -E "^\.env$" .gitignore && echo "OK: ignored" || echo "WARN: not in gitignore"
  ```
- **期望**:第一行输出 `OK: not tracked`,第二行 `OK: ignored`。
- **判定**:两者均 OK 才 PASS。

### R1-B-3 .env.template 无真实密钥

- **检查目的**:`.env.template` 应仅留占位符。
- **命令**:
  ```bash
  cd ROOT && grep -E "sk-[a-zA-Z0-9]{20,}|ghp_[a-zA-Z0-9]{30,}" .env.template ops/.env.example
  ```
- **期望**:无输出。
- **判定**:无输出 PASS;有输出 FAIL(密钥泄漏)。

### R1-B-4 密码哈希算法

- **检查目的**:TASK-019 完成后,应使用 bcrypt。
- **命令**:
  ```bash
  cd ROOT && grep -nE "bcrypt|hashlib.sha256" src/views/x_views.py
  ```
- **期望**:`bcrypt` 出现,`hashlib.sha256` 仅在 `verify_password` 兼容老数据分支中出现。
- **判定**:满足 PASS;若仅 `hashlib.sha256` 无 bcrypt FAIL。

### R1-B-5 password_algo 字段存在

- **检查目的**:User 表必须有 `password_algo` 字段以兼容老数据。
- **命令**:
  ```bash
  cd ROOT && grep -nE "password_algo" src/models/x_models.py ops/init.sql
  ```
- **期望**:两处都有 `password_algo` 出现。
- **判定**:均出现 PASS;任一缺失 FAIL。

### R1-B-6 SQL SecurityChecker 调用点

- **检查目的**:`execute_query` 中必须强制调用 `SQLSecurityChecker.check`。
- **命令**:
  ```bash
  cd ROOT && grep -B2 -A8 "async def execute_query" src/agents/x_sql_agent.py | grep -E "SQLSecurityChecker.check|security_result"
  ```
- **期望**:有匹配行(`security_result = SQLSecurityChecker.check(sql, skip_protected=internal)`)。
- **判定**:有匹配 PASS;无匹配 FAIL。

### R1-B-7 ReadOnly 事务兜底

- **检查目的**:`SET TRANSACTION READ ONLY` 必须存在且失败降级。
- **命令**:
  ```bash
  cd ROOT && grep -A5 "SET TRANSACTION READ ONLY" src/agents/x_sql_agent.py | grep -E "ro_err|logger.warning"
  ```
- **期望**:有 `except Exception as ro_err:` 与 `logger.warning` 出现。
- **判定**:有匹配 PASS;无匹配 FAIL。

### R1-B-8 GraphQL mutation 鉴权

- **检查目的**:所有 mutation 入口应有鉴权调用。
- **命令**:
  ```bash
  cd ROOT && awk '/@strawberry\.mutation/,/^    async def/' src/controllers/x_controllers.py | grep -E "_get_bearer_user|require_admin" | wc -l
  ```
- **期望**:数量等于 mutation 数量(约 20+)。
- **判定**:等于 mutation 数 PASS;少于 FAIL。

## R1-C 包结构

### R1-C-1 后端目录结构完整

- **检查目的**:src/ 下应有 7 个核心子目录。
- **命令**:
  ```bash
  cd ROOT && ls -d src/{agents,controllers,graphql,models,schemas,utils,views}/ 2>&1
  ```
- **期望**:7 个目录全部存在。
- **判定**:全有 PASS;缺一 FAIL。

### R1-C-2 前端死目录处理

- **检查目的**:`web/src/redux/` 与 `web/src/services/` 空目录应被删除或落地实际代码。
- **命令**:
  ```bash
  cd ROOT && ls web/src/redux/ web/src/services/ 2>&1
  ```
- **期望**:要么目录被删除(ls 报错 "No such file"),要么含非 .gitkeep 的实际文件。
- **判定**:删除或落地 PASS;仍是空目录(仅 .gitkeep)INFO。

### R1-C-3 排除项目录反向检查(关键)

- **检查目的**:本期排除项相关目录不应存在。
- **命令**:
  ```bash
  cd ROOT && \
  echo "--- migrations/ ---" && ls migrations 2>/dev/null && echo "WARN" || echo "OK" && \
  echo "--- alembic.ini ---" && ls alembic.ini 2>/dev/null && echo "WARN" || echo "OK" && \
  echo "--- .github/workflows/ ---" && ls .github/workflows 2>/dev/null && echo "WARN" || echo "OK" && \
  echo "--- src/jobs/ ---" && ls src/jobs 2>/dev/null && echo "WARN" || echo "OK" && \
  echo "--- src/middleware/x_csrf* ---" && ls src/middleware/x_csrf* 2>/dev/null && echo "WARN" || echo "OK" && \
  echo "--- src/utils/x_2fa* ---" && ls src/utils/x_2fa* 2>/dev/null && echo "WARN" || echo "OK" && \
  echo "--- tests/ ---" && ls tests 2>/dev/null && echo "WARN" || echo "OK"
  ```
- **期望**:7 处全部输出 `OK`。
- **判定**:全 OK PASS;任一 WARN FAIL。

### R1-C-4 ops/compose.yaml 服务清单

- **检查目的**:compose.yaml 不应包含 redis / worker 服务。
- **命令**:
  ```bash
  cd ROOT && grep -E "^\s+(redis|worker|sandbox|celery):" ops/compose.yaml
  ```
- **期望**:无输出。
- **判定**:无输出 PASS;有输出 FAIL。

## R1-D 数据库与 init.sql

### R1-D-1 pgvector 扩展创建语句

- **检查目的**:`ops/init.sql` 应在顶部 `CREATE EXTENSION IF NOT EXISTS vector`。
- **命令**:
  ```bash
  cd ROOT && grep -n "CREATE EXTENSION IF NOT EXISTS vector" ops/init.sql
  ```
- **期望**:有匹配行,行号 < 10。
- **判定**:有匹配 PASS;无匹配 FAIL。

### R1-D-2 新增表存在性

- **检查目的**:TASK-001/005/009/012/014/017/018 引入的新表必须在 init.sql 中存在或能被 create_all 创建。
- **命令**:
  ```bash
  cd ROOT && grep -E "CREATE TABLE IF NOT EXISTS (table_comments|document_chunks|conversation_summaries|sql_examples|approval_tasks|report_subscriptions|user_feedbacks|sql_eval_cases|sql_eval_results|prompt_templates|uploaded_images)" ops/init.sql
  ```
- **期望**:出现所有计划中的表名(若对应 TASK 已完成)。
- **判定**:对照任务状态表,已完成的任务对应表必须出现。

### R1-D-3 兼容字段 ALTER 语句

- **检查目的**:本期不引入 Alembic,新字段必须通过 `ALTER TABLE ADD COLUMN IF NOT EXISTS` 兼容旧库(本期约束 #3)。
- **命令**:
  ```bash
  cd ROOT && grep -E "ALTER TABLE .* ADD COLUMN IF NOT EXISTS" ops/init.sql
  ```
- **期望**:出现 `is_admin`、`password_algo` 等新字段 ALTER 语句。
- **判定**:至少 2 条(对应 TASK-013/019)PASS;缺失 FAIL。

### R1-D-4 表注释完整

- **检查目的**:每张表应有 `COMMENT ON TABLE` 与关键字段 `COMMENT ON COLUMN`。
- **命令**:
  ```bash
  cd ROOT && grep -c "COMMENT ON TABLE" ops/init.sql && grep -c "COMMENT ON COLUMN" ops/init.sql
  ```
- **期望**:`COMMENT ON TABLE` 数量 ≥ 表数量,`COMMENT ON COLUMN` 数量 ≥ 50。
- **判定**:满足 PASS;否则 INFO(可能注释疏漏)。

### R1-D-5 触发器 updated_at 维护

- **检查目的**:目前仅 users 表有 `update_users_updated_at` 触发器,应扩展到带 updated_at 的所有表。
- **命令**:
  ```bash
  cd ROOT && grep -E "CREATE TRIGGER.*updated_at" ops/init.sql
  ```
- **期望**:数量等于带 `updated_at` 字段的表数(目前 users / external_provider / local_provider / agent_db_settings / user_model_settings / user_markdown_prompts / conversation_summaries 等)。
- **判定**:匹配数达标 PASS;不达标 INFO。

### R1-D-6 PROTECTED_TABLES 兜底屏蔽

- **检查目的**:`get_table_names` 应过滤 PROTECTED_TABLES,避免 LLM 在 list_tables 阶段看到敏感表。
- **命令**:
  ```bash
  cd ROOT && grep -B2 -A10 "async def get_table_names" src/agents/x_sql_agent.py | grep -E "PROTECTED_TABLES|filtered"
  ```
- **期望**:有 `n.lower() not in PROTECTED_TABLES` 过滤逻辑。
- **判定**:有匹配 PASS;无匹配 FAIL。

## R1-E 前端基础

### R1-E-1 i18n 字典文件

- **检查目的**:TASK-016 完成后应有两份语言字典。
- **命令**:
  ```bash
  cd ROOT/web && ls src/i18n/zh-CN.json src/i18n/en-US.json src/context/I18nContext.tsx 2>&1
  ```
- **期望**:三个文件都存在。
- **判定**:全在 PASS;否则 FAIL(若 TASK-016 未做则 NA)。

### R1-E-2 Markdown XSS 防护

- **检查目的**:`react-markdown` + `rehype-sanitize` 应启用。
- **命令**:
  ```bash
  cd ROOT/web && grep -E "rehype-sanitize|DOMPurify" package.json src/components/chat/ChatMessage.tsx
  ```
- **期望**:package.json 中有 `rehype-sanitize` 依赖,ChatMessage 中有 import 使用。
- **判定**:满足 PASS;否则 FAIL(XSS 风险)。

### R1-E-3 localStorage SSR 安全

- **检查目的**:所有 `localStorage.getItem` 应在 `typeof window !== "undefined"` 守卫内。
- **命令**:
  ```bash
  cd ROOT/web && grep -rn "localStorage.getItem" src/ | head -10
  ```
- **期望**:每个调用上下文(向上 3-5 行)有 `typeof window !== "undefined"` 检查。
- **判定**:全有守卫 PASS;否则 FAIL(水合错误)。

### R1-E-4 next.config standalone

- **检查目的**:生产构建镜像应启用 standalone 减小体积。
- **命令**:
  ```bash
  cd ROOT/web && grep "standalone" next.config.ts
  ```
- **期望**:输出 `output: "standalone"`。
- **判定**:有 PASS;无 INFO。

### R1-E-5 next dev 端口

- **检查目的**:`package.json` 的 dev script 应指定端口 2000(避免与后端 8000 冲突)。
- **命令**:
  ```bash
  cd ROOT/web && grep '"dev"' package.json
  ```
- **期望**:`"dev": "next dev -p 2000"`。
- **判定**:含 `-p 2000` PASS;无 FAIL。

## R1-F 运维配置

### R1-F-1 docker compose 容器资源限制

- **检查目的**:每个 service 应有 `mem_limit` 与 `restart: unless-stopped`。
- **命令**:
  ```bash
  cd ROOT && grep -E "mem_limit|restart:" ops/compose.yaml
  ```
- **期望**:每个 service 都有这两个字段。
- **判定**:齐全 PASS;否则 FAIL。

### R1-F-2 HAProxy 健康检查

- **检查目的**:HAProxy 应配置 `/health` 检查。
- **命令**:
  ```bash
  cd ROOT && grep -E "option httpchk|/health" ops/haproxy.cfg
  ```
- **期望**:有 `option httpchk GET /health` 或类似配置。
- **判定**:有 PASS;无 FAIL。

### R1-F-3 systemd unit 非 root

- **检查目的**:`ops/*.service` 应有 `User=` / `Group=` 非 root。
- **命令**:
  ```bash
  cd ROOT && grep -E "^User=|^Group=" ops/*.service
  ```
- **期望**:每个 service 文件都有 User= 与 Group=,且值非 `root`。
- **判定**:满足 PASS;否则 FAIL。

### R1-F-4 .env.example 完整性

- **检查目的**:代码中所有 `os.getenv` 调用的环境变量都应在 `.env.example` 中有占位。
- **命令**:
  ```bash
  cd ROOT && python -c "
  import re, os
  seen = set()
  for root, _, files in os.walk('src'):
      for f in files:
          if f.endswith('.py'):
              with open(os.path.join(root, f)) as fp:
                  for m in re.findall(r'os\.getenv\([\"\\']([\w]+)[\"\\']', fp.read()):
                      seen.add(m)
  with open('.env.template') as fp: tpl = fp.read()
  missing = [k for k in seen if k not in tpl]
  print('missing:', missing if missing else 'none')
  "
  ```
- **期望**:`missing: none`。
- **判定**:none PASS;否则 FAIL,列出缺失变量。

### R1-F-5 cron 报告订阅脚本

- **检查目的**:TASK-014 完成后,`ops/scripts/run_reports.sh` 与 `ops/crontab.example` 应存在。
- **命令**:
  ```bash
  cd ROOT && ls ops/scripts/run_reports.sh ops/crontab.example 2>&1
  ```
- **期望**:两个文件都存在。
- **判定**:存在 PASS;否则 NA(若 TASK-014 未做)。

---

# Round 2:代码语义轮

> 含较多 MANUAL 检查,AI 应读取指定文件位置并按要点人工判断。

## R2-D Agent 编排(单选路由)

### R2-D-1 LangGraph 节点异常处理

- **检查目的**:每个节点异常必须 try/except + `logger.error`,不静默吞错。
- **命令**:
  ```bash
  cd ROOT && grep -B1 "except Exception" src/agents/x_langgraph_supervisor.py | grep -c "logger"
  ```
- **期望**:几乎每个 `except` 前后都伴随 logger 调用。
- **判定**:覆盖率 > 90% PASS;< 90% FAIL,列出未日志化的 except。

### R2-D-2friendly_llm_error 覆盖度

- **检查目的**:错误降级函数应覆盖 temperature / rate_limit / auth / network / timeout 5 类。
- **命令**:
  ```bash
  cd ROOT && grep -iE "temperature|rate_limit|quota|auth|network|timeout|connection" src/agents/x_llm_error.py
  ```
- **期望**:文件内出现这些关键字(覆盖 5 类错误)。
- **判定**:5 类全覆盖 PASS;缺失 FAIL。

### R2-D-3 temperature 回退机制

- **检查目的**:reasoning 模型仅允许 temperature=1,代码应有 `_is_temp_error` 检测并回退。
- **命令**:
  ```bash
  cd ROOT && grep -nE "_is_temp_error|temperature=1" src/agents/x_general_agent.py src/agents/x_langgraph_supervisor.py src/agents/x_sql_agent.py
  ```
- **期望**:各 Agent 中都有该回退逻辑。
- **判定**:三处都有 PASS;缺一处 FAIL。

### R2-D-4 thinking 标签解析

- **检查目的**:`<thinking>...</thinking>` 标签应被正确解析,thinking 与 content 分流。
- **命令**:
  ```bash
  cd ROOT && grep -nE "in_thinking|<thinking>|</thinking>" src/agents/x_general_agent.py
  ```
- **期望**:有 `in_thinking` 状态变量 + 标签替换逻辑。
- **判定**:齐全 PASS;否则 FAIL。

### R2-D-5 三 Agent 状态流独立(MANUAL)

- **检查目的**:General Agent / SQL Agent / Code Agent 各自的 state 不应共享字段。
- **复核要点**:
  - `SupervisorState` 中的 `sub_results` / `planned_agents` 等 ReAct 字段不存在(本期约束)
  - 三个 Agent 的执行结果通过 `response` / `thinking` / `error` 统一返回,**不通过中间状态互相传递**
- **复核方式**:
  ```bash
  cd ROOT && sed -n '587,610p' src/agents/x_langgraph_supervisor.py  # 查看 SupervisorState 定义
  ```
- **期望**:`SupervisorState` 字段中无 `sub_results` / `planned_agents` / `executed_agents` / `iterations` / `max_iterations`。
- **判定**:无这些字段 PASS;存在 FAIL。

### R2-D-6 stream_chat usage 捕获

- **检查目的**:`stream_chat` 应捕获 `usage_metadata`,失败降级为 None 而非抛错。
- **命令**:
  ```bash
  cd ROOT && grep -B1 -A3 "usage_metadata" src/agents/x_general_agent.py
  ```
- **期望**:有 `meta = getattr(chunk, "usage_metadata", None)` 与 `isinstance(meta, dict)` 守卫。
- **判定**:有匹配 PASS;无 FAIL。

### R2-D-7 _decide_next_agent 单选语义(MANUAL)

- **检查目的**:`_decide_next_agent` 返回值应为单字符串(`"general"` / `"sql"` / `"code"` / `"end"`),不应返回列表。
- **复核要点**:
  ```bash
  cd ROOT && grep -A20 "def _decide_next_agent" src/agents/x_langgraph_supervisor.py
  ```
- **期望**:返回单值,无 `[agent1, agent2]` 形式;无 `Send` / `Command.PARENT` 调用。
- **判定**:单选 PASS;多选 FAIL。

### R2-D-8 直接调用模式与图编排行为一致(MANUAL)

- **检查目的**:`process` 中 `agent_type in ["general", "sql", "code"]` 直接调用分支与图编排分支产出结构一致(success / response / thinking / model_used / error 字段)。
- **复核要点**:对比 `process` 函数中 "if agent_type" 分支与 "initial_state" 分支返回的 dict key。
- **判定**:字段完全一致 PASS;不一致 FAIL。

## R2-E SQL Agent

### R2-E-1 PROTECTED_TABLES env 扩展(MANUAL)

- **检查目的**:`_load_protected_tables` 应支持 NONE 关键字、引号剥离、空值忽略。
- **复核要点**:
  ```bash
  cd ROOT && sed -n '350,371p' src/agents/x_sql_agent.py
  ```
- **期望**:
  - 设置为 `NONE` 清空默认集
  - 引号 `"` ` ` ` ' ` 被剥离
  - 空字符串被跳过
- **判定**:满足 PASS;否则 FAIL。

### R2-E-2 extract_referenced_tables 保守失败(MANUAL)

- **检查目的**:正则解析失败时应保守拒绝,不应静默放行。
- **复核要点**:`check_protected_tables` 调用 `extract_referenced_tables` 后,如返回空列表应不视为安全(可能漏过受保护表)。
- **命令**:
  ```bash
  cd ROOT && grep -B2 -A5 "extract_referenced_tables" src/agents/x_sql_agent.py | head -40
  ```
- **判定**:保守 PASS;激进放行 FAIL。

### R2-E-3 intent_analysis 与 chart_detection 职责清晰(MANUAL)

- **检查目的**:两者 prompt 不应重叠。
  - `intent_analysis`:在 generate_query **前**,塑形 SQL(ORDER BY / GROUP BY / LIMIT)
  - `chart_detection`:在 run_query **后**,推荐图表类型
- **命令**:
  ```bash
  cd ROOT && grep -n "INTENT_ANALYSIS_PROMPT\|CHART_DETECTION_PROMPT" src/agents/x_sql_agent.py
  ```
- **判定**:两个常量各自独立存在,职责清晰 PASS;否则 FAIL。

### R2-E-4 auto_execute 路径切换(MANUAL)

- **检查目的**:`check_query` 通过则跳过 human_approval 直接 run_query;否则进入挂起。
- **复核要点**:查看 state 中 `auto_execute` 字段的赋值与边判定。
- **判定**:逻辑正确 PASS;否则 FAIL。

### R2-E-5 continue_with_approval(approved=False)重新生成(MANUAL)

- **检查目的**:拒绝当前 SQL 后应重新走 generate_query,而非直接结束。
- **复核要点**:
  ```bash
  cd ROOT && grep -A20 "async def continue_with_approval" src/agents/x_sql_agent.py
  ```
- **期望**:`approved=False` 时调用 `stream_query` 重新生成。
- **判定**:有重新生成逻辑 PASS;否则 FAIL。

### R2-E-6 _resolve_settings 优先级

- **检查目的**:显式传参 > agent_db_settings 表 > 环境变量。
- **命令**:
  ```bash
  cd ROOT && grep -A8 "explicit_all = all" src/agents/x_sql_agent.py
  ```
- **期望**:显式全传入则跳过表查询;表无行才回退 env。
- **判定**:优先级正确 PASS;否则 FAIL。

### R2-E-7 pool_size 合理

- **检查目的**:多用户并发不应撑爆 PG `max_connections`。
- **命令**:
  ```bash
  cd ROOT && grep -E "pool_size|max_overflow" src/agents/x_sql_agent.py
  ```
- **期望**:`pool_size=5, max_overflow=10`,单 connection 最大 15。
- **判定**:合理 PASS;过大(如 pool_size=20) INFO。

### R2-E-8 _sql_agent_cache TTL/LRU(若 TASK-011 已完成)

- **检查目的**:命中 move_to_end,超 TTL 重建,超容量 evict + disconnect。
- **命令**:
  ```bash
  cd ROOT && grep -nE "OrderedDict|_MAX_AGENTS|_AGENT_TTL|move_to_end|popitem" src/agents/x_sql_agent.py
  ```
- **期望**:有 OrderedDict / _MAX_AGENTS / _AGENT_TTL / move_to_end / popitem 五个关键字。
- **判定**:全有 PASS;否则 NA(若 TASK-011 未做)。

### R2-E-9 _schema_cache 通过 retrieve 召回(若 TASK-002 已完成)

- **检查目的**:`_load_relevant_schema` 应优先向量召回,top-5 失败降级全 schema。
- **命令**:
  ```bash
  cd ROOT && grep -nE "_load_relevant_schema|retrieve_relevant_tables" src/agents/x_sql_agent.py
  ```
- **期望**:有这两个方法调用。
- **判定**:有 PASS;否则 NA(若 TASK-002 未做)。

### R2-E-10 Few-Shot 注入(若 TASK-009 已完成)

- **检查目的**:`generate_query` 节点应注入 retrieve_examples 结果到 prompt 末尾。
- **命令**:
  ```bash
  cd ROOT && grep -nE "retrieve_examples|类似问题参考" src/agents/x_sql_agent.py
  ```
- **期望**:有 retrieve_examples 调用 + "类似问题参考" 段拼入 prompt。
- **判定**:有 PASS;否则 NA。

## R2-F API 与控制器

### R2-F-1 GraphQL resolver try/except(关键)

- **检查目的**:每个 mutation / query resolver 异常应被捕获并返回结构化错误,绝不向客户端抛 raw GraphQL error。
- **复核要点**:
  ```bash
  cd ROOT && awk '/@strawberry\.(mutation|field)/,/^    @|^[^ ]/' src/controllers/x_controllers.py | grep -c "except Exception"
  ```
- **期望**:每个 resolver 都有 `try/except`。
- **判定**:覆盖率 100% PASS;< 100% FAIL。

### R2-F-2 request_id_var 异步生成器传递

- **检查目的**:SSE subscription 异步生成器中应重新 `request_id_var.set(req_id)`。
- **命令**:
  ```bash
  cd ROOT && grep -A15 "async def generate" src/controllers/x_controllers.py | grep "request_id_var.set"
  ```
- **期望**:有 `request_id_var.set(req_id)` 调用。
- **判定**:有 PASS;无 FAIL。

### R2-F-3 SSE 缓冲头

- **检查目的**:所有 SSE 端点应设置 `X-Accel-Buffering: no`,避免 nginx 缓冲。
- **命令**:
  ```bash
  cd ROOT && grep -rn "X-Accel-Buffering" src/controllers/
  ```
- **期望**:`graphql_stream_subscription` 与 `sql_approval_endpoint` 两处都有。
- **判定**:两处都有 PASS;否则 FAIL。

### R2-F-4 Mutation 输入校验

- **检查目的**:Mutation 输入字段服务端应再次校验,不只依赖 GraphQL schema 类型。
- **复核要点**:重点检查 `register`(password 长度)、`save_model_settings`(字段非空)、`save_external_model`(字段非空 + 可选 test_connection)。
- **命令**:
  ```bash
  cd ROOT && grep -B1 -A5 "if not all\|if len(input.password)" src/controllers/x_controllers.py
  ```
- **期望**:多处有显式校验。
- **判定**:校验齐全 PASS;否则 INFO。

### R2-F-5 register 后 login 流程(MANUAL)

- **检查目的**:`register` 创建的用户 `is_active=False`,需管理员激活才能 `login`。本期 TASK-013 应提供管理员激活 UI。
- **复核要点**:`login` 中有 `if user.is_active is False: return AuthResponseType(success=False, message="用户尚未激活")`,且 TASK-013 完成后 Mutation 有 `toggleUserActive`。
- **判定**:两者都有 PASS;否则 FAIL。

### R2-F-6 forgot_password 安全(MANUAL)

- **检查目的**:目前 `forgot_password` 直接在响应中返回 `reset_token`,生产应改发邮件。
- **复核要点**:
  ```bash
  cd ROOT && grep -A30 "async def forgot_password" src/controllers/x_controllers.py
  ```
- **期望**:reset_token 不在响应中返回(或仅用于本地 demo),生产应发送邮件。
- **判定**:不返回 PASS;仍返回 INFO(代码注释已提示)。

### R2-F-7 sql_approval 双入口一致(MANUAL)

- **检查目的**:`sql_approval` mutation 与 `/sql-approval` HTTP endpoint 行为应一致。
- **复核要点**:对比两处 approve/reject/cancel 三分支处理逻辑。
- **判定**:行为一致 PASS;否则 FAIL。

### R2-F-8 GraphQL 自动 camelCase(MANUAL)

- **检查目的**:Schema `auto_camel_case` 设置与前端字段命名一致。
- **复核要点**:
  ```bash
  cd ROOT && grep "strawberry.Schema" src/controllers/x_controllers.py
  cd ROOT/web && grep -rn "sendMessage\|sqlApproval\|reindexSchema" src/api/graphql.ts
  ```
- **期望**:Schema 默认 auto_camel_case=True,前端用 camelCase 调用。
- **判定**:一致 PASS;不一致 FAIL。

### R2-F-9 WebSocket 鉴权(MANUAL, 若 TASK-012 已完成)

- **检查目的**:`/ws/approval` 鉴权失败应立即关闭连接发送 close 帧。
- **复核要点**:
  ```bash
  cd ROOT && grep -A8 "async def approval_ws" src/controllers/x_ws.py 2>/dev/null
  ```
- **期望**:鉴权失败调用 `await socket.close(code=4001)` 并 return。
- **判定**:有 close 调用 PASS;否则 FAIL。

## R2-G 前端代码

### R2-G-1 useEffect 依赖数组(MANUAL)

- **检查目的**:`useEffect` 依赖数组完整,无副作用泄漏。
- **复核要点**:重点检查 `ChatHome.tsx` 与 `ChatMessage.tsx` 中订阅、定时器是否在 cleanup 中清理。
- **命令**:
  ```bash
  cd ROOT/web && grep -rn "useEffect" src/components/chat/ src/views/ChatHome.tsx | head
  ```
- **判定**:依赖完整 + cleanup PASS;否则 FAIL。

### R2-G-2 streamChat SSE 心跳与重连(MANUAL)

- **检查目的**:`streamChat.ts` 应处理 SSE心跳、网络断连重连、客户端取消。
- **复核要点**:读取 `web/src/api/streamChat.ts` 完整文件。
- **判定**:有重连 + 取消逻辑 PASS;否则 INFO。

### R2-G-3 graphql.ts 错误处理

- **检查目的**:`fetch` 错误应区分 401 / 5xx / 网络。
- **命令**:
  ```bash
  cd ROOT/web && grep -E "401|status === 5|catch|throw" src/api/graphql.ts
  ```
- **期望**:有 401 跳登录、5xx 重试或提示、网络错误抛出。
- **判定**:齐全 PASS;否则 FAIL。

### R2-G-4 ChartView 边界处理(MANUAL)

- **检查目的**:大数据(>1000 行)、空数据、极端值(负数、NaN、Infinity)应有 fallback。
- **复核要点**:读 `web/src/components/chat/ChartView.tsx`,确认 toNum/formatNum 与 SVG 渲染分支。
- **判定**:有 fallback PASS;否则 INFO。

### R2-G-5 SqlApprovalPanel 防重复提交(MANUAL)

- **检查目的**:审批按钮点击后应禁用 + loading 态,网络异常有重试。
- **复核要点**:读 `web/src/components/chat/SqlApprovalPanel.tsx`。
- **判定**:有禁用 + loading PASS;否则 FAIL。

### R2-G-6 表单 loading + toast(MANUAL)

- **检查目的**:表单提交 loading、失败 toast 提示,无静默错误。
- **复核要点**:扫 `ModelSettingsDialog.tsx` / `ProfileDialog.tsx` / `LoginPage.tsx`。
- **判定**:loading + toast 齐全 PASS;否则 FAIL。

### R2-G-7 I18nProvider 顺序(MANUAL, 若 TASK-016 已完成)

- **检查目的**:`layout.tsx` 中 I18nProvider 在 ThemeProvider 外层或合理位置,Context 链清晰。
- **命令**:
  ```bash
  cd ROOT/web && cat src/app/layout.tsx
  ```
- **判定**:顺序合理 PASS;否则 INFO。

### R2-G-8 /admin 路由守卫(MANUAL, 若 TASK-013 已完成)

- **检查目的**:普通用户访问 `/admin` 应重定向首页。
- **复核要点**:
  ```bash
  cd ROOT/web && cat src/app/admin/page.tsx 2>/dev/null
  ```
- **期望**:有 `if (!user.is_admin) router.push("/")` 之类逻辑。
- **判定**:有守卫 PASS;否则 FAIL。

## R2-H 性能

### R2-H-1 LLM 调用超时

- **检查目的**:所有 `ChatOpenAI` 实例化应有 `request_timeout`。
- **命令**:
  ```bash
  cd ROOT && grep -rnE "ChatOpenAI\(" src/ | wc -l
  cd ROOT && grep -rnE "request_timeout" src/agents/ src/utils/
  ```
- **期望**:`ChatOpenAI(` 总数与 `request_timeout` 出现次数接近。
- **判定**:有超时 PASS;无 INFO。

### R2-H-2 SSE 心跳(若实现)

- **检查目的**:LLM 长时间无 token 时应发心跳避免 nginx 60s 超时。
- **命令**:
  ```bash
  cd ROOT && grep -rnE "heartbeat|ping" src/controllers/x_controllers.py | head
  ```
- **期望**:有 `{"type": "heartbeat"}` 或类似定时发送逻辑。
- **判定**:有 PASS;无 INFO(本期可不做)。

### R2-H-3 客户端断开停止 LLM(MANUAL)

- **检查目的**:SSE 客户端断开应触发 `asyncio.CancelledError` 并停止 LLM 调用。
- **复核要点**:在 stream_chat generate() 函数中检查 `try/except asyncio.CancelledError`。
- **判定**:有处理 PASS;否则 INFO。

### R2-H-4 _schema_cache 失效机制

- **检查目的**:表结构变更后(如 reindex_schema)应清缓存。
- **命令**:
  ```bash
  cd ROOT && grep -E "_schema_cache = None|invalidate.*schema" src/agents/x_sql_agent.py src/controllers/x_controllers.py
  ```
- **期望**:有失效调用(若 TASK-002/003 已完成)。
- **判定**:有 PASS;无 INFO。

## R2-I 可观测性(若 TASK-007 已完成)

### R2-I-1 metrics 命名规范

- **检查目的**:Counter 用 `_total` 后缀,Histogram 用 `_seconds` 后缀。
- **命令**:
  ```bash
  cd ROOT && grep -E "Counter\(|Histogram\(|Gauge\(" src/utils/x_metrics.py 2>/dev/null
  ```
- **期望**:Counter 名以 `_total` 结尾,Histogram `_seconds`。
- **判定**:命名规范 PASS;否则 FAIL。

### R2-I-2 三 Agent 各自埋点

- **检查目的**:LLM_CALLS / LLM_LATENCY 应在 General / SQL / Code 三 Agent 各自埋点。
- **命令**:
  ```bash
  cd ROOT && grep -rnE "LLM_CALLS|LLM_LATENCY" src/agents/
  ```
- **期望**:三个 agent 文件都有埋点。
- **判定**:三处都有 PASS;缺一处 FAIL。

### R2-I-3 SECURITY_BLOCKS 埋点

- **检查目的**:`SQLSecurityChecker.check` 拦截时应 `SECURITY_BLOCKS.labels(reason_type=...).inc()`。
- **命令**:
  ```bash
  cd ROOT && grep -B2 -A5 "SECURITY_BLOCKS" src/agents/x_sql_agent.py 2>/dev/null
  ```
- **期望**:有 inc() 调用且 labels 包含 reason type。
- **判定**:有 PASS;无 NA。

### R2-I-4 /metrics endpoint

- **检查目的**:`register_routers` 应注册 GET /metrics。
- **命令**:
  ```bash
  cd ROOT && grep -E "@get\(\"/metrics\\"\)|metrics_endpoint" src/controllers/x_controllers.py
  ```
- **期望**:有 endpoint 注册。
- **判定**:有 PASS;无 FAIL。

### R2-I-5 logger 全部带 request_id

- **检查目的**:几乎所有 logger 调用都应以 `get_request_id()` 为前缀。
- **命令**:
  ```bash
  cd ROOT && grep -rE "logger\.(info|warning|error|debug)" src/ | wc -l
  cd ROOT && grep -rE "get_request_id\(\)" src/ | wc -l
  ```
- **期望**:两个数大致接近(80% 以上日志调用携带 request_id 前缀)。
- **判定**:比例 > 80% PASS;< 80% FAIL。

---

# Round 3:集成验证轮

> 多为 MANUAL,AI 应基于代码逻辑做端到端推断。

## R3-A 端到端数据流

### R3-A-1 用户提问 → 流式响应(MANUAL)

- **检查目的**:完整数据流应畅通。
- **数据流**:
  ```
  前端 streamChat.ts fetch /graphql/stream
  → controllers register_routers graphql_stream_subscription
  → schema.subscribe
  → Mutation/Subscription resolver
  → LangGraphSupervisor.stream_process
  → router.route(query)
  → _decide_next_agent 路由到 general/sql/code
  → 对应 agent.stream_chat / stream_query
  → yield chunk
  → controller yield StreamChunkType
  → SSE data: chunk\n\n
  → 前端流式渲染
  ```
- **复核要点**:逐环节查看代码,无断点。
- **判定**:全链路通畅 PASS;断点 FAIL。

### R3-A-2 SQL 审批闭环(MANUAL)

- **检查目的**:用户问数 → SQL Agent 生成 → 不在白名单挂起 → 推送 sql_approval chunk → 前端弹审批面板 → 用户审批 → 继续执行。
- **复核要点**:
  - `human_approval` 节点产出 `sql_approval` chunk
  - 前端 `SqlApprovalPanel` 显示 SQL 与按钮
  - `/sql-approval` endpoint 接收 action 后继续执行
  - TASK-006 完成后通过 LangGraph checkpoint thread_id 恢复
- **命令**:
  ```bash
  cd ROOT && grep -nE "sql_approval|continue_with_approval" src/agents/x_sql_agent.py src/controllers/x_controllers.py
  cd ROOT/web && grep -n "SqlApprovalPanel\|sqlApproval" src/components/ src/api/
  ```
- **判定**:全链路 PASS;否则 FAIL。

### R3-A-3 多用户上下文隔离(MANUAL)

- **检查目的**:不同用户的对话日志、提示词、用量统计应严格隔离。
- **复核要点**:
  - `conversation_logs` 无 user_id 字段(改为按 conversation_id 隔离,需保证 conversation_id 不重复)
  - `user_markdown_prompts` / `usage_logs` 等都按 user_id 过滤
  - GraphQL query 必须用 `_get_bearer_user` 拿到 user 后查询
- **命令**:
  ```bash
  cd ROOT && grep -E "user_id == user.id|user_id=user.id" src/views/x_views.py src/controllers/x_controllers.py | wc -l
  ```
- **期望**:每个用户相关 query 都有 user_id 过滤。
- **判定**:全过滤 PASS;否则 FAIL(数据越权)。

### R3-A-4 模型配置切换生效(MANUAL)

- **检查目的**:用户切模型 / 配置 → 后续请求生效。
- **复核要点**:
  - `external_models` 表存多模型
  - `stream_chat` 入口根据 `model_name` 查 `external_models` 表拿 base_url/api_key
  - `LangGraphSupervisor` 实例化时用 override_api_key/override_base_url
- **判定**:链路完整 PASS;否则 FAIL。

## R3-B Agent 解耦深度验证

### R3-B-1 三个 Agent state 不共享(MANUAL)

- **检查目的**:`GeneralAgent.chat` / `SQLAgent.query` / `CodeAgent.chat` 各自维护独立 state,不通过共享全局变量传递数据。
- **复核要点**:
  - `GeneralAgent` 内部用 `messages: List[BaseMessage]`
  - `SQLAgent` 用 `SQLAgentState(MessagesState)` 子类
  - 两者不共享同一 state 对象
- **命令**:
  ```bash
  cd ROOT && grep -nE "class.*AgentState|class.*State\(TypedDict\)" src/agents/
  ```
- **期望**:三个 Agent 各自定义独立 state。
- **判定**:独立定义 PASS;否则 FAIL。

### R3-B-2 Supervisor 不调用子 Agent 内部方法(MANUAL)

- **检查目的**:`LangGraphSupervisor` 只通过 `agent.chat()` / `agent.query()` 公开 API 调用,不直接访问 agent 内部 state。
- **复核要点**:
  ```bash
  cd ROOT && grep -E "self\.(general_agent|sql_agent|code_agent)\.[a-z_]+" src/agents/x_langgraph_supervisor.py | grep -vE "chat\(|query\(|stream_chat\(|stream_query\(|stream_run\(" 
  ```
- **期望**:无内部方法直接调用(只调公开方法)。
- **判定**:仅公开方法 PASS;否则 FAIL。

### R3-B-3 三个 Agent 工具集不交叉(MANUAL)

- **检查目的**:TASK-004 General Agent 引入工具集应仅 General Agent 使用,SQL Agent 不应有工具。
- **命令**:
  ```bash
  cd ROOT && grep -rE "from.*agents.tools" src/agents/
  ```
- **期望**:仅 `x_general_agent.py` 引入 `agents.tools`,SQL Agent / Code Agent 不引入。
- **判定**:仅 general PASS;否则 FAIL。

### R3-B-4 VL Agent 独立(若 TASK-015 已完成)

- **检查目的**:VL Agent 不调用其它 Agent,其它 Agent 不调用 VL Agent。
- **命令**:
  ```bash
  cd ROOT && grep -E "VLAgent" src/agents/x_general_agent.py src/agents/x_sql_agent.py src/agents/x_code_agent.py 2>/dev/null
  ```
- **期望**:无输出(三个 Agent 不依赖 VLAgent)。
- **判定**:无输出 PASS;有 FAIL。

## R3-C API 一致性

### R3-C-1 README API 表 vs 代码实现(MANUAL)

- **检查目的**:README 第 8 节 API 接口表应与 controllers 中实际暴露接口一致。
- **复核要点**:README 写 `approveSql` 但代码中是 `sqlApproval`,需统一。
- **命令**:
  ```bash
  cd ROOT && grep -E "^interface\|Mutation/\|Query/" README.md
  cd ROOT && grep -E "@strawberry\.(mutation|field)" src/controllers/x_controllers.py | head -30
  ```
- **判定**:一致 PASS;不一致 FAIL。

### R3-C-2 Schemas Input 与控制器调用一致(MANUAL)

- **检查目的**:每个 Mutation input 类字段与控制器内调用 `input.xxx` 一致。
- **复核要点**:抽样检查 5 个 mutation。
- **判定**:一致 PASS;否则 FAIL。

### R3-C-3 GraphQL Schema 注册

- **检查目的**:`schema = strawberry.Schema(query=Query, mutation=Mutation, subscription=Subscription)` 注册完整。
- **命令**:
  ```bash
  cd ROOT && grep -n "strawberry.Schema(" src/controllers/x_controllers.py
  ```
- **期望**:有该行,且包含 query/mutation/subscription 三参。
- **判定**:三参齐全 PASS;否则 FAIL。

## R3-D 配置与外部依赖

### R3-D-1 LLM_PROVIDER 切换可用

- **检查目的**:`load_llm_provider_config()` 应正确读取 `external_provider` / `local_provider` 表。
- **命令**:
  ```bash
  cd ROOT && grep -n "async def load_llm_provider_config" src/views/x_views.py
  ```
- **期望**:函数存在,内部按 `LLM_PROVIDER` env 选择表。
- **判定**:有 PASS;否则 FAIL。

### R3-D-2 SSO JWKS 验签(MANUAL)

- **检查目的**:`x_oauth.py` 应使用 RS256 验签 id_token,JWKS 缓存有 TTL。
- **复核要点**:
  ```bash
  cd ROOT && grep -nE "RS256|JWKS|jwks_client" src/utils/x_oauth.py
  ```
- **期望**:有 RS256 / JWKS 相关代码。
- **判定**:有 PASS;否则 FAIL。

### R3-D-3 文件上传校验统一(MANUAL)

- **检查目的**:`upload_markdown` / `upload_avatar` / `upload_image`(若 TASK-015)三处校验风格一致。
- **复核要点**:大小限制、MIME 校验、内容嗅探、鉴权。
- **判定**:三处齐全 PASS;否则 FAIL。

### R3-D-4 审批任务持久化(若 TASK-012 已完成)

- **检查目的**:`ApprovalTask` 表存在,create/resolve 函数落实。
- **命令**:
  ```bash
  cd ROOT && grep -nE "class ApprovalTask|create_approval_task|resolve_task" src/
  ```
- **期望**:有 ApprovalTask 模型与对应函数。
- **判定**:有 PASS;无 NA。

## R3-E 文档一致性

### R3-E-1 README API 与代码一致(同 R3-C-1)

### R3-E-2 架构描述文档 vs 代码(MANUAL)

- **检查目的**:`docs/架构描述.md` 中描述的 Memcached 应改为 Redis 不可用 / 进程内缓存(本期排除项)。
- **复核要点**:
  ```bash
  cd ROOT && grep -E "Memcached|Redis|pgvector" docs/架构描述.md
  ```
- **期望**:不应有 Memcached 承诺;pgvector 应已落地。
- **判定**:文档已与代码同步 PASS;否则 FAIL。

### R3-E-3 corpus.md 与 utterances 一致(MANUAL)

- **检查目的**:`docs/corpus.md` 中语料应与 `x_langgraph_supervisor.py` 中 `GENERAL_ROUTE` / `SQL_ROUTE` / `CODE_ROUTE` utterances 一致。
- **复核要点**:对比两份内容。
- **判定**:一致 PASS;否则 INFO。

### R3-E-4 README 含本期范围说明(MANUAL)

- **检查目的**:README 应明确说明本期不包含的 9 项排除。
- **命令**:
  ```bash
  cd ROOT && grep -E "本期不|不包含|excluded" README.md
  ```
- **期望**:有"本期范围"段落,列出 9 项排除。
- **判定**:有 PASS;无 INFO。

### R3-E-5 LICENSE 与版权头

- **检查目的**:源文件头部应有 AGPL-3.0 声明。
- **命令**:
  ```bash
  cd ROOT && grep -rL "AGPL-3.0\|GNU Affero General Public License" src/ x_plugin.py
  ```
- **期望**:多数文件包含(可能漏检,作为 INFO)。
- **判定**:覆盖率 > 80% PASS;否则 INFO。

---

# Round 4:排除项反向轮(关键)

> **此 Round 是本期最重要的轮次**,验证 9 项排除约束未被 AI 在执行任务时"自作主张"引入。
> 全部为 AUTO 检查。**任一 FAIL 必须立即修正**。

## R4-X-1 Code Agent 沙箱未引入

- **检查目的**:本期不引入 Code Agent 沙箱执行能力(约束 #1)。
- **命令**:
  ```bash
  cd ROOT && \
  grep -rniE "e2b|PythonREPL|jupyter_kernel|jupyter_kernel_gateway|codeinterpreter" src/ requirements.txt web/src/ 2>/dev/null && \
  echo "FAIL: found sandbox keywords" || echo "PASS: no sandbox keywords"
  ```
- **期望**:`PASS: no sandbox keywords`。
- **判定**:PASS / FAIL。

## R4-X-2 三 Agent 不联动

- **检查目的**:Supervisor 单选路由,无 ReAct 多 Agent 串接(约束 #2)。
- **命令**:
  ```bash
  cd ROOT && \
  echo "--- ReAct 字段 ---" && \
  grep -nE "sub_results|planned_agents|executed_agents|iterations.*max|max_iterations" src/agents/x_langgraph_supervisor.py && \
  echo "FAIL: found ReAct fields" || echo "PASS: no ReAct fields" && \
  echo "--- LangGraph 多 Agent 路由 ---" && \
  grep -nE "Send\(|Command\.PARENT|_summary_agent_node|_planner_node|_after_agent_node" src/agents/x_langgraph_supervisor.py && \
  echo "FAIL: found multi-agent routing" || echo "PASS: single routing only" && \
  echo "--- Agent 间 import ---" && \
  grep -E "^from x_models.*x_(sql_agent|code_agent|vl_agent)" src/agents/x_general_agent.py && \
  echo "FAIL: general imports other agents" || echo "PASS: general no cross imports" && \
  grep -E "^from x_models.*x_(general_agent|code_agent|vl_agent)" src/agents/x_sql_agent.py && \
  echo "FAIL: sql imports other agents" || echo "PASS: sql no cross imports"
  ```
- **期望**:三处全部输出 PASS。
- **判定**:三处 PASS 才 PASS;任一 FAIL 即 FAIL。

## R4-X-3 Alembic 未引入

- **检查目的**:本期不引入 Alembic 数据库迁移(约束 #3)。
- **命令**:
  ```bash
  cd ROOT && \
  ls alembic.ini migrations/ 2>/dev/null && echo "FAIL: Alembic exists" || echo "OK: no Alembic files" && \
  grep -E "^alembic" requirements.txt && echo "FAIL: alembic in requirements" || echo "OK: not in requirements" && \
  grep -E "alembic (upgrade|downgrade|revision)" ops/up.sh ops/down.sh 2>/dev/null && echo "FAIL: alembic in scripts" || echo "OK: not in scripts" && \
  grep -E "ADD COLUMN IF NOT EXISTS" ops/init.sql > /dev/null && echo "OK: ALTER COLUMN used" || echo "WARN: no ALTER COLUMN"
  ```
- **期望**:四处全部 OK。
- **判定**:全 OK PASS;任一 FAIL 即 FAIL。

## R4-X-4 CI/CD 流水线未引入

- **检查目的**:本期不引入 CI/CD 流水线(约束 #4)。
- **命令**:
  ```bash
  cd ROOT && \
  ls .github/workflows/ 2>/dev/null && echo "FAIL: workflows exist" || echo "OK: no GitHub workflows" && \
  ls .gitlab-ci.yml 2>/dev/null && echo "FAIL: gitlab CI exists" || echo "OK: no GitLab CI" && \
  ls Jenkinsfile 2>/dev/null && echo "FAIL: Jenkinsfile exists" || echo "OK: no Jenkinsfile"
  ```
- **期望**:三处全部 OK。
- **判定**:全 OK PASS;任一 FAIL 即 FAIL。

## R4-X-5 Redis 未引入

- **检查目的**:本期不引入 Redis 缓存层(约束 #5)。
- **命令**:
  ```bash
  cd ROOT && \
  grep -E "^\s+redis:" ops/compose.yaml && echo "FAIL: redis service in compose" || echo "OK: no redis service" && \
  grep -E "^redis" requirements.txt && echo "FAIL: redis in requirements" || echo "OK: not in requirements" && \
  grep -rniE "import redis|from redis" src/ && echo "FAIL: redis import in code" || echo "OK: no redis import" && \
  grep -rniE "REDIS_URL|REDIS_HOST" src/ ops/.env.example .env.template && echo "FAIL: redis env vars" || echo "OK: no redis env vars"
  ```
- **期望**:四处全部 OK。
- **判定**:全 OK PASS;任一 FAIL 即 FAIL。

## R4-X-6 异步任务队列未引入

- **检查目的**:本期不引入 arq / Celery / RQ 等异步任务队列(约束 #6)。
- **命令**:
  ```bash
  cd ROOT && \
  ls src/jobs/ 2>/dev/null && echo "FAIL: jobs dir exists" || echo "OK: no jobs dir" && \
  grep -E "^\s+worker:" ops/compose.yaml && echo "FAIL: worker service in compose" || echo "OK: no worker service" && \
  grep -E "^(arq|celery|rq|dramatiq)" requirements.txt && echo "FAIL: queue lib in requirements" || echo "OK: not in requirements" && \
  grep -rniE "from arq|import arq|from celery|import celery|from rq |import rq " src/ && echo "FAIL: queue import" || echo "OK: no queue import"
  ```
- **期望**:四处全部 OK。
- **判定**:全 OK PASS;任一 FAIL 即 FAIL。

## R4-X-7 CSRF + 2FA 未引入

- **检查目的**:本期不引入 CSRF 防护与 2FA(TOTP)(约束 #7)。
- **命令**:
  ```bash
  cd ROOT && \
  ls src/middleware/x_csrf* 2>/dev/null && echo "FAIL: csrf module exists" || echo "OK: no csrf module" && \
  ls src/utils/x_2fa* 2>/dev/null && echo "FAIL: 2fa module exists" || echo "OK: no 2fa module" && \
  grep -rniE "csrf_guard|csrf_token|X-CSRF-Token" src/ && echo "FAIL: csrf code" || echo "OK: no csrf code" && \
  grep -rniE "pyotp|totp_secret|totp_enabled|backup_codes" src/ && echo "FAIL: totp code" || echo "OK: no totp code" && \
  grep -E "^(pyotp|qrcode)" requirements.txt && echo "FAIL: otp deps" || echo "OK: no otp deps" && \
  grep -E "totp_code" web/src/components/LoginForm 2>/dev/null && echo "FAIL: totp UI" || echo "OK: no totp UI"
  ```
- **期望**:六处全部 OK。
- **判定**:全 OK PASS;任一 FAIL 即 FAIL。

## R4-X-8 无 tests/ 目录

- **检查目的**:本期不写测试用例(约束 #8)。
- **命令**:
  ```bash
  cd ROOT && \
  ls tests/ 2>/dev/null && echo "FAIL: tests dir exists" || echo "OK: no tests dir" && \
  ls test/ 2>/dev/null && echo "FAIL: test dir exists" || echo "OK: no test dir" && \
  find . -maxdepth 4 \( -name "test_*.py" -o -name "*_test.py" -o -name "conftest.py" \) 2>/dev/null | head -5 && \
  echo "INFO: check above list" && \
  ls web/cypress/ web/playwright/ 2>/dev/null && echo "FAIL: e2e tests" || echo "OK: no e2e tests"
  ```
- **期望**:tests/、test/、e2e 目录不存在;find 结果为空或仅前端配置。
- **判定**:无测试文件 PASS;有测试文件 FAIL。

## R4-X-9 仅 PostgreSQL 数据源

- **检查目的**:本期不扩展多数据源(约束 #9)。
- **命令**:
  ```bash
  cd ROOT && \
  grep -rniE "mysql|clickhouse|sqlite|oracle|mongo|elasticsearch|s3" src/ requirements.txt && \
  echo "WARN: check if data sources other than PG" || echo "OK: PG only" && \
  grep -E "create_async_engine\(" src/agents/x_sql_agent.py && \
  grep -E "postgresql\+asyncpg" src/agents/x_sql_agent.py > /dev/null && echo "OK: PG only engine" || echo "FAIL: non-PG engine"
  ```
- **期望**:仅 PG 引擎,WARN 行需人工确认是否真多源(文档提到 MySQL 等也可能在注释中)。
- **判定**:仅 PG 引擎 PASS;非 PG 引擎 FAIL。

## R4-X-10 反向项汇总命令(一键全跑)

```bash
cd ROOT && \
echo "===== R4 排除项反向轮汇总 =====" && \
echo "[X-1 Code Agent 沙箱]" && grep -rniE "e2b|PythonREPL|jupyter_kernel|codeinterpreter" src/ requirements.txt 2>/dev/null && echo "FAIL" || echo "PASS" && \
echo "[X-2 三 Agent 不联动-字段]" && grep -nE "sub_results|planned_agents|max_iterations" src/agents/x_langgraph_supervisor.py >/dev/null && echo "FAIL" || echo "PASS" && \
echo "[X-2 三 Agent 不联动-Send]" && grep -nE "Send\(|Command\.PARENT" src/agents/x_langgraph_supervisor.py >/dev/null && echo "FAIL" || echo "PASS" && \
echo "[X-3 Alembic]" && ls alembic.ini migrations/ 2>/dev/null >/dev/null && echo "FAIL" || echo "PASS" && \
echo "[X-4 CI/CD]" && ls .github/workflows/ .gitlab-ci.yml Jenkinsfile 2>/dev/null >/dev/null && echo "FAIL" || echo "PASS" && \
echo "[X-5 Redis]" && (grep -E "^\s+redis:" ops/compose.yaml; grep -rniE "import redis|from redis" src/) 2>/dev/null | head -1 && echo "FAIL" || echo "PASS" && \
echo "[X-6 异步队列]" && (ls src/jobs/; grep -E "^\s+worker:" ops/compose.yaml; grep -rniE "from arq|from celery|import rq " src/) 2>/dev/null | head -1 && echo "FAIL" || echo "PASS" && \
echo "[X-7 CSRF+2FA]" && (grep -rniE "csrf_guard|pyotp|totp_secret" src/) 2>/dev/null | head -1 && echo "FAIL" || echo "PASS" && \
echo "[X-8 测试]" && (ls tests/ test/ 2>/dev/null; find . -maxdepth 4 -name "test_*.py" 2>/dev/null) | head -1 && echo "FAIL" || echo "PASS" && \
echo "[X-9 多数据源]" && grep -E "create_async_engine\(" src/agents/x_sql_agent.py | grep -v "postgresql" >/dev/null && echo "FAIL" || echo "PASS"
```

---

# 执行流程

## 推荐 4 轮顺序执行

```
┌─────────────────────────────────────┐
│ Round 1 静态扫描(20+ 项)            │
│ - 全 AUTO,grep/find/ls              │
│ - 输出 PASS/FAIL/INFO/NA 报告        │
└──────────┬──────────────────────────┘
           │ FAIL → 立即修复,再跑 R1
           ▼ PASS
┌─────────────────────────────────────┐
│ Round 2 代码语义(40+ 项)            │
│ - AI 读取代码段做语义检查            │
│ - 输出 含修复建议的报告              │
└──────────┬──────────────────────────┘
           │ FAIL → 修复后跑 R1+R2
           ▼ PASS
┌─────────────────────────────────────┐
│ Round 3 集成验证(20+ 项)            │
│ - 端到端数据流、API 一致性、文档     │
│ - 多 MANUAL                          │
└──────────┬──────────────────────────┘
           │
           ▼
┌─────────────────────────────────────┐
│ Round 4 排除项反向(10 项)           │
│ - 必须全部 PASS,否则违规            │
│ - 此 Round 是底线                    │
└─────────────────────────────────────┘
```

## AI 多轮迭代场景

- **场景 A**:修复 R1 一个 FAIL,改完代码后只重跑该项,无需重跑全 R1。
- **场景 B**:R2 发现语义错误,改完代码后需重跑该项 + R1 相关 grep。
- **场景 C**:R4 任一 FAIL → 强制 FAIL,标记 P0 修复,**禁止**以"代码逻辑无影响"为由放过。
- **场景 D**:R3 中 MANUAL 复核无法 AI 自动判定 → 标 INFO 等待人工。

## 报告输出要求

每次 recheck 结束 AI 必须输出结构化报告,格式见 §0.4。报告中每个 FAIL 项需:

```markdown
- ID: R1-B-1
  - 检查项:日志密钥泄漏
  - 文件:src/controllers/x_controllers.py:573
  - 命令输出:`api_key={api_key}` (实际命中)
  - 期望:无输出
  - 修复建议:把 `f"api_key={api_key}"` 改为 `f"api_key=***REDACTED***"`
```

## 适用阶段

- **每个 Sprint 末**:跑 R1 + R4
- **每次重大改动后**:跑 R2 + R4
- **发布前**:跑全 R1-R4
- **修改文档时**:跑 R3-E
- **修改任何 Agent 时**:跑 R2-D + R4-X-2

---

## 附录:全部检查项 ID 索引

| ID | 类别 | 检查项简述 | 类型 |
|----|------|------------|------|
| R1-A-1 | 架构 | PluginInterface 契约 | AUTO |
| R1-A-2 | 架构 | required_extensions pgvector | AUTO |
| R1-A-3 | 架构 | 依赖版本明确 | AUTO |
| R1-A-4 | 架构 | npm audit | AUTO |
| R1-A-5 | 架构 | 包路径统一 | AUTO |
| R1-A-6 | 架构 | 循环 import | AUTO |
| R1-A-7 | 架构 | 三 Agent 不互相 import | AUTO |
| R1-A-8 | 架构 | 无 ReAct 串接 | AUTO |
| R1-A-9 | 架构 | 无 Code Agent 沙箱 | AUTO |
| R1-B-1 | 安全 | 日志密钥泄漏 | AUTO |
| R1-B-2 | 安全 | .env 不入仓 | AUTO |
| R1-B-3 | 安全 | .env.template 无真密钥 | AUTO |
| R1-B-4 | 安全 | 密码哈希算法 | AUTO |
| R1-B-5 | 安全 | password_algo 字段 | AUTO |
| R1-B-6 | 安全 | SQLSecurityChecker 调用 | AUTO |
| R1-B-7 | 安全 | ReadOnly 兜底 | AUTO |
| R1-B-8 | 安全 | Mutation 鉴权 | AUTO |
| R1-C-1 | 结构 | 后端目录完整 | AUTO |
| R1-C-2 | 结构 | 前端死目录 | AUTO |
| R1-C-3 | 结构 | 排除项目录反向 | AUTO |
| R1-C-4 | 结构 | compose 服务清单 | AUTO |
| R1-D-1 | 数据库 | pgvector 扩展 | AUTO |
| R1-D-2 | 数据库 | 新增表存在 | AUTO |
| R1-D-3 | 数据库 | ALTER COLUMN 兼容 | AUTO |
| R1-D-4 | 数据库 | 表注释完整 | AUTO |
| R1-D-5 | 数据库 | updated_at 触发器 | AUTO |
| R1-D-6 | 数据库 | PROTECTED_TABLES 屏蔽 | AUTO |
| R1-E-1 | 前端 | i18n 字典 | AUTO |
| R1-E-2 | 前端 | XSS 防护 | AUTO |
| R1-E-3 | 前端 | localStorage SSR | AUTO |
| R1-E-4 | 前端 | next standalone | AUTO |
| R1-E-5 | 前端 | next dev 端口 | AUTO |
| R1-F-1 | 运维 | 容器资源限制 | AUTO |
| R1-F-2 | 运维 | HAProxy 健康检查 | AUTO |
| R1-F-3 | 运维 | systemd 非 root | AUTO |
| R1-F-4 | 运维 | .env.example 完整 | AUTO |
| R1-F-5 | 运维 | cron 报告脚本 | AUTO |
| R2-D-1 | Agent | 节点异常处理 | AUTO |
| R2-D-2 | Agent | friendly_llm_error 覆盖 | AUTO |
| R2-D-3 | Agent | temperature 回退 | AUTO |
| R2-D-4 | Agent | thinking 标签解析 | AUTO |
| R2-D-5 | Agent | 三 Agent state 独立 | MANUAL |
| R2-D-6 | Agent | usage_metadata 捕获 | AUTO |
| R2-D-7 | Agent | _decide_next_agent 单选 | MANUAL |
| R2-D-8 | Agent | 直接模式与图模式一致 | MANUAL |
| R2-E-1 | SQL | PROTECTED_TABLES 扩展 | MANUAL |
| R2-E-2 | SQL | extract_referenced 保守 | MANUAL |
| R2-E-3 | SQL | intent vs chart 职责 | MANUAL |
| R2-E-4 | SQL | auto_execute 路径 | MANUAL |
| R2-E-5 | SQL | continue_with_approval | MANUAL |
| R2-E-6 | SQL | _resolve_settings 优先级 | MANUAL |
| R2-E-7 | SQL | pool_size 合理 | AUTO |
| R2-E-8 | SQL | LRU/TTL 缓存 | AUTO |
| R2-E-9 | SQL | retrieve 召回 schema | AUTO |
| R2-E-10 | SQL | Few-Shot 注入 | AUTO |
| R2-F-1 | API | resolver try/except | AUTO |
| R2-F-2 | API | request_id_var 传递 | AUTO |
| R2-F-3 | API | SSE 缓冲头 | AUTO |
| R2-F-4 | API | Mutation 输入校验 | MANUAL |
| R2-F-5 | API | register/login 流程 | MANUAL |
| R2-F-6 | API | forgot_password 安全 | MANUAL |
| R2-F-7 | API | sql_approval 双入口 | MANUAL |
| R2-F-8 | API | GraphQL camelCase | MANUAL |
| R2-F-9 | API | WS 鉴权 | MANUAL |
| R2-G-1 | 前端 | useEffect 依赖 | MANUAL |
| R2-G-2 | 前端 | SSE 心跳重连 | MANUAL |
| R2-G-3 | 前端 | graphql 错误处理 | AUTO |
| R2-G-4 | 前端 | ChartView 边界 | MANUAL |
| R2-G-5 | 前端 | 审批防重复 | MANUAL |
| R2-G-6 | 前端 | 表单 loading toast | MANUAL |
| R2-G-7 | 前端 | I18nProvider 顺序 | MANUAL |
| R2-G-8 | 前端 | /admin 守卫 | MANUAL |
| R2-H-1 | 性能 | LLM 超时 | AUTO |
| R2-H-2 | 性能 | SSE 心跳 | AUTO |
| R2-H-3 | 性能 | 客户端断开 | MANUAL |
| R2-H-4 | 性能 | schema cache 失效 | AUTO |
| R2-I-1 | 观察 | metrics 命名 | AUTO |
| R2-I-2 | 观察 | 三 Agent 埋点 | AUTO |
| R2-I-3 | 观察 | SECURITY_BLOCKS 埋点 | AUTO |
| R2-I-4 | 观察 | /metrics endpoint | AUTO |
| R2-I-5 | 观察 | logger request_id | AUTO |
| R3-A-1 | 集成 | 提问 → 响应流 | MANUAL |
| R3-A-2 | 集成 | SQL 审批闭环 | MANUAL |
| R3-A-3 | 集成 | 多用户隔离 | MANUAL |
| R3-A-4 | 集成 | 模型配置切换 | MANUAL |
| R3-B-1 | 集成 | Agent state 不共享 | MANUAL |
| R3-B-2 | 集成 | Supervisor 仅调公开 API | MANUAL |
| R3-B-3 | 集成 | 工具集不交叉 | MANUAL |
| R3-B-4 | 集成 | VL Agent 独立 | MANUAL |
| R3-C-1 | 集成 | README API 一致 | MANUAL |
| R3-C-2 | 集成 | Schemas 一致 | MANUAL |
| R3-C-3 | 集成 | Schema 注册 | AUTO |
| R3-D-1 | 集成 | LLM_PROVIDER 切换 | AUTO |
| R3-D-2 | 集成 | SSO JWKS | MANUAL |
| R3-D-3 | 集成 | 文件上传统一 | MANUAL |
| R3-D-4 | 集成 | 审批任务持久化 | AUTO |
| R3-E-1 | 集成 | (同 R3-C-1) | MANUAL |
| R3-E-2 | 集成 | 架构文档同步 | MANUAL |
| R3-E-3 | 集成 | corpus 一致 | MANUAL |
| R3-E-4 | 集成 | README 范围说明 | MANUAL |
| R3-E-5 | 集成 | 版权头 | AUTO |
| R4-X-1 | 排除 | Code Agent 沙箱未引入 | AUTO |
| R4-X-2 | 排除 | 三 Agent 不联动 | AUTO |
| R4-X-3 | 排除 | Alembic 未引入 | AUTO |
| R4-X-4 | 排除 | CI/CD 未引入 | AUTO |
| R4-X-5 | 排除 | Redis 未引入 | AUTO |
| R4-X-6 | 排除 | 异步队列未引入 | AUTO |
| R4-X-7 | 排除 | CSRF+2FA 未引入 | AUTO |
| R4-X-8 | 排除 | 测试未引入 | AUTO |
| R4-X-9 | 排除 | 仅 PG 数据源 | AUTO |

**总计约 103 项检查项**:
- R1 静态扫描:37 项(全 AUTO)
- R2 代码语义:42 项(AUTO + MANUAL 混合)
- R3 集成验证:19 项(主要 MANUAL)
- R4 排除项反向:9 项(全 AUTO,**关键**)

---

**文档版本**:v1.0(AI 多轮 Recheck 执行版)
**生成日期**:2026-10-05
**适用项目**:id_x_010 通用计算智能体
**用法**:
1. 按 4 个 Round 顺序执行,每轮结束输出结构化报告(参考 §0.4)
2. 修复 FAIL 后重跑该项,无需重跑全轮(除非该项关联性强)
3. **R4 排除项反向轮为底线**,任一 FAIL 不允许放过
4. MANUAL 项由人工语义复核,AI 标 INFO 后等待
