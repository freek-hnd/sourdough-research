import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useContainerTypes } from "@/hooks/useContainerTypes";

const ADD_CUSTOM_TOKEN = "__add_custom__";

interface Props {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  /** Compact mode for tight per-jar rows. */
  compact?: boolean;
}

/**
 * Container picker. Shows a dropdown with:
 *   - everything currently in the items table (so containers used
 *     before are reusable with one click), plus a small predefined
 *     baseline (Jar (starter), Banneton, etc.)
 *   - a final "+ Add custom…" option that flips into a text input
 *     so the user can type a new label.
 *
 * If the current `value` isn't in the option list (i.e. it was a
 * custom one entered earlier), we render the input mode so editing
 * stays straightforward.
 */
export function ContainerInput({ value, onChange, placeholder, compact }: Props) {
  const { data: options = [] } = useContainerTypes();
  const [customMode, setCustomMode] = useState(false);

  // Sync custom mode when external value can't be represented in the
  // dropdown. We do this in an effect (not derived) so the user can
  // type custom values without the input remounting on every keystroke.
  useEffect(() => {
    if (value && !options.includes(value) && !customMode) {
      setCustomMode(true);
    }
  }, [value, options, customMode]);

  if (customMode) {
    return (
      <div className={compact ? "flex gap-1" : "flex gap-2"}>
        <Input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder ?? "Type a name…"}
          className="flex-1"
        />
        <Button
          type="button"
          variant="outline"
          size={compact ? "sm" : "default"}
          onClick={() => {
            setCustomMode(false);
            // Don't blank the value — let the user keep what they typed
            // and pick from the list if they want.
          }}
        >
          List
        </Button>
      </div>
    );
  }

  return (
    <Select
      value={options.includes(value) ? value : ""}
      onValueChange={(v) => {
        if (v == null) return;
        if (v === ADD_CUSTOM_TOKEN) {
          setCustomMode(true);
          onChange("");
        } else {
          onChange(v);
        }
      }}
    >
      <SelectTrigger>
        <SelectValue placeholder={placeholder ?? "Choose…"}>
          {value || placeholder || "Choose…"}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {options.map((opt) => (
          <SelectItem key={opt} value={opt}>
            {opt}
          </SelectItem>
        ))}
        <SelectItem value={ADD_CUSTOM_TOKEN}>+ Add custom…</SelectItem>
      </SelectContent>
    </Select>
  );
}
