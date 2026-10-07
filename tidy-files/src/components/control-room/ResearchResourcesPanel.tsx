import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  getResearchResources,
  createResearchResourceCategory,
  deleteResearchResourceCategory,
  addResearchResourceSite,
  deleteResearchResourceSite,
  getTrustEntries,
  addTrustEntry,
  deleteTrustEntry,
  type ResearchResourceCategory,
  type TrustEntryKind,
  type TrustEntriesResponse,
} from "@/lib/api";

function toError(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

const TRUST_SECTIONS: Array<{
  kind: TrustEntryKind;
  title: string;
  description: string;
  placeholder: string;
}> = [
  {
    kind: "high",
    title: "Trusted domains",
    description: "Domains treated as trusted when ranking search results.",
    placeholder: "Add a domain, e.g. nasa.gov",
  },
  {
    kind: "suffix",
    title: "Trusted suffixes",
    description: "Domain suffixes treated as trusted (e.g. .gov, .edu).",
    placeholder: "Add a suffix, e.g. .gov",
  },
  {
    kind: "low",
    title: "Low trust domains",
    description: "Domains ranked lower or dropped when better results exist.",
    placeholder: "Add a domain, e.g. reddit.com",
  },
];

export function ResearchResourcesPanel() {
  const [categories, setCategories] = React.useState<ResearchResourceCategory[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [siteDrafts, setSiteDrafts] = React.useState<Record<number, string>>({});
  const [siteErrors, setSiteErrors] = React.useState<Record<number, string | null>>({});
  const [categoryDraft, setCategoryDraft] = React.useState("");
  const [categoryError, setCategoryError] = React.useState<string | null>(null);
  const [trustEntries, setTrustEntries] = React.useState<TrustEntriesResponse>({
    high: [],
    suffix: [],
    low: [],
  });
  const [trustDrafts, setTrustDrafts] = React.useState<Record<TrustEntryKind, string>>({
    high: "",
    suffix: "",
    low: "",
  });
  const [trustErrors, setTrustErrors] = React.useState<Record<TrustEntryKind, string | null>>({
    high: null,
    suffix: null,
    low: null,
  });

  const refresh = async () => {
    try {
      const data = await getResearchResources();
      setCategories(data.categories);
      setError(null);
    } catch (err) {
      setError(toError(err, "Failed to load research resources"));
    }
  };

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      const [resources, trust] = await Promise.allSettled([
        getResearchResources(),
        getTrustEntries(),
      ]);
      if (cancelled) return;
      if (resources.status === "fulfilled") {
        setCategories(resources.value.categories);
      } else {
        setError(toError(resources.reason, "Failed to load research resources"));
      }
      if (trust.status === "fulfilled") {
        setTrustEntries(trust.value);
      } else {
        setError(toError(trust.reason, "Failed to load trust list"));
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSiteChange = (categoryId: number, value: string) => {
    setSiteDrafts((prev) => ({ ...prev, [categoryId]: value }));
    setSiteErrors((prev) => ({ ...prev, [categoryId]: null }));
  };

  const handleAddSite = async (categoryId: number) => {
    if (busy) return;
    const url = (siteDrafts[categoryId] ?? "").trim();
    if (!url) return;
    setBusy(true);
    try {
      await addResearchResourceSite(categoryId, url);
      setSiteDrafts((prev) => ({ ...prev, [categoryId]: "" }));
      setSiteErrors((prev) => ({ ...prev, [categoryId]: null }));
      await refresh();
    } catch (err) {
      setSiteErrors((prev) => ({
        ...prev,
        [categoryId]: toError(err, "Failed to add site"),
      }));
    } finally {
      setBusy(false);
    }
  };

  const handleRemoveSite = async (siteId: number) => {
    if (busy) return;
    setBusy(true);
    try {
      await deleteResearchResourceSite(siteId);
      await refresh();
    } catch (err) {
      setError(toError(err, "Failed to remove site"));
    } finally {
      setBusy(false);
    }
  };

  const handleRemoveCategory = async (categoryId: number) => {
    if (busy) return;
    setBusy(true);
    try {
      await deleteResearchResourceCategory(categoryId);
      await refresh();
    } catch (err) {
      setError(toError(err, "Failed to remove category"));
    } finally {
      setBusy(false);
    }
  };

  const handleCategoryChange = (value: string) => {
    setCategoryDraft(value);
    setCategoryError(null);
  };

  const handleAddCategory = async () => {
    if (busy) return;
    const name = categoryDraft.trim();
    if (!name) return;
    setBusy(true);
    try {
      await createResearchResourceCategory(name);
      setCategoryDraft("");
      setCategoryError(null);
      await refresh();
    } catch (err) {
      setCategoryError(toError(err, "Failed to add category"));
    } finally {
      setBusy(false);
    }
  };

  const refreshTrust = async () => {
    try {
      const trust = await getTrustEntries();
      setTrustEntries(trust);
    } catch (err) {
      setError(toError(err, "Failed to load trust list"));
    }
  };

  const handleTrustChange = (kind: TrustEntryKind, value: string) => {
    setTrustDrafts((prev) => ({ ...prev, [kind]: value }));
    setTrustErrors((prev) => ({ ...prev, [kind]: null }));
  };

  const handleAddTrustEntry = async (kind: TrustEntryKind) => {
    if (busy) return;
    const value = (trustDrafts[kind] ?? "").trim();
    if (!value) return;
    setBusy(true);
    try {
      await addTrustEntry(kind, value);
      setTrustDrafts((prev) => ({ ...prev, [kind]: "" }));
      setTrustErrors((prev) => ({ ...prev, [kind]: null }));
      await refreshTrust();
    } catch (err) {
      setTrustErrors((prev) => ({
        ...prev,
        [kind]: toError(err, "Failed to add entry"),
      }));
    } finally {
      setBusy(false);
    }
  };

  const handleRemoveTrustEntry = async (entryId: number) => {
    if (busy) return;
    setBusy(true);
    try {
      await deleteTrustEntry(entryId);
      await refreshTrust();
    } catch (err) {
      setError(toError(err, "Failed to remove entry"));
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <h2 className="text-xs uppercase tracking-wider text-zinc-500">Research Resources</h2>
        <p className="text-xs text-zinc-500">Loading research resources…</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xs uppercase tracking-wider text-zinc-500">Research Resources</h2>
        <p className="text-xs text-zinc-500">
          Trustworthy websites grouped by category, max 10 each.
        </p>
      </div>

      {error && (
        <p
          role="alert"
          className="text-xs text-red-600 border border-red-200 bg-red-50 rounded-md px-3 py-2"
        >
          {error}
        </p>
      )}

      <div className="space-y-6" role="list" aria-label="Research resource categories">
        {categories.map((category) => {
          const draft = siteDrafts[category.id] ?? "";
          const siteError = siteErrors[category.id] ?? null;

          return (
            <div key={category.id} className="space-y-3" role="listitem">
              <div className="flex items-center justify-between">
                <h3 className="text-xs uppercase tracking-wider text-zinc-500">{category.name}</h3>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleRemoveCategory(category.id)}
                  disabled={busy}
                  className="gap-1.5"
                >
                  Remove
                </Button>
              </div>

              <div className="space-y-2">
                {category.sites.length === 0 && (
                  <p className="text-xs text-zinc-500">No sites yet.</p>
                )}
                {category.sites.map((site) => (
                  <div
                    key={site.id}
                    className="flex items-start gap-4 p-4 rounded-xl bg-white/30 border border-white/40"
                  >
                    <p className="flex-1 min-w-0 text-sm font-medium text-zinc-900 break-all">
                      {site.url}
                    </p>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleRemoveSite(site.id)}
                      disabled={busy}
                      className="gap-1.5 flex-shrink-0"
                    >
                      Remove
                    </Button>
                  </div>
                ))}
              </div>

              <div className="space-y-2">
                <Textarea
                  value={draft}
                  onChange={(e) => handleSiteChange(category.id, e.target.value)}
                  rows={1}
                  className="font-mono text-sm"
                  placeholder="Add a website address, e.g. nasa.gov"
                  aria-label={`Add a site to ${category.name}`}
                  disabled={busy}
                />
                {siteError && (
                  <p role="alert" className="text-xs text-red-600">
                    {siteError}
                  </p>
                )}
                <div className="flex justify-end">
                  <Button
                    size="sm"
                    onClick={() => handleAddSite(category.id)}
                    disabled={busy || draft.trim().length === 0}
                    className="gap-1.5"
                  >
                    Add site
                  </Button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="space-y-3 pt-4 border-t border-white/40">
        <h3 className="text-xs uppercase tracking-wider text-zinc-500">New category</h3>
        <Textarea
          value={categoryDraft}
          onChange={(e) => handleCategoryChange(e.target.value)}
          rows={1}
          className="font-mono text-sm"
          placeholder="Category name, e.g. Astronomy"
          aria-label="New category name"
          disabled={busy}
        />
        {categoryError && (
          <p role="alert" className="text-xs text-red-600">
            {categoryError}
          </p>
        )}
        <div className="flex justify-end">
          <Button
            size="sm"
            onClick={handleAddCategory}
            disabled={busy || categoryDraft.trim().length === 0}
            className="gap-1.5"
          >
            Add category
          </Button>
        </div>
      </div>

      <h2 className="text-xs uppercase tracking-wider text-zinc-500 pt-4 border-t border-white/40">
        Trust list
      </h2>

      <div className="space-y-6">
        {TRUST_SECTIONS.map((section) => {
          const entries = trustEntries[section.kind];
          const draft = trustDrafts[section.kind] ?? "";
          const trustError = trustErrors[section.kind] ?? null;

          return (
            <div key={section.kind} className="space-y-3" role="list" aria-label={section.title}>
              <div className="space-y-1">
                <h3 className="text-xs uppercase tracking-wider text-zinc-500">{section.title}</h3>
                <p className="text-xs text-zinc-500">{section.description}</p>
              </div>

              <div className="space-y-2">
                {entries.length === 0 && <p className="text-xs text-zinc-500">No entries yet.</p>}
                {entries.map((entry) => (
                  <div
                    key={entry.id}
                    className="flex items-start gap-4 p-4 rounded-xl bg-white/30 border border-white/40"
                  >
                    <p className="flex-1 min-w-0 text-sm font-medium text-zinc-900 break-all">
                      {entry.value}
                    </p>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleRemoveTrustEntry(entry.id)}
                      disabled={busy}
                      className="gap-1.5 flex-shrink-0"
                    >
                      Remove
                    </Button>
                  </div>
                ))}
              </div>

              <div className="space-y-2">
                <Textarea
                  value={draft}
                  onChange={(e) => handleTrustChange(section.kind, e.target.value)}
                  rows={1}
                  className="font-mono text-sm"
                  placeholder={section.placeholder}
                  aria-label={`Add to ${section.title}`}
                  disabled={busy}
                />
                {trustError && (
                  <p role="alert" className="text-xs text-red-600">
                    {trustError}
                  </p>
                )}
                <div className="flex justify-end">
                  <Button
                    size="sm"
                    onClick={() => handleAddTrustEntry(section.kind)}
                    disabled={busy || draft.trim().length === 0}
                    className="gap-1.5"
                  >
                    Add entry
                  </Button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

import * as React from "react";
