import type { ModeModelOption } from "@/lib/api";
import { resolveModelValue } from "@/lib/useModeModels";

export function ModelPicker({
  options,
  defaultAlias,
  value,
  onChange,
  disabled,
  loading,
}: {
  options: ModeModelOption[];
  defaultAlias?: string | undefined;
  value?: string | undefined;
  onChange: (alias: string) => void;
  disabled?: boolean | undefined;
  loading?: boolean | undefined;
}) {
  if (loading || options.length === 0) return null;

  const effective = resolveModelValue(options, defaultAlias, value);

  return (
    <div className="flex items-center gap-2 px-1 py-2 text-xs text-gray-500">
      <span className="text-gray-400">Model:</span>
      <select
        value={effective}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        aria-label="Model"
        className="flex items-center gap-1 px-2 py-1 rounded-lg border border-gray-200 bg-white/80 text-gray-700 focus:outline-none focus:ring-1 focus:ring-black/20 disabled:opacity-50 cursor-pointer"
      >
        {options.map((opt) => (
          <option key={opt.alias} value={opt.alias}>
            {opt.paramSize} — {opt.displayName}
          </option>
        ))}
      </select>
    </div>
  );
}
