import { ArrowUp } from "lucide-react";
import { useState, type KeyboardEvent } from "react";

type Props = {
  onSend: (text: string) => void;
  disabled?: boolean;
};

// Pill input + circular send button — same shape as QueckSilver AI's
// ChatInput.tsx send button (rounded-full bg-primary text-primary-foreground).
export function ZoraChatInput({ onSend, disabled }: Props) {
  const [value, setValue] = useState("");

  const submit = () => {
    const text = value.trim();
    if (!text || disabled) return;
    onSend(text);
    setValue("");
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div className="flex items-end gap-2 rounded-full border border-border bg-card px-4 py-2.5">
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder="Ask me anything..."
        rows={1}
        className="max-h-32 min-h-[24px] flex-1 resize-none self-center bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
      />
      <button
        onClick={submit}
        disabled={disabled || !value.trim()}
        title="Send  ⌘↵"
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-opacity hover:opacity-80 disabled:opacity-25"
      >
        <ArrowUp className="h-4 w-4" />
      </button>
    </div>
  );
}
