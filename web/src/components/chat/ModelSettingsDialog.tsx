/**
 * 模型设置弹窗
 * 支持选择模型厂商、自定义 base_url / API-Key / 模型名称；
 * 点击保存后由后端进行连通性检测，通过才落库，结果在弹窗内即时反馈。
 */

"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Button,
  Input,
  Label,
  ListBox,
  Modal,
  Select,
  TextField,
} from "@heroui/react";
import { settingsGraphqlApi } from "@/api/graphql";

// 厂商预设（OpenAI 兼容接口）；选择后自动带出默认 base_url，仍可手动修改
const PROVIDER_PRESETS: { value: string; label: string; baseUrl: string }[] = [
  {
    value: "siliconflow",
    label: "硅基流动 SiliconFlow",
    baseUrl: "https://api.siliconflow.cn/v1",
  },
  { value: "openai", label: "OpenAI", baseUrl: "https://api.openai.com/v1" },
  { value: "deepseek", label: "DeepSeek", baseUrl: "https://api.deepseek.com/v1" },
  {
    value: "openrouter",
    label: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
  },
  {
    value: "dashscope",
    label: "阿里百炼 DashScope",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
  },
  {
    value: "zhipu",
    label: "智谱 AI",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
  },
  { value: "custom", label: "自定义", baseUrl: "" },
];

const DEFAULT_PROVIDER = PROVIDER_PRESETS[0];

interface ModelSettingsDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved?: () => void;
}

type Feedback = { type: "success" | "error"; text: string } | null;

export function ModelSettingsDialog({
  isOpen,
  onOpenChange,
  onSaved,
}: ModelSettingsDialogProps) {
  const [provider, setProvider] = useState<string>(DEFAULT_PROVIDER.value);
  const [baseUrl, setBaseUrl] = useState<string>(DEFAULT_PROVIDER.baseUrl);
  const [apiKey, setApiKey] = useState<string>("");
  const [modelName, setModelName] = useState<string>("");
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);

  // 打开弹窗时加载已保存的设置
  useEffect(() => {
    if (!isOpen) return;

    setFeedback(null);
    setIsLoading(true);

    settingsGraphqlApi
      .getModelSettings()
      .then((res) => {
        const settings = res.getModelSettings.settings;
        if (settings) {
          setProvider(
            PROVIDER_PRESETS.some((p) => p.value === settings.provider)
              ? settings.provider
              : "custom",
          );
          setBaseUrl(settings.baseUrl);
          setApiKey(settings.apiKey);
          setModelName(settings.modelName);
        }
      })
      .catch((err) => {
        console.error("加载模型设置失败:", err);
      })
      .finally(() => setIsLoading(false));
  }, [isOpen]);

  const handleProviderChange = useCallback((key: string) => {
    setProvider(key);
    const preset = PROVIDER_PRESETS.find((p) => p.value === key);
    if (preset && preset.baseUrl) {
      setBaseUrl(preset.baseUrl);
    }
  }, []);

  const handleSave = useCallback(async () => {
    if (isSaving) return;

    if (!provider || !baseUrl.trim() || !apiKey.trim() || !modelName.trim()) {
      setFeedback({ type: "error", text: "请完整填写厂商、访问地址、API-KEY 与模型名称" });
      return;
    }

    setIsSaving(true);
    setFeedback(null);

    try {
      const res = await settingsGraphqlApi.saveModelSettings({
        provider,
        baseUrl: baseUrl.trim(),
        apiKey: apiKey.trim(),
        modelName: modelName.trim(),
      });

      const { success, message } = res.saveModelSettings;
      setFeedback({ type: success ? "success" : "error", text: message });

      if (success) {
        onSaved?.();
        // 成功后稍作停留让用户看到检测结果，再自动关闭
        setTimeout(() => onOpenChange(false), 1200);
      }
    } catch (err) {
      setFeedback({
        type: "error",
        text: err instanceof Error ? err.message : "保存失败，请稍后重试",
      });
    } finally {
      setIsSaving(false);
    }
  }, [apiKey, baseUrl, isSaving, modelName, onOpenChange, onSaved, provider]);

  return (
    <Modal.Backdrop isOpen={isOpen} onOpenChange={onOpenChange}>
      <Modal.Container>
        <Modal.Dialog className="sm:max-w-[440px]">
          <Modal.CloseTrigger />
          <Modal.Header>
            <Modal.Heading>模型设置</Modal.Heading>
          </Modal.Header>
          <Modal.Body>
            {isLoading ? (
              <p className="text-sm" style={{ color: "var(--fg3)" }}>
                加载已保存的设置...
              </p>
            ) : (
              <div className="flex flex-col gap-4">
                {/* 模型厂商 */}
                <div className="flex flex-col gap-1.5">
                  <Label className="text-sm font-medium">模型厂商</Label>
                  <Select
                    aria-label="模型厂商"
                    value={provider}
                    onChange={(key) =>
                      handleProviderChange(key ? String(key) : "custom")
                    }
                    variant="secondary"
                    className="w-full"
                  >
                    <Select.Trigger className="h-11 px-2 w-full flex items-center">
                      <Select.Value className="!flex !flex-1 !min-w-0 h-9 text-sm px-2.5 !items-center rounded-md font-medium truncate bg-default/60 text-foreground">
                        {({ selectedText }) => (
                          <span className="block w-full truncate">
                            {selectedText}
                          </span>
                        )}
                      </Select.Value>
                    </Select.Trigger>
                    <Select.Popover>
                      <ListBox>
                        {PROVIDER_PRESETS.map((p) => (
                          <ListBox.Item
                            key={p.value}
                            id={p.value}
                            textValue={p.label}
                          >
                            {({ isSelected }) => (
                              <span className="flex items-center gap-2 w-full">
                                <span
                                  className={`inline-block w-2 h-2 rounded-full shrink-0 transition-opacity ${
                                    isSelected
                                      ? "bg-green-500 opacity-100"
                                      : "opacity-0"
                                  }`}
                                />
                                <span className="flex-1">{p.label}</span>
                              </span>
                            )}
                          </ListBox.Item>
                        ))}
                      </ListBox>
                    </Select.Popover>
                  </Select>
                </div>

                {/* 访问地址 */}
                <TextField fullWidth className="flex flex-col gap-1.5">
                  <Label className="text-sm font-medium">访问地址 (base_url)</Label>
                  <Input
                    placeholder="https://api.example.com/v1"
                    value={baseUrl}
                    onChange={(e) => setBaseUrl(e.target.value)}
                  />
                </TextField>

                {/* API-KEY */}
                <TextField fullWidth className="flex flex-col gap-1.5">
                  <Label className="text-sm font-medium">API-KEY</Label>
                  <Input
                    type="text"
                    placeholder="sk-..."
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                  />
                </TextField>

                {/* 模型名称 */}
                <TextField fullWidth className="flex flex-col gap-1.5">
                  <Label className="text-sm font-medium">模型名称</Label>
                  <Input
                    placeholder="如 Pro/zai-org/GLM-5"
                    value={modelName}
                    onChange={(e) => setModelName(e.target.value)}
                  />
                </TextField>

                {/* 连通性检测 / 保存结果反馈 */}
                {feedback && (
                  <div
                    className="text-sm rounded-lg px-3 py-2 leading-relaxed"
                    style={
                      feedback.type === "success"
                        ? {
                            background: "rgba(34, 197, 94, 0.10)",
                            color: "#16a34a",
                          }
                        : {
                            background: "var(--error-bg)",
                            color: "var(--error)",
                          }
                    }
                  >
                    {feedback.text}
                  </div>
                )}
              </div>
            )}
          </Modal.Body>
          <Modal.Footer>
            <Button slot="close" variant="tertiary" isDisabled={isSaving}>
              取消
            </Button>
            <Button
              variant="primary"
              onPress={handleSave}
              isDisabled={isSaving || isLoading}
            >
              {isSaving ? "连通性检测中..." : "保存"}
            </Button>
          </Modal.Footer>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}
