/**
 * Model Settings dialog
 *
 * Multi-model management:
 *  - Top: list of external_models rows, each editable/deletable
 *  - Bottom: add/edit form with free-text provider (datalist suggestions)
 *  - Optional connectivity test before save
 *  - "Active model" concept removed — the model used for Q&A is determined
 *    by whichever model the user selects in the message input's model dropdown.
 */

"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, Input, Label, Modal, TextField } from "@heroui/react";
import {
  settingsGraphqlApi,
  externalModelGraphqlApi,
  type ExternalModelItem,
} from "@/api/graphql";

const PROVIDER_SUGGESTIONS: { name: string; baseUrl: string }[] = [
  { name: "SiliconFlow", baseUrl: "https://api.siliconflow.cn/v1" },
  { name: "OpenAI", baseUrl: "https://api.openai.com/v1" },
  { name: "DeepSeek", baseUrl: "https://api.deepseek.com/v1" },
  { name: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1" },
  { name: "Alibaba DashScope", baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1" },
  { name: "Zhipu AI", baseUrl: "https://open.bigmodel.cn/api/paas/v4" },
];

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
  const [models, setModels] = useState<ExternalModelItem[]>([]);

  const [editingId, setEditingId] = useState<number | null>(null);
  const [provider, setProvider] = useState<string>("");
  const [baseUrl, setBaseUrl] = useState<string>("");
  const [apiKey, setApiKey] = useState<string>("");
  const [modelName, setModelName] = useState<string>("");

  const [isLoading, setIsLoading] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState<number | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);

  const loadAll = useCallback(async () => {
    setIsLoading(true);
    setFeedback(null);
    try {
      const listRes = await externalModelGraphqlApi.listExternalModels();
      if (listRes.externalModels.success) {
        setModels(listRes.externalModels.models);
      }
    } catch (err) {
      console.error("Failed to load model data:", err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      void loadAll();
      setEditingId(null);
      setProvider("");
      setBaseUrl("");
      setApiKey("");
      setModelName("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const handleProviderInput = useCallback(
    (value: string) => {
      setProvider(value);
      const suggestion = PROVIDER_SUGGESTIONS.find(
        (s) => s.name.toLowerCase() === value.trim().toLowerCase(),
      );
      if (suggestion) {
        const isPresetUrl = PROVIDER_SUGGESTIONS.some(
          (s) => s.baseUrl === baseUrl,
        );
        if (!baseUrl || isPresetUrl) {
          setBaseUrl(suggestion.baseUrl);
        }
      }
    },
    [baseUrl],
  );

  const resetForm = useCallback(() => {
    setEditingId(null);
    setProvider("");
    setBaseUrl("");
    setApiKey("");
    setModelName("");
    setFeedback(null);
  }, []);

  const handleEdit = useCallback((m: ExternalModelItem) => {
    setEditingId(m.id);
    setProvider(m.provider);
    setBaseUrl(m.baseUrl);
    setApiKey(m.apiKey);
    setModelName(m.name);
    setFeedback(null);
  }, []);

  const handleTest = useCallback(async () => {
    if (isTesting || isSaving) return;
    if (!baseUrl.trim() || !apiKey.trim() || !modelName.trim()) {
      setFeedback({
        type: "error",
        text: "Please complete endpoint, API key and model name before testing",
      });
      return;
    }
    setIsTesting(true);
    setFeedback(null);
    try {
      const res = await settingsGraphqlApi.testConnection({
        baseUrl: baseUrl.trim(),
        apiKey: apiKey.trim(),
        modelName: modelName.trim(),
      });
      const { success, message } = res.testConnection;
      setFeedback({
        type: success ? "success" : "error",
        text: success ? `Connection OK — ${message}` : message,
      });
    } catch (err) {
      setFeedback({
        type: "error",
        text:
          err instanceof Error
            ? err.message
            : "Test failed, please try again later",
      });
    } finally {
      setIsTesting(false);
    }
  }, [apiKey, baseUrl, isSaving, isTesting, modelName]);

  const handleSave = useCallback(async () => {
    if (isSaving) return;
    if (!provider.trim() || !baseUrl.trim() || !apiKey.trim() || !modelName.trim()) {
      setFeedback({
        type: "error",
        text: "Please complete provider, endpoint, API key and model name",
      });
      return;
    }
    setIsSaving(true);
    setFeedback(null);
    try {
      const res = await externalModelGraphqlApi.saveExternalModel({
        id: editingId,
        provider: provider.trim(),
        baseUrl: baseUrl.trim(),
        apiKey: apiKey.trim(),
        modelName: modelName.trim(),
        testConnection: true,
      });
      const { success, message } = res.saveExternalModel;
      setFeedback({ type: success ? "success" : "error", text: message });
      if (success) {
        onSaved?.();
        await loadAll();
        resetForm();
      }
    } catch (err) {
      setFeedback({
        type: "error",
        text:
          err instanceof Error ? err.message : "Save failed, please try again",
      });
    } finally {
      setIsSaving(false);
    }
  }, [apiKey, baseUrl, editingId, isSaving, loadAll, modelName, onSaved, provider, resetForm]);

  const handleDelete = useCallback(
    async (m: ExternalModelItem) => {
      if (isDeleting !== null) return;
      setIsDeleting(m.id);
      setFeedback(null);
      try {
        const res = await externalModelGraphqlApi.deleteExternalModel(m.id);
        const { success, message } = res.deleteExternalModel;
        if (success) {
          setFeedback({ type: "success", text: message });
          if (editingId === m.id) resetForm();
          await loadAll();
          onSaved?.();
        } else {
          setFeedback({ type: "error", text: message });
        }
      } catch (err) {
        setFeedback({
          type: "error",
          text:
            err instanceof Error
              ? err.message
              : "Delete failed, please try again",
        });
      } finally {
        setIsDeleting(null);
      }
    },
    [editingId, isDeleting, loadAll, onSaved, resetForm],
  );

  const formIsEditing = editingId !== null;

  return (
    <Modal.Backdrop isOpen={isOpen} onOpenChange={onOpenChange}>
      <Modal.Container>
        <Modal.Dialog className="sm:max-w-[720px]">
          <Modal.CloseTrigger />
          <Modal.Header>
            <Modal.Heading>Model Settings</Modal.Heading>
          </Modal.Header>
          <Modal.Body>
            {isLoading ? (
              <p className="text-sm" style={{ color: "var(--fg3)" }}>
                Loading...
              </p>
            ) : (
              <div className="flex flex-col gap-5">
                {/* ── Model List ── */}
                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <p className="label-section">My Models</p>
                    {models.length > 0 && (
                      <span
                        className="font-text"
                        style={{ fontSize: "11px", color: "var(--fg4)" }}
                      >
                        {models.length} model{models.length !== 1 ? "s" : ""}
                      </span>
                    )}
                  </div>

                  {models.length === 0 ? (
                    <div
                      className="rounded-xl px-4 py-6 text-center"
                      style={{
                        background: "var(--surface-1)",
                        border: "0.5px solid var(--divider)",
                      }}
                    >
                      <p
                        className="font-text"
                        style={{ fontSize: "13px", color: "var(--fg3)" }}
                      >
                        No models yet — add one below
                      </p>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-1.5">
                      {models.map((m) => {
                        const isThisDeleting = isDeleting === m.id;
                        return (
                          <div
                            key={m.id}
                            className="flex items-center gap-3 px-3.5 py-2.5 rounded-xl"
                            style={{
                              background: "var(--surface-2)",
                              border: "0.5px solid var(--divider)",
                            }}
                          >
                            <div className="flex-1 min-w-0">
                              <span
                                className="font-text truncate block"
                                style={{
                                  fontSize: "13px",
                                  fontWeight: 600,
                                  color: "var(--fg1)",
                                }}
                              >
                                {m.name}
                              </span>
                              <span
                                className="font-text truncate block"
                                style={{
                                  fontSize: "11px",
                                  color: "var(--fg3)",
                                }}
                              >
                                {m.provider} · {m.baseUrl}
                              </span>
                            </div>

                            <Button
                              variant="ghost"
                              size="sm"
                              onPress={() => handleEdit(m)}
                              isDisabled={isThisDeleting}
                              className="text-xs shrink-0"
                            >
                              Edit
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onPress={() => handleDelete(m)}
                              isDisabled={isThisDeleting}
                              className="text-xs shrink-0"
                              aria-label="Delete model"
                            >
                              {isThisDeleting ? "..." : "Delete"}
                            </Button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  <p
                    className="font-text"
                    style={{
                      fontSize: "11px",
                      color: "var(--fg4)",
                      marginTop: "4px",
                    }}
                  >
                    Select a model in the chat input dropdown to use it for Q&A
                  </p>
                </div>

                {/* ── Add / Edit Form ── */}
                <div
                  className="flex flex-col gap-3 rounded-xl px-4 py-4"
                  style={{
                    background: "var(--surface-1)",
                    border: "0.5px solid var(--divider)",
                  }}
                >
                  <div className="flex items-center justify-between">
                    <p className="label-section">
                      {formIsEditing ? "Edit Model" : "Add New Model"}
                    </p>
                    {formIsEditing && (
                      <button
                        type="button"
                        onClick={resetForm}
                        className="font-text"
                        style={{
                          fontSize: "11px",
                          color: "var(--fg3)",
                          textDecoration: "underline",
                        }}
                      >
                        Cancel edit
                      </button>
                    )}
                  </div>

                  <TextField fullWidth className="flex flex-col gap-1.5">
                    <Label className="text-sm font-medium">Model Provider</Label>
                    <Input
                      list="model-provider-suggestions"
                      placeholder="e.g. SiliconFlow, OpenAI, or any custom name"
                      value={provider}
                      onChange={(e) => handleProviderInput(e.target.value)}
                    />
                    <datalist id="model-provider-suggestions">
                      {PROVIDER_SUGGESTIONS.map((s) => (
                        <option key={s.name} value={s.name}>
                          {s.baseUrl}
                        </option>
                      ))}
                    </datalist>
                  </TextField>

                  <TextField fullWidth className="flex flex-col gap-1.5">
                    <Label className="text-sm font-medium">
                      Endpoint (base_url)
                    </Label>
                    <Input
                      placeholder="https://api.example.com/v1"
                      value={baseUrl}
                      onChange={(e) => setBaseUrl(e.target.value)}
                    />
                  </TextField>

                  <TextField fullWidth className="flex flex-col gap-1.5">
                    <Label className="text-sm font-medium">API-KEY</Label>
                    <Input
                      type="text"
                      placeholder="sk-..."
                      value={apiKey}
                      onChange={(e) => setApiKey(e.target.value)}
                    />
                  </TextField>

                  <TextField fullWidth className="flex flex-col gap-1.5">
                    <Label className="text-sm font-medium">Model Name</Label>
                    <Input
                      placeholder="e.g. zai-org/GLM-5.2"
                      value={modelName}
                      onChange={(e) => setModelName(e.target.value)}
                    />
                  </TextField>

                  <div className="flex items-center justify-between mt-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onPress={handleTest}
                      isDisabled={isSaving || isTesting}
                    >
                      {isTesting ? "Testing..." : "Test Connection"}
                    </Button>
                    <Button
                      variant="primary"
                      size="sm"
                      onPress={handleSave}
                      isDisabled={isSaving || isTesting}
                    >
                      {isSaving
                        ? "Testing & Saving..."
                        : formIsEditing
                          ? "Update Model"
                          : "Save Model"}
                    </Button>
                  </div>
                </div>

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
            <Button
              slot="close"
              variant="tertiary"
              isDisabled={isSaving || isTesting}
            >
              Close
            </Button>
          </Modal.Footer>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}
