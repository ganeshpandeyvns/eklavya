"use client";

import { useState, useEffect } from "react";
import {
  Settings,
  Database,
  Bell,
  DollarSign,
  Key,
  Save,
  Loader2,
  CheckCircle,
  AlertCircle,
  RefreshCw,
  Wifi,
  WifiOff,
  Volume2,
  VolumeX,
  Mail,
  Smartphone,
  Moon,
  Sun,
  Clock,
} from "lucide-react";
import { cn, formatCurrency } from "@/lib/utils";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

// Types
interface NotificationSettings {
  critical: { email: boolean; push: boolean; sms: boolean };
  needsInput: { email: boolean; push: boolean; sms: boolean };
  info: { email: boolean; push: boolean };
  silent: { log: boolean };
}

interface DatabaseStatus {
  connected: boolean;
  host: string;
  database: string;
  poolSize: number;
  activeConnections: number;
  idleConnections: number;
}

interface BudgetDefaults {
  defaultBudgetUsd: number;
  defaultTokenLimit: number;
  defaultTimeHours: number;
  maxConcurrentAgents: number;
}

interface ModelPricing {
  model: string;
  provider: string;
  inputPricePer1k: number;
  outputPricePer1k: number;
  cachedInputPricePer1k?: number;
  cachedOutputPricePer1k?: number;
}

type AvailabilityMode = "active" | "busy" | "away" | "dnd";

const availabilityModes: {
  key: AvailabilityMode;
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
}[] = [
  {
    key: "active",
    label: "Active",
    description: "Full notifications",
    icon: Sun,
    color: "bg-green-500",
  },
  {
    key: "busy",
    label: "Busy",
    description: "Urgent only",
    icon: Clock,
    color: "bg-yellow-500",
  },
  {
    key: "away",
    label: "Away",
    description: "Critical only, agents keep working",
    icon: Moon,
    color: "bg-blue-500",
  },
  {
    key: "dnd",
    label: "Do Not Disturb",
    description: "Emergencies only",
    icon: VolumeX,
    color: "bg-red-500",
  },
];

function SettingsSection({
  title,
  description,
  icon: Icon,
  children,
}: {
  title: string;
  description?: string;
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
      <div className="bg-gray-50 px-6 py-4 border-b border-gray-200">
        <div className="flex items-center gap-3">
          <Icon className="h-5 w-5 text-gray-500" />
          <div>
            <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
            {description && (
              <p className="text-sm text-gray-500">{description}</p>
            )}
          </div>
        </div>
      </div>
      <div className="p-6">{children}</div>
    </div>
  );
}

function Toggle({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={() => !disabled && onChange(!checked)}
      disabled={disabled}
      className={cn(
        "relative inline-flex h-6 w-11 items-center rounded-full transition-colors",
        checked ? "bg-blue-600" : "bg-gray-200",
        disabled && "opacity-50 cursor-not-allowed"
      )}
    >
      <span
        className={cn(
          "inline-block h-4 w-4 transform rounded-full bg-white transition-transform",
          checked ? "translate-x-6" : "translate-x-1"
        )}
      />
    </button>
  );
}

export default function SettingsPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // State for settings
  const [availability, setAvailability] = useState<AvailabilityMode>("active");
  const [notifications, setNotifications] = useState<NotificationSettings>({
    critical: { email: true, push: true, sms: true },
    needsInput: { email: true, push: true, sms: false },
    info: { email: false, push: true },
    silent: { log: true },
  });
  const [budgetDefaults, setBudgetDefaults] = useState<BudgetDefaults>({
    defaultBudgetUsd: 100,
    defaultTokenLimit: 1000000,
    defaultTimeHours: 24,
    maxConcurrentAgents: 10,
  });
  const [dbStatus, setDbStatus] = useState<DatabaseStatus | null>(null);
  const [modelPricing, setModelPricing] = useState<ModelPricing[]>([]);

  useEffect(() => {
    async function loadSettings() {
      try {
        setLoading(true);

        // Load notification settings
        const notifRes = await fetch(`${API_BASE}/api/settings/notifications`);
        if (notifRes.ok) {
          const data = await notifRes.json();
          if (data.settings) {
            setNotifications(data.settings);
          }
          if (data.availability) {
            setAvailability(data.availability);
          }
        }

        // Load model pricing
        const pricingRes = await fetch(`${API_BASE}/api/costs/pricing`);
        if (pricingRes.ok) {
          const data = await pricingRes.json();
          setModelPricing(data.models || []);
        }

        // Load health/db status
        const healthRes = await fetch(`${API_BASE}/api/health`);
        if (healthRes.ok) {
          const data = await healthRes.json();
          if (data.database) {
            setDbStatus({
              connected: data.database.connected || data.status === "ok",
              host: data.database.host || "localhost",
              database: data.database.database || "eklavya",
              poolSize: data.database.poolSize || 100,
              activeConnections: data.database.activeConnections || 0,
              idleConnections: data.database.idleConnections || 0,
            });
          } else {
            setDbStatus({
              connected: data.status === "ok",
              host: "localhost",
              database: "eklavya",
              poolSize: 100,
              activeConnections: 0,
              idleConnections: 0,
            });
          }
        }
      } catch (err) {
        console.error("Failed to load settings:", err);
      } finally {
        setLoading(false);
      }
    }

    loadSettings();
  }, []);

  const saveNotificationSettings = async () => {
    try {
      setSaving(true);
      setError(null);

      const res = await fetch(`${API_BASE}/api/settings/notifications`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settings: notifications }),
      });

      if (!res.ok) {
        throw new Error("Failed to save notification settings");
      }

      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const updateAvailability = async (mode: AvailabilityMode) => {
    try {
      setAvailability(mode);

      const res = await fetch(`${API_BASE}/api/settings/availability`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ availability: mode }),
      });

      if (!res.ok) {
        throw new Error("Failed to update availability");
      }
    } catch (err) {
      console.error("Failed to update availability:", err);
    }
  };

  const updateNotification = (
    level: keyof NotificationSettings,
    channel: string,
    value: boolean
  ) => {
    setNotifications((prev) => ({
      ...prev,
      [level]: {
        ...prev[level],
        [channel]: value,
      },
    }));
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6 animate-in max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gray-100">
            <Settings className="h-6 w-6 text-gray-600" />
          </div>
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Settings</h1>
            <p className="text-sm text-gray-500">Configure your Eklavya instance</p>
          </div>
        </div>
        {saved && (
          <span className="flex items-center gap-2 text-green-600 text-sm">
            <CheckCircle className="h-4 w-4" />
            Saved
          </span>
        )}
      </div>

      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 p-4 flex items-center gap-3">
          <AlertCircle className="h-5 w-5 text-red-500" />
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {/* Availability Mode */}
      <SettingsSection
        title="Availability"
        description="Control when you receive notifications"
        icon={Volume2}
      >
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {availabilityModes.map((mode) => (
            <button
              key={mode.key}
              onClick={() => updateAvailability(mode.key)}
              className={cn(
                "rounded-lg border-2 p-4 text-left transition-all",
                availability === mode.key
                  ? "border-blue-500 bg-blue-50"
                  : "border-gray-200 hover:border-gray-300"
              )}
            >
              <div className="flex items-center gap-2 mb-2">
                <span
                  className={cn("h-3 w-3 rounded-full", mode.color)}
                />
                <mode.icon className="h-4 w-4 text-gray-500" />
              </div>
              <p className="font-medium text-gray-900">{mode.label}</p>
              <p className="text-xs text-gray-500">{mode.description}</p>
            </button>
          ))}
        </div>
      </SettingsSection>

      {/* Notification Settings */}
      <SettingsSection
        title="Notifications"
        description="Choose how you want to be notified"
        icon={Bell}
      >
        <div className="space-y-6">
          {/* Critical */}
          <div className="pb-4 border-b border-gray-100">
            <div className="flex items-center gap-2 mb-3">
              <span className="h-2 w-2 rounded-full bg-red-500" />
              <span className="font-medium text-gray-900">Critical</span>
              <span className="text-xs text-gray-500">Build failed, budget exceeded</span>
            </div>
            <div className="flex items-center gap-6">
              <label className="flex items-center gap-2">
                <Toggle
                  checked={notifications.critical.email}
                  onChange={(v) => updateNotification("critical", "email", v)}
                />
                <Mail className="h-4 w-4 text-gray-400" />
                <span className="text-sm text-gray-600">Email</span>
              </label>
              <label className="flex items-center gap-2">
                <Toggle
                  checked={notifications.critical.push}
                  onChange={(v) => updateNotification("critical", "push", v)}
                />
                <Bell className="h-4 w-4 text-gray-400" />
                <span className="text-sm text-gray-600">Push</span>
              </label>
              <label className="flex items-center gap-2">
                <Toggle
                  checked={notifications.critical.sms}
                  onChange={(v) => updateNotification("critical", "sms", v)}
                />
                <Smartphone className="h-4 w-4 text-gray-400" />
                <span className="text-sm text-gray-600">SMS</span>
              </label>
            </div>
          </div>

          {/* Needs Input */}
          <div className="pb-4 border-b border-gray-100">
            <div className="flex items-center gap-2 mb-3">
              <span className="h-2 w-2 rounded-full bg-yellow-500" />
              <span className="font-medium text-gray-900">Needs Input</span>
              <span className="text-xs text-gray-500">Demo ready, approval needed</span>
            </div>
            <div className="flex items-center gap-6">
              <label className="flex items-center gap-2">
                <Toggle
                  checked={notifications.needsInput.email}
                  onChange={(v) => updateNotification("needsInput", "email", v)}
                />
                <Mail className="h-4 w-4 text-gray-400" />
                <span className="text-sm text-gray-600">Email</span>
              </label>
              <label className="flex items-center gap-2">
                <Toggle
                  checked={notifications.needsInput.push}
                  onChange={(v) => updateNotification("needsInput", "push", v)}
                />
                <Bell className="h-4 w-4 text-gray-400" />
                <span className="text-sm text-gray-600">Push</span>
              </label>
              <label className="flex items-center gap-2">
                <Toggle
                  checked={notifications.needsInput.sms}
                  onChange={(v) => updateNotification("needsInput", "sms", v)}
                />
                <Smartphone className="h-4 w-4 text-gray-400" />
                <span className="text-sm text-gray-600">SMS</span>
              </label>
            </div>
          </div>

          {/* Info */}
          <div className="pb-4 border-b border-gray-100">
            <div className="flex items-center gap-2 mb-3">
              <span className="h-2 w-2 rounded-full bg-green-500" />
              <span className="font-medium text-gray-900">Info</span>
              <span className="text-xs text-gray-500">Milestone complete</span>
            </div>
            <div className="flex items-center gap-6">
              <label className="flex items-center gap-2">
                <Toggle
                  checked={notifications.info.email}
                  onChange={(v) => updateNotification("info", "email", v)}
                />
                <Mail className="h-4 w-4 text-gray-400" />
                <span className="text-sm text-gray-600">Email</span>
              </label>
              <label className="flex items-center gap-2">
                <Toggle
                  checked={notifications.info.push}
                  onChange={(v) => updateNotification("info", "push", v)}
                />
                <Bell className="h-4 w-4 text-gray-400" />
                <span className="text-sm text-gray-600">Push</span>
              </label>
            </div>
          </div>

          {/* Silent */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <span className="h-2 w-2 rounded-full bg-gray-400" />
              <span className="font-medium text-gray-900">Silent</span>
              <span className="text-xs text-gray-500">Agent progress</span>
            </div>
            <div className="flex items-center gap-6">
              <label className="flex items-center gap-2">
                <Toggle
                  checked={notifications.silent.log}
                  onChange={(v) => updateNotification("silent", "log", v)}
                />
                <span className="text-sm text-gray-600">Log only</span>
              </label>
            </div>
          </div>

          <button
            onClick={saveNotificationSettings}
            disabled={saving}
            className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            Save Changes
          </button>
        </div>
      </SettingsSection>

      {/* Budget Defaults */}
      <SettingsSection
        title="Budget Defaults"
        description="Default limits for new projects"
        icon={DollarSign}
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Default Budget (USD)
            </label>
            <input
              type="number"
              value={budgetDefaults.defaultBudgetUsd}
              onChange={(e) =>
                setBudgetDefaults((prev) => ({
                  ...prev,
                  defaultBudgetUsd: Number(e.target.value),
                }))
              }
              className="w-full rounded-lg border border-gray-200 px-4 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Default Token Limit
            </label>
            <input
              type="number"
              value={budgetDefaults.defaultTokenLimit}
              onChange={(e) =>
                setBudgetDefaults((prev) => ({
                  ...prev,
                  defaultTokenLimit: Number(e.target.value),
                }))
              }
              className="w-full rounded-lg border border-gray-200 px-4 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Default Time Limit (hours)
            </label>
            <input
              type="number"
              value={budgetDefaults.defaultTimeHours}
              onChange={(e) =>
                setBudgetDefaults((prev) => ({
                  ...prev,
                  defaultTimeHours: Number(e.target.value),
                }))
              }
              className="w-full rounded-lg border border-gray-200 px-4 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Max Concurrent Agents
            </label>
            <input
              type="number"
              value={budgetDefaults.maxConcurrentAgents}
              onChange={(e) =>
                setBudgetDefaults((prev) => ({
                  ...prev,
                  maxConcurrentAgents: Number(e.target.value),
                }))
              }
              className="w-full rounded-lg border border-gray-200 px-4 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            />
          </div>
        </div>
      </SettingsSection>

      {/* Database Status */}
      <SettingsSection
        title="Database"
        description="PostgreSQL connection status"
        icon={Database}
      >
        {dbStatus ? (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              {dbStatus.connected ? (
                <span className="flex items-center gap-2 text-green-600">
                  <Wifi className="h-5 w-5" />
                  Connected
                </span>
              ) : (
                <span className="flex items-center gap-2 text-red-600">
                  <WifiOff className="h-5 w-5" />
                  Disconnected
                </span>
              )}
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm">
              <div>
                <p className="text-gray-500">Host</p>
                <p className="font-medium text-gray-900">{dbStatus.host}</p>
              </div>
              <div>
                <p className="text-gray-500">Database</p>
                <p className="font-medium text-gray-900">{dbStatus.database}</p>
              </div>
              <div>
                <p className="text-gray-500">Pool Size</p>
                <p className="font-medium text-gray-900">{dbStatus.poolSize}</p>
              </div>
              <div>
                <p className="text-gray-500">Active Connections</p>
                <p className="font-medium text-gray-900">{dbStatus.activeConnections}</p>
              </div>
              <div>
                <p className="text-gray-500">Idle Connections</p>
                <p className="font-medium text-gray-900">{dbStatus.idleConnections}</p>
              </div>
            </div>
          </div>
        ) : (
          <p className="text-gray-500">Unable to fetch database status</p>
        )}
      </SettingsSection>

      {/* Model Pricing */}
      <SettingsSection
        title="Model Pricing"
        description="Current API pricing configuration"
        icon={Key}
      >
        {modelPricing.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left py-2 font-medium text-gray-500">Model</th>
                  <th className="text-right py-2 font-medium text-gray-500">
                    Input $/1K
                  </th>
                  <th className="text-right py-2 font-medium text-gray-500">
                    Output $/1K
                  </th>
                  <th className="text-right py-2 font-medium text-gray-500">
                    Cached Input $/1K
                  </th>
                </tr>
              </thead>
              <tbody>
                {modelPricing.map((model) => (
                  <tr key={model.model} className="border-b border-gray-100">
                    <td className="py-3">
                      <span className="font-medium text-gray-900">{model.model}</span>
                      <span className="ml-2 text-xs text-gray-400">{model.provider}</span>
                    </td>
                    <td className="py-3 text-right text-gray-900">
                      ${model.inputPricePer1k.toFixed(4)}
                    </td>
                    <td className="py-3 text-right text-gray-900">
                      ${model.outputPricePer1k.toFixed(4)}
                    </td>
                    <td className="py-3 text-right text-gray-500">
                      {model.cachedInputPricePer1k
                        ? `$${model.cachedInputPricePer1k.toFixed(4)}`
                        : "-"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-gray-500">No pricing data available</p>
        )}
      </SettingsSection>
    </div>
  );
}
