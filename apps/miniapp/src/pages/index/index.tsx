import { useEffect, useState } from "react";
import { Button, Input, Picker, Text, Textarea, View } from "@tarojs/components";
import Taro from "@tarojs/taro";
import type { FieldConfig, FormType } from "@it/shared";
import "./index.scss";

const API_BASE_URL = process.env.TARO_APP_API_BASE_URL ?? "http://localhost:4000";

type MiniRequestOptions = Omit<Taro.request.Option, "url">;

async function request<T>(path: string, options: MiniRequestOptions = {}) {
  const result = await Taro.request<T>({
    url: `${API_BASE_URL}${path}`,
    method: options.method ?? "GET",
    data: options.data,
    header: {
      "content-type": "application/json",
      "x-dev-user-id": "miniapp-dev-user",
      "x-dev-user-name": "小程序用户",
      "x-dev-role": "business",
      ...(options.header ?? {})
    }
  });
  return result.data;
}

export default function Index() {
  const [types, setTypes] = useState<FormType[]>([]);
  const [activeType, setActiveType] = useState("demand");
  const [fields, setFields] = useState<FieldConfig[]>([]);
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [userName, setUserName] = useState("小程序用户");

  useEffect(() => {
    loginWithFeishu().then((user) => {
      if (user?.name) setUserName(user.name);
    }).catch(() => undefined);
    request<FormType[]>("/api/form-types").then(setTypes);
  }, []);

  useEffect(() => {
    request<{ fields: FieldConfig[] }>(`/api/forms/${activeType}/config`).then((config) => {
      setFields(config.fields.filter((field) => field.visibleToBusiness && field.editableByBusiness));
      setValues({ status: "待处理" });
    });
  }, [activeType]);

  async function submit() {
    await request(`/api/records/${activeType}`, {
      method: "POST",
      data: { values }
    });
    Taro.showToast({ title: "已提交", icon: "success" });
  }

  return (
    <View className="page">
      <View className="hero">
        <Text className="eyebrow">IT WORKBENCH</Text>
        <Text className="title">统一提交入口</Text>
        <Text className="subtitle">{userName}，提交后自动匹配系统管理员，并记录进度与审计。</Text>
      </View>
      <View className="tabs">
        {types.map((type) => (
          <Button key={type.key} className={type.key === activeType ? "active" : ""} onClick={() => setActiveType(type.key)}>
            {type.name}
          </Button>
        ))}
      </View>
      <View className="form">
        {fields.map((field) => (
          <View key={field.id} className="field">
            <Text>{field.label}{field.required ? " *" : ""}</Text>
            {field.kind === "textarea" ? (
              <Textarea value={String(values[field.fieldKey] ?? "")} onInput={(event) => setValues((current) => ({ ...current, [field.fieldKey]: event.detail.value }))} />
            ) : field.kind === "select" ? (
              <Picker mode="selector" range={field.options} onChange={(event) => setValues((current) => ({ ...current, [field.fieldKey]: field.options[Number(event.detail.value)] }))}>
                <View className="picker">{String(values[field.fieldKey] ?? "请选择")}</View>
              </Picker>
            ) : (
              <Input value={String(values[field.fieldKey] ?? "")} onInput={(event) => setValues((current) => ({ ...current, [field.fieldKey]: event.detail.value }))} />
            )}
          </View>
        ))}
      </View>
      <Button className="submit" onClick={submit}>提交并自动分派</Button>
    </View>
  );
}

async function loginWithFeishu() {
  const ttApi = (globalThis as any).tt;
  if (!ttApi?.requestAccess) return null;
  const access = await new Promise<{ code?: string }>((resolve, reject) => {
    ttApi.requestAccess({
      success: resolve,
      fail: reject
    });
  });
  if (!access.code) return null;
  const result = await request<{ user: { name: string } }>("/api/auth/feishu/login", {
    method: "POST",
    data: { code: access.code }
  });
  return result.user;
}
