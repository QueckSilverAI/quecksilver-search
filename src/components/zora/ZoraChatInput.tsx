import { ArrowUp, Plus, Square, X } from "lucide-react";
import { useRef, useState, type KeyboardEvent } from "react";
import { ZoraMascot } from "@/components/QueckSilverMarks";
import { ZoraModelSelector } from "./ZoraModelSelector";
import type { ImageAttachment } from "@/hooks/use-zora-chat";

type Props = {
  onSend: (text: string, attachment?: ImageAttachment) => void;
  disabled?: boolean;
  // When set, the send button in this same slot becomes a stop button
  // instead — same pattern as QueckSilver AI's own ChatInput.tsx (one
  // button, not a second one appearing off to the side once a reply
  // starts generating).
  isLoading?: boolean;
  onStop?: () => void;
};

const MAX_HEIGHT_PX = 200;

// Same composer layout as QueckSilver AI's own ChatInput.tsx: a tall
// rounded box, "+" for attaching a file directly (not a drop zone) along
// the bottom-left, the model picker + send button bottom-right — brought
// here so Zora's sidebar reads as the same product, not a lighter, less
// capable cousin of it.
export function ZoraChatInput({ onSend, disabled, isLoading, onStop }: Props) {
  const [value, setValue] = useState("");
  const [attachment, setAttachment] = useState<ImageAttachment | null>(null);
  const [pickingFile, setPickingFile] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const resize = (el: HTMLTextAreaElement) => {
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT_PX)}px`;
  };

  const submit = () => {
    const text = value.trim();
    if ((!text && !attachment) || disabled) return;
    onSend(text, attachment ?? undefined);
    setValue("");
    setAttachment(null);
    // Cleared value means scrollHeight collapses back down too — reset
    // explicitly rather than waiting on the next onChange, since clearing
    // via setValue here doesn't itself fire a change event on the textarea.
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  const pickImage = async () => {
    if (!window.browserAPI) return;
    setPickingFile(true);
    try {
      const picked = await window.browserAPI.zora.pickImageFile();
      if (picked) setAttachment(picked);
    } finally {
      setPickingFile(false);
    }
  };

  return (
    <div className="relative">
      {/* Only appears once a message has actually been sent (Enter/submit
          — not while still typing), and stays while Zora is working on the
          reply. Conditionally rendered (not just hidden) so the pop
          animation genuinely replays every time it reappears, i.e. on
          every new send. */}
      {isLoading && (
        <ZoraMascot className="zora-mascot-pop pointer-events-none absolute -top-10 right-9 h-11 w-11 text-primary" />
      )}
      <style>{`
        @keyframes zora-mascot-pop {
          0% { opacity: 0; transform: translateY(10px) scale(0.6); }
          65% { opacity: 1; transform: translateY(-2px) scale(1.06); }
          100% { opacity: 1; transform: translateY(0) scale(1); }
        }
        .zora-mascot-pop { animation: zora-mascot-pop 320ms cubic-bezier(0.34, 1.56, 0.64, 1) both; }
      `}</style>
      <div className="flex min-h-[104px] flex-col rounded-3xl border border-border bg-card px-4 pb-2.5 pt-3.5">
        {attachment && (
          <div className="mb-2 flex items-center gap-2 self-start rounded-xl bg-muted px-2 py-1.5">
            <img
              src={`data:${attachment.mimeType};base64,${attachment.base64}`}
              alt=""
              className="h-8 w-8 rounded-lg object-cover"
            />
            <span className="max-w-[140px] truncate text-[11px] text-muted-foreground">{attachment.name}</span>
            <button
              onClick={() => setAttachment(null)}
              aria-label="Remove attachment"
              className="rounded-full p-0.5 text-muted-foreground hover:bg-background hover:text-foreground"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        )}
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            resize(e.target);
          }}
          onKeyDown={onKeyDown}
          placeholder="Ask me anything..."
          rows={1}
          className="max-h-[200px] min-h-[24px] flex-1 resize-none overflow-y-auto bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
        />
        <div className="flex items-center justify-between pt-2">
          <button
            onClick={() => void pickImage()}
            disabled={pickingFile}
            title="Attach an image"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40"
          >
            <Plus className="h-4 w-4" />
          </button>
          <div className="flex items-center gap-1.5">
            <ZoraModelSelector />
            {isLoading ? (
              <button
                onClick={onStop}
                title="Stop"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-opacity hover:opacity-80"
              >
                <Square className="h-3.5 w-3.5 fill-current" />
              </button>
            ) : (
              <button
                onClick={submit}
                disabled={disabled || (!value.trim() && !attachment)}
                title="Send  ⌘↵"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-opacity hover:opacity-80 disabled:opacity-25"
              >
                <ArrowUp className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
