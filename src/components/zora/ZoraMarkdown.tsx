import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import { CodeBlock } from "./CodeBlock";

// Same rendering stack as QueckSilver AI's ChatMessage.tsx (react-markdown +
// remark-math/rehype-katex for LaTeX, remark-gfm for tables/strikethrough),
// scaled down for the sidebar. No @tailwindcss/typography plugin here (this
// project doesn't have it — Lovable's locked vite config, see master plan),
// so spacing/weight come from explicit component overrides below instead of
// `prose` classes.
export function ZoraMarkdown({ text }: { text: string }) {
  return (
    <div className="text-sm leading-relaxed text-foreground [&_.katex-display]:my-3 [&_.katex-display]:overflow-x-auto [&_.katex]:text-foreground">
      <ReactMarkdown
        remarkPlugins={[remarkMath, remarkGfm]}
        rehypePlugins={[[rehypeKatex, { throwOnError: false, strict: false }]]}
        components={{
          p: ({ children }) => <p className="my-2 first:mt-0 last:mb-0">{children}</p>,
          h1: ({ children }) => <h1 className="mb-2 mt-4 text-base font-semibold first:mt-0">{children}</h1>,
          h2: ({ children }) => <h2 className="mb-2 mt-4 text-base font-semibold first:mt-0">{children}</h2>,
          h3: ({ children }) => <h3 className="mb-1.5 mt-3 text-sm font-semibold first:mt-0">{children}</h3>,
          ul: ({ children }) => <ul className="my-2 list-disc space-y-1 pl-5">{children}</ul>,
          ol: ({ children }) => <ol className="my-2 list-decimal space-y-1 pl-5">{children}</ol>,
          li: ({ children }) => <li className="pl-0.5">{children}</li>,
          strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-2">
              {children}
            </a>
          ),
          blockquote: ({ children }) => (
            <blockquote className="my-2 border-l-2 border-border pl-3 text-muted-foreground">{children}</blockquote>
          ),
          hr: () => <hr className="my-3 border-border" />,
          table: ({ children }) => (
            <div className="my-2 overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-xs">{children}</table>
            </div>
          ),
          th: ({ children }) => <th className="border-b border-border bg-muted/50 px-2 py-1 text-left font-medium">{children}</th>,
          td: ({ children }) => <td className="border-b border-border/60 px-2 py-1">{children}</td>,
          code({ className, children }) {
            const match = /language-(\w+)/.exec(className || "");
            const codeStr = String(children).replace(/\n$/, "");
            if (!match && !codeStr.includes("\n")) {
              return <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]">{codeStr}</code>;
            }
            return <CodeBlock lang={match?.[1] ?? ""} code={codeStr} />;
          },
          pre({ children }) {
            return <>{children}</>;
          },
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
