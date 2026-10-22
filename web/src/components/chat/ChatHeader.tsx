"use client";

/**
 * 聊天顶栏（当前未被页面引用，保留为可复用组件）。
 * 样式统一走 globals.css 设计 token：nav-glass 毛玻璃顶栏 +
 * accent 图标块 + chip-btn 次级按钮，支持明暗主题。
 */
interface ChatHeaderProps {
  onClearChat: () => void;
}

export function ChatHeader({ onClearChat }: ChatHeaderProps) {
  return (
    <div className="sticky top-0 z-10 nav-glass">
      <div className="max-w-3xl mx-auto px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center"
              style={{
                background: "var(--accent)",
                color: "var(--accent-fg)",
                boxShadow: "var(--shadow-inset), var(--shadow-xs)",
              }}
            >
              <svg
                className="w-5 h-5"
                viewBox="0 0 20 20"
                fill="currentColor"
                aria-hidden
              >
                <path d="M10 2L3 7v11h4v-6h6v6h4V7l-7-5z" />
              </svg>
            </div>
            <div>
              <h1
                className="text-[17px] font-semibold leading-[1.24] tracking-[-0.374px]"
                style={{ color: "var(--fg1)" }}
              >
                AI Assistant
              </h1>
              <p
                className="text-[12px] leading-[1.33] tracking-[-0.12px]"
                style={{ color: "var(--fg2)" }}
              >
                Chat · Apple Style
              </p>
            </div>
          </div>
          <button
            onClick={onClearChat}
            className="chip-btn px-3 py-1.5 text-[13px] leading-[1.29] tracking-[-0.224px]"
            style={{ borderRadius: 980 }}
          >
            Clear Chat
          </button>
        </div>
      </div>
    </div>
  );
}
