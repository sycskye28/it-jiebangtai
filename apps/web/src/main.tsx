import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { createRoot } from "react-dom/client";
import { Award, Bell, ClipboardList, Crown, Download, ExternalLink, Eye, FilePlus2, Filter, GripVertical, LoaderCircle, LogIn, MessageSquare, Network, Newspaper, Paperclip, PencilLine, Rocket, Save, Search, Settings2, ShieldCheck, Sparkles, Trash2, UploadCloud, UserPlus } from "lucide-react";
import type { CurrentUser, FieldConfig, FormType, InnovationArticle, InnovationProject, RecordDetail, RecordSummary } from "@it/shared";
import { API_BASE_URL, api, type BitableLink, type ElevatedRole, type FeishuUserSearchResult, setDevIdentity, storeCurrentUser } from "./api";
import BlurText from "./components/react-bits/BlurText";
import GradientText from "./components/react-bits/GradientText";
import SplitText from "./components/react-bits/SplitText";
import TextType from "./components/react-bits/TextType";
import "./styles.css";

type ViewKey = "home" | "submit" | "records" | "innovation" | "innovationNews" | "admin";
type WorkViewKey = Exclude<ViewKey, "home">;
const requireFeishuLogin = import.meta.env.VITE_REQUIRE_FEISHU_LOGIN !== "false";
const feishuWebAppAutoLogin = import.meta.env.VITE_FEISHU_WEBAPP_AUTO_LOGIN === "true";
const roleLabels: Record<string, string> = {
  business: "业务用户",
  system_owner: "IT管理员",
  admin: "超级管理员",
  external: "外部用户"
};
const innovationFormTypeKey = "innovation_studio";
const innovationAwardChoices = ["好点子", "好方案", "好收益"] as const;
type InnovationAwardChoice = typeof innovationAwardChoices[number];

function roleLabel(role?: string | null) {
  return roleLabels[role ?? ""] ?? "业务用户";
}

function isFeishuClient() {
  if (typeof navigator === "undefined") return false;
  const params = new URLSearchParams(window.location.search);
  return params.get("feishu_webapp") === "1" || /Lark|Feishu|LarkLocale/i.test(navigator.userAgent);
}

function currentRedirectUri() {
  return `${window.location.origin}${window.location.pathname}`;
}

function isUnauthenticatedUser(user: CurrentUser | null) {
  return !user || ["anonymous", "dev-admin"].includes(user.feishuUserId);
}

async function startFeishuLogin(onToast: (message: string) => void, nextView?: WorkViewKey) {
  if (nextView) sessionStorage.setItem("postLoginView", nextView);
  const oauth = await api.feishuOAuthUrl(currentRedirectUri());
  if (!oauth.configured) {
    onToast("飞书应用 App ID 未配置");
    return;
  }
  window.location.href = oauth.url;
}

function App() {
  const [view, setView] = useState<ViewKey>("home");
  const [formTypes, setFormTypes] = useState<FormType[]>([]);
  const [activeType, setActiveType] = useState("demand");
  const [fields, setFields] = useState<FieldConfig[]>([]);
  const [records, setRecords] = useState<RecordSummary[]>([]);
  const [selectedRecordId, setSelectedRecordId] = useState<string | null>(null);
  const [recordDetail, setRecordDetail] = useState<RecordDetail | null>(null);
  const [owners, setOwners] = useState<Array<{ id: string; systemName: string; ownerName: string }>>([]);
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  const [detailFields, setDetailFields] = useState<FieldConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [fieldsLoading, setFieldsLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [busyMessage, setBusyMessage] = useState("");
  const [innovationEntering, setInnovationEntering] = useState(false);
  const [toast, setToast] = useState("");

  async function refresh() {
    setLoading(true);
    const [me, types, list, ownerList] = await Promise.all([api.me(), api.formTypes(), api.records(), api.owners()]);
    setCurrentUser(me);
    setFormTypes(types);
    setRecords(list);
    setOwners(ownerList);
    setLoading(false);
  }

  useEffect(() => {
    const feishuRuntime = isFeishuClient();
    document.documentElement.classList.toggle("feishu-webapp", feishuRuntime);
    document.documentElement.classList.toggle("browser-webapp", !feishuRuntime);
  }, []);

  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get("code");
    if (code) {
      api.loginFeishu(code)
        .then(({ user }) => {
          storeCurrentUser(user);
          setCurrentUser(user);
          const nextView = sessionStorage.getItem("postLoginView") as WorkViewKey | null;
          sessionStorage.removeItem("postLoginView");
          sessionStorage.removeItem("feishuAutoLoginStarted");
          window.history.replaceState({}, "", window.location.pathname);
          setView(nextView ?? "submit");
          return refresh();
        })
        .catch((error) => setToast(error.message));
      return;
    }
    refresh().catch((error) => setToast(error.message));
  }, []);

  useEffect(() => {
    if (!feishuWebAppAutoLogin || !isFeishuClient()) return;
    if (view === "home") return;
    if (loading || !requireFeishuLogin || !isUnauthenticatedUser(currentUser)) return;
    if (sessionStorage.getItem("feishuAutoLoginStarted")) return;
    sessionStorage.setItem("feishuAutoLoginStarted", "1");
    startFeishuLogin(setToast, view).catch((error) => setToast(error.message));
  }, [loading, currentUser?.feishuUserId, view]);

  useEffect(() => {
    let alive = true;
    setFieldsLoading(true);
    api.formConfig(activeType)
      .then((config) => {
        if (alive) setFields(config.fields);
      })
      .catch((error) => setToast(error.message))
      .finally(() => {
        if (alive) setFieldsLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [activeType]);

  useEffect(() => {
    if (!selectedRecordId) {
      setRecordDetail(null);
      setDetailFields([]);
      setDetailLoading(false);
      return;
    }
    let alive = true;
    setDetailLoading(true);
    setRecordDetail(null);
    api.record(selectedRecordId)
      .then((detail) => {
        if (alive) setRecordDetail(detail);
      })
      .catch((error) => setToast(error.message))
      .finally(() => {
        if (alive) setDetailLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [selectedRecordId]);

  useEffect(() => {
    if (!recordDetail?.typeKey) {
      setDetailFields([]);
      return;
    }
    api.formConfig(recordDetail.typeKey).then((config) => setDetailFields(config.fields)).catch((error) => setToast(error.message));
  }, [recordDetail?.id, recordDetail?.typeKey]);

  useEffect(() => {
    if (currentUser && currentUser.role !== "admin" && view === "admin") {
      setView("submit");
    }
  }, [currentUser, view]);

  const standardFormTypes = formTypes.filter((item) => item.key !== innovationFormTypeKey);
  const selectedType = standardFormTypes.find((item) => item.key === activeType);
  const isAdmin = currentUser?.role === "admin";

  async function runBusy<T>(message: string, task: () => Promise<T>) {
    setBusyMessage(message);
    try {
      return await task();
    } finally {
      setBusyMessage("");
    }
  }

  async function enterWorkView(nextView: WorkViewKey) {
    if (requireFeishuLogin && isUnauthenticatedUser(currentUser)) {
      await startFeishuLogin(setToast, nextView);
      return;
    }
    if (nextView === "innovation") {
      setInnovationEntering(true);
      window.setTimeout(() => {
        setView("innovation");
        setInnovationEntering(false);
      }, 1350);
      return;
    }
    setView(nextView);
  }

  const appContent = view === "home" ? (
    <LandingHome
      user={currentUser}
      loading={loading}
      isAdmin={isAdmin}
      onLogin={(nextView) => startFeishuLogin(setToast, nextView)}
      onEnter={enterWorkView}
    />
  ) : (
    <>
      <aside className="rail">
        <div className="brand">
          <div className="brand-mark"><img src="/dcec-logo-transparent.png" alt="DCEC" /></div>
          <div>
            <strong>东风康明斯数字化需求与问题管理系统</strong>
          </div>
        </div>
        <button className={view === "submit" ? "nav active" : "nav"} onClick={() => setView("submit")}><FilePlus2 size={18} />问题或需求提交</button>
        <button className={view === "records" ? "nav active" : "nav"} onClick={() => setView("records")}><ClipboardList size={18} />问题或需求记录</button>
        <button className={view === "innovation" || view === "innovationNews" ? "nav active" : "nav"} onClick={() => enterWorkView("innovation").catch((error) => setToast(error.message))}><Rocket size={18} />创新工作室</button>
        {isAdmin ? <button className={view === "admin" ? "nav active" : "nav"} onClick={() => setView("admin")}><Settings2 size={18} />后台</button> : null}
        <button className="nav nav-home" onClick={() => setView("home")}><Sparkles size={18} />主页</button>
        <div className="rail-card">
          <Bell size={18} />
          <span>关键节点会通知提交人与管理员。</span>
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">Feishu-ready workbench</p>
            <h1>{view === "submit" ? "问题或需求提交" : view === "records" ? "问题或需求记录" : view === "innovation" ? "数字化创新工作室" : view === "innovationNews" ? "新闻与学习心得" : "配置后台"}</h1>
          </div>
          <div className="top-actions">
            <AuthBadge user={currentUser} onToast={setToast} />
          </div>
        </header>

        {loading ? <div className="empty">正在连接本地服务...</div> : null}
        {!loading && requireFeishuLogin && isUnauthenticatedUser(currentUser) ? (
          <LoginRequiredPanel onToast={setToast} />
        ) : null}
        {!loading && view === "submit" ? (
          requireFeishuLogin && isUnauthenticatedUser(currentUser) ? null :
          <SubmitPanel
            formTypes={standardFormTypes}
            activeType={activeType}
            selectedType={selectedType}
            fields={fields}
            fieldsLoading={fieldsLoading}
            owners={owners}
            onTypeChange={setActiveType}
            onSubmit={async (values) => {
              await runBusy("正在提交并同步多维表格...", async () => {
                const created = await api.createRecord(activeType, values);
                setToast(`已提交：${created.title}`);
                await refresh();
                setView("records");
                setSelectedRecordId(created.id);
              });
            }}
          />
        ) : null}
        {!loading && view === "records" ? (
          requireFeishuLogin && isUnauthenticatedUser(currentUser) ? null :
          <RecordsPanel
            records={records}
            formTypes={standardFormTypes}
            owners={owners}
            fields={detailFields}
            currentUser={currentUser}
            selectedRecordId={selectedRecordId}
            detail={recordDetail}
            detailLoading={detailLoading}
            onSelect={setSelectedRecordId}
            onRefreshFields={async (typeKey) => {
              const config = await api.formConfig(typeKey);
              setDetailFields(config.fields);
              return config.fields;
            }}
            onSave={async (id, values) => {
              await runBusy("正在保存记录并更新飞书...", async () => {
                await api.updateRecord(id, values);
                setToast("记录已更新");
                await refresh();
                setRecordDetail(await api.record(id));
              });
            }}
            onCloneSystems={async (id, systems) => {
              try {
                await runBusy("正在生成多系统记录...", async () => {
                  const created = await api.cloneRecordToSystems(id, systems);
                  setToast(created.length ? `已生成 ${created.length} 条多系统记录` : "没有新增系统记录");
                  await refresh();
                  const nextId = created[0]?.id ?? id;
                  setSelectedRecordId(nextId);
                  setRecordDetail(await api.record(nextId));
                });
              } catch (error) {
                setToast(error instanceof Error ? error.message : "追加系统失败");
                throw error;
              }
            }}
            onConvert={async (id, typeKey) => {
              try {
                await runBusy("正在转换提交类型...", async () => {
                  const converted = await api.convertRecord(id, typeKey);
                  setToast("提交类型已转换");
                  const config = await api.formConfig(converted.typeKey);
                  await refresh();
                  setSelectedRecordId(id);
                  setDetailFields(config.fields);
                  const nextDetail = await api.record(id);
                  setRecordDetail(nextDetail);
                });
              } catch (error) {
                setToast(error instanceof Error ? error.message : "提交类型转换失败");
                throw error;
              }
            }}
            onComment={async (id, body) => {
              await api.addComment(id, body);
              setRecordDetail(await api.record(id));
            }}
            onSyncRecords={async () => {
              await runBusy("正在从多维表格同步记录...", async () => {
                const result = await api.syncBitableRecords();
                setToast(`已同步记录：导入 ${result.importedRecords} 条，更新 ${result.updatedRecords} 条，清理本地 ${result.removedLocalRecords} 条`);
                setSelectedRecordId(null);
                setRecordDetail(null);
                await refresh();
              });
            }}
          />
        ) : null}
        {!loading && view === "innovation" ? (
          requireFeishuLogin && isUnauthenticatedUser(currentUser) ? null :
          <InnovationStudio currentUser={currentUser} onToast={setToast} onOpenNews={() => setView("innovationNews")} />
        ) : null}
        {!loading && view === "innovationNews" ? (
          requireFeishuLogin && isUnauthenticatedUser(currentUser) ? null :
          <InnovationNewsPage currentUser={currentUser} onToast={setToast} onBack={() => setView("innovation")} />
        ) : null}
        {!loading && view === "admin" ? (
          requireFeishuLogin && isUnauthenticatedUser(currentUser) ? null :
          isAdmin ? <AdminPanel /> : <div className="empty">你当前没有后台管理权限。</div>
        ) : null}
      </section>
    </>
  );

  return (
    <main className={`shell view-${view}`}>
      {appContent}
      {busyMessage ? (
        <div className="busy-overlay" aria-live="polite">
          <div className="busy-card">
            <LoaderCircle size={20} />
            <strong>{busyMessage}</strong>
            <span>请稍等，正在处理飞书和本地数据。</span>
          </div>
        </div>
      ) : null}
      {innovationEntering ? <InnovationEntryAnimation /> : null}
      {toast ? <button className="toast" onClick={() => setToast("")}>{toast}</button> : null}
    </main>
  );
}

function LandingHome({ user, loading, isAdmin, onLogin, onEnter }: {
  user: CurrentUser | null;
  loading: boolean;
  isAdmin: boolean;
  onLogin: (nextView: WorkViewKey) => Promise<void>;
  onEnter: (nextView: WorkViewKey) => Promise<void>;
}) {
  const needsLogin = requireFeishuLogin && isUnauthenticatedUser(user);

  return (
    <section className="landing-home" aria-label="数字化需求与问题管理系统主页">
      <div className="landing-bg" />
      <div className="landing-scanline" />
      <header className="landing-top">
        <div className="landing-brand">
          <img src="/dcec-logo-transparent.png" alt="DCEC" />
          <div>
            <strong>东风康明斯数字化需求与问题管理系统</strong>
            <span>Digital Demand · Issue · Feishu Workflow</span>
          </div>
        </div>
        <div className="landing-user">
          <span>{loading ? "连接中" : user?.name ?? "未登录"}</span>
          <strong>{loading ? "LOCAL SERVICE" : user ? roleLabel(user.role) : "FEISHU REQUIRED"}</strong>
        </div>
      </header>

      <div className="landing-orbit" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>

      <div className="landing-content">
        <div className="landing-copy">
          <span className="landing-kicker"><Sparkles size={16} />Digital innovation studio</span>
          <SplitText
            tag="h1"
            text="数字化创新工作室"
            className="landing-split-title"
            delay={58}
            duration={0.7}
            from={{ opacity: 0, y: 30, rotateX: -42 }}
            to={{ opacity: 1, y: 0, rotateX: 0 }}
            textAlign="left"
            rootMargin="0px"
          />
          <BlurText
            className="landing-blur-subtitle"
              text="把工作中的痛点、灵感和共创项目集中到一个开放空间。创新工作室优先展示，需求与问题入口也在这里快速进入。"
            delay={92}
            animateBy="words"
            direction="bottom"
            stepDuration={0.42}
            rootMargin="-40px"
          />
          <div className="landing-actions">
            <button className="landing-primary" type="button" onClick={() => needsLogin ? onLogin("innovation") : onEnter("innovation")}>
              {needsLogin ? <LogIn size={20} /> : <Rocket size={20} />}
              {needsLogin ? "飞书登录后进入" : "进入创新工作室"}
            </button>
            <button className="landing-secondary" type="button" onClick={() => needsLogin ? onLogin("submit") : onEnter("submit")}>
              <FilePlus2 size={20} />
              {needsLogin ? "登录后提交" : "问题或需求提交"}
            </button>
          </div>
        </div>

        <div className="landing-entry-grid">
          <button type="button" className="landing-entry main-entry innovation-entry" onClick={() => needsLogin ? onLogin("innovation") : onEnter("innovation")}>
            <Rocket size={26} />
            <span>创新工作室</span>
            <strong>共创项目、评奖看板与学习新闻</strong>
          </button>
          <button type="button" className="landing-entry" onClick={() => needsLogin ? onLogin("submit") : onEnter("submit")}>
            <FilePlus2 size={24} />
            <span>问题或需求提交</span>
            <strong>需求 / 问题统一发起</strong>
          </button>
          <button type="button" className="landing-entry" onClick={() => needsLogin ? onLogin("records") : onEnter("records")}>
            <ClipboardList size={24} />
            <span>问题或需求记录</span>
            <strong>查看状态、附件和时间线</strong>
          </button>
          {isAdmin ? (
            <button type="button" className="landing-entry" onClick={() => onEnter("admin")}>
              <Settings2 size={24} />
              <span>配置后台</span>
              <strong>维护表单、系统责任人</strong>
            </button>
          ) : (
            <div className="landing-entry ghost-entry">
              <ShieldCheck size={24} />
              <span>飞书身份</span>
              <strong>{needsLogin ? "先登录再进入工作区" : "权限已识别"}</strong>
            </div>
          )}
          <div className="landing-entry ghost-entry">
            <Network size={24} />
            <span>闭环同步</span>
            <strong>本地数据与飞书流程联动</strong>
          </div>
        </div>
      </div>
    </section>
  );
}

function AuthBadge({ user, onToast }: { user: CurrentUser | null; onToast: (message: string) => void }) {
  const [simulateOpen, setSimulateOpen] = useState(false);
  const [notificationsDisabled, setNotificationsDisabled] = useState(false);
  const [notificationBusy, setNotificationBusy] = useState(false);
  const simulationBackup = localStorage.getItem("superAdminSimulationBackup");
  const canSimulate = user?.role === "admin" || Boolean(simulationBackup);
  const canToggleNotifications = user?.role === "admin";
  const simulationOptions = [
    { label: "IT管理员", feishuUserId: "a10986", name: "IT管理员测试用户", role: "system_owner", department: "权限名单" },
    { label: "业务用户", feishuUserId: "a10986", name: "业务用户测试用户", role: "business", department: "生产制造部" }
  ];
  useEffect(() => {
    if (!canToggleNotifications) return;
    api.feishuNotificationStatus()
      .then((status) => setNotificationsDisabled(status.disabled))
      .catch(() => undefined);
  }, [canToggleNotifications]);
  const loginWithFeishu = async () => {
    await startFeishuLogin(onToast);
  };
  const toggleNotifications = async () => {
    setNotificationBusy(true);
    try {
      const next = await api.setFeishuNotificationStatus(!notificationsDisabled);
      setNotificationsDisabled(next.disabled);
      onToast(next.disabled ? "飞书通知已关闭，调试不会打扰同事" : "飞书通知已恢复");
    } catch (error) {
      onToast(error instanceof Error ? error.message : "飞书通知开关失败");
    } finally {
      setNotificationBusy(false);
    }
  };
  const simulateIdentity = (identity: typeof simulationOptions[number]) => {
    if (!simulationBackup && user?.role === "admin") {
      localStorage.setItem("superAdminSimulationBackup", JSON.stringify({
        feishuUserId: user.feishuUserId,
        name: user.name,
        role: user.role,
        department: user.department ?? "权限名单"
      }));
    }
    setDevIdentity(identity);
    onToast(`已切换为${identity.label}视角`);
    window.location.reload();
  };
  const restoreSuperAdmin = () => {
    if (!simulationBackup) return;
    const backup = JSON.parse(simulationBackup) as { feishuUserId: string; name: string; role: string; department: string };
    setDevIdentity(backup);
    localStorage.removeItem("superAdminSimulationBackup");
    onToast("已返回超级管理员视角");
    window.location.reload();
  };

  return (
    <div className="auth-badge">
      <div>
        <span>{user?.name ?? "未登录"}</span>
        <strong>{roleLabel(user?.role)}</strong>
      </div>
      {canToggleNotifications ? (
        <button
          type="button"
          className={notificationsDisabled ? "notification-kill-switch muted" : "notification-kill-switch"}
          disabled={notificationBusy}
          onClick={toggleNotifications}
          title="仅暂停飞书/小程序消息通知，不影响本地记录和多维表格同步"
        >
          <Bell size={15} />
          {notificationsDisabled ? "通知已关闭" : "关闭通知"}
        </button>
      ) : null}
      {canSimulate ? (
        <div className="identity-switcher">
          {simulationBackup ? <button type="button" onClick={restoreSuperAdmin}>返回超级管理员</button> : null}
          {user?.role === "admin" ? <button type="button" onClick={() => setSimulateOpen((current) => !current)}>模拟身份</button> : null}
          {simulateOpen && user?.role === "admin" ? (
            <div className="identity-menu">
              {simulationOptions.map((option) => (
                <button key={option.feishuUserId} type="button" onClick={() => simulateIdentity(option)}>
                  <span>{option.label}</span>
                  <small>{option.name} · {option.department}</small>
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
      <button type="button" onClick={loginWithFeishu}><LogIn size={16} />飞书登录</button>
    </div>
  );
}

function LoginRequiredPanel({ onToast }: { onToast: (message: string) => void }) {
  const login = async () => {
    await startFeishuLogin(onToast);
  };

  return (
    <section className="panel login-panel">
      <img className="login-logo" src="/dcec-logo-transparent.png" alt="DCEC" />
      <ShieldCheck size={28} />
      <h2>需要飞书登录</h2>
      <p>在飞书客户端内会使用当前网页应用地址登录；在浏览器中会跳转到飞书网页登录。</p>
      <button className="command" type="button" onClick={login}><LogIn size={18} />飞书登录</button>
    </section>
  );
}

function InnovationEntryAnimation() {
  return (
    <div className="innovation-entry-overlay" aria-live="polite">
      <div className="innovation-entry-core">
        <span />
        <span />
        <span />
      </div>
      <div className="innovation-entry-copy">
        <strong>数字化创新工作室</strong>
        <small>正在进入共创空间</small>
      </div>
    </div>
  );
}

type InnovationAwardView = {
  id: string;
  recordId: string;
  awardName: string;
  awardType: string | null;
  reason: string | null;
  displayOrder: number;
  awardedByName: string;
  awardedAt: string;
  projectTitle: string;
  recordNo: string | null;
  projectStatus: string;
  submitterName: string;
  projectValues: Record<string, unknown>;
};

const innovationStatusChoices = ["待评审", "概念验证", "项目试点", "全面开展", "暂未入选（感谢你的创新提案）"] as const;
type InnovationStatusValue = typeof innovationStatusChoices[number];

function InnovationStudio({ currentUser, onToast, onOpenNews }: { currentUser: CurrentUser | null; onToast: (message: string) => void; onOpenNews: () => void }) {
  const [projects, setProjects] = useState<InnovationProject[]>([]);
  const [awards, setAwards] = useState<InnovationAwardView[]>([]);
  const [articles, setArticles] = useState<InnovationArticle[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [selectedProject, setSelectedProject] = useState<InnovationProject | null>(null);
  const [loadingInnovation, setLoadingInnovation] = useState(true);
  const canManage = currentUser?.role === "admin" || currentUser?.role === "system_owner";
  const scrollToInnovationSection = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  async function refreshInnovation() {
    setLoadingInnovation(true);
    try {
      const [projectData, awardData, articleData] = await Promise.all([
        api.innovationProjects(),
        api.innovationAwards(),
        api.innovationArticles(canManage)
      ]);
      setProjects(projectData);
      setAwards(awardData);
      setArticles(articleData);
      if (selectedProjectId) {
        const detail = await api.innovationProject(selectedProjectId).catch(() => null);
        setSelectedProject(detail);
      }
    } finally {
      setLoadingInnovation(false);
    }
  }

  useEffect(() => {
    refreshInnovation().catch((error) => onToast(error.message));
  }, [canManage]);

  useEffect(() => {
    if (!selectedProjectId) {
      setSelectedProject(null);
      return;
    }
    api.innovationProject(selectedProjectId)
      .then(setSelectedProject)
      .catch((error) => onToast(error.message));
  }, [selectedProjectId]);

  return (
    <div className="innovation-page">
      <section className="innovation-hero">
        <div className="laser-flow" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <div className="innovation-hero-copy">
          <span className="innovation-kicker"><Rocket size={16} />Digital Innovation Studio</span>
          <SplitText
            tag="h2"
            text="数字化创新工作室"
            className="innovation-split-title"
            delay={72}
            duration={0.72}
            from={{ opacity: 0, y: 34, rotateX: -48 }}
            to={{ opacity: 1, y: 0, rotateX: 0 }}
            textAlign="left"
            rootMargin="0px"
          />
          <TextType
            as="p"
            className="innovation-type-line"
            text={["开放包容，自由共创。", "每一个想法都值得被倾听。", "把痛点变成项目，把灵感变成成果。"]}
            typingSpeed={44}
            deletingSpeed={24}
            pauseDuration={1300}
            initialDelay={300}
            textColors={["#ffffff"]}
            cursorCharacter="_"
          />
          <BlurText
            className="innovation-blur-copy"
              text="数字化创新工作室是一个开放包容、自由共创的空间。说说你工作中的创新痛点、脑海里的奇思妙想，以及对工作室设备、服务、活动的真实期待。"
            delay={54}
            animateBy="words"
            direction="bottom"
            stepDuration={0.4}
            rootMargin="-30px"
          />
          <BlurText
            className="innovation-blur-copy"
              text="这里没有对错，没有门槛，每一个想法都值得被倾听，每一条建议都将成为工作室成长的力量，期待你的发声，和我们一起共建属于大家的创新乐园！"
            delay={54}
            animateBy="words"
            direction="bottom"
            stepDuration={0.4}
            rootMargin="-30px"
          />
          <div className="innovation-metrics">
            <strong>{projects.length}<span>创新项目</span></strong>
            <strong>{awards.length}<span>获奖展示</span></strong>
            <strong>{articles.filter((item) => item.status === "published").length}<span>学习新闻</span></strong>
          </div>
          <div className="innovation-hero-actions">
            <button type="button" onClick={() => scrollToInnovationSection("innovation-submit-section")}>
              <Rocket size={17} />
              提交创新
            </button>
            <button type="button" onClick={() => scrollToInnovationSection("innovation-records-section")}>
              <ClipboardList size={17} />
              记录管理
            </button>
          </div>
        </div>
      </section>

      <InnovationAwardsBoard awards={awards} />

      <button type="button" className="innovation-news-gateway" onClick={onOpenNews}>
        <div>
          <span><Newspaper size={18} />Field Notes</span>
          <strong>新闻与学习心得</strong>
          <small>上传 Word 文档，自动生成正文预览，沉淀外出参观、展会学习和创新项目经验。</small>
        </div>
        <em>{articles.filter((item) => item.status === "published").length} 篇已发布</em>
      </button>

      <section id="innovation-records-section" className="innovation-board-shell">
        <div className="innovation-section-title">
          <div>
          <span>Project Radar</span>
          <h3><GradientText colors={["#ee2e24", "#1f1a17", "#f7f7f7", "#ee2e24"]} animationSpeed={4}>创新项目看板</GradientText></h3>
          </div>
          <button type="button" onClick={() => refreshInnovation().catch((error) => onToast(error.message))}>
            {loadingInnovation ? "刷新中..." : "刷新"}
          </button>
        </div>
        <InnovationProjectBoard
          currentUser={currentUser}
          canManage={canManage}
          projects={projects}
          selectedProjectId={selectedProjectId}
          selectedProject={selectedProject}
          onSelect={setSelectedProjectId}
          onToast={onToast}
          onUpdated={async (project) => {
            setSelectedProject(project);
            await refreshInnovation();
          }}
          onDeleted={async () => {
            setSelectedProjectId(null);
            setSelectedProject(null);
            await refreshInnovation();
          }}
        />
      </section>

      <section id="innovation-submit-section" className="innovation-submit-section">
        <InnovationProjectForm
          onToast={onToast}
          onCreated={async (project) => {
            onToast(`已提交创新项目：${project.title}`);
            setSelectedProjectId(project.id);
            await refreshInnovation();
          }}
        />
      </section>
    </div>
  );
}

function InnovationProjectForm({ onToast, onCreated }: {
  onToast: (message: string) => void;
  onCreated: (project: InnovationProject) => Promise<void>;
}) {
  const [values, setValues] = useState({
    projectTheme: "",
    projectDescription: "",
    innovationKind: "创新建议",
    leaderName: "",
    leaderUserId: "",
    estimatedDemandCost: ""
  });
  const [submitting, setSubmitting] = useState(false);
  const [leaderSearchResults, setLeaderSearchResults] = useState<FeishuUserSearchResult[]>([]);
  const [leaderSearchMessage, setLeaderSearchMessage] = useState("");
  const [searchingLeader, setSearchingLeader] = useState(false);
  const isDemand = values.innovationKind === "创新需求";

  async function searchLeader(event?: React.FormEvent) {
    event?.preventDefault();
    const keyword = values.leaderName.trim();
    if (!keyword) {
      setLeaderSearchMessage("请输入牵头人姓名、拼音或工号");
      setLeaderSearchResults([]);
      return;
    }
    setSearchingLeader(true);
    setLeaderSearchMessage("");
    try {
      const result = await api.searchFeishuUsers(keyword);
      setLeaderSearchResults(result.users);
      setLeaderSearchMessage(result.users.length ? `找到 ${result.users.length} 个候选，请选择牵头人` : "没有找到匹配用户");
    } catch (error) {
      const message = error instanceof Error ? error.message : "搜索用户失败";
      setLeaderSearchResults([]);
      setLeaderSearchMessage(message.includes("missing_user_token") ? "需要用飞书重新登录后再搜索用户" : message);
    } finally {
      setSearchingLeader(false);
    }
  }

  function selectLeader(user: FeishuUserSearchResult) {
    setValues((current) => ({
      ...current,
      leaderName: user.name,
      leaderUserId: user.userId
    }));
    setLeaderSearchResults([]);
    setLeaderSearchMessage(`${user.name} 已选为牵头人，user_id：${user.userId}`);
  }

  return (
    <section className="innovation-card innovation-submit-card">
      <div className="innovation-card-title">
        <Sparkles size={20} />
        <div>
          <span>Launch Pad</span>
          <h3>提交创新项目</h3>
        </div>
      </div>
      <form onSubmit={async (event) => {
        event.preventDefault();
        setSubmitting(true);
        try {
          const created = await api.createInnovationProject(values as any);
          setValues({ projectTheme: "", projectDescription: "", innovationKind: "创新建议", leaderName: "", leaderUserId: "", estimatedDemandCost: "" });
          setLeaderSearchResults([]);
          setLeaderSearchMessage("");
          await onCreated(created);
        } catch (error) {
          onToast(error instanceof Error ? error.message : "提交失败");
        } finally {
          setSubmitting(false);
        }
      }}>
        <label><span>项目主题<b>*</b></span><input value={values.projectTheme} onChange={(event) => setValues((current) => ({ ...current, projectTheme: event.target.value }))} required placeholder="一句话说明你的创新想法" /></label>
        <label className="full"><span>描述（项目内容，预期收益）<b>*</b></span><textarea value={values.projectDescription} onChange={(event) => setValues((current) => ({ ...current, projectDescription: event.target.value }))} required rows={5} placeholder="痛点、设想、预期收益、需要工作室支持的方向" /></label>
        <label className="innovation-kind-field"><span>类型<b>*</b></span><select value={values.innovationKind} onChange={(event) => setValues((current) => ({ ...current, innovationKind: event.target.value }))}>
          <option value="创新建议">创新建议</option>
          <option value="创新需求">创新需求</option>
        </select>
          <small>
            创新建议只是建议稿，无实际执行人，需要其他人接榜；创新需求有明确牵头人、预计需求费用等。
          </small>
        </label>
        <div className="leader-picker">
          <label><span>牵头人{isDemand ? <b>*</b> : null}</span><input value={values.leaderName} onChange={(event) => {
            const nextName = event.target.value;
            setValues((current) => ({
              ...current,
              leaderName: nextName,
              leaderUserId: nextName === current.leaderName ? current.leaderUserId : ""
            }));
          }} required={isDemand} placeholder="输入姓名或拼音后搜索" /></label>
          <button type="button" className="leader-search-button" onClick={() => searchLeader()} disabled={searchingLeader || !values.leaderName.trim()}>
            {searchingLeader ? <LoaderCircle size={16} /> : <Search size={16} />}
            搜索
          </button>
          {values.leaderUserId ? <p className="leader-picked">已选择 user_id：{values.leaderUserId}</p> : null}
          {leaderSearchMessage ? <p className="leader-search-message">{leaderSearchMessage}</p> : null}
          {leaderSearchResults.length ? (
            <div className="leader-search-results">
              {leaderSearchResults.map((user) => (
                <button type="button" key={user.userId} onClick={() => selectLeader(user)}>
                  <strong>{user.name}</strong>
                  <span>{user.department || "未返回部门"} · {user.userId}</span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
        <label><span>预计需求费用{isDemand ? <b>*</b> : null}</span><input value={values.estimatedDemandCost} onChange={(event) => setValues((current) => ({ ...current, estimatedDemandCost: event.target.value }))} required={isDemand} type="number" min="0" placeholder="创新需求需填写" /></label>
        <button className="innovation-command" type="submit" disabled={submitting}>
          {submitting ? <LoaderCircle size={17} /> : <Rocket size={17} />}
          {submitting ? "发射中..." : "提交到创新工作室"}
        </button>
      </form>
    </section>
  );
}

function InnovationAwardsBoard({ awards }: { awards: InnovationAwardView[] }) {
  const [activeFilter, setActiveFilter] = useState<"全部" | InnovationAwardChoice>("全部");
  const visibleAwards = awards.filter((award) => activeFilter === "全部" || award.awardName.split("、").includes(activeFilter));
  const filterChoices = ["全部", ...innovationAwardChoices] as const;
  const activeFilterIndex = filterChoices.findIndex((choice) => choice === activeFilter);
  return (
    <section className="innovation-card innovation-awards-card">
      <div className="innovation-card-title">
        <Award size={20} />
        <div>
          <span>Award Board</span>
          <h3><GradientText colors={["#ffffff", "#ee2e24", "#ffffff", "#b8b1ad"]} animationSpeed={5}>优秀项目展示</GradientText></h3>
        </div>
        <div
          className="award-filter-switch"
          role="tablist"
          aria-label="优秀项目奖项筛选"
          style={{ "--award-filter-index": activeFilterIndex } as React.CSSProperties}
        >
          <span className="award-filter-thumb" aria-hidden="true" />
          {filterChoices.map((choice) => (
            <button
              key={choice}
              type="button"
              className={activeFilter === choice ? "selected" : ""}
              onClick={() => setActiveFilter(choice)}
            >
              {choice}
            </button>
          ))}
        </div>
      </div>
      <div className="award-list">
        {visibleAwards.map((award) => (
          <article key={award.id} className="award-item">
            <span>{award.awardName}</span>
            <h4><GradientText colors={["#ffffff", "#ee2e24", "#ffffff"]} animationSpeed={6}>{award.projectTitle}</GradientText></h4>
            <p>{award.reason || award.awardName}</p>
            <small>{award.awardedByName} · {new Date(award.awardedAt).toLocaleDateString("zh-CN")}</small>
          </article>
        ))}
        {!visibleAwards.length ? <p className="innovation-empty">{awards.length ? "当前筛选下暂无获奖项目。" : "优秀项目评奖后会在这里点亮展示。"}</p> : null}
      </div>
    </section>
  );
}

function InnovationProjectBoard({ currentUser, canManage, projects, selectedProjectId, selectedProject, onSelect, onToast, onUpdated, onDeleted }: {
  currentUser: CurrentUser | null;
  canManage: boolean;
  projects: InnovationProject[];
  selectedProjectId: string | null;
  selectedProject: InnovationProject | null;
  onSelect: (id: string | null) => void;
  onToast: (message: string) => void;
  onUpdated: (project: InnovationProject) => Promise<void>;
  onDeleted: () => Promise<void>;
}) {
  const [supplement, setSupplement] = useState<{
    leaderName: string;
    leaderUserId: string;
    participants: string;
    participantsUserIds: string[];
    workshopResources: string;
    expectedCost: string;
    expectedCycle: string;
    status: InnovationStatusValue;
  }>({
    leaderName: "",
    leaderUserId: "",
    participants: "",
    participantsUserIds: [],
    workshopResources: "",
    expectedCost: "",
    expectedCycle: "",
    status: "待评审"
  });
  const [award, setAward] = useState<{ awardNames: Array<(typeof innovationAwardChoices)[number]>; reason: string; displayOrder: number }>({ awardNames: [], reason: "", displayOrder: 0 });
  const [saving, setSaving] = useState(false);
  const [leaderSupplementSearchResults, setLeaderSupplementSearchResults] = useState<FeishuUserSearchResult[]>([]);
  const [leaderSupplementSearchMessage, setLeaderSupplementSearchMessage] = useState("");
  const [searchingSupplementLeader, setSearchingSupplementLeader] = useState(false);
  const [participantSearchKeyword, setParticipantSearchKeyword] = useState("");
  const [participantSearchResults, setParticipantSearchResults] = useState<FeishuUserSearchResult[]>([]);
  const [participantSearchMessage, setParticipantSearchMessage] = useState("");
  const [searchingParticipant, setSearchingParticipant] = useState(false);
  const isSuperAdmin = currentUser?.role === "admin";

  useEffect(() => {
    if (!selectedProject) return;
    setSupplement({
      leaderName: formatFieldValue(selectedProject.values.leader_name),
      leaderUserId: formatFieldValue(selectedProject.values.leader_user_id),
      participants: formatFieldValue(selectedProject.values.participants),
      participantsUserIds: Array.isArray(selectedProject.values.participants_user_ids)
        ? selectedProject.values.participants_user_ids.map((item) => String(item)).filter(Boolean)
        : [],
      workshopResources: formatFieldValue(selectedProject.values.workshop_resources),
      expectedCost: formatFieldValue(selectedProject.values.expected_cost),
      expectedCycle: formatFieldValue(selectedProject.values.expected_cycle),
      status: innovationStatusChoices.includes(selectedProject.status as InnovationStatusValue) ? selectedProject.status as InnovationStatusValue : "待评审"
    });
    setAward({ awardNames: [], reason: "", displayOrder: 0 });
    setLeaderSupplementSearchResults([]);
    setLeaderSupplementSearchMessage("");
    setParticipantSearchKeyword("");
    setParticipantSearchResults([]);
    setParticipantSearchMessage("");
  }, [selectedProject?.id]);

  const canSupplementSelected = Boolean(selectedProject && (
    canManage
      || selectedProject.submitterUserId === currentUser?.id
      || selectedProject.submitterFeishuUserId === currentUser?.feishuUserId
      || selectedProject.submitterName === currentUser?.name
  ));

  async function searchSupplementLeader(event?: React.FormEvent) {
    event?.preventDefault();
    const keyword = supplement.leaderName.trim();
    if (!keyword) {
      setLeaderSupplementSearchMessage("请输入牵头人姓名、拼音或工号");
      setLeaderSupplementSearchResults([]);
      return;
    }
    setSearchingSupplementLeader(true);
    setLeaderSupplementSearchMessage("");
    try {
      const result = await api.searchFeishuUsers(keyword);
      setLeaderSupplementSearchResults(result.users);
      setLeaderSupplementSearchMessage(result.users.length ? `找到 ${result.users.length} 个候选，请选择牵头人` : "没有找到匹配用户");
    } catch (error) {
      const message = error instanceof Error ? error.message : "搜索用户失败";
      setLeaderSupplementSearchResults([]);
      setLeaderSupplementSearchMessage(message.includes("missing_user_token") ? "需要用飞书重新登录后再搜索用户" : message);
    } finally {
      setSearchingSupplementLeader(false);
    }
  }

  function selectSupplementLeader(user: FeishuUserSearchResult) {
    setSupplement((current) => ({
      ...current,
      leaderName: user.name,
      leaderUserId: user.userId
    }));
    setLeaderSupplementSearchResults([]);
    setLeaderSupplementSearchMessage(`${user.name} 已选为牵头人，user_id：${user.userId}`);
  }

  async function searchParticipant(event?: React.FormEvent) {
    event?.preventDefault();
    const keyword = participantSearchKeyword.trim();
    if (!keyword) {
      setParticipantSearchMessage("请输入参与人员姓名、拼音或工号");
      setParticipantSearchResults([]);
      return;
    }
    setSearchingParticipant(true);
    setParticipantSearchMessage("");
    try {
      const result = await api.searchFeishuUsers(keyword);
      setParticipantSearchResults(result.users);
      setParticipantSearchMessage(result.users.length ? `找到 ${result.users.length} 个候选，请选择参与人员` : "没有找到匹配用户");
    } catch (error) {
      const message = error instanceof Error ? error.message : "搜索用户失败";
      setParticipantSearchResults([]);
      setParticipantSearchMessage(message.includes("missing_user_token") ? "需要用飞书重新登录后再搜索用户" : message);
    } finally {
      setSearchingParticipant(false);
    }
  }

  function selectParticipant(user: FeishuUserSearchResult) {
    setSupplement((current) => {
      const names = current.participants.split(/[、,，\n]/).map((item) => item.trim()).filter(Boolean);
      const nextNames = names.includes(user.name) ? names : [...names, user.name];
      const nextUserIds = current.participantsUserIds.includes(user.userId)
        ? current.participantsUserIds
        : [...current.participantsUserIds, user.userId];
      return {
        ...current,
        participants: nextNames.join("、"),
        participantsUserIds: nextUserIds
      };
    });
    setParticipantSearchKeyword("");
    setParticipantSearchResults([]);
    setParticipantSearchMessage(`${user.name} 已加入参与人员，user_id：${user.userId}`);
  }

  function removeParticipantUserId(userId: string) {
    setSupplement((current) => ({
      ...current,
      participantsUserIds: current.participantsUserIds.filter((id) => id !== userId)
    }));
  }

  return (
    <div className="innovation-board">
      <div className="innovation-project-list">
        {projects.map((project) => {
          const kind = formatFieldValue(project.values.innovation_kind) || "创新建议";
          return (
            <button key={project.id} type="button" className={project.id === selectedProjectId ? "innovation-project-row active" : "innovation-project-row"} onClick={() => onSelect(project.id)}>
              <span className="innovation-status-dot" data-status={project.status} />
              <strong>
                {project.id === selectedProjectId
                  ? <GradientText colors={["#ee2e24", "#1f1a17", "#ee2e24"]} animationSpeed={5}>{project.title}</GradientText>
                  : project.title}
              </strong>
              <span className={kind === "创新需求" ? "innovation-kind-badge demand" : "innovation-kind-badge suggestion"}>{kind}</span>
              <small>{project.recordNo ?? "未编号"} · {project.submitterName}</small>
              <em>{project.status}</em>
            </button>
          );
        })}
        {!projects.length ? <div className="innovation-empty">暂无创新项目，先提交一个想法吧。</div> : null}
      </div>
      {selectedProject ? createPortal(
        <div className="innovation-project-modal-backdrop" role="dialog" aria-modal="true" aria-label={selectedProject.title} onClick={() => onSelect(null)}>
          <div className="innovation-project-detail innovation-project-modal" onClick={(event) => event.stopPropagation()}>
            <div className="innovation-detail-head">
              <div>
                <span>{selectedProject.recordNo ?? "创新项目"}</span>
                <h3>{selectedProject.title}</h3>
                <p>{formatFieldValue(selectedProject.values.innovation_kind)} · {selectedProject.status} · {selectedProject.submitterName}</p>
              </div>
              <div className="innovation-detail-actions">
                <button type="button" className="innovation-modal-close" onClick={() => onSelect(null)}>关闭</button>
                {isSuperAdmin ? (
                  <button
                    type="button"
                    className="innovation-danger-button"
                    onClick={async () => {
                      const confirmed = window.confirm(`确定删除创新项目「${selectedProject.title}」吗？相关获奖展示也会同步移除。`);
                      if (!confirmed) return;
                      try {
                        await api.deleteInnovationProject(selectedProject.id);
                        onToast("创新项目已删除");
                        await onDeleted();
                      } catch (error) {
                        onToast(error instanceof Error ? error.message : "删除创新项目失败");
                      }
                    }}
                  >
                    删除项目
                  </button>
                ) : null}
                <Award size={24} />
              </div>
            </div>
            <div className="innovation-value-grid">
              <div className="full"><span>描述</span><strong>{formatFieldValue(selectedProject.values.project_description)}</strong></div>
              <div><span>牵头人</span><strong>{formatFieldValue(selectedProject.values.leader_name) || "暂无"}</strong></div>
              <div><span>预计需求费用</span><strong>{formatFieldValue(selectedProject.values.estimated_demand_cost) || "暂无"}</strong></div>
              <div><span>参与人员</span><strong>{formatFieldValue(selectedProject.values.participants) || "待补充"}</strong></div>
              <div className="full"><span>参与人员 user_id</span><strong>{formatFieldValue(selectedProject.values.participants_user_ids) || "待补充"}</strong></div>
              <div className="full"><span>工作室资源</span><strong>{formatFieldValue(selectedProject.values.workshop_resources) || "待补充"}</strong></div>
              <div><span>预期费用</span><strong>{formatFieldValue(selectedProject.values.expected_cost) || "待补充"}</strong></div>
              <div><span>预期周期</span><strong>{formatFieldValue(selectedProject.values.expected_cycle) || "待补充"}</strong></div>
            </div>
            {canSupplementSelected ? (
              <form className="innovation-supplement-form" onSubmit={async (event) => {
                event.preventDefault();
                setSaving(true);
                try {
                  const updated = await api.supplementInnovationProject(selectedProject.id, canManage ? supplement : {
                    leaderName: supplement.leaderName,
                    leaderUserId: supplement.leaderUserId,
                    participants: supplement.participants,
                    participantsUserIds: supplement.participantsUserIds,
                    workshopResources: supplement.workshopResources,
                    expectedCost: supplement.expectedCost,
                    expectedCycle: supplement.expectedCycle
                  });
                  onToast("创新项目信息已保存");
                  await onUpdated(updated);
                } catch (error) {
                  onToast(error instanceof Error ? error.message : "保存失败");
                } finally {
                  setSaving(false);
                }
              }}>
                <h4>补充协同信息</h4>
                <div className="leader-picker">
                  <label><span>牵头人</span><input value={supplement.leaderName} onChange={(event) => {
                    const nextName = event.target.value;
                    setSupplement((current) => ({
                      ...current,
                      leaderName: nextName,
                      leaderUserId: nextName === current.leaderName ? current.leaderUserId : ""
                    }));
                  }} placeholder="创新建议可后续补充牵头人" /></label>
                  <button type="button" className="leader-search-button" onClick={() => searchSupplementLeader()} disabled={searchingSupplementLeader || !supplement.leaderName.trim()}>
                    {searchingSupplementLeader ? <LoaderCircle size={16} /> : <Search size={16} />}
                    搜索
                  </button>
                  {supplement.leaderUserId ? <p className="leader-picked">已选择 user_id：{supplement.leaderUserId}</p> : null}
                  {leaderSupplementSearchMessage ? <p className="leader-search-message">{leaderSupplementSearchMessage}</p> : null}
                  {leaderSupplementSearchResults.length ? (
                    <div className="leader-search-results">
                      {leaderSupplementSearchResults.map((user) => (
                        <button type="button" key={user.userId} onClick={() => selectSupplementLeader(user)}>
                          <strong>{user.name}</strong>
                          <span>{user.department || "未返回部门"} · {user.userId}</span>
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
                <div className="participant-picker">
                  <label className="full"><span>参与人员</span><textarea value={supplement.participants} onChange={(event) => setSupplement((current) => ({ ...current, participants: event.target.value }))} rows={3} placeholder="可手动填写，也可搜索内部用户后自动追加" /></label>
                  <div className="participant-search-row">
                    <input value={participantSearchKeyword} onChange={(event) => setParticipantSearchKeyword(event.target.value)} placeholder="输入姓名或拼音搜索参与人员" />
                    <button type="button" className="leader-search-button" onClick={() => searchParticipant()} disabled={searchingParticipant || !participantSearchKeyword.trim()}>
                      {searchingParticipant ? <LoaderCircle size={16} /> : <Search size={16} />}
                      搜索
                    </button>
                  </div>
                  {supplement.participantsUserIds.length ? (
                    <div className="participant-user-chips">
                      {supplement.participantsUserIds.map((userId) => (
                        <button type="button" key={userId} onClick={() => removeParticipantUserId(userId)} title="点击移除">
                          {userId}
                        </button>
                      ))}
                    </div>
                  ) : null}
                  {participantSearchMessage ? <p className="leader-search-message">{participantSearchMessage}</p> : null}
                  {participantSearchResults.length ? (
                    <div className="leader-search-results">
                      {participantSearchResults.map((user) => (
                        <button type="button" key={user.userId} onClick={() => selectParticipant(user)}>
                          <strong>{user.name}</strong>
                          <span>{user.department || "未返回部门"} · {user.userId}</span>
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
                <label className="full"><span>所需工作室资源</span><textarea value={supplement.workshopResources} onChange={(event) => setSupplement((current) => ({ ...current, workshopResources: event.target.value }))} rows={4} placeholder="例如：3D打印、会议室、测试环境、边缘设备、工业相机等" /></label>
                <label><span>预期费用</span><input value={supplement.expectedCost} onChange={(event) => setSupplement((current) => ({ ...current, expectedCost: event.target.value }))} type="number" min="0" /></label>
                <label><span>预期周期</span><input value={supplement.expectedCycle} onChange={(event) => setSupplement((current) => ({ ...current, expectedCycle: event.target.value }))} placeholder="例如：2个月" /></label>
                {canManage ? <label><span>状态</span><select value={supplement.status} onChange={(event) => setSupplement((current) => ({ ...current, status: event.target.value as InnovationStatusValue }))}>
                  {innovationStatusChoices.map((status) => <option key={status} value={status}>{status}</option>)}
                </select></label> : null}
                <button className="innovation-command compact" disabled={saving} type="submit">{saving ? "保存中..." : "保存补充"}</button>
              </form>
            ) : null}
            {canManage ? (
              <form className="innovation-award-form" onSubmit={async (event) => {
                event.preventDefault();
                if (!award.awardNames.length) return;
                try {
                  await api.createInnovationAward({
                    recordId: selectedProject.id,
                    awardNames: award.awardNames,
                    reason: award.reason || null,
                    displayOrder: Number(award.displayOrder || 0)
                  });
                  setAward({ awardNames: [], reason: "", displayOrder: 0 });
                  onToast("已加入获奖看板");
                  await onUpdated(await api.innovationProject(selectedProject.id));
                } catch (error) {
                  onToast(error instanceof Error ? error.message : "评奖失败");
                }
              }}>
                <h4>评奖展示</h4>
                <div className="award-choice-grid">
                  {innovationAwardChoices.map((choice) => {
                    const selected = award.awardNames.includes(choice);
                    return (
                      <label key={choice} className={selected ? "award-choice selected" : "award-choice"}>
                        <input
                          type="checkbox"
                          checked={selected}
                          onChange={(event) => setAward((current) => ({
                            ...current,
                            awardNames: event.target.checked
                              ? [...current.awardNames, choice]
                              : current.awardNames.filter((item) => item !== choice)
                          }))}
                        />
                        <span>{choice}</span>
                      </label>
                    );
                  })}
                </div>
                <label><span>展示理由</span><input value={award.reason} onChange={(event) => setAward((current) => ({ ...current, reason: event.target.value }))} placeholder="为什么值得展示" /></label>
                <label><span>看板排序</span><input value={award.displayOrder} onChange={(event) => setAward((current) => ({ ...current, displayOrder: Number(event.target.value) }))} type="number" placeholder="数字越小越靠前" /></label>
                <button type="submit" disabled={!award.awardNames.length}>加入看板</button>
              </form>
            ) : null}
            <ul className="timeline-list compact innovation-timeline">
              {(selectedProject.timeline ?? []).map((item) => (
                <li key={item.id}>
                  <span />
                  <div className="timeline-copy">
                    <strong>{item.title}</strong>
                    <small>{item.body}</small>
                    <small className="timeline-meta">{item.actorName ? `${item.actorName} · ` : ""}{formatTimelineDate(item.createdAt)}</small>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>,
        document.body
      ) : null}
    </div>
  );
}

function InnovationNewsPage({ currentUser, onToast, onBack }: {
  currentUser: CurrentUser | null;
  onToast: (message: string) => void;
  onBack: () => void;
}) {
  const [articles, setArticles] = useState<InnovationArticle[]>([]);
  const [activeArticle, setActiveArticle] = useState<InnovationArticle | null>(null);
  const [uploadingWord, setUploadingWord] = useState(false);
  const canManage = currentUser?.role === "admin" || currentUser?.role === "system_owner";
  const canDeleteArticles = currentUser?.role === "admin";

  async function refreshArticles() {
    const data = await api.innovationArticles(canManage);
    setArticles(data);
    if (activeArticle && !data.some((article) => article.id === activeArticle.id)) setActiveArticle(null);
  }

  useEffect(() => {
    refreshArticles().catch((error) => onToast(error.message));
  }, [canManage]);

  return (
    <section className="innovation-news-shell innovation-news-page">
      <div className="innovation-section-title">
        <div>
          <span>Field Notes</span>
          <h3>创新项目新闻与学习心得</h3>
        </div>
        <button type="button" onClick={onBack}>返回工作室</button>
      </div>
      {canManage ? (
        <label className={uploadingWord ? "word-upload-panel uploading" : "word-upload-panel"}>
          <UploadCloud size={26} />
          <strong>{uploadingWord ? "正在解析 Word 文档..." : "上传 Word 文档发布学习心得"}</strong>
          <span>支持 .docx，系统会保存原文档并自动提取正文作为在线预览。</span>
          <input type="file" accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" disabled={uploadingWord} onChange={async (event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (!file) return;
            if (!file.name.toLowerCase().endsWith(".docx")) {
              onToast("请上传 .docx 格式的 Word 文档，旧版 .doc 需要先另存为 .docx。");
              return;
            }
            if (!file.size) {
              onToast("上传文件为空，请重新选择 Word 文档。");
              return;
            }
            setUploadingWord(true);
            try {
              const article = await api.uploadInnovationArticleWord(file);
              setActiveArticle(article);
              onToast("Word 文档已上传并发布");
              await refreshArticles();
            } catch (error) {
              onToast(error instanceof Error ? error.message : "Word 上传失败");
            } finally {
              setUploadingWord(false);
            }
          }} />
        </label>
      ) : null}
      <div className="innovation-news-grid">
        <div className="innovation-article-list">
          {articles.map((article) => (
            <article key={article.id} className="innovation-article-card">
              <button type="button" onClick={() => setActiveArticle(article)}>
                <img src={article.coverImageUrl ? absoluteApiUrl(article.coverImageUrl) : "/visuals/innovation/news-showcase.png"} alt="" />
                <span>{article.status === "published" ? "已发布" : article.status === "archived" ? "已下线" : "草稿"}</span>
                <h4>{article.title}</h4>
                <p>{article.summary}</p>
                <small>{article.authorName} · {article.publishedAt ? formatTimelineDate(article.publishedAt) : "未发布"}</small>
              </button>
              {canDeleteArticles ? (
                <button
                  type="button"
                  className="article-delete-button"
                  onClick={async () => {
                    const confirmed = window.confirm(`确定删除新闻「${article.title}」吗？删除后业务用户将无法阅读。`);
                    if (!confirmed) return;
                    try {
                      await api.deleteInnovationArticle(article.id);
                      const nextArticles = articles.filter((item) => item.id !== article.id);
                      setArticles(nextArticles);
                      if (activeArticle?.id === article.id) setActiveArticle(nextArticles[0] ?? null);
                      onToast("新闻已删除");
                    } catch (error) {
                      onToast(error instanceof Error ? error.message : "删除新闻失败");
                    }
                  }}
                >
                  删除
                </button>
              ) : null}
            </article>
          ))}
          {!articles.length ? <div className="innovation-empty">管理员上传 Word 学习心得后会展示在这里。</div> : null}
        </div>
      </div>
      {activeArticle ? createPortal(
        <div className="innovation-article-modal" role="dialog" aria-modal="true" aria-label={activeArticle.title}>
          <button className="article-modal-backdrop" type="button" aria-label="关闭新闻详情" onClick={() => setActiveArticle(null)} />
          <article className="innovation-article-reader fullscreen">
            <div className="article-reader-toolbar">
              <div>
                <span>{activeArticle.status === "published" ? "Word 预览" : "管理预览"}</span>
                <h4>{activeArticle.title}</h4>
              </div>
              <button type="button" onClick={() => setActiveArticle(null)}>关闭</button>
            </div>
            <img src={activeArticle.coverImageUrl ? absoluteApiUrl(activeArticle.coverImageUrl) : "/visuals/innovation/news-showcase.png"} alt="" />
            <p>{activeArticle.summary}</p>
            <AttachmentList value={activeArticle.attachments} compact />
            <DocxArticlePreview value={activeArticle.attachments} />
            <div className="article-body">{activeArticle.body}</div>
            <ArticleImagePreview value={activeArticle.attachments} />
          </article>
        </div>,
        document.body
      ) : null}
    </section>
  );
}

function SubmitPanel({ formTypes, activeType, selectedType, fields, fieldsLoading, owners, onTypeChange, onSubmit }: {
  formTypes: FormType[];
  activeType: string;
  selectedType?: FormType;
  fields: FieldConfig[];
  fieldsLoading: boolean;
  owners: Array<{ systemName: string; ownerName: string }>;
  onTypeChange: (type: string) => void;
  onSubmit: (values: Record<string, unknown>) => Promise<void>;
}) {
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [submitting, setSubmitting] = useState(false);
  const businessFields = fields.filter((field) => field.visibleToBusiness && field.editableByBusiness);
  const activeTypeIndex = Math.max(0, formTypes.findIndex((type) => type.key === activeType));
  const switchStyle = {
    "--active-index": activeTypeIndex,
    "--item-count": Math.max(formTypes.length, 1)
  } as React.CSSProperties;

  useEffect(() => {
    const initial: Record<string, unknown> = {};
    for (const field of fields) {
      if (field.fieldKey === "status") initial[field.fieldKey] = "待处理";
      if (field.fieldKey === "system") initial[field.fieldKey] = "LMES1.0";
    }
    setValues(initial);
  }, [fields]);

  return (
    <div className="submit-layout">
      <section className="panel primary-panel">
        <div className="segmented type-switch" style={switchStyle}>
          {formTypes.map((type) => (
            <button
              key={type.key}
              type="button"
              className={activeType === type.key ? "selected" : ""}
              aria-pressed={activeType === type.key}
              onClick={() => {
                if (activeType !== type.key) onTypeChange(type.key);
              }}
            >
              {type.name}
            </button>
          ))}
        </div>
        <div className="panel-title form-copy-stage" key={`title-${activeType}`}>
          <h2>{selectedType?.name ?? "提交"}</h2>
          <p>{selectedType?.description}</p>
        </div>
        {fieldsLoading ? (
          <div className="form-skeleton" aria-label="表单切换中">
            <span />
            <span />
            <span />
            <span />
            <span className="wide" />
          </div>
        ) : (
        <form key={activeType} className="dynamic-form form-stage" onSubmit={async (event) => {
          event.preventDefault();
          setSubmitting(true);
          try {
            await onSubmit(values);
          } finally {
            setSubmitting(false);
          }
        }}>
          {businessFields.map((field) => (
            <DynamicField
              key={field.id}
              field={field.fieldKey === "system" ? { ...field, kind: "select", options: owners.map((owner) => owner.systemName) } : field}
              value={values[field.fieldKey] ?? ""}
              onChange={(value) => setValues((current) => ({ ...current, [field.fieldKey]: value }))}
              onUpload={async (file) => {
                const uploaded = await api.uploadAttachment(file);
                setValues((current) => ({
                  ...current,
                  [field.fieldKey]: [...asAttachmentList(current[field.fieldKey]), uploaded]
                }));
              }}
            />
          ))}
          <button className="command" type="submit" disabled={submitting}>
            {submitting ? <LoaderCircle size={18} /> : <FilePlus2 size={18} />}
            {submitting ? "提交中..." : "提交并自动分派"}
          </button>
        </form>
        )}
      </section>
    </div>
  );
}

type AttachmentValue = {
  name: string;
  url?: string;
  storedName?: string;
  mimeType?: string;
  size?: number;
  fileToken?: string;
  source?: string;
};

function asAttachmentList(value: unknown): AttachmentValue[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (!item || typeof item !== "object") return { name: String(item ?? "附件") };
        const object = item as Record<string, unknown>;
        return {
          name: String(object.name ?? object.file_name ?? object.fileName ?? object.fileToken ?? object.file_token ?? "附件"),
          url: typeof object.url === "string" ? object.url : undefined,
          storedName: typeof object.storedName === "string" ? object.storedName : undefined,
          mimeType: typeof object.mimeType === "string" ? object.mimeType : undefined,
          size: typeof object.size === "number" ? object.size : undefined,
          fileToken: typeof object.fileToken === "string" ? object.fileToken : typeof object.file_token === "string" ? object.file_token : undefined,
          source: typeof object.source === "string" ? object.source : undefined
        };
      })
      .filter((item) => item.name || item.url || item.fileToken);
  }
  if (!value) return [];
  if (typeof value === "string") return value ? [{ name: value, url: value }] : [];
  return [];
}

function absoluteApiUrl(pathOrUrl: string) {
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
  return `${API_BASE_URL}${pathOrUrl.startsWith("/") ? pathOrUrl : `/${pathOrUrl}`}`;
}

function attachmentLinks(item: AttachmentValue) {
  const encodedName = encodeURIComponent(item.name || "附件");
  if (item.fileToken) {
    const base = `${API_BASE_URL}/api/feishu/attachments/${encodeURIComponent(item.fileToken)}/download?name=${encodedName}`;
    return {
      previewUrl: `${base}&disposition=inline`,
      downloadUrl: `${base}&disposition=attachment`
    };
  }
  if (item.url) {
    const separator = item.url.includes("?") ? "&" : "?";
    const previewPath = `${item.url}${separator}name=${encodedName}&disposition=inline`;
    const downloadPath = `${item.url}${separator}name=${encodedName}&disposition=attachment`;
    return { previewUrl: absoluteApiUrl(previewPath), downloadUrl: absoluteApiUrl(downloadPath) };
  }
  return { previewUrl: "", downloadUrl: "" };
}

function isPreviewableAttachment(item: AttachmentValue) {
  const mimeType = item.mimeType ?? "";
  const name = item.name.toLowerCase();
  return mimeType.startsWith("image/")
    || mimeType.startsWith("text/")
    || /\.(png|jpe?g|gif|webp|svg|txt|md|csv|json|log)$/i.test(name);
}

function isImageAttachment(item: AttachmentValue) {
  const mimeType = item.mimeType ?? "";
  const name = item.name.toLowerCase();
  return item.source === "word_image" || mimeType.startsWith("image/") || /\.(png|jpe?g|gif|webp|svg)$/i.test(name);
}

function isDocxAttachment(item: AttachmentValue) {
  const mimeType = item.mimeType ?? "";
  const name = item.name.toLowerCase();
  return mimeType.includes("wordprocessingml.document") || name.endsWith(".docx");
}

function fitDocxPreviewToWidth(container: HTMLDivElement) {
  const wrapper = container.querySelector<HTMLElement>(".docx-wrapper");
  const firstPage = container.querySelector<HTMLElement>("section.docx");
  if (!wrapper || !firstPage) return;

  (wrapper.style as any).zoom = "";
  wrapper.style.removeProperty("transform");
  wrapper.style.removeProperty("width");
  wrapper.style.removeProperty("height");
  const canvasStyle = window.getComputedStyle(container);
  const horizontalPadding = parseFloat(canvasStyle.paddingLeft) + parseFloat(canvasStyle.paddingRight);
  const availableWidth = Math.max(240, container.clientWidth - horizontalPadding);
  const pageWidth = firstPage.offsetWidth || firstPage.getBoundingClientRect().width;
  if (!pageWidth) return;

  const scale = Math.min(1, availableWidth / pageWidth);
  wrapper.style.width = `${pageWidth}px`;
  wrapper.style.margin = "0 auto";
  (wrapper.style as any).zoom = String(scale);
}

function DocxArticlePreview({ value }: { value: unknown }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [message, setMessage] = useState("");
  const docx = asAttachmentList(value).find(isDocxAttachment);
  const links = docx ? attachmentLinks(docx) : null;
  const previewUrl = links?.previewUrl || links?.downloadUrl || "";

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !docx || !previewUrl) {
      setStatus("idle");
      return;
    }

    let cancelled = false;
    container.innerHTML = "";
    setStatus("loading");
    setMessage("");

    fetch(previewUrl, { credentials: "include" })
      .then((response) => {
        if (!response.ok) throw new Error(`Word 文档读取失败：${response.status}`);
        return response.blob();
      })
      .then(async (blob) => {
        const { renderAsync } = await import("docx-preview");
        await renderAsync(blob, container, undefined, {
          inWrapper: true,
          className: "docx",
          breakPages: true,
          renderHeaders: true,
          renderFooters: true,
          ignoreWidth: false,
          ignoreHeight: false,
          useBase64URL: true
        });
        fitDocxPreviewToWidth(container);
      })
      .then(() => {
        if (!cancelled) setStatus("ready");
      })
      .catch((error) => {
        if (!cancelled) {
          container.innerHTML = "";
          setStatus("error");
          setMessage(error instanceof Error ? error.message : "Word 原格式预览失败，可下载附件查看。");
        }
      });

    return () => {
      cancelled = true;
      container.innerHTML = "";
    };
  }, [docx?.fileToken, docx?.url, docx?.name, previewUrl]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || status !== "ready") return;
    const handleResize = () => fitDocxPreviewToWidth(container);
    const observer = new ResizeObserver(() => fitDocxPreviewToWidth(container));
    observer.observe(container);
    window.addEventListener("resize", handleResize);
    fitDocxPreviewToWidth(container);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", handleResize);
    };
  }, [status]);

  if (!docx) return null;
  return (
    <div className="docx-preview-panel">
      <div className="docx-preview-head">
        <strong>Word 原格式预览</strong>
        {links?.downloadUrl ? <a href={links.downloadUrl} download={docx.name || true}>下载原文档</a> : null}
      </div>
      {status === "loading" ? <p>正在加载 Word 原格式预览...</p> : null}
      {status === "error" ? <p>{message}</p> : null}
      <div ref={containerRef} className="docx-preview-canvas" />
    </div>
  );
}

function ArticleImagePreview({ value }: { value: unknown }) {
  const images = asAttachmentList(value).filter(isImageAttachment);
  if (!images.length) return null;
  return (
    <div className="article-image-preview">
      <strong>Word 图片预览</strong>
      <div>
        {images.map((image, index) => {
          const links = attachmentLinks(image);
          const src = links.previewUrl || (image.url ? absoluteApiUrl(image.url) : "");
          if (!src) return null;
          return <img key={`${image.url ?? image.name}-${index}`} src={src} alt={image.name || `Word 图片 ${index + 1}`} />;
        })}
      </div>
    </div>
  );
}

function AttachmentList({ value, compact = false, onRemove }: {
  value: unknown;
  compact?: boolean;
  onRemove?: (index: number) => void;
}) {
  const attachments = asAttachmentList(value);
  if (!attachments.length) return <span className="empty-attachment">暂无附件</span>;
  return (
    <div className={compact ? "attachment-view compact" : "attachment-view"}>
      {attachments.map((item, index) => {
        const links = attachmentLinks(item);
        const key = `${item.fileToken ?? item.url ?? item.name}-${index}`;
        return (
          <div className="attachment-chip" key={key}>
            <Paperclip size={14} />
            <span>{item.name || "附件"}</span>
            {links.previewUrl && isPreviewableAttachment(item) ? (
              <a href={links.previewUrl} target="_blank" rel="noreferrer"><Eye size={13} />预览</a>
            ) : null}
            {links.downloadUrl ? (
              <a href={links.downloadUrl} download={item.name || true}><Download size={13} />下载</a>
            ) : null}
            {onRemove ? (
              <button type="button" className="attachment-remove" onClick={() => onRemove(index)}>移除</button>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function formatFieldValue(value: unknown) {
  if (Array.isArray(value)) {
    return value.map((item) => typeof item === "object" && item ? String((item as any).name ?? (item as any).url ?? "") : String(item)).filter(Boolean).join("、");
  }
  if (value && typeof value === "object") return JSON.stringify(value);
  return String(value ?? "");
}

function formatTimelineDate(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).format(new Date(value));
}

function typeTone(typeKey: string) {
  if (typeKey === "demand") return "demand";
  if (typeKey === "issue") return "issue";
  if (/innovation|创新|studio|workshop/i.test(typeKey)) return "innovation";
  const tones = ["moss", "blue", "copper", "slate"];
  const index = Array.from(typeKey).reduce((sum, char) => sum + char.charCodeAt(0), 0) % tones.length;
  return tones[index];
}

function TypeBadge({ typeKey, label }: { typeKey: string; label: string }) {
  return <span className="type-chip" data-tone={typeTone(typeKey)}>{label}</span>;
}

function DynamicField({ field, value, onChange, onUpload }: {
  field: FieldConfig;
  value: unknown;
  onChange: (value: unknown) => void;
  onUpload?: (file: File) => Promise<void>;
}) {
  const common = {
    id: field.fieldKey,
    required: field.required,
    value: String(value ?? ""),
    onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => onChange(event.target.value)
  };
  return (
    <label className={field.kind === "textarea" || field.kind === "attachment" ? "field full" : "field"} htmlFor={field.fieldKey}>
      <span>{field.label}{field.required ? <b>*</b> : null}</span>
      {field.kind === "textarea" ? <textarea {...common} rows={4} /> : null}
      {field.kind === "select" ? (
        <select {...common}>
          <option value="">请选择</option>
          {field.options.map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
      ) : null}
      {field.kind === "date" ? <input {...common} type="date" /> : null}
      {field.kind === "number" ? <input {...common} type="number" /> : null}
      {field.kind === "attachment" ? (
        <div className="attachment-control">
          <input
            id={field.fieldKey}
            required={field.required && asAttachmentList(value).length === 0}
            type="file"
            multiple
            onChange={async (event) => {
              const files = Array.from(event.target.files ?? []);
              for (const file of files) await onUpload?.(file);
              event.target.value = "";
            }}
          />
          <div className="attachment-list">
            {asAttachmentList(value).length ? (
              <AttachmentList
                value={value}
                onRemove={(index) => {
                  const next = asAttachmentList(value).filter((_, itemIndex) => itemIndex !== index);
                  onChange(next);
                }}
              />
            ) : <em><UploadCloud size={14} />选择文件上传</em>}
          </div>
        </div>
      ) : null}
      {!["textarea", "select", "date", "number", "attachment"].includes(field.kind) ? <input {...common} /> : null}
    </label>
  );
}

function RecordsPanel({ records, formTypes, owners, fields, currentUser, selectedRecordId, detail, detailLoading, onSelect, onRefreshFields, onSave, onCloneSystems, onConvert, onComment, onSyncRecords }: {
  records: RecordSummary[];
  formTypes: FormType[];
  owners: Array<{ systemName: string; ownerName: string }>;
  fields: FieldConfig[];
  currentUser: CurrentUser | null;
  selectedRecordId: string | null;
  detail: RecordDetail | null;
  detailLoading: boolean;
  onSelect: (id: string) => void;
  onRefreshFields: (typeKey: string) => Promise<FieldConfig[]>;
  onSave: (id: string, values: Record<string, unknown>) => Promise<void>;
  onCloneSystems: (id: string, systems: string[]) => Promise<void>;
  onConvert: (id: string, typeKey: string) => Promise<void>;
  onComment: (id: string, body: string) => Promise<void>;
  onSyncRecords: () => Promise<void>;
}) {
  const [comment, setComment] = useState("");
  const [editorOpen, setEditorOpen] = useState(false);
  const [syncingRecords, setSyncingRecords] = useState(false);
  const [ownOnly, setOwnOnly] = useState(true);
  const [filters, setFilters] = useState({ typeKey: "", systemName: "", ownerName: "" });
  const canEditRecord = currentUser?.role === "admin" || currentUser?.role === "system_owner";
  const isSuperAdmin = currentUser?.role === "admin";
  const shouldFilterMine = currentUser?.role === "business" && ownOnly;
  const typeNameByKey = new Map(formTypes.map((type) => [type.key, type.name]));
  const typeName = (typeKey: string) => typeNameByKey.get(typeKey) ?? typeKey;
  const summaryFields = fields
    .filter((field) => field.businessVisible);
  const filteredRecords = records.filter((record) => {
    if (shouldFilterMine && currentUser) {
      const mine = record.submitterUserId === currentUser.id
        || record.submitterFeishuUserId === currentUser.feishuUserId
        || record.submitterName === currentUser.name;
      if (!mine) return false;
    }
    if (filters.typeKey && record.typeKey !== filters.typeKey) return false;
    if (filters.systemName && record.systemName !== filters.systemName) return false;
    if (filters.ownerName && record.ownerName !== filters.ownerName) return false;
    return true;
  });

  return (
    <div className="records-workbench">
      <section className="panel records-toolbar">
        <div className="toolbar-title">
          <Filter size={18} />
          <strong>记录筛选</strong>
          {isSuperAdmin ? <button type="button" className="sync-records-button" disabled={syncingRecords} onClick={async () => {
            setSyncingRecords(true);
            try {
              await onSyncRecords();
            } finally {
              setSyncingRecords(false);
            }
          }}>{syncingRecords ? "同步中..." : "同步多维表格记录"}</button> : null}
          <span>{filteredRecords.length} / {records.length}</span>
        </div>
        <div className="filter-bar">
          {currentUser?.role === "business" ? (
            <label className="check-filter">
              <input type="checkbox" checked={ownOnly} onChange={(event) => setOwnOnly(event.target.checked)} />
              <span>只看自己提交</span>
            </label>
          ) : null}
          <label><span>提交类型</span><select value={filters.typeKey} onChange={(event) => setFilters((current) => ({ ...current, typeKey: event.target.value }))}>
            <option value="">全部类型</option>
            {formTypes.map((type) => <option key={type.key} value={type.key}>{type.name}</option>)}
          </select></label>
          <label><span>系统</span><select value={filters.systemName} onChange={(event) => setFilters((current) => ({ ...current, systemName: event.target.value }))}>
            <option value="">全部系统</option>
            {owners.map((owner) => <option key={owner.systemName} value={owner.systemName}>{owner.systemName}</option>)}
          </select></label>
          <label><span>管理员</span><select value={filters.ownerName} onChange={(event) => setFilters((current) => ({ ...current, ownerName: event.target.value }))}>
            <option value="">全部管理员</option>
            {[...new Set(owners.map((owner) => owner.ownerName))].map((ownerName) => <option key={ownerName} value={ownerName}>{ownerName}</option>)}
          </select></label>
        </div>
      </section>
      <div className="record-grid">
        <section className="panel list-panel">
          <div className="list-head"><span>标题</span><span>系统/负责人</span><span>状态</span></div>
          {filteredRecords.map((record) => (
            <button
              key={record.id}
              className={selectedRecordId === record.id ? "record-row active" : "record-row"}
              data-priority={record.priority ?? ""}
              onClick={() => onSelect(record.id)}
            >
              <span className="status-dot" data-status={record.status} />
              <strong>
                {record.title}
                {record.priority ? <span className="priority-chip" data-priority={record.priority}>{record.priority}</span> : null}
              </strong>
              <small>
                {record.recordNo ? <>{record.recordNo}<span className="meta-separator">·</span></> : null}
                <TypeBadge typeKey={record.typeKey} label={typeName(record.typeKey)} />
                <span className="meta-separator">·</span>{record.systemName}<span className="meta-separator">·</span>{record.ownerName ?? "未分派"}
              </small>
              <em>{record.status}</em>
            </button>
          ))}
        </section>
      <section className="panel detail-panel">
        {detailLoading ? (
          <div className="detail-placeholder" aria-label="记录详情加载中">
            <span className="detail-skeleton-title" />
            <span />
            <span />
            <span />
            <span className="wide" />
          </div>
        ) : detail ? (
          <div key={detail.id} className="detail-content">
            <div className="detail-head">
              <div>
                <h2>{detail.title}</h2>
                <p>
                  {detail.recordNo ? <>{detail.recordNo}<span className="meta-separator">·</span></> : null}
                  <TypeBadge typeKey={detail.typeKey} label={typeName(detail.typeKey)} />
                  <span className="meta-separator">·</span>{detail.systemName}<span className="meta-separator">·</span>{detail.status}<span className="meta-separator">·</span>{detail.ownerName ?? "未分派"}
                </p>
              </div>
              <MessageSquare size={22} />
            </div>
            <div className="value-grid">
              {summaryFields.map((field) => (
                <div key={field.id}>
                  <span>{field.label}</span>
                  {field.kind === "attachment"
                    ? <AttachmentList value={detail.values[field.fieldKey]} compact />
                    : <strong>{formatFieldValue(detail.values[field.fieldKey])}</strong>}
                </div>
              ))}
            </div>
            {canEditRecord ? <div className="detail-actions">
              <button className="command edit-open" type="button" onClick={async () => {
                await onRefreshFields(detail.typeKey);
                setEditorOpen(true);
              }}><PencilLine size={16} />打开完整字段编辑</button>
            </div> : null}
            {editorOpen ? createPortal(
              <div className="modal-backdrop" role="dialog" aria-modal="true">
                <div className="record-modal">
                  <div className="modal-head">
                    <div>
                      <span>完整字段编辑</span>
                      <h2>{detail.title}</h2>
                    </div>
                    <button type="button" onClick={() => setEditorOpen(false)}>关闭</button>
                  </div>
                  <RecordEditor
                    detail={detail}
                    owners={owners}
                    formTypes={formTypes}
                    fields={fields}
                    onSave={async (id, values) => {
                      await onSave(id, values);
                      setEditorOpen(false);
                    }}
                    onCloneSystems={async (id, systems) => {
                      await onCloneSystems(id, systems);
                      setEditorOpen(false);
                    }}
                    onConvert={async (id, typeKey) => {
                      await onConvert(id, typeKey);
                      setEditorOpen(false);
                    }}
                  />
                </div>
              </div>,
              document.body
            ) : null}
            <h3>时间线</h3>
            <ul className="timeline-list compact">
              {detail.timeline.map((item) => (
                <li key={item.id}>
                  <span />
                  <div className="timeline-copy">
                    <strong>{item.title}</strong>
                    <small>{item.body}</small>
                    <small className="timeline-meta">
                      {item.actorName ? `${item.actorName} · ` : ""}{formatTimelineDate(item.createdAt)}
                    </small>
                  </div>
                </li>
              ))}
            </ul>
            {canEditRecord ? <form className="comment-box" onSubmit={async (event) => {
              event.preventDefault();
              if (!comment.trim()) return;
              await onComment(detail.id, comment);
              setComment("");
            }}>
              <input value={comment} onChange={(event) => setComment(event.target.value)} placeholder="追加评论或补充说明" />
              <button type="submit">发送</button>
            </form> : null}
          </div>
        ) : <div className="empty">选择一条记录查看详情</div>}
      </section>
      </div>
    </div>
  );
}

function RecordEditor({ detail, owners, formTypes, fields, onSave, onCloneSystems, onConvert }: {
  detail: RecordDetail;
  owners: Array<{ systemName: string; ownerName: string }>;
  formTypes: FormType[];
  fields: FieldConfig[];
  onSave: (id: string, values: Record<string, unknown>) => Promise<void>;
  onCloneSystems: (id: string, systems: string[]) => Promise<void>;
  onConvert: (id: string, typeKey: string) => Promise<void>;
}) {
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [cloneSystem, setCloneSystem] = useState("");
  const [targetType, setTargetType] = useState("");
  const [saving, setSaving] = useState(false);
  const [cloning, setCloning] = useState(false);
  const [converting, setConverting] = useState(false);
  const editableFields = fields.filter((field) => field.visibleToBusiness);
  const extraSystemOptions = owners
    .map((owner) => owner.systemName)
    .filter((systemName) => systemName && systemName !== detail.systemName);
  const targetTypeOptions = formTypes.filter((type) => type.key !== detail.typeKey);

  useEffect(() => {
    setValues({ ...detail.values });
    setCloneSystem("");
    setTargetType("");
  }, [detail.id, detail.values]);

  return (
    <div className="record-edit-stack">
      <div className="record-tools">
        <div>
          <span>追加系统</span>
          <strong>为同一事项生成其他系统的独立记录，并自动匹配管理员。</strong>
        </div>
        <select value={cloneSystem} onChange={(event) => setCloneSystem(event.target.value)}>
          <option value="">选择系统</option>
          {extraSystemOptions.map((systemName) => <option key={systemName} value={systemName}>{systemName}</option>)}
        </select>
        <button type="button" disabled={!cloneSystem || cloning} onClick={async () => {
          setCloning(true);
          try {
            await onCloneSystems(detail.id, [cloneSystem]);
            setCloneSystem("");
          } finally {
            setCloning(false);
          }
        }}>{cloning ? "生成中..." : "生成记录"}</button>
        <div>
          <span>转换类型</span>
          <strong>业务选错时，可把当前记录转为其他提交类型。</strong>
        </div>
        <select value={targetType} onChange={(event) => setTargetType(event.target.value)}>
          <option value="">选择类型</option>
          {targetTypeOptions.map((type) => <option key={type.key} value={type.key}>{type.name}</option>)}
        </select>
        <button type="button" disabled={!targetType || converting} onClick={async () => {
          setConverting(true);
          try {
            await onConvert(detail.id, targetType);
            setTargetType("");
          } finally {
            setConverting(false);
          }
        }}>{converting ? "转换中..." : "转换"}</button>
      </div>
      <form className="edit-panel" onSubmit={async (event) => {
        event.preventDefault();
        setSaving(true);
        try {
          await onSave(detail.id, values);
        } finally {
          setSaving(false);
        }
      }}>
        <div className="edit-title"><PencilLine size={18} /><h3>IT 处理修改</h3></div>
      {editableFields.map((field) => (
        <DynamicField
          key={field.id}
          field={field.fieldKey === "system"
            ? { ...field, kind: "select", options: owners.map((owner) => owner.systemName) }
            : field.fieldKey === "status"
              ? { ...field, kind: "select", options: ["待处理", "处理中", "设计已完成", "开发已完成", "测试已完成", "部署已完成", "状态异常", "已延期", "已关闭"] }
              : field}
          value={values[field.fieldKey] ?? ""}
          onChange={(value) => setValues((current) => ({ ...current, [field.fieldKey]: value }))}
          onUpload={async (file) => {
            const uploaded = await api.uploadAttachment(file);
            setValues((current) => ({
              ...current,
              [field.fieldKey]: [...asAttachmentList(current[field.fieldKey]), uploaded]
            }));
          }}
        />
      ))}
        <button className="command compact-command" type="submit" disabled={saving}>
          {saving ? <LoaderCircle size={16} /> : <Save size={16} />}
          {saving ? "保存中..." : "保存修改"}
        </button>
      </form>
    </div>
  );
}

function AdminPanel() {
  const [fields, setFields] = useState<any[]>([]);
  const [formTypes, setFormTypes] = useState<FormType[]>([]);
  const [owners, setOwners] = useState<any[]>([]);
  const [adminMembers, setAdminMembers] = useState<any[]>([]);
  const [adminRecords, setAdminRecords] = useState<RecordSummary[]>([]);
  const [bitableLink, setBitableLink] = useState<BitableLink | null>(null);
  const [activeFormType, setActiveFormType] = useState("demand");
  const [newType, setNewType] = useState({ key: "", name: "", description: "" });
  const [newField, setNewField] = useState({
    label: "",
    kind: "text",
    required: false,
    visibleToBusiness: true,
    editableByBusiness: true,
    businessVisible: true,
    options: ""
  });
  const [newOwner, setNewOwner] = useState({ systemName: "", ownerName: "", ownerFeishuUserId: "", consultantNames: "" });
  const [ownerSearchResults, setOwnerSearchResults] = useState<FeishuUserSearchResult[]>([]);
  const [ownerSearchMessage, setOwnerSearchMessage] = useState("");
  const [memberSearchQuery, setMemberSearchQuery] = useState("");
  const [memberSearchResults, setMemberSearchResults] = useState<FeishuUserSearchResult[]>([]);
  const [memberSearchMessage, setMemberSearchMessage] = useState("");
  const [selectedMemberRole, setSelectedMemberRole] = useState<ElevatedRole>("system_owner");
  const [recordFilters, setRecordFilters] = useState({ typeKey: "", systemName: "", query: "" });
  const [selectedRecordIds, setSelectedRecordIds] = useState<string[]>([]);
  const [deletingRecords, setDeletingRecords] = useState(false);
  const [creatingOwner, setCreatingOwner] = useState(false);
  const [searchingOwner, setSearchingOwner] = useState(false);
  const [searchingMembers, setSearchingMembers] = useState(false);
  const [addingMemberId, setAddingMemberId] = useState<string | null>(null);
  const [savingConfig, setSavingConfig] = useState(false);
  const [importingConfig, setImportingConfig] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState("");
  const [draggingFieldId, setDraggingFieldId] = useState<string | null>(null);

  async function refreshAdmin() {
    Promise.all([api.formTypes(), api.fieldConfigs(), api.owners(), api.records(), api.adminMembers(), api.bitableLink().catch(() => null)])
      .then(([typeData, fieldData, ownerData, recordData, adminMemberData, bitableLinkData]) => {
        setFormTypes(typeData);
        setFields(fieldData);
        setOwners(ownerData);
        setAdminRecords(recordData);
        setAdminMembers(adminMemberData);
        setBitableLink(bitableLinkData);
      })
      .catch(() => undefined);
  }

  useEffect(() => {
    refreshAdmin();
  }, []);

  const configFields = fields
    .filter((field) => field.form_type_key === activeFormType)
    .sort((left, right) => Number(left.sort_order ?? 0) - Number(right.sort_order ?? 0));
  const formTypeName = new Map(formTypes.map((type) => [type.key, type.name]));
  const filteredAdminRecords = adminRecords.filter((record) => {
    if (recordFilters.typeKey && record.typeKey !== recordFilters.typeKey) return false;
    if (recordFilters.systemName && record.systemName !== recordFilters.systemName) return false;
    const keyword = recordFilters.query.trim();
    if (keyword && !`${record.recordNo ?? ""} ${record.title} ${record.submitterName} ${record.ownerName ?? ""}`.includes(keyword)) return false;
    return true;
  });
  const allFilteredSelected = filteredAdminRecords.length > 0 && filteredAdminRecords.every((record) => selectedRecordIds.includes(record.id));
  const superAdminCount = adminMembers.filter((member) => member.enabled && member.role === "admin").length;
  const itAdminCount = adminMembers.filter((member) => member.enabled && member.role !== "admin").length;

  function toggleRecord(id: string, checked: boolean) {
    setSelectedRecordIds((current) => checked ? [...new Set([...current, id])] : current.filter((item) => item !== id));
  }

  async function moveFieldBefore(draggedId: string, targetId: string) {
    if (draggedId === targetId) return;
    const currentIndex = configFields.findIndex((field) => field.id === draggedId);
    const targetIndex = configFields.findIndex((field) => field.id === targetId);
    if (currentIndex < 0 || targetIndex < 0) return;
    const reordered = [...configFields];
    const [dragged] = reordered.splice(currentIndex, 1);
    reordered.splice(targetIndex, 0, dragged);
    setFields((current) => current.map((field) => {
      const nextIndex = reordered.findIndex((item) => item.id === field.id);
      return nextIndex >= 0 ? { ...field, sort_order: nextIndex + 1 } : field;
    }));
    await Promise.all(reordered.map((field, index) => (
      Number(field.sort_order) === index + 1
        ? Promise.resolve()
        : api.updateFieldConfig(field.id, { sortOrder: index + 1 })
    )));
    await refreshAdmin();
  }

  async function downloadConfigBackup() {
    setSavingConfig(true);
    try {
      const backup = await api.exportConfig();
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `it-jiebangtai-config-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      setSyncResult("配置已导出，请妥善保存下载的 JSON 文件。");
    } finally {
      setSavingConfig(false);
    }
  }

  async function importConfigBackup(file: File) {
    setImportingConfig(true);
    try {
      const backup = JSON.parse(await file.text());
      const result = await api.importConfig(backup);
      setSyncResult(`配置已恢复：表单 ${result.formTypes}，字段 ${result.fieldConfigs}，系统管理员 ${result.systemOwners}，权限名单 ${result.adminMembers}，通知规则 ${result.notificationRules}`);
      await refreshAdmin();
    } catch (error) {
      setSyncResult(error instanceof Error ? `配置导入失败：${error.message}` : "配置导入失败，请检查 JSON 文件。");
    } finally {
      setImportingConfig(false);
    }
  }

  async function searchPermissionUsers(event?: React.FormEvent) {
    event?.preventDefault();
    const keyword = memberSearchQuery.trim();
    if (!keyword) {
      setMemberSearchMessage("请输入姓名、工号或关键词");
      setMemberSearchResults([]);
      return;
    }
    setSearchingMembers(true);
    setMemberSearchMessage("");
    try {
      const result = await api.searchFeishuUsers(keyword);
      setMemberSearchResults(result.users);
      setMemberSearchMessage(result.users.length ? `找到 ${result.users.length} 个匹配用户` : "没有找到匹配用户");
    } catch (error) {
      const message = error instanceof Error ? error.message : "搜索用户失败";
      setMemberSearchResults([]);
      setMemberSearchMessage(message.includes("missing_user_token") ? "需要用飞书重新登录后再搜索用户" : message);
    } finally {
      setSearchingMembers(false);
    }
  }

  async function assignPermissionUser(user: FeishuUserSearchResult) {
    setAddingMemberId(user.userId);
    try {
      await api.createAdminMember({
        name: user.name,
        feishuUserId: user.userId,
        employeeNo: user.userId,
        role: selectedMemberRole,
        note: user.department ?? null,
        enabled: true
      });
      setMemberSearchMessage(`${user.name} 已设为${roleLabel(selectedMemberRole)}`);
      await refreshAdmin();
    } finally {
      setAddingMemberId(null);
    }
  }

  async function searchOwnerForCreate() {
    const keyword = newOwner.ownerName.trim();
    if (!keyword) {
      setOwnerSearchMessage("请先填写系统管理员姓名");
      setOwnerSearchResults([]);
      return;
    }
    setSearchingOwner(true);
    setOwnerSearchMessage("");
    try {
      const result = await api.searchFeishuUsers(keyword);
      const exactUser = result.users.find((user) => user.name === keyword) ?? (result.users.length === 1 ? result.users[0] : null);
      if (exactUser) {
        setNewOwner((current) => ({
          ...current,
          ownerName: exactUser.name,
          ownerFeishuUserId: exactUser.userId
        }));
        setOwnerSearchResults([]);
        setOwnerSearchMessage(`${exactUser.name} 已匹配 user_id：${exactUser.userId}`);
      } else {
        setOwnerSearchResults(result.users);
        setOwnerSearchMessage(result.users.length ? `找到 ${result.users.length} 个候选，请选择系统管理员` : "没有找到匹配用户");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "搜索用户失败";
      setOwnerSearchResults([]);
      setOwnerSearchMessage(message.includes("missing_user_token") ? "需要用飞书重新登录后再匹配 user_id" : message);
    } finally {
      setSearchingOwner(false);
    }
  }

  function applyOwnerForCreate(user: FeishuUserSearchResult) {
    setNewOwner((current) => ({
      ...current,
      ownerName: user.name,
      ownerFeishuUserId: user.userId
    }));
    setOwnerSearchResults([]);
    setOwnerSearchMessage(`${user.name} 已匹配 user_id：${user.userId}`);
  }

  return (
    <div className="admin-grid">
      <section className="panel admin-wide config-backup-panel">
        <div className="panel-title admin-title-row">
          <div>
            <h2>配置备份</h2>
            <p>保存后台配置到本地 JSON；数据库或 Docker 卷异常后可导入恢复。</p>
          </div>
          <div className="backup-actions">
            {bitableLink?.url ? (
              <a
                className="sync-button secondary-sync-button"
                href={bitableLink.url}
                target="_blank"
                rel="noreferrer"
                title={bitableLink.message}
              >
                <ExternalLink size={16} />打开数据库多维表格
              </a>
            ) : (
              <button className="sync-button secondary-sync-button" type="button" disabled title={bitableLink?.message ?? "多维表格链接未配置"}>
                <ExternalLink size={16} />打开数据库多维表格
              </button>
            )}
            <button className="sync-button" type="button" disabled={savingConfig} onClick={downloadConfigBackup}>
              <Download size={16} />{savingConfig ? "保存中..." : "保存配置"}
            </button>
            <label className={importingConfig ? "sync-button disabled" : "sync-button"}>
              <UploadCloud size={16} />{importingConfig ? "导入中..." : "导入配置"}
              <input
                type="file"
                accept="application/json,.json"
                disabled={importingConfig}
                onChange={async (event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (!file) return;
                  await importConfigBackup(file);
                }}
              />
            </label>
          </div>
        </div>
      </section>
      <section className="panel admin-wide record-admin-panel">
        <div className="panel-title admin-title-row">
          <div>
            <h2>记录管理</h2>
            <p>仅超级管理员可批量删除记录；会同步清理多维表格，异常会写入审计日志。</p>
          </div>
          <button
            className="danger-command"
            type="button"
            disabled={!selectedRecordIds.length || deletingRecords}
            onClick={async () => {
              if (!selectedRecordIds.length) return;
              if (!window.confirm(`确认删除已选择的 ${selectedRecordIds.length} 条记录吗？`)) return;
              setDeletingRecords(true);
              try {
                const result = await api.bulkDeleteRecords(selectedRecordIds);
                setSyncResult(`记录删除完成：删除 ${result.deleted} / ${result.requested} 条，飞书清理警告 ${result.feishuWarnings} 条`);
                setSelectedRecordIds([]);
                await refreshAdmin();
              } finally {
                setDeletingRecords(false);
              }
            }}
          ><Trash2 size={16} />{deletingRecords ? "删除中..." : `删除所选 ${selectedRecordIds.length}`}</button>
        </div>
        <div className="record-admin-filters">
          <input value={recordFilters.query} onChange={(event) => setRecordFilters((current) => ({ ...current, query: event.target.value }))} placeholder="搜索编号、标题、提交人、管理员" />
          <select value={recordFilters.typeKey} onChange={(event) => setRecordFilters((current) => ({ ...current, typeKey: event.target.value }))}>
            <option value="">全部类型</option>
            {formTypes.map((type) => <option key={type.key} value={type.key}>{type.name}</option>)}
          </select>
          <select value={recordFilters.systemName} onChange={(event) => setRecordFilters((current) => ({ ...current, systemName: event.target.value }))}>
            <option value="">全部系统</option>
            {[...new Set(adminRecords.map((record) => record.systemName).filter(Boolean))].map((systemName) => <option key={systemName} value={systemName}>{systemName}</option>)}
          </select>
          <label><input type="checkbox" checked={allFilteredSelected} onChange={(event) => {
            if (event.target.checked) {
              setSelectedRecordIds((current) => [...new Set([...current, ...filteredAdminRecords.map((record) => record.id)])]);
            } else {
              const visibleIds = new Set(filteredAdminRecords.map((record) => record.id));
              setSelectedRecordIds((current) => current.filter((id) => !visibleIds.has(id)));
            }
          }} />全选当前筛选</label>
        </div>
        <div className="record-admin-list">
          {filteredAdminRecords.map((record) => (
            <label key={record.id} className="record-admin-row">
              <input type="checkbox" checked={selectedRecordIds.includes(record.id)} onChange={(event) => toggleRecord(record.id, event.target.checked)} />
              <strong>{record.title}</strong>
              <span>{record.recordNo ?? "未编号"} · {formTypeName.get(record.typeKey) ?? record.typeKey}</span>
              <span>{record.systemName} · {record.ownerName ?? "未分派"}</span>
              <em>{record.status}</em>
            </label>
          ))}
          {!filteredAdminRecords.length ? <p className="muted">暂无匹配记录</p> : null}
        </div>
      </section>
      <section className="panel admin-wide">
        <div className="panel-title admin-title-row">
          <div>
            <h2>提交表单配置</h2>
            <p>控制用户提交时显示哪些字段、哪些字段必填，配置会同时影响 Web 和小程序动态表单。</p>
          </div>
          <button className="sync-button" type="button" disabled={syncing} onClick={async () => {
            setSyncing(true);
            try {
              const result = await api.syncBitableSchema();
              setSyncResult(`已同步：更新 ${result.syncedFields} 个字段，新增 ${result.createdFields} 个字段，删除 ${result.removedFields} 个字段，删除 ${result.removedRecords} 条记录，禁用 ${result.disabledFormTypes.length} 个类型，导入 ${result.importedFormTypes.length} 个类型`);
              await refreshAdmin();
              if (result.disabledFormTypes.includes(formTypes.find((type) => type.key === activeFormType)?.name ?? "")) {
                setActiveFormType("demand");
              }
            } finally {
              setSyncing(false);
            }
          }}>{syncing ? "同步中..." : "从多维表格同步"}</button>
        </div>
        {syncResult ? <div className="sync-result">{syncResult}</div> : null}
        <div className="segmented">
          {formTypes.map((type) => (
            <button key={type.key} className={activeFormType === type.key ? "selected" : ""} onClick={() => setActiveFormType(type.key)}>{type.name}</button>
          ))}
        </div>
        <form className="admin-create-form" onSubmit={async (event) => {
          event.preventDefault();
          await api.createFormType({ ...newType, createBitableTable: true });
          setActiveFormType(newType.key);
          setNewType({ key: "", name: "", description: "" });
          await refreshAdmin();
        }}>
          <strong>新增提交类型</strong>
          <input value={newType.name} onChange={(event) => setNewType((current) => ({ ...current, name: event.target.value }))} placeholder="例如：创新工作室需求" required />
          <input value={newType.key} onChange={(event) => setNewType((current) => ({ ...current, key: event.target.value }))} placeholder="英文标识，例如 innovation" required />
          <input value={newType.description} onChange={(event) => setNewType((current) => ({ ...current, description: event.target.value }))} placeholder="说明" />
          <button type="submit">添加类型</button>
        </form>
        <form className="admin-create-form field-add-form" onSubmit={async (event) => {
          event.preventDefault();
          await api.createFieldConfig({
            formTypeKey: activeFormType,
            label: newField.label,
            kind: newField.kind,
            required: newField.required,
            visibleToBusiness: newField.visibleToBusiness,
            editableByBusiness: newField.editableByBusiness,
            businessVisible: newField.businessVisible,
            options: newField.options.split(/[,，\n]/).map((item) => item.trim()).filter(Boolean),
            createBitableField: true
          });
          setNewField({
            label: "",
            kind: "text",
            required: false,
            visibleToBusiness: true,
            editableByBusiness: true,
            businessVisible: true,
            options: ""
          });
          await refreshAdmin();
        }}>
          <strong>新增字段</strong>
          <input value={newField.label} onChange={(event) => setNewField((current) => ({ ...current, label: event.target.value }))} placeholder="字段名称" required />
          <select value={newField.kind} onChange={(event) => setNewField((current) => ({ ...current, kind: event.target.value }))}>
            <option value="text">文本</option>
            <option value="textarea">长文本</option>
            <option value="date">日期</option>
            <option value="select">选项</option>
            <option value="person">人员</option>
            <option value="attachment">附件</option>
            <option value="number">数字</option>
            <option value="boolean">布尔</option>
          </select>
          <input value={newField.options} onChange={(event) => setNewField((current) => ({ ...current, options: event.target.value }))} placeholder="选项值，用逗号分隔" />
          <label><input type="checkbox" checked={newField.visibleToBusiness} onChange={(event) => setNewField((current) => ({ ...current, visibleToBusiness: event.target.checked }))} />提交显示</label>
          <label><input type="checkbox" checked={newField.editableByBusiness} onChange={(event) => setNewField((current) => ({ ...current, editableByBusiness: event.target.checked }))} />提交可填</label>
          <label><input type="checkbox" checked={newField.required} onChange={(event) => setNewField((current) => ({ ...current, required: event.target.checked }))} />必填</label>
          <label><input type="checkbox" checked={newField.businessVisible} onChange={(event) => setNewField((current) => ({ ...current, businessVisible: event.target.checked }))} />详情摘要</label>
          <button type="submit">添加字段</button>
        </form>
        <div className="field-config-list">
          {configFields.map((field) => (
            <div
              key={field.id}
              className={draggingFieldId === field.id ? "field-config-row dragging" : "field-config-row"}
              onDragOver={(event) => event.preventDefault()}
              onDrop={async (event) => {
                event.preventDefault();
                const draggedId = event.dataTransfer.getData("text/plain") || draggingFieldId;
                if (draggedId) await moveFieldBefore(draggedId, field.id);
                setDraggingFieldId(null);
              }}
            >
              <span
                className="drag-handle"
                draggable
                onDragStart={(event) => {
                  setDraggingFieldId(field.id);
                  event.dataTransfer.setData("text/plain", field.id);
                  event.dataTransfer.effectAllowed = "move";
                }}
                onDragEnd={() => setDraggingFieldId(null)}
                title="拖动调整顺序"
              >
                <GripVertical size={16} />
              </span>
              <strong>{field.label}</strong>
              <span>{field.kind}</span>
              <label><input type="checkbox" checked={field.visible_to_business} onChange={async (event) => {
                await api.updateFieldConfig(field.id, { visibleToBusiness: event.target.checked });
                await refreshAdmin();
              }} />提交显示</label>
              <label><input type="checkbox" checked={field.editable_by_business} onChange={async (event) => {
                await api.updateFieldConfig(field.id, { editableByBusiness: event.target.checked });
                await refreshAdmin();
              }} />提交可填</label>
              <label><input type="checkbox" checked={field.required} onChange={async (event) => {
                await api.updateFieldConfig(field.id, { required: event.target.checked });
                await refreshAdmin();
              }} />必填</label>
              <label><input type="checkbox" checked={field.business_visible} onChange={async (event) => {
                await api.updateFieldConfig(field.id, { businessVisible: event.target.checked });
                await refreshAdmin();
              }} />详情摘要</label>
            </div>
          ))}
        </div>
      </section>
      <section className="panel admin-wide admin-member-panel">
        <div className="panel-title admin-title-row">
          <div>
            <h2>权限控制</h2>
            <p>超级管理员维护提权名单；名单外人员登录后默认为业务用户。</p>
          </div>
          <div className="role-counters">
            <span><Crown size={15} />超级管理员 {superAdminCount}</span>
            <span><ShieldCheck size={15} />IT管理员 {itAdminCount}</span>
          </div>
        </div>
        <form className="permission-search-form" onSubmit={searchPermissionUsers}>
          <div className="permission-search-box">
            <Search size={17} />
            <input value={memberSearchQuery} onChange={(event) => setMemberSearchQuery(event.target.value)} placeholder="搜索姓名、工号或关键词" />
          </div>
          <select value={selectedMemberRole} onChange={(event) => setSelectedMemberRole(event.target.value as ElevatedRole)}>
            <option value="system_owner">设为 IT管理员</option>
            <option value="admin">设为 超级管理员</option>
          </select>
          <button type="submit" disabled={searchingMembers}>{searchingMembers ? <LoaderCircle size={16} /> : <Search size={16} />}{searchingMembers ? "搜索中..." : "搜索用户"}</button>
        </form>
        {memberSearchMessage ? <div className="permission-search-message">{memberSearchMessage}</div> : null}
        {memberSearchResults.length ? (
          <div className="permission-search-results">
            {memberSearchResults.map((user) => (
              <button key={user.userId} type="button" onClick={() => assignPermissionUser(user)} disabled={addingMemberId === user.userId}>
                <UserPlus size={16} />
                <strong>{user.name}</strong>
                <span>{user.userId}</span>
                <em>{user.department ?? "未返回部门"}</em>
                <small>{addingMemberId === user.userId ? "添加中..." : roleLabel(selectedMemberRole)}</small>
              </button>
            ))}
          </div>
        ) : null}
        <div className="admin-list">
          {adminMembers.map((member) => <AdminMemberRow key={member.id} member={member} onSave={async (values) => {
            await api.updateAdminMember(member.id, values);
            await refreshAdmin();
          }} />)}
        </div>
      </section>
      <section className="panel admin-wide owner-admin-panel">
        <div className="panel-title"><h2>系统管理员配置</h2><p>按系统匹配信息数字化部管理员；可用飞书搜索自动匹配 user_id，未匹配时转彭涛。</p></div>
        <form className="owner-create-form" onSubmit={async (event) => {
          event.preventDefault();
          setCreatingOwner(true);
          try {
            await api.createOwner({
              systemName: newOwner.systemName,
              ownerName: newOwner.ownerName,
              ownerFeishuUserId: newOwner.ownerFeishuUserId || null,
              consultantNames: newOwner.consultantNames || null,
              enabled: true
            });
            setNewOwner({ systemName: "", ownerName: "", ownerFeishuUserId: "", consultantNames: "" });
            await refreshAdmin();
          } finally {
            setCreatingOwner(false);
          }
        }}>
          <input value={newOwner.systemName} onChange={(event) => setNewOwner((current) => ({ ...current, systemName: event.target.value }))} placeholder="系统名称" required />
          <input value={newOwner.ownerName} onChange={(event) => setNewOwner((current) => ({ ...current, ownerName: event.target.value }))} placeholder="管理员" required />
          <div className="owner-userid-cell">
            <input value={newOwner.ownerFeishuUserId} onChange={(event) => setNewOwner((current) => ({ ...current, ownerFeishuUserId: event.target.value }))} placeholder="user_id，可搜索匹配" />
            <button className="secondary-command owner-match-button" type="button" disabled={searchingOwner} onClick={searchOwnerForCreate}>
              {searchingOwner ? <LoaderCircle size={15} /> : <Search size={15} />}
              {searchingOwner ? "匹配中" : "匹配"}
            </button>
          </div>
          <input value={newOwner.consultantNames} onChange={(event) => setNewOwner((current) => ({ ...current, consultantNames: event.target.value }))} placeholder="顾问" />
          <button type="submit" disabled={creatingOwner}>{creatingOwner ? "新增中..." : "新增"}</button>
        </form>
        {ownerSearchMessage ? <div className="permission-search-message">{ownerSearchMessage}</div> : null}
        {ownerSearchResults.length ? (
          <div className="owner-match-results">
            {ownerSearchResults.map((user) => (
              <button key={user.userId} type="button" onClick={() => applyOwnerForCreate(user)}>
                <strong>{user.name}</strong>
                <span>{user.userId}</span>
                <em>{user.department ?? "未返回部门"}</em>
              </button>
            ))}
          </div>
        ) : null}
        <div className="admin-list">
          {owners.map((owner) => <OwnerRow key={owner.id} owner={owner} onSave={async (values) => {
            await api.updateOwner(owner.id, values);
            await refreshAdmin();
          }} />)}
        </div>
      </section>
    </div>
  );
}

function AdminMemberRow({ member, onSave }: {
  member: any;
  onSave: (values: Record<string, unknown>) => Promise<void>;
}) {
  const [saving, setSaving] = useState(false);
  const [values, setValues] = useState({
    name: member.name ?? "",
    feishuUserId: member.feishuUserId ?? "",
    employeeNo: member.employeeNo ?? "",
    role: (member.role ?? "system_owner") as ElevatedRole,
    note: member.note ?? "",
    enabled: member.enabled ?? true
  });

  useEffect(() => {
    setValues({
      name: member.name ?? "",
      feishuUserId: member.feishuUserId ?? "",
      employeeNo: member.employeeNo ?? "",
      role: (member.role ?? "system_owner") as ElevatedRole,
      note: member.note ?? "",
      enabled: member.enabled ?? true
    });
  }, [member]);

  return (
    <form className="owner-row admin-member-row" onSubmit={async (event) => {
      event.preventDefault();
      setSaving(true);
      try {
        await onSave(values);
      } finally {
        setSaving(false);
      }
    }}>
      {values.role === "admin" ? <Crown size={16} /> : <ShieldCheck size={16} />}
      <div className="permission-user-cell">
        <strong>{values.name}</strong>
        <span>{values.feishuUserId || "未绑定 user_id"}</span>
      </div>
      <label><span>角色</span><select value={values.role} onChange={(event) => setValues((current) => ({ ...current, role: event.target.value as ElevatedRole }))} aria-label={`${member.name}角色`}>
        <option value="system_owner">IT管理员</option>
        <option value="admin">超级管理员</option>
      </select></label>
      <label><span>工号</span><input value={values.employeeNo ?? ""} onChange={(event) => setValues((current) => ({ ...current, employeeNo: event.target.value }))} aria-label={`${member.name}工号`} placeholder="可选" /></label>
      <label><span>备注</span><input value={values.note ?? ""} onChange={(event) => setValues((current) => ({ ...current, note: event.target.value }))} aria-label={`${member.name}备注`} placeholder="所属小组" /></label>
      <label className="owner-enabled"><input type="checkbox" checked={values.enabled} onChange={(event) => setValues((current) => ({ ...current, enabled: event.target.checked }))} />启用</label>
      <button type="submit" disabled={saving}>{saving ? "保存中..." : "保存"}</button>
    </form>
  );
}

function OwnerRow({ owner, onSave }: {
  owner: any;
  onSave: (values: Record<string, unknown>) => Promise<void>;
}) {
  const [saving, setSaving] = useState(false);
  const [matching, setMatching] = useState(false);
  const [matchResults, setMatchResults] = useState<FeishuUserSearchResult[]>([]);
  const [matchMessage, setMatchMessage] = useState("");
  const [values, setValues] = useState({
    ownerName: owner.ownerName ?? "",
    ownerFeishuUserId: owner.ownerFeishuUserId ?? "",
    consultantNames: owner.consultantNames ?? "",
    enabled: owner.enabled ?? true
  });

  useEffect(() => {
    setValues({
      ownerName: owner.ownerName ?? "",
      ownerFeishuUserId: owner.ownerFeishuUserId ?? "",
      consultantNames: owner.consultantNames ?? "",
      enabled: owner.enabled ?? true
    });
  }, [owner]);

  async function applyMatchedUser(user: FeishuUserSearchResult) {
    const nextValues = {
      ...values,
      ownerName: user.name,
      ownerFeishuUserId: user.userId
    };
    setValues(nextValues);
    setMatchResults([]);
    setSaving(true);
    try {
      await onSave(nextValues);
      setMatchMessage(`${user.name} 已匹配并保存 user_id：${user.userId}`);
    } finally {
      setSaving(false);
    }
  }

  async function matchOwnerUser() {
    const keyword = values.ownerName.trim();
    if (!keyword) {
      setMatchMessage("请先填写系统管理员姓名");
      setMatchResults([]);
      return;
    }
    setMatching(true);
    setMatchMessage("");
    try {
      const result = await api.searchFeishuUsers(keyword);
      const exactUser = result.users.find((user) => user.name === keyword) ?? (result.users.length === 1 ? result.users[0] : null);
      if (exactUser) {
        await applyMatchedUser(exactUser);
      } else {
        setMatchResults(result.users);
        setMatchMessage(result.users.length ? `找到 ${result.users.length} 个候选，请选择` : "没有找到匹配用户");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "搜索用户失败";
      setMatchResults([]);
      setMatchMessage(message.includes("missing_user_token") ? "需要用飞书重新登录后再匹配 user_id" : message);
    } finally {
      setMatching(false);
    }
  }

  return (
    <form className="owner-row" onSubmit={async (event) => {
      event.preventDefault();
      setSaving(true);
      try {
        await onSave(values);
      } finally {
        setSaving(false);
      }
    }}>
      <ShieldCheck size={16} />
      <div className="owner-system-name"><span>系统</span><strong>{owner.systemName}</strong></div>
      <label><span>管理员</span><input value={values.ownerName} onChange={(event) => setValues((current) => ({ ...current, ownerName: event.target.value }))} aria-label={`${owner.systemName}管理员`} /></label>
      <div className="owner-userid-cell">
        <label><span>user_id</span><input value={values.ownerFeishuUserId ?? ""} onChange={(event) => setValues((current) => ({ ...current, ownerFeishuUserId: event.target.value }))} aria-label={`${owner.systemName}user_id`} placeholder="可搜索匹配" /></label>
        <button className="secondary-command owner-match-button" type="button" disabled={matching || saving} onClick={matchOwnerUser}>
          {matching ? <LoaderCircle size={15} /> : <Search size={15} />}
          {matching ? "匹配中" : "匹配"}
        </button>
      </div>
      <label><span>顾问</span><input value={values.consultantNames ?? ""} onChange={(event) => setValues((current) => ({ ...current, consultantNames: event.target.value }))} aria-label={`${owner.systemName}顾问`} placeholder="顾问" /></label>
      <label className="owner-enabled"><input type="checkbox" checked={values.enabled} onChange={(event) => setValues((current) => ({ ...current, enabled: event.target.checked }))} />启用</label>
      <button type="submit" disabled={saving}>{saving ? "保存中..." : "保存"}</button>
      {matchMessage ? <div className="owner-match-message">{matchMessage}</div> : null}
      {matchResults.length ? (
        <div className="owner-match-results">
          {matchResults.map((user) => (
            <button key={user.userId} type="button" onClick={() => applyMatchedUser(user)}>
              <strong>{user.name}</strong>
              <span>{user.userId}</span>
              <em>{user.department ?? "未返回部门"}</em>
            </button>
          ))}
        </div>
      ) : null}
    </form>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
