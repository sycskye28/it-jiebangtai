import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { Bell, ClipboardList, Clock3, Download, Eye, FilePlus2, Filter, GripVertical, LayoutDashboard, LogIn, MessageSquare, Paperclip, PencilLine, Save, Settings2, ShieldCheck, Sparkles, Trash2, UploadCloud } from "lucide-react";
import type { CurrentUser, FieldConfig, FormType, RecordDetail, RecordSummary } from "@it/shared";
import { API_BASE_URL, api, setDevIdentity, storeCurrentUser } from "./api";
import "./styles.css";

type ViewKey = "submit" | "records" | "admin";
const requireFeishuLogin = import.meta.env.VITE_REQUIRE_FEISHU_LOGIN !== "false";

function App() {
  const [view, setView] = useState<ViewKey>("submit");
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
    const code = new URLSearchParams(window.location.search).get("code");
    if (code) {
      api.loginFeishu(code)
        .then(({ user }) => {
          storeCurrentUser(user);
          setCurrentUser(user);
          window.history.replaceState({}, "", window.location.pathname);
          return refresh();
        })
        .catch((error) => setToast(error.message));
      return;
    }
    refresh().catch((error) => setToast(error.message));
  }, []);

  useEffect(() => {
    api.formConfig(activeType).then((config) => setFields(config.fields)).catch((error) => setToast(error.message));
  }, [activeType]);

  useEffect(() => {
    if (!selectedRecordId) {
      setRecordDetail(null);
      setDetailFields([]);
      return;
    }
    api.record(selectedRecordId).then(setRecordDetail).catch((error) => setToast(error.message));
  }, [selectedRecordId]);

  useEffect(() => {
    if (!recordDetail?.typeKey) return;
    api.formConfig(recordDetail.typeKey).then((config) => setDetailFields(config.fields)).catch((error) => setToast(error.message));
  }, [recordDetail?.id, recordDetail?.typeKey]);

  useEffect(() => {
    if (currentUser && currentUser.role !== "admin" && view === "admin") {
      setView("submit");
    }
  }, [currentUser, view]);

  const selectedType = formTypes.find((item) => item.key === activeType);
  const isAdmin = currentUser?.role === "admin";
  const stats = useMemo(() => {
    const open = records.filter((record) => record.status !== "已关闭").length;
    const delayed = records.filter((record) => record.status.includes("延期") || record.status.includes("异常")).length;
    const mine = records.length;
    return { open, delayed, mine };
  }, [records]);

  return (
    <main className="shell">
      <aside className="rail">
        <div className="brand">
          <div className="brand-mark"><Sparkles size={18} /></div>
          <div>
            <strong>IT 揭榜台</strong>
            <span>需求与问题管理</span>
          </div>
        </div>
        <button className={view === "submit" ? "nav active" : "nav"} onClick={() => setView("submit")}><FilePlus2 size={18} />提交</button>
        <button className={view === "records" ? "nav active" : "nav"} onClick={() => setView("records")}><ClipboardList size={18} />记录</button>
        {isAdmin ? <button className={view === "admin" ? "nav active" : "nav"} onClick={() => setView("admin")}><Settings2 size={18} />后台</button> : null}
        <div className="rail-card">
          <Bell size={18} />
          <span>关键节点会通知提交人与管理员。</span>
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">Feishu-ready workbench</p>
            <h1>{view === "submit" ? "统一提交入口" : view === "records" ? "进度追踪" : "配置后台"}</h1>
          </div>
          <div className="top-actions">
            <AuthBadge user={currentUser} onToast={setToast} />
          </div>
        </header>

        <section className="metrics">
          <Metric icon={<LayoutDashboard size={18} />} label="开放记录" value={stats.open} />
          <Metric icon={<Clock3 size={18} />} label="异常/延期" value={stats.delayed} />
          <Metric icon={<ShieldCheck size={18} />} label="可见记录" value={stats.mine} />
        </section>

        {loading ? <div className="empty">正在连接本地服务...</div> : null}
        {!loading && requireFeishuLogin && currentUser?.feishuUserId === "dev-admin" ? (
          <LoginRequiredPanel onToast={setToast} />
        ) : null}
        {!loading && view === "submit" ? (
          requireFeishuLogin && currentUser?.feishuUserId === "dev-admin" ? null :
          <SubmitPanel
            formTypes={formTypes}
            activeType={activeType}
            selectedType={selectedType}
            fields={fields}
            owners={owners}
            onTypeChange={setActiveType}
            onSubmit={async (values) => {
              const created = await api.createRecord(activeType, values);
              setToast(`已提交：${created.title}`);
              await refresh();
              setView("records");
              setSelectedRecordId(created.id);
            }}
          />
        ) : null}
        {!loading && view === "records" ? (
          requireFeishuLogin && currentUser?.feishuUserId === "dev-admin" ? null :
          <RecordsPanel
            records={records}
            formTypes={formTypes}
            owners={owners}
            fields={detailFields}
            currentUser={currentUser}
            selectedRecordId={selectedRecordId}
            detail={recordDetail}
            onSelect={setSelectedRecordId}
            onRefreshFields={async (typeKey) => {
              const config = await api.formConfig(typeKey);
              setDetailFields(config.fields);
              return config.fields;
            }}
            onSave={async (id, values) => {
              await api.updateRecord(id, values);
              setToast("记录已更新");
              await refresh();
              setRecordDetail(await api.record(id));
            }}
            onCloneSystems={async (id, systems) => {
              try {
                const created = await api.cloneRecordToSystems(id, systems);
                setToast(created.length ? `已生成 ${created.length} 条多系统记录` : "没有新增系统记录");
                await refresh();
                const nextId = created[0]?.id ?? id;
                setSelectedRecordId(nextId);
                setRecordDetail(await api.record(nextId));
              } catch (error) {
                setToast(error instanceof Error ? error.message : "追加系统失败");
                throw error;
              }
            }}
            onConvert={async (id, typeKey) => {
              try {
                const converted = await api.convertRecord(id, typeKey);
                setToast("提交类型已转换");
                const config = await api.formConfig(converted.typeKey);
                await refresh();
                setSelectedRecordId(id);
                setDetailFields(config.fields);
                const nextDetail = await api.record(id);
                setRecordDetail(nextDetail);
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
              const result = await api.syncBitableRecords();
              setToast(`已同步记录：导入 ${result.importedRecords} 条，清理本地 ${result.removedLocalRecords} 条`);
              setSelectedRecordId(null);
              setRecordDetail(null);
              await refresh();
            }}
          />
        ) : null}
        {!loading && view === "admin" ? (
          requireFeishuLogin && currentUser?.feishuUserId === "dev-admin" ? null :
          isAdmin ? <AdminPanel /> : <div className="empty">你当前没有后台管理权限。</div>
        ) : null}
      </section>
      {toast ? <button className="toast" onClick={() => setToast("")}>{toast}</button> : null}
    </main>
  );
}

function Metric({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return <div className="metric">{icon}<span>{label}</span><strong>{value}</strong></div>;
}

function AuthBadge({ user, onToast }: { user: CurrentUser | null; onToast: (message: string) => void }) {
  const [simulateOpen, setSimulateOpen] = useState(false);
  const simulationBackup = localStorage.getItem("superAdminSimulationBackup");
  const canSimulate = user?.role === "admin" || Boolean(simulationBackup);
  const simulationOptions = [
    { label: "管理员", feishuUserId: "a10986", name: "数字化部测试员", role: "system_owner", department: "信息数字化部" },
    { label: "业务人员", feishuUserId: "a10986", name: "业务测试用户", role: "business", department: "生产制造部" }
  ];
  const loginWithFeishu = async () => {
    const oauth = await api.feishuOAuthUrl();
    if (!oauth.configured) {
      onToast("飞书应用 App ID 未配置");
      return;
    }
    window.location.href = oauth.url;
  };
  const simulateIdentity = (identity: typeof simulationOptions[number]) => {
    if (!simulationBackup && user?.role === "admin") {
      localStorage.setItem("superAdminSimulationBackup", JSON.stringify({
        feishuUserId: user.feishuUserId,
        name: user.name,
        role: user.role,
        department: user.department ?? "信息数字化部"
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
        <strong>{user?.role === "admin" ? "超级管理员" : user?.role === "system_owner" ? "管理员" : "业务人员"}</strong>
      </div>
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
    const oauth = await api.feishuOAuthUrl();
    if (!oauth.configured) {
      onToast("飞书应用 App ID 未配置");
      return;
    }
    window.location.href = oauth.url;
  };

  return (
    <section className="panel login-panel">
      <ShieldCheck size={28} />
      <h2>需要飞书扫码登录</h2>
      <p>登录后系统会按飞书身份判断超级管理员、管理员和业务人员权限。</p>
      <button className="command" type="button" onClick={login}><LogIn size={18} />飞书扫码登录</button>
    </section>
  );
}

function SubmitPanel({ formTypes, activeType, selectedType, fields, owners, onTypeChange, onSubmit }: {
  formTypes: FormType[];
  activeType: string;
  selectedType?: FormType;
  fields: FieldConfig[];
  owners: Array<{ systemName: string; ownerName: string }>;
  onTypeChange: (type: string) => void;
  onSubmit: (values: Record<string, unknown>) => Promise<void>;
}) {
  const [values, setValues] = useState<Record<string, unknown>>({});
  const businessFields = fields.filter((field) => field.visibleToBusiness && field.editableByBusiness);

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
        <div className="segmented">
          {formTypes.map((type) => (
            <button key={type.key} className={activeType === type.key ? "selected" : ""} onClick={() => onTypeChange(type.key)}>{type.name}</button>
          ))}
        </div>
        <div className="panel-title">
          <h2>{selectedType?.name ?? "提交"}</h2>
          <p>{selectedType?.description}</p>
        </div>
        <form className="dynamic-form" onSubmit={async (event) => {
          event.preventDefault();
          await onSubmit(values);
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
          <button className="command" type="submit"><FilePlus2 size={18} />提交并自动分派</button>
        </form>
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
          fileToken: typeof object.fileToken === "string" ? object.fileToken : typeof object.file_token === "string" ? object.file_token : undefined
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
  if (item.url) {
    const separator = item.url.includes("?") ? "&" : "?";
    const previewPath = `${item.url}${separator}name=${encodedName}&disposition=inline`;
    const downloadPath = `${item.url}${separator}name=${encodedName}&disposition=attachment`;
    return { previewUrl: absoluteApiUrl(previewPath), downloadUrl: absoluteApiUrl(downloadPath) };
  }
  if (item.fileToken) {
    const base = `${API_BASE_URL}/api/feishu/attachments/${encodeURIComponent(item.fileToken)}/download?name=${encodedName}`;
    return {
      previewUrl: `${base}&disposition=inline`,
      downloadUrl: base
    };
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

function RecordsPanel({ records, formTypes, owners, fields, currentUser, selectedRecordId, detail, onSelect, onRefreshFields, onSave, onCloneSystems, onConvert, onComment, onSyncRecords }: {
  records: RecordSummary[];
  formTypes: FormType[];
  owners: Array<{ systemName: string; ownerName: string }>;
  fields: FieldConfig[];
  currentUser: CurrentUser | null;
  selectedRecordId: string | null;
  detail: RecordDetail | null;
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
    .filter((field) => field.showInList || ["title", "system", "status", "description"].includes(field.fieldKey));
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
        {detail ? (
          <>
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
            {editorOpen ? (
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
              </div>
            ) : null}
            <h3>时间线</h3>
            <ul className="timeline-list compact">
              {detail.timeline.map((item) => (
                <li key={item.id}>
                  <span />
                  <div className="timeline-copy">
                    <strong>{item.title}</strong>
                    <small>{item.body}</small>
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
          </>
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
        <button type="button" disabled={!cloneSystem} onClick={() => onCloneSystems(detail.id, [cloneSystem])}>生成记录</button>
        <div>
          <span>转换类型</span>
          <strong>业务选错时，可把当前记录转为其他提交类型。</strong>
        </div>
        <select value={targetType} onChange={(event) => setTargetType(event.target.value)}>
          <option value="">选择类型</option>
          {targetTypeOptions.map((type) => <option key={type.key} value={type.key}>{type.name}</option>)}
        </select>
        <button type="button" disabled={!targetType} onClick={() => onConvert(detail.id, targetType)}>转换</button>
      </div>
      <form className="edit-panel" onSubmit={async (event) => {
        event.preventDefault();
        await onSave(detail.id, values);
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
        <button className="command compact-command" type="submit"><Save size={16} />保存修改</button>
      </form>
    </div>
  );
}

function AdminPanel() {
  const [fields, setFields] = useState<any[]>([]);
  const [formTypes, setFormTypes] = useState<FormType[]>([]);
  const [owners, setOwners] = useState<any[]>([]);
  const [adminRecords, setAdminRecords] = useState<RecordSummary[]>([]);
  const [activeFormType, setActiveFormType] = useState("demand");
  const [newType, setNewType] = useState({ key: "", name: "", description: "" });
  const [newField, setNewField] = useState({ label: "", kind: "text", required: false, visibleToBusiness: true, editableByBusiness: true, showInList: false, options: "" });
  const [newOwner, setNewOwner] = useState({ systemName: "", ownerName: "", ownerFeishuUserId: "", consultantNames: "" });
  const [recordFilters, setRecordFilters] = useState({ typeKey: "", systemName: "", query: "" });
  const [selectedRecordIds, setSelectedRecordIds] = useState<string[]>([]);
  const [deletingRecords, setDeletingRecords] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState("");
  const [draggingFieldId, setDraggingFieldId] = useState<string | null>(null);

  async function refreshAdmin() {
    Promise.all([api.formTypes(), api.fieldConfigs(), api.owners(), api.records()])
      .then(([typeData, fieldData, ownerData, recordData]) => {
        setFormTypes(typeData);
        setFields(fieldData);
        setOwners(ownerData);
        setAdminRecords(recordData);
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

  return (
    <div className="admin-grid">
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
            showInList: newField.showInList,
            options: newField.options.split(/[,，\n]/).map((item) => item.trim()).filter(Boolean),
            createBitableField: true
          });
          setNewField({ label: "", kind: "text", required: false, visibleToBusiness: true, editableByBusiness: true, showInList: false, options: "" });
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
          <label><input type="checkbox" checked={newField.showInList} onChange={(event) => setNewField((current) => ({ ...current, showInList: event.target.checked }))} />详情摘要</label>
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
              <label><input type="checkbox" checked={field.show_in_list} onChange={async (event) => {
                await api.updateFieldConfig(field.id, { showInList: event.target.checked });
                await refreshAdmin();
              }} />详情摘要</label>
            </div>
          ))}
        </div>
      </section>
      <section className="panel admin-wide owner-admin-panel">
        <div className="panel-title"><h2>管理员配置</h2><p>按系统匹配信息数字化部管理员；未匹配时转彭涛。</p></div>
        <form className="owner-create-form" onSubmit={async (event) => {
          event.preventDefault();
          await api.createOwner({
            systemName: newOwner.systemName,
            ownerName: newOwner.ownerName,
            ownerFeishuUserId: newOwner.ownerFeishuUserId || null,
            consultantNames: newOwner.consultantNames || null,
            enabled: true
          });
          setNewOwner({ systemName: "", ownerName: "", ownerFeishuUserId: "", consultantNames: "" });
          await refreshAdmin();
        }}>
          <input value={newOwner.systemName} onChange={(event) => setNewOwner((current) => ({ ...current, systemName: event.target.value }))} placeholder="系统名称" required />
          <input value={newOwner.ownerName} onChange={(event) => setNewOwner((current) => ({ ...current, ownerName: event.target.value }))} placeholder="管理员" required />
          <input value={newOwner.ownerFeishuUserId} onChange={(event) => setNewOwner((current) => ({ ...current, ownerFeishuUserId: event.target.value }))} placeholder="user_id" />
          <input value={newOwner.consultantNames} onChange={(event) => setNewOwner((current) => ({ ...current, consultantNames: event.target.value }))} placeholder="顾问" />
          <button type="submit">新增</button>
        </form>
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

function OwnerRow({ owner, onSave }: {
  owner: any;
  onSave: (values: Record<string, unknown>) => Promise<void>;
}) {
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

  return (
    <form className="owner-row" onSubmit={async (event) => {
      event.preventDefault();
      await onSave(values);
    }}>
      <ShieldCheck size={16} />
      <div className="owner-system-name"><span>系统</span><strong>{owner.systemName}</strong></div>
      <label><span>管理员</span><input value={values.ownerName} onChange={(event) => setValues((current) => ({ ...current, ownerName: event.target.value }))} aria-label={`${owner.systemName}管理员`} /></label>
      <label><span>user_id</span><input value={values.ownerFeishuUserId ?? ""} onChange={(event) => setValues((current) => ({ ...current, ownerFeishuUserId: event.target.value }))} aria-label={`${owner.systemName}user_id`} placeholder="user_id" /></label>
      <label><span>顾问</span><input value={values.consultantNames ?? ""} onChange={(event) => setValues((current) => ({ ...current, consultantNames: event.target.value }))} aria-label={`${owner.systemName}顾问`} placeholder="顾问" /></label>
      <label className="owner-enabled"><input type="checkbox" checked={values.enabled} onChange={(event) => setValues((current) => ({ ...current, enabled: event.target.checked }))} />启用</label>
      <button type="submit">保存</button>
    </form>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
