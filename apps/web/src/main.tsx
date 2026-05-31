import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { Bell, ClipboardList, Clock3, FilePlus2, Filter, LayoutDashboard, LogIn, MessageSquare, Paperclip, PencilLine, Save, Settings2, ShieldCheck, Sparkles, UploadCloud, UserRoundCog } from "lucide-react";
import type { CurrentUser, FieldConfig, FormType, RecordDetail, RecordSummary } from "@it/shared";
import { api, storeCurrentUser } from "./api";
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
          <span>关键节点会通知提交人与系统管理员。</span>
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
            selectedRecordId={selectedRecordId}
            detail={recordDetail}
            onSelect={setSelectedRecordId}
            onSave={async (id, values) => {
              await api.updateRecord(id, values);
              setToast("记录已更新");
              await refresh();
              setRecordDetail(await api.record(id));
            }}
            onComment={async (id, body) => {
              await api.addComment(id, body);
              setRecordDetail(await api.record(id));
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
  const loginWithFeishu = async () => {
    const oauth = await api.feishuOAuthUrl();
    if (!oauth.configured) {
      onToast("飞书应用 App ID 未配置");
      return;
    }
    window.location.href = oauth.url;
  };

  return (
    <div className="auth-badge">
      <div>
        <span>{user?.name ?? "未登录"}</span>
        <strong>{user?.role === "admin" ? "管理员" : user?.role === "system_owner" ? "系统管理员" : "业务用户"}</strong>
      </div>
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
      <p>登录后系统会按飞书身份判断提交人、系统管理员和管理员权限。</p>
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
    <div className="two-column">
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
      <section className="panel helper-panel">
        <h3>提交后自动完成</h3>
        <ul className="timeline-list">
          <li><span /><div className="timeline-copy">记录写入规范业务表</div></li>
          <li><span /><div className="timeline-copy">按所属系统匹配管理员</div></li>
          <li><span /><div className="timeline-copy">未匹配时转彭涛</div></li>
          <li><span /><div className="timeline-copy">通知提交人和系统管理员</div></li>
          <li><span /><div className="timeline-copy">生成审计与进度时间线</div></li>
        </ul>
      </section>
    </div>
  );
}

type AttachmentValue = { name: string; url: string; storedName?: string; mimeType?: string; size?: number };

function asAttachmentList(value: unknown): AttachmentValue[] {
  if (Array.isArray(value)) return value as AttachmentValue[];
  if (!value) return [];
  if (typeof value === "string") return value ? [{ name: value, url: value }] : [];
  return [];
}

function formatFieldValue(value: unknown) {
  if (Array.isArray(value)) {
    return value.map((item) => typeof item === "object" && item ? String((item as any).name ?? (item as any).url ?? "") : String(item)).filter(Boolean).join("、");
  }
  if (value && typeof value === "object") return JSON.stringify(value);
  return String(value ?? "");
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
            {asAttachmentList(value).length ? asAttachmentList(value).map((item, index) => (
              <span key={`${item.url}-${index}`}><Paperclip size={14} />{item.name}</span>
            )) : <em><UploadCloud size={14} />选择文件上传</em>}
          </div>
        </div>
      ) : null}
      {!["textarea", "select", "date", "number", "attachment"].includes(field.kind) ? <input {...common} /> : null}
    </label>
  );
}

function RecordsPanel({ records, formTypes, owners, fields, selectedRecordId, detail, onSelect, onSave, onComment }: {
  records: RecordSummary[];
  formTypes: FormType[];
  owners: Array<{ systemName: string; ownerName: string }>;
  fields: FieldConfig[];
  selectedRecordId: string | null;
  detail: RecordDetail | null;
  onSelect: (id: string) => void;
  onSave: (id: string, values: Record<string, unknown>) => Promise<void>;
  onComment: (id: string, body: string) => Promise<void>;
}) {
  const [comment, setComment] = useState("");
  const [editorOpen, setEditorOpen] = useState(false);
  const [filters, setFilters] = useState({ typeKey: "", systemName: "", ownerName: "" });
  const filteredRecords = records.filter((record) => {
    if (filters.typeKey && record.typeKey !== filters.typeKey) return false;
    if (filters.systemName && record.systemName !== filters.systemName) return false;
    if (filters.ownerName && record.ownerName !== filters.ownerName) return false;
    return true;
  });

  return (
    <div className="records-workbench">
      <section className="panel records-toolbar">
        <div className="toolbar-title"><Filter size={18} /><strong>记录筛选</strong><span>{filteredRecords.length} / {records.length}</span></div>
        <div className="filter-bar">
          <label><span>类型</span><select value={filters.typeKey} onChange={(event) => setFilters((current) => ({ ...current, typeKey: event.target.value }))}>
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
            <button key={record.id} className={selectedRecordId === record.id ? "record-row active" : "record-row"} onClick={() => onSelect(record.id)}>
              <span className="status-dot" data-status={record.status} />
              <strong>{record.title}</strong>
              <small>{record.typeKey === "demand" ? "需求" : "问题"} · {record.systemName} · {record.ownerName ?? "未分派"}</small>
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
                <p>{detail.systemName} · {detail.status} · {detail.ownerName ?? "未分派"}</p>
              </div>
              <MessageSquare size={22} />
            </div>
            <div className="value-grid">
              {fields.filter((field) => field.showInList || ["title", "system", "status", "description"].includes(field.fieldKey)).slice(0, 12).map((field) => (
                <div key={field.id}><span>{field.label}</span><strong>{formatFieldValue(detail.values[field.fieldKey])}</strong></div>
              ))}
            </div>
            <button className="command edit-open" type="button" onClick={() => setEditorOpen(true)}><PencilLine size={16} />打开完整字段编辑</button>
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
                    fields={fields}
                    onSave={async (id, values) => {
                      await onSave(id, values);
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
            <form className="comment-box" onSubmit={async (event) => {
              event.preventDefault();
              if (!comment.trim()) return;
              await onComment(detail.id, comment);
              setComment("");
            }}>
              <input value={comment} onChange={(event) => setComment(event.target.value)} placeholder="追加评论或补充说明" />
              <button type="submit">发送</button>
            </form>
          </>
        ) : <div className="empty">选择一条记录查看详情</div>}
      </section>
      </div>
    </div>
  );
}

function RecordEditor({ detail, owners, fields, onSave }: {
  detail: RecordDetail;
  owners: Array<{ systemName: string; ownerName: string }>;
  fields: FieldConfig[];
  onSave: (id: string, values: Record<string, unknown>) => Promise<void>;
}) {
  const [values, setValues] = useState<Record<string, unknown>>({});

  useEffect(() => {
    setValues({ ...detail.values });
  }, [detail.id, detail.values]);

  return (
    <form className="edit-panel" onSubmit={async (event) => {
      event.preventDefault();
      await onSave(detail.id, values);
    }}>
      <div className="edit-title"><PencilLine size={18} /><h3>IT 处理修改</h3></div>
      {fields.map((field) => (
        <DynamicField
          key={field.id}
          field={field.fieldKey === "system"
            ? { ...field, kind: "select", options: owners.map((owner) => owner.systemName) }
            : field.fieldKey === "status"
              ? { ...field, kind: "select", options: ["待处理", "进行中", "状态异常", "已延期", "已关闭"] }
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
  );
}

function AdminPanel() {
  const [fields, setFields] = useState<any[]>([]);
  const [formTypes, setFormTypes] = useState<FormType[]>([]);
  const [owners, setOwners] = useState<any[]>([]);
  const [requests, setRequests] = useState<any[]>([]);
  const [activeFormType, setActiveFormType] = useState("demand");
  const [newType, setNewType] = useState({ key: "", name: "", description: "" });
  const [newField, setNewField] = useState({ label: "", kind: "text", required: false, visibleToBusiness: true, editableByBusiness: true, showInList: false, options: "" });
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState("");

  async function refreshAdmin() {
    Promise.all([api.formTypes(), api.fieldConfigs(), api.owners(), api.accessRequests()])
      .then(([typeData, fieldData, ownerData, requestData]) => {
        setFormTypes(typeData);
        setFields(fieldData);
        setOwners(ownerData);
        setRequests(requestData);
      })
      .catch(() => undefined);
  }

  useEffect(() => {
    refreshAdmin();
  }, []);

  const configFields = fields.filter((field) => field.form_type_key === activeFormType);

  return (
    <div className="admin-grid">
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
              setSyncResult(`已同步：更新 ${result.syncedFields} 个字段，新增 ${result.createdFields} 个字段，删除 ${result.removedFields} 个字段，禁用 ${result.disabledFormTypes.length} 个类型，导入 ${result.importedFormTypes.length} 个类型`);
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
            <div key={field.id} className="field-config-row">
              <UserRoundCog size={16} />
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
      <section className="panel">
        <div className="panel-title"><h2>系统管理员</h2><p>按系统匹配负责人；未匹配时转彭涛。</p></div>
        <div className="admin-list">
          {owners.map((owner) => <div key={owner.id}><ShieldCheck size={16} /><span>{owner.systemName}</span><strong>{owner.ownerName}</strong><em>{owner.consultantNames ?? ""}</em></div>)}
        </div>
      </section>
      <section className="panel">
        <div className="panel-title"><h2>外部访问申请</h2><p>审批通过后外部用户可访问。</p></div>
        <div className="admin-list">
          {requests.length ? requests.map((request) => <div key={request.id}><Clock3 size={16} /><span>{request.status}</span><strong>{request.applicant_name}</strong><em>{request.reason}</em></div>) : <p className="muted">暂无申请</p>}
        </div>
      </section>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
