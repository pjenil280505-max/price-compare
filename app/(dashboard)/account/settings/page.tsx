"use client";

import { useCallback, useEffect, useState } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import { ErrorState } from "@/components/ui/ErrorState";
import { useToast } from "@/components/ui/Toast";

interface Preferences {
  notifyEmail: boolean;
  notifyPush: boolean;
  notifyPriceDrop: boolean;
  notifyBackInStock: boolean;
  notifyProductNews: boolean;
}
interface Profile {
  email: string | null;
  displayName: string | null;
  preferences: Preferences;
}

const PREFERENCE_FIELDS: { key: keyof Preferences; label: string; description: string }[] = [
  { key: "notifyPriceDrop", label: "Price alerts", description: "When a product hits your target price." },
  { key: "notifyBackInStock", label: "Back in stock", description: "When a saved product becomes available again." },
  { key: "notifyEmail", label: "Email delivery", description: "Send the above by email as well as in-app." },
  { key: "notifyProductNews", label: "Product news", description: "Occasional updates about this service. Off by default." },
];

export default function AccountSettingsPage() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const { toast } = useToast();

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch("/api/profile");
      if (!res.ok) throw new Error();
      const data: Profile = await res.json();
      setProfile(data);
      setDisplayName(data.displayName ?? "");
    } catch {
      setError("Couldn't load your settings.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function patch(body: Record<string, unknown>, successMessage: string) {
    setIsSaving(true);
    try {
      const res = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error();
      toast({ title: successMessage, variant: "success" });
    } catch {
      toast({ title: "Couldn't save that change", variant: "error" });
      await load();
    } finally {
      setIsSaving(false);
    }
  }

  async function togglePreference(key: keyof Preferences, value: boolean) {
    if (!profile) return;
    // Optimistic; reloaded from the server if the write fails.
    setProfile({ ...profile, preferences: { ...profile.preferences, [key]: value } });
    await patch({ preferences: { [key]: value } }, "Preferences saved");
  }

  async function clearHistory() {
    try {
      const res = await fetch("/api/recently-viewed", { method: "DELETE" });
      if (!res.ok) throw new Error();
      toast({ title: "Recently viewed cleared", variant: "success" });
    } catch {
      toast({ title: "Couldn't clear history", variant: "error" });
    }
  }

  if (error) return <ErrorState description={error} onRetry={load} />;

  return (
    <>
      <PageHeader title="Settings" description="Your profile and how we notify you." />

      {!profile ? (
        <div className="mt-8 flex flex-col gap-4">
          <Skeleton className="h-32 w-full rounded-lg" />
          <Skeleton className="h-64 w-full rounded-lg" />
        </div>
      ) : (
        <div className="mt-8 flex max-w-xl flex-col gap-8">
          <section className="rounded-lg border border-ink-100 p-5 dark:border-ink-800">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-400">Profile</h2>
            <div className="mt-4 flex flex-col gap-4">
              <div>
                <span className="mb-1.5 block text-sm font-medium text-ink-700 dark:text-ink-200">Email</span>
                <p className="font-tabular text-sm text-ink-500 dark:text-ink-400">{profile.email ?? "—"}</p>
                <p className="mt-1 text-xs text-ink-400">
                  Changing your email isn&apos;t supported yet — it requires re-verification.
                </p>
              </div>
              <Input
                name="displayName"
                label="Display name"
                maxLength={80}
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
              />
              <Button
                size="md"
                isLoading={isSaving}
                onClick={() => patch({ profile: { displayName } }, "Profile saved")}
                className="w-fit"
              >
                Save profile
              </Button>
            </div>
          </section>

          <section className="rounded-lg border border-ink-100 p-5 dark:border-ink-800">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-400">Notifications</h2>
            <ul className="mt-4 flex flex-col gap-4">
              {PREFERENCE_FIELDS.map((field) => (
                <li key={field.key} className="flex items-start justify-between gap-4">
                  <label htmlFor={`pref-${field.key}`} className="flex-1 cursor-pointer">
                    <span className="block text-sm font-medium text-ink dark:text-paper">{field.label}</span>
                    <span className="block text-xs text-ink-400">{field.description}</span>
                  </label>
                  <button
                    id={`pref-${field.key}`}
                    type="button"
                    role="switch"
                    aria-checked={profile.preferences[field.key]}
                    aria-label={field.label}
                    onClick={() => togglePreference(field.key, !profile.preferences[field.key])}
                    data-active={profile.preferences[field.key]}
                    className="relative h-6 w-11 shrink-0 rounded-full bg-ink-200 transition-colors data-[active=true]:bg-jade-500 dark:bg-ink-700"
                  >
                    <span
                      className="absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform"
                      style={{ transform: profile.preferences[field.key] ? "translateX(20px)" : "translateX(0)" }}
                    />
                  </button>
                </li>
              ))}
            </ul>
          </section>

          <section className="rounded-lg border border-ink-100 p-5 dark:border-ink-800">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-400">Your data</h2>
            <p className="mt-3 text-sm text-ink-500 dark:text-ink-400">
              Recently viewed products are kept for 90 days, capped at 50 items, and are only ever
              visible to you.
            </p>
            <Button variant="outline" size="md" onClick={clearHistory} className="mt-4 w-fit">
              Clear recently viewed
            </Button>
          </section>
        </div>
      )}
    </>
  );
}
